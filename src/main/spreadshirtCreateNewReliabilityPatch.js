const videoFlow = require('./spreadshirtVideoFlowPatch');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const UPLOAD_ERROR_PATTERN = /Ooops!?\s*Snap|It didn[’']t work|Unfortunately, an error occured|Unfortunately, an error occurred|upload\s+failed|could(?:n[’']?t| not)\s+upload|file\s+(?:was\s+)?not\s+uploaded/i;
const UPLOAD_LIMIT_PATTERN = /upload\s+limit|daily\s+(?:upload|design)|maximum\s+(?:number\s+of\s+)?(?:uploads?|designs?)|too\s+many\s+(?:uploads?|designs?)|exceeded[^\n]{0,80}(?:uploads?|designs?)|try\s+again\s+tomorrow/i;
const HUMAN_CHECK_PATTERN = /captcha|verify you are human|are you human|cloudflare/i;
const DESIGNS_INDEX_RE = /\/mp\/designs\/?(?:[?#].*)?$/i;
const DESIGN_EDITOR_RE = /\/mp\/designs\/[^/?#]+\/?(?:[?#].*)?$/i;

async function isVisible(locator) {
  try {
    return Boolean(await locator.count()) && await locator.first().isVisible();
  } catch {
    return false;
  }
}

async function bodyText(page) {
  return page.locator('body').innerText().catch(() => '');
}

async function visibleDialogText(page, pattern) {
  const selectors = [
    page.getByRole('dialog'),
    page.locator('[role="dialog"]'),
    page.locator('[aria-modal="true"]')
  ];

  for (const group of selectors) {
    const count = await group.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const dialog = group.nth(index);
      if (!(await dialog.isVisible().catch(() => false))) continue;
      const text = await dialog.innerText().catch(() => '');
      if (!pattern || pattern.test(text)) return { dialog, text };
    }
  }
  return null;
}

async function visibleUploadDesignDialog(page) {
  return visibleDialogText(page, /Upload\s+design/i);
}

async function visibleUploadStatusDialog(page) {
  return visibleDialogText(page, /Upload\s+status|Upload\s+successful|Ooops!?\s*Snap|upload\s+limit/i);
}

async function visibleActionLabels(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
    };
    const label = (el) => String(
      el.innerText || el.textContent || el.getAttribute?.('aria-label') || el.getAttribute?.('title') || el.value || ''
    ).replace(/\s+/g, ' ').trim();
    return [...document.querySelectorAll('button,a,[role="button"]')]
      .filter(visible)
      .map(label)
      .filter(Boolean)
      .slice(0, 40);
  }).catch(() => []);
}

async function waitForVisibleUploadDesignDialog(page, timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const found = await visibleUploadDesignDialog(page);
    if (found) return found;
    await wait(150);
  }
  return null;
}

async function clickCreateNewCandidate(page, candidate) {
  if (!(await isVisible(candidate))) return false;
  if (await candidate.isDisabled().catch(() => false)) return false;

  await candidate.scrollIntoViewIfNeeded().catch(() => {});

  // Prefer a normal trusted Playwright click, matching the flow that worked
  // before the upload-verification work. Coordinate click and force-click are
  // bounded fallbacks only when Spreadshirt's overlay/animation blocks it.
  if (await candidate.click({ timeout: 3000 }).then(() => true).catch(() => false)) return true;

  const box = await candidate.boundingBox().catch(() => null);
  if (box?.width > 0 && box?.height > 0) {
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    if (await page.mouse.click(x, y).then(() => true).catch(() => false)) return true;
  }

  return candidate.click({ force: true, timeout: 3000 }).then(() => true).catch(() => false);
}

async function openCreateNewDialogReliable(page) {
  const alreadyOpen = await visibleUploadDesignDialog(page);
  if (alreadyOpen) return true;

  const candidates = [
    page.getByRole('button', { name: /^\+?\s*Create New$/i }).first(),
    page.getByRole('button', { name: /create new/i }).first(),
    page.getByRole('link', { name: /^\+?\s*Create New$/i }).first(),
    page.getByText(/^\+?\s*Create New$/i, { exact: true }).first()
  ];

  let sawVisibleCreateNew = false;
  for (let pass = 1; pass <= 2; pass += 1) {
    for (const candidate of candidates) {
      if (!(await isVisible(candidate))) continue;
      sawVisibleCreateNew = true;
      const clicked = await clickCreateNewCandidate(page, candidate);
      if (!clicked) continue;
      const dialog = await waitForVisibleUploadDesignDialog(page, 5000);
      if (dialog) return true;
    }
    await wait(400);
  }

  const actions = await visibleActionLabels(page);
  if (!sawVisibleCreateNew) {
    throw new Error(`Spreadshirt “Create New” button is not visibly available on the Designs page. Visible actions: ${actions.join(' | ') || 'none'}`);
  }
  throw new Error(`Spreadshirt “Create New” was clicked, but a VISIBLE “Upload Design” dialog never opened. ZeroPOD stopped before selecting any file. Visible actions: ${actions.join(' | ') || 'none'}`);
}

