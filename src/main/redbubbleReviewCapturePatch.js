const fs = require('fs');
const path = require('path');
const { RedbubbleController } = require('./redbubbleController');

const previousPrepare = RedbubbleController.prototype.prepare;

async function captureFirstProductPreview(page, targetPath) {
  const marker = await page.evaluate(() => {
    const visible = (el) => {
      if (!(el instanceof Element)) return false;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width >= 120 && r.height >= 120 && s.display !== 'none' && s.visibility !== 'hidden';
    };
    const tidy = (value) => String(value || '').trim().replace(/\s+/g, ' ');
    const all = [...document.querySelectorAll('body *')];
    const label = all.find((el) => tidy(el.innerText || el.textContent) === 'Product Previews');
    if (!label) return null;
    label.scrollIntoView({ block: 'start', behavior: 'instant' });
    const lr = label.getBoundingClientRect();
    const images = [...document.querySelectorAll('img')]
      .filter(visible)
      .map((el) => ({ el, r: el.getBoundingClientRect(), alt: tidy(el.alt), src: String(el.currentSrc || el.src || '') }))
      .filter(({ r }) => r.top >= lr.bottom - 20 && r.top <= lr.bottom + 1800)
      .sort((a, b) => {
        const as = /shirt|t-?shirt|tee|apparel/i.test(`${a.alt} ${a.src}`) ? 0 : 1;
        const bs = /shirt|t-?shirt|tee|apparel/i.test(`${b.alt} ${b.src}`) ? 0 : 1;
        if (as !== bs) return as - bs;
        if (Math.abs(a.r.top - b.r.top) > 20) return a.r.top - b.r.top;
        return a.r.left - b.r.left;
      });
    if (!images.length) return null;
    const token = `zeropod-product-preview-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    images[0].el.setAttribute('data-zeropod-product-preview', token);
    return token;
  }).catch(() => null);

  await page.waitForTimeout(1200).catch(() => {});
  if (!marker) return false;
  const image = page.locator(`[data-zeropod-product-preview="${marker}"]`).first();
  if (!(await image.isVisible().catch(() => false))) return false;
  await image.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(500).catch(() => {});
  await image.screenshot({ path: targetPath }).catch(() => null);
  return fs.existsSync(targetPath) && fs.statSync(targetPath).size > 1000;
}

RedbubbleController.prototype.prepare = async function prepareWithReviewCapture(projectId) {
  const result = await previousPrepare.call(this, projectId);
  if (!result?.ok) return result;

  try {
    const { page } = await this.sessions.ensureService('redbubble');
    const projectDir = this.projects.getProjectDir(projectId);
    fs.mkdirSync(projectDir, { recursive: true });
    const screenshotPath = path.join(projectDir, 'redbubble-shirt-preview.png');
    const captured = await captureFirstProductPreview(page, screenshotPath);
    const latest = this.projects.read(projectId);
    this.projects.update(projectId, {
      redbubble: {
        ...(latest.redbubble || {}),
        reviewScreenshotPath: captured ? screenshotPath : null,
        reviewScreenshotCapturedAt: captured ? new Date().toISOString() : null
      }
    });
    if (captured) this.projects.addActivity(projectId, { type: 'review', label: 'Captured Redbubble shirt preview for final approval' });
  } catch (error) {
    console.warn('[ZeroPOD] Redbubble review preview capture skipped:', error?.message || error);
  }

  return { ...result, project: this.projects.read(projectId) };
};

module.exports = { captureFirstProductPreview };
