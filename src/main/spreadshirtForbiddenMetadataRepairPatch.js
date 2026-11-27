const { feature } = require('./spreadshirtAlphaIpc');
const { restoreDesignEditorForPublish, returnToMetadata } = require('./spreadshirtFinalApprovalSequencePatch');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function activity(projectId, label, type = 'spreadshirt') {
  try { feature.projects.addActivity(projectId, { type, label }); } catch {}
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanForbiddenTerm(value) {
  return String(value || '')
    .replace(/\s+\d+\s*\/\s*\d+.*$/i, '')
    .replace(/\s+(?:Description|Tags|Keywords?|Design name|Name)\b.*$/i, '')
    .replace(/^[\s,;:|]+|[\s,;:|]+$/g, '')
    .trim();
}

function parseForbiddenTerms(text) {
  const result = [];
  const seen = new Set();
  const source = String(text || '');
  const regex = /The following terms are not allowed:\s*([^\n\r]+)/gi;
  let match;
  while ((match = regex.exec(source))) {
    const raw = cleanForbiddenTerm(match[1]);
    if (!raw) continue;
    for (const piece of raw.split(/\s*[,;|]\s*/)) {
      const term = cleanForbiddenTerm(piece);
      const key = term.toLowerCase();
      if (!term || seen.has(key)) continue;
      seen.add(key);
      result.push(term);
    }
  }
  return result;
}

async function collectForbiddenTerms(page) {
  const terms = [];
  const seen = new Set();
  for (const frame of page.frames()) {
    const text = await frame.locator('body').innerText({ timeout: 1500 }).catch(() => '');
    for (const term of parseForbiddenTerms(text)) {
      const key = term.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      terms.push(term);
    }
  }
  return terms;
}

function removeTermsFromText(value, terms) {
  let next = String(value || '');
  for (const term of terms || []) {
    const escaped = escapeRegex(term);
    if (!escaped) continue;
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'giu');
    next = next.replace(re, '$1');
  }
  return next
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,;:])\s*([,;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+\./g, '.')
    .trim();
}

async function findVisibleField(page, kind) {
  for (const frame of page.frames()) {
    const candidates = kind === 'description'
      ? [
          frame.getByLabel(/^Description$/i).first(),
          frame.getByLabel(/description/i).first(),
          frame.locator('textarea[name*="description" i]').first(),
          frame.locator('textarea[placeholder*="description" i]').first()
        ]
      : [
          frame.getByLabel(/design name/i).first(),
          frame.getByLabel(/^Name$/i).first(),
          frame.getByLabel(/^Title$/i).first(),
          frame.locator('input[name*="name" i]').first(),
          frame.locator('input[name*="title" i]').first()
        ];
    for (const candidate of candidates) {
      try {
        if (await candidate.count() && await candidate.isVisible() && !(await candidate.isDisabled())) return candidate;
      } catch {}
    }
  }
  return null;
}

async function removeForbiddenTagChip(frame, term) {
  return frame.evaluate((wanted) => {
    const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
    };
    const wantedLower = norm(wanted).toLowerCase();
    const all = [...document.querySelectorAll('button,[role="button"],span,div,li')].filter(visible);
    const matches = all.filter((el) => {
      const text = norm(el.innerText || el.textContent || '');
      const simplified = text.replace(/[×✕✖x]\s*$/i, '').trim().toLowerCase();
      return simplified === wantedLower;
    });
    matches.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return (ar.width * ar.height) - (br.width * br.height);
    });
    for (const match of matches) {
      let node = match;
      for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
        if (!visible(node)) continue;
        const rect = node.getBoundingClientRect();
        const text = norm(node.innerText || node.textContent || '');
        const simplified = text.replace(/[×✕✖x]\s*$/i, '').trim().toLowerCase();
        if (simplified !== wantedLower) continue;
        if (rect.width < 35 || rect.width > 360 || rect.height < 18 || rect.height > 90) continue;
        const buttons = [...node.querySelectorAll('button,[role="button"]')].filter(visible);
        const remove = buttons.find((button) => /remove|delete|close/i.test(String(button.getAttribute('aria-label') || button.getAttribute('title') || '')))
          || buttons[buttons.length - 1]
          || null;
        if (remove) {
          remove.click();
          return { removed: true, method: 'chip-remove-button' };
        }
        const x = Math.max(rect.left + 4, rect.right - Math.min(16, rect.width * 0.18));
        const y = rect.top + rect.height / 2;
        const target = document.elementFromPoint(x, y);
        const clickable = target?.closest?.('button,[role="button"]') || target;
        if (clickable && typeof clickable.click === 'function') {
          clickable.click();
          return { removed: true, method: 'chip-right-edge' };
        }
      }
    }
    return { removed: false };
  }, term).catch(() => ({ removed: false }));
}

