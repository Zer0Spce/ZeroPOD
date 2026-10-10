const { RedbubbleController } = require('./redbubbleController');

const previousFillListingFields = RedbubbleController.prototype.fillListingFields;

function norm(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

async function visibleCoreState(page, metadata) {
  return page.evaluate((meta) => {
    const tidy = (value) => String(value || '').trim().replace(/\s+/g, ' ');
    const visible = (el) => {
      if (!(el instanceof Element)) return false;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    };

    const titleInputs = [...document.querySelectorAll('input')].filter(visible);
    const title = titleInputs
      .map((el) => String(el.value || '').trim())
      .find((value) => value && value === String(meta.title || '').trim()) || '';

    const bodyText = tidy(document.body?.innerText || '');
    const lowerBody = bodyText.toLowerCase();
    const mainTag = tidy(meta.mainTag).toLowerCase();
    const mainPresent = Boolean(mainTag && lowerBody.includes(mainTag));

    const supporting = Array.isArray(meta.supportingTags)
      ? meta.supportingTags.map((tag) => tidy(tag).toLowerCase()).filter(Boolean)
      : [];

    let supportText = lowerBody;
    const supportIndex = lowerBody.indexOf('supporting tags');
    const descriptionIndex = lowerBody.indexOf('description', supportIndex >= 0 ? supportIndex : 0);
    if (supportIndex >= 0) {
      supportText = lowerBody.slice(
        supportIndex,
        descriptionIndex > supportIndex ? descriptionIndex : Math.min(lowerBody.length, supportIndex + 1600)
      );
    }

    const matchedSupporting = supporting.filter((tag) => {
      const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(supportText);
    });

    const tagButtons = [...document.querySelectorAll('button, [role="button"]')]
      .filter(visible)
      .map((el) => tidy(el.innerText || el.textContent).replace(/[×✕✖]/g, '').trim().toLowerCase())
      .filter(Boolean);
    const matchedButtons = supporting.filter((tag) => tagButtons.includes(tag));

    const matched = [...new Set([...matchedSupporting, ...matchedButtons])];
    return {
      title,
      mainPresent,
      matchedSupporting: matched,
      supportEvidence: supportText.slice(0, 900)
    };
  }, {
    title: String(metadata?.title || ''),
    mainTag: String(metadata?.mainTag || ''),
    supportingTags: Array.isArray(metadata?.supportingTags) ? metadata.supportingTags : []
  }).catch(() => ({ title: '', mainPresent: false, matchedSupporting: [], supportEvidence: '' }));
}

RedbubbleController.prototype.fillListingFields = async function fillListingFieldsSkipDescriptionBeta(page, metadata) {
  // Beta policy: keep Description blank on Redbubble for now. The generated
  // description stays stored in the ZeroPOD project so this can be restored later.
  const betaMetadata = { ...metadata, description: '' };

  try {
    const result = await previousFillListingFields.call(this, page, betaMetadata);
    console.warn('[ZeroPOD] Redbubble beta: Description intentionally skipped.');
    return result ?? true;
  } catch (error) {
    const message = String(error?.message || '');
    const skippable = /Description|Supporting Tags|accepted only\s+\d+\s+Supporting Tags|tag entry/i.test(message);
    if (!skippable) throw error;

    // Some Redbubble layouts make the old numeric chip counter report zero even
    // while the entered chips are visibly present. Trust the actual page contents
    // when Title + Main Tag + at least one generated Supporting Tag are visible.
    const state = await visibleCoreState(page, metadata);
    const titleOk = norm(state.title) === norm(metadata.title);
    const mainOk = Boolean(state.mainPresent);
    const supportOk = state.matchedSupporting.length > 0;

    if (!titleOk || !mainOk || !supportOk) {
      throw new Error(
        `Redbubble beta core-field check failed after skipping Description. `
        + `title=${titleOk ? 'ok' : 'missing'}, mainTag=${mainOk ? 'ok' : 'missing'}, `
        + `visibleSupporting=${state.matchedSupporting.length}. Original error: ${message}`
      );
    }

    console.warn(
      `[ZeroPOD] Redbubble beta: Description skipped; continuing with ${state.matchedSupporting.length} visibly confirmed Supporting Tag(s). `
      + `Original non-blocking error: ${message}`
    );
    return true;
  }
};

module.exports = { visibleCoreState };