async function selectFileFromVisibleDialog(page, file) {
  const found = await visibleUploadDesignDialog(page);
  if (!found) {
    throw new Error('Spreadshirt “Upload Design” dialog is not visible. ZeroPOD refused to use hidden/stale file controls.');
  }
  const dialog = found.dialog;

  // setInputFiles works on a hidden native <input type=file> as long as that
  // input belongs to the currently visible Upload Design modal. This is much
  // safer than scanning the whole page, where Spreadshirt keeps stale controls.
  const inputs = dialog.locator('input[type="file"]');
  const count = await inputs.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const input = inputs.nth(index);
    if (await input.setInputFiles(file).then(() => true).catch(() => false)) {
      return 'visible-dialog-input';
    }
  }

  const chooserPromise = page.waitForEvent('filechooser', { timeout: 7000 }).catch(() => null);
  const buttons = [
    dialog.getByRole('button', { name: /select file/i }).first(),
    dialog.getByRole('button', { name: /browse/i }).first(),
    dialog.getByText(/select file/i, { exact: true }).first(),
    dialog.getByText(/browse/i, { exact: true }).first()
  ];

  for (const button of buttons) {
    if (!(await isVisible(button))) continue;
    if (await button.isDisabled().catch(() => false)) continue;
    const clicked = await button.click({ timeout: 3000 }).then(() => true).catch(() => false);
    if (!clicked) continue;
    const chooser = await chooserPromise;
    if (chooser) {
      await chooser.setFiles(file);
      return 'visible-dialog-filechooser';
    }
  }

  throw new Error('Spreadshirt “Upload Design” dialog is visible, but its file selector could not be used. No hidden page-level file input was touched.');
}

async function waitForUploadResultFromVisibleState(page, timeoutMs = 60000) {
  const started = Date.now();
  let sawVisibleUploadStatus = false;
  let statusDisappearedAt = 0;
  let uploadDialogDisappearedAt = 0;
  let lastStatusText = '';

  while (Date.now() - started < timeoutMs) {
    const globalText = await bodyText(page);
    if (HUMAN_CHECK_PATTERN.test(globalText)) {
      throw new Error('Spreadshirt is showing a human-verification challenge. Complete it manually, then retry.');
    }

    const status = await visibleUploadStatusDialog(page);
    const uploadDialog = await visibleUploadDesignDialog(page);
    const url = page.url();

    if (status) {
      sawVisibleUploadStatus = true;
      statusDisappearedAt = 0;
      lastStatusText = status.text || '';
      if (UPLOAD_LIMIT_PATTERN.test(lastStatusText)) {
        throw new Error('Spreadshirt rejected the file because an upload/design limit is active. ZeroPOD did not record this artwork as uploaded.');
      }
      if (UPLOAD_ERROR_PATTERN.test(lastStatusText)) {
        throw new Error(`Spreadshirt rejected the upload. ZeroPOD did not record this artwork as uploaded. Visible Upload Status: ${String(lastStatusText).replace(/\s+/g, ' ').trim().slice(0, 500)}`);
      }
      if (/Upload\s+successful/i.test(lastStatusText)) {
        return { ok: true, confirmed: true, sawUploadStatus: true, reason: 'visible-upload-success', url };
      }
    } else if (sawVisibleUploadStatus) {
      if (!statusDisappearedAt) statusDisappearedAt = Date.now();
    }

    if (DESIGN_EDITOR_RE.test(url)) {
      return { ok: true, confirmed: true, sawUploadStatus: sawVisibleUploadStatus, reason: 'direct-design-editor', url };
    }
    if (/Design products/i.test(globalText) && /Metadata/i.test(globalText)) {
      return { ok: true, confirmed: true, sawUploadStatus: sawVisibleUploadStatus, reason: 'design-editor-ready', url };
    }

    // The only ambiguous handoff we accept is one that follows a VISIBLE Upload
    // Status modal. Hidden stale text can no longer manufacture an upload event.
    if (sawVisibleUploadStatus && !status && DESIGNS_INDEX_RE.test(url)) {
      if (!statusDisappearedAt) statusDisappearedAt = Date.now();
      if (Date.now() - statusDisappearedAt >= 1500) {
        return {
          ok: true,
          confirmed: false,
          needsCardVerification: true,
          sawUploadStatus: true,
          reason: 'visible-status-closed-needs-card-verification',
          url
        };
      }
    }

    // If the visible Upload Design modal vanished but no visible Upload Status
    // ever appeared, fail near the real cause instead of waiting for a fake new
    // card for 90 seconds.
    if (!sawVisibleUploadStatus && !uploadDialog) {
      if (!uploadDialogDisappearedAt) uploadDialogDisappearedAt = Date.now();
      if (Date.now() - uploadDialogDisappearedAt >= 12000 && DESIGNS_INDEX_RE.test(url)) {
        throw new Error('Spreadshirt never showed a VISIBLE “Upload Status” after ZeroPOD selected the file. The upload did not enter a verifiable state, so ZeroPOD stopped before checking for a new design card.');
      }
    } else {
      uploadDialogDisappearedAt = 0;
    }

    await wait(250);
  }

  throw new Error(
    `Spreadshirt upload did not reach a visible, verifiable state within ${Math.round(timeoutMs / 1000)} seconds. ` +
    `Saw visible Upload Status: ${sawVisibleUploadStatus ? 'yes' : 'no'}. Current page: ${page.url()}. ` +
    `Last visible status: ${String(lastStatusText || 'none').replace(/\s+/g, ' ').trim().slice(0, 500)}`
  );
}

videoFlow.openCreateNewDialog = openCreateNewDialogReliable;
videoFlow.selectFileLikeVideo = selectFileFromVisibleDialog;
videoFlow.waitForUploadResult = waitForUploadResultFromVisibleState;

module.exports = {
  openCreateNewDialogReliable,
  selectFileFromVisibleDialog,
  waitForUploadResultFromVisibleState,
  visibleUploadDesignDialog,
  visibleUploadStatusDialog
};