async function removeForbiddenTag(page, term) {
  for (const frame of page.frames()) {
    const result = await removeForbiddenTagChip(frame, term);
    if (result?.removed) {
      await wait(220);
      return result;
    }
  }
  return { removed: false };
}

function sanitizedStoredMetadata(project, terms) {
  const metadata = project.spreadshirt?.metadata || {};
  const forbidden = new Set((terms || []).map((term) => String(term).toLowerCase()));
  return {
    ...metadata,
    title: removeTermsFromText(metadata.title || '', terms),
    description: removeTermsFromText(metadata.description || '', terms),
    keywords: (metadata.keywords || []).filter((keyword) => !forbidden.has(String(keyword || '').trim().toLowerCase()))
  };
}

async function repairForbiddenMetadata(page, projectId, initialTerms = null) {
  let terms = Array.isArray(initialTerms) ? [...initialTerms] : await collectForbiddenTerms(page);
  const removed = new Set();
  if (!terms.length) return { changed: false, terms: [], remaining: [] };

  for (let pass = 0; pass < 4 && terms.length; pass += 1) {
    const description = await findVisibleField(page, 'description');
    if (description) {
      const current = await description.inputValue().catch(() => '');
      const next = removeTermsFromText(current, terms);
      if (next !== current) {
        await description.fill(next);
        await description.press('Tab').catch(() => {});
        terms.forEach((term) => removed.add(term));
      }
    }

    const title = await findVisibleField(page, 'title');
    if (title) {
      const current = await title.inputValue().catch(() => '');
      const next = removeTermsFromText(current, terms);
      if (next !== current) {
        await title.fill(next);
        await title.press('Tab').catch(() => {});
        terms.forEach((term) => removed.add(term));
      }
    }

    for (const term of terms) {
      const result = await removeForbiddenTag(page, term);
      if (result?.removed) removed.add(term);
    }

    const project = feature.projects.read(projectId);
    const nextMetadata = sanitizedStoredMetadata(project, terms);
    if (nextMetadata.description && nextMetadata.title && (nextMetadata.keywords || []).length >= 3) {
      feature.projects.update(projectId, {
        spreadshirt: {
          ...(project.spreadshirt || {}),
          metadata: nextMetadata,
          metadataUpdatedAt: new Date().toISOString(),
          forbiddenTermsRemoved: [...new Set([...(project.spreadshirt?.forbiddenTermsRemoved || []), ...terms])],
          lastError: null
        }
      });
    }

    await wait(700);
    terms = await collectForbiddenTerms(page);
  }

  return { changed: removed.size > 0, terms: [...removed], remaining: terms };
}

function rollbackFalsePublishedState(projectId, reason = 'metadata-validation') {
  const project = feature.projects.read(projectId);
  try {
    const ledger = feature.readLedger();
    const next = ledger.filter((entry) => entry.projectId !== projectId);
    if (next.length !== ledger.length) feature.writeLedger(next);
  } catch {}
  return feature.projects.update(projectId, {
    spreadshirt: {
      ...(project.spreadshirt || {}),
      status: 'review',
      publishedAt: null,
      publishedUrl: null,
      reviewState: null,
      publishVerification: `reverted-${reason}`,
      falsePublishRevertedAt: new Date().toISOString(),
      lastError: null
    }
  });
}

