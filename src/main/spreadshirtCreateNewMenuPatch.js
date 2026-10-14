const videoFlow = require('./spreadshirtVideoFlowPatch');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function isVisible(locator) {
  try {
    return Boolean(await locator.count()) && await locator.first().isVisible();
  } catch {
    return false;
  }
}

async function visibleUploadSurface(page) {
  const dialogs = [
    page.getByRole('dialog'),
    page.locator('[role="dialog"]'),
    page.locator('[aria-modal="true"]')
  ];

  for (const group of dialogs) {
    const count = await group.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const dialog = group.nth(index);
      if (!(await dialog.isVisible().catch(() => false))) continue;
      const text = await dialog.innerText().catch(() => '');
      if (/Upload\s+design/i.test(text) && /Select\s+file|Browse/i.test(text)) return dialog;
    }
  }

  const hasVisibleSurface = await page.evaluate(() => {
    const visible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
    };
    const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const nodes = [...document.querySelectorAll('div,section,form,aside')].filter(visible);
    return nodes.some((node) => {
      const text = norm(node.innerText || node.textContent || '');
      if (!/Upload\s+design/i.test(text)) return false;
      const button = [...node.querySelectorAll('button,[role="button"],a')]
        .find((el) => visible(el) && /Select\s+file|Browse/i.test(norm(el.innerText || el.textContent || el.getAttribute('aria-label') || '')));
      return Boolean(button || node.querySelector('input[type="file"]'));
    });
  }).catch(() => false);

  return hasVisibleSurface ? page.locator('body') : null;
}

async function findVisibleUploadDesignAction(page) {
  const candidates = [
    page.getByRole('menuitem', { name: /^Upload Design$/i }).first(),
    page.getByRole('button', { name: /^Upload Design$/i }).first(),
    page.getByRole('link', { name: /^Upload Design$/i }).first(),
    page.locator('[role="option"]').filter({ hasText: /^\s*Upload Design\s*$/i }).first(),
    page.locator('[role="button"]').filter({ hasText: /^\s*Upload Design\s*$/i }).first(),
    page.getByText(/^Upload Design$/i, { exact: true }).first()
  ];
  for (const candidate of candidates) {
    if (await isVisible(candidate)) return candidate;
  }
  return null;
}

async function waitForCreateNewOutcome(page, timeoutMs = 6000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const surface = await visibleUploadSurface(page);
    if (surface) return { type: 'surface', surface };
    const uploadAction = await findVisibleUploadDesignAction(page);
    if (uploadAction) return { type: 'upload-action', uploadAction };
    await wait(120);
  }
  return null;
}

async function clickUploadDesignAction(page, action) {
  if (!action || !(await isVisible(action))) return false;
  await action.scrollIntoViewIfNeeded().catch(() => {});
  if (await action.click({ force: true, timeout: 3000 }).then(() => true).catch(() => false)) return true;
  const box = await action.boundingBox().catch(() => null);
  if (box?.width > 0 && box?.height > 0) {
    return page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).then(() => true).catch(() => false);
  }
  return false;
}

async function clickCreateNewLikeYesterday(page, candidate, useCoordinateFallback = false) {
  if (!(await isVisible(candidate))) return false;
  if (await candidate.isDisabled().catch(() => false)) return false;
  await candidate.scrollIntoViewIfNeeded().catch(() => {});

  // Yesterday's working upload path used a forced Playwright click. Restore that
  // exact behavior first; only use a physical coordinate click as a retry.
  if (!useCoordinateFallback) {
    return candidate.click({ force: true, timeout: 3000 }).then(() => true).catch(() => false);
  }

  const box = await candidate.boundingBox().catch(() => null);
  if (!box?.width || !box?.height) return false;
  return page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).then(() => true).catch(() => false);
}

