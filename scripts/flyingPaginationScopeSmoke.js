const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { JSDOM } = require('jsdom');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zeropod-flying-pagination-scope-'));
const originalLoad = Module._load;
Module._load = function(request, ...args) {
  if (request === 'electron') return { app: { getPath: () => root }, safeStorage: {} };
  return originalLoad.call(this, request, ...args);
};

try {
  const { paginationProbe } = require('../src/main/flyingResearchPaginationPatch');
  assert.equal(typeof paginationProbe, 'function');

  const dom = new JSDOM(`<!doctype html><body>
    <div class="results"><div class="list-card-content"><span class="asin-info">ASIN : B012345678</span></div></div>
  </body>`, { url: 'https://app.flyingresearch.net/' });
  global.document = dom.window.document;
  global.window = dom.window;
  global.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  dom.window.Element.prototype.getBoundingClientRect = () => ({ width: 100, height: 40 });
  dom.window.Element.prototype.getClientRects = () => [{ width: 100, height: 40 }];

  // Playwright serializes page.evaluate(function) into the browser page. Rebuild
  // the function from source so any accidental module-scope dependency fails here.
  const isolatedProbe = new Function(`return (${paginationProbe.toString()});`)();
  const state = isolatedProbe('state');
  assert.equal(state.hasNext, false);
  assert.equal(state.currentPage, null);
  const click = isolatedProbe('click');
  assert.equal(click.clicked, false);

  dom.window.close();
  console.log('Flying pagination scope smoke passed: browser probe is self-contained.');
} finally {
  Module._load = originalLoad;
  delete global.document;
  delete global.window;
  delete global.getComputedStyle;
  fs.rmSync(root, { recursive: true, force: true });
}