async function preflightForbiddenMetadata(page, projectId) {
  const terms = await collectForbiddenTerms(page);
  if (!terms.length) return { changed: false, terms: [], remaining: [] };
  activity(projectId, `Spreadshirt rejected metadata term${terms.length === 1 ? '' : 's'}: ${terms.join(', ')}. Removing ${terms.length === 1 ? 'it' : 'them'} before Save and publish…`);
  const repaired = await repairForbiddenMetadata(page, projectId, terms);
  if (repaired.remaining.length) {
    throw new Error(`Spreadshirt still rejects metadata term${repaired.remaining.length === 1 ? '' : 's'} after automatic cleanup: ${repaired.remaining.join(', ')}. ZeroPOD did not press Save and publish.`);
  }
  activity(projectId, `Removed Spreadshirt-forbidden metadata term${repaired.terms.length === 1 ? '' : 's'} (${repaired.terms.join(', ')}). Validation is clean before publishing.`);
  return repaired;
}

const previousPublish = feature.publish.bind(feature);
feature.publish = async function publishWithForbiddenMetadataRepair(projectId) {
  let project = this.projects.read(projectId);
  const { page } = await this.sessions.ensureService('spreadshirt');

  if (project.spreadshirt?.editorUrl) {
    await restoreDesignEditorForPublish(page, projectId, project).catch(() => {});
    await page.bringToFront().catch(() => {});
    await returnToMetadata(page, projectId).catch(() => {});
    await preflightForbiddenMetadata(page, projectId);
  }

  let result;
  try {
    result = await previousPublish(projectId);
  } catch (error) {
    const terms = await collectForbiddenTerms(page);
    if (!terms.length) throw error;
    activity(projectId, `Spreadshirt revealed forbidden metadata after the publish attempt (${terms.join(', ')}). Cleaning it and retrying the same design without re-uploading…`);
    await returnToMetadata(page, projectId).catch(() => {});
    const repaired = await repairForbiddenMetadata(page, projectId, terms);
    if (repaired.remaining.length) {
      throw new Error(`Spreadshirt still rejects metadata after automatic cleanup: ${repaired.remaining.join(', ')}. The existing upload is preserved and was not re-uploaded.`);
    }
    rollbackFalsePublishedState(projectId, 'forbidden-metadata');
    result = await previousPublish(projectId);
  }

  let remaining = await collectForbiddenTerms(page);
  if (remaining.length) {
    activity(projectId, `Spreadshirt still shows forbidden metadata (${remaining.join(', ')}) even though the publish call returned. Correcting the false Published state and retrying safely…`, 'spreadshirt-error');
    await returnToMetadata(page, projectId).catch(() => {});
    const repaired = await repairForbiddenMetadata(page, projectId, remaining);
    if (repaired.remaining.length) {
      rollbackFalsePublishedState(projectId, 'forbidden-metadata');
      throw new Error(`Spreadshirt publish is blocked by forbidden metadata: ${repaired.remaining.join(', ')}. ZeroPOD corrected the false Published state and did not upload another design.`);
    }
    rollbackFalsePublishedState(projectId, 'forbidden-metadata');
    result = await previousPublish(projectId);
    remaining = await collectForbiddenTerms(page);
    if (remaining.length) {
      rollbackFalsePublishedState(projectId, 'forbidden-metadata');
      throw new Error(`Spreadshirt still rejects metadata after retry: ${remaining.join(', ')}. ZeroPOD will not mark this design Published.`);
    }
  }

  return result;
};

module.exports = { parseForbiddenTerms, collectForbiddenTerms, removeTermsFromText, repairForbiddenMetadata, rollbackFalsePublishedState };