async function openCreateNewThenUploadDesign(page) {
  if (await visibleUploadSurface(page)) return true;

  const candidates = [
    page.getByRole('button', { name: /^\+?\s*Create New$/i }).first(),
    page.getByRole('button', { name: /create new/i }).first(),
    page.getByRole('link', { name: /^\+?\s*Create New$/i }).first(),
    page.getByText(/^\+?\s*Create New$/i, { exact: true }).first()
  ];

  let createNew = null;
  for (const candidate of candidates) {
    if (await isVisible(candidate)) {
      createNew = candidate;
      break;
    }
  }
  if (!createNew) throw new Error('Spreadshirt “Create New” button was not visibly available on the Designs page.');

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const clicked = await clickCreateNewLikeYesterday(page, createNew, attempt === 1);
    if (!clicked) continue;

    // Crucial: inspect the first click result before ever clicking Create New
    // again. On the current Spreadshirt UI the first click can open a menu with
    // an “Upload Design” choice; re-clicking Create New simply closes that menu.
    const outcome = await waitForCreateNewOutcome(page, 6500);
    if (outcome?.type === 'surface') return true;
    if (outcome?.type === 'upload-action') {
      const selected = await clickUploadDesignAction(page, outcome.uploadAction);
      if (!selected) throw new Error('Spreadshirt showed the “Upload Design” choice after Create New, but ZeroPOD could not click it.');
      const surfaceStarted = Date.now();
      while (Date.now() - surfaceStarted < 7000) {
        if (await visibleUploadSurface(page)) return true;
        await wait(150);
      }
      throw new Error('Spreadshirt “Upload Design” was selected, but the upload file panel did not become visible. ZeroPOD stopped before selecting a file.');
    }
  }

  const actions = await page.evaluate(() => {
    const visible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    return [...document.querySelectorAll('button,a,[role="button"],[role="menuitem"],[role="option"]')]
      .filter(visible)
      .map((el) => String(el.innerText || el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 50);
  }).catch(() => []);
  throw new Error(`Spreadshirt “Create New” was clicked, but neither a visible “Upload Design” choice nor an upload file panel appeared. Visible actions: ${actions.join(' | ') || 'none'}`);
}

async function selectFileFromCurrentUploadSurface(page, file) {
  if (!(await visibleUploadSurface(page))) {
    throw new Error('Spreadshirt upload file panel is not visible. ZeroPOD refused to use hidden/stale file controls.');
  }

  const chooserPromise = page.waitForEvent('filechooser', { timeout: 7000 }).catch(() => null);
  const buttons = [
    page.getByRole('button', { name: /select file/i }).first(),
    page.getByRole('button', { name: /browse/i }).first(),
    page.getByText(/select file/i, { exact: true }).first(),
    page.getByText(/browse/i, { exact: true }).first()
  ];
  for (const button of buttons) {
    if (!(await isVisible(button))) continue;
    if (await button.isDisabled().catch(() => false)) continue;
    const clicked = await button.click({ force: true, timeout: 3000 }).then(() => true).catch(() => false);
    if (!clicked) continue;
    const chooser = await chooserPromise;
    if (chooser) {
      await chooser.setFiles(file);
      return 'visible-filechooser';
    }
  }

  const inputIndex = await page.evaluate(() => {
    const visible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const inputs = [...document.querySelectorAll('input[type="file"]')];
    return inputs.findIndex((input) => {
      let node = input.parentElement;
      for (let depth = 0; node && depth < 10; depth += 1, node = node.parentElement) {
        if (!visible(node)) continue;
        const text = norm(node.innerText || node.textContent || '');
        if (/Upload\s+design/i.test(text) && /Select\s+file|Browse/i.test(text)) return true;
      }
      return false;
    });
  }).catch(() => -1);

  if (inputIndex >= 0) {
    const input = page.locator('input[type="file"]').nth(inputIndex);
    if (await input.setInputFiles(file).then(() => true).catch(() => false)) return 'visible-surface-input';
  }

  throw new Error('Spreadshirt upload panel is visible, but ZeroPOD could not activate its file selector. No stale page-level file input was used.');
}

videoFlow.openCreateNewDialog = openCreateNewThenUploadDesign;
videoFlow.selectFileLikeVideo = selectFileFromCurrentUploadSurface;

module.exports = {
  openCreateNewThenUploadDesign,
  selectFileFromCurrentUploadSurface,
  visibleUploadSurface,
  findVisibleUploadDesignAction
};
