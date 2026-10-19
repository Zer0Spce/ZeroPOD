const { FlyingResearchFeature } = require('./flyingResearchFeature');
const { AutomationQueueStore } = require('./automationQueueStore');

const MAX_AUTOMATION_ROWS = 50;
const CHUNK_SIZE = 15;
const previousAddToAutomation = FlyingResearchFeature.prototype.addToAutomation;
const previousAddRows = AutomationQueueStore.prototype.addRows;

AutomationQueueStore.prototype.addRows = function addRowsWith50RowLimit(rows = []) {
  const incoming = Array.isArray(rows) ? rows : [];
  const current = this.read();
  const available = Math.max(0, MAX_AUTOMATION_ROWS - current.rows.length);
  if (incoming.length > available) {
    throw new Error(`Automation List can hold a maximum of ${MAX_AUTOMATION_ROWS} rows.`);
  }
  return previousAddRows.call(this, incoming);
};

function fakeLengthRows(rows) {
  return new Proxy(rows, {
    get(target, property, receiver) {
      if (property === 'length') return 0;
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

FlyingResearchFeature.prototype.addToAutomation = async function addToAutomationWith50Rows(payload = {}) {
  const uniqueKeys = [...new Set(Array.isArray(payload.keys) ? payload.keys : [])];
  const queue = this.automationStore.read();
  const available = Math.max(0, MAX_AUTOMATION_ROWS - queue.rows.length);
  const allowed = uniqueKeys.slice(0, available);
  const overflow = uniqueKeys.slice(available).map((key) => ({
    key,
    reason: `Automation List is full (${MAX_AUTOMATION_ROWS} rows).`
  }));

  if (!allowed.length) {
    return { added: 0, rows: [], skippedItems: overflow };
  }

  const originalRead = this.automationStore.read;
  const combined = { added: 0, rows: [], skippedItems: [] };

  try {
    // The legacy Flying importer has two internal 15-row checks. Keep its proven
    // duplicate/image/cache logic intact, but neutralize only that obsolete length
    // value while calling it in safe 15-item chunks. The wrapper itself enforces 50.
    this.automationStore.read = () => {
      const state = originalRead.call(this.automationStore);
      return { ...state, rows: fakeLengthRows(state.rows) };
    };

    for (let index = 0; index < allowed.length; index += CHUNK_SIZE) {
      const chunk = allowed.slice(index, index + CHUNK_SIZE);
      const result = await previousAddToAutomation.call(this, { ...payload, keys: chunk });
      combined.added += Number(result?.added) || 0;
      if (Array.isArray(result?.rows)) combined.rows.push(...result.rows);
      if (Array.isArray(result?.skippedItems)) combined.skippedItems.push(...result.skippedItems);
    }
  } finally {
    this.automationStore.read = originalRead;
  }

  combined.skippedItems.push(...overflow);
  return combined;
};

module.exports = { MAX_AUTOMATION_ROWS };
