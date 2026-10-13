const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const file = path.join(root, 'src/main/spreadshirtFinalPublishPatch.js');
const source = fs.readFileSync(file, 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const syntax = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
assert(syntax.status === 0, syntax.stderr || syntax.stdout || 'spreadshirtFinalPublishPatch.js failed syntax check');

assert(/allFramesText/.test(source) && /page\.frames\(\)/.test(source), 'Spreadshirt final publish confirmation must inspect all frames.');
assert(/verifyMarketplacePublished/.test(source), 'Spreadshirt Marketplace publish verification is missing.');
assert(/MARKETPLACE_DESIGNS_URL/.test(source), 'Spreadshirt publish verification must use Marketplace Designs.');
assert(/filterMarketplaceByTitle/.test(source) && /firstMarketplaceCard/.test(source), 'Spreadshirt publish verification must locate the uploaded design card.');
assert(/already Published on Spreadshirt/i.test(source), 'Spreadshirt must recover silent publish success without another click.');
assert(/Marketplace Designs still shows this design as Draft/i.test(source), 'Spreadshirt must distinguish Draft from Published after an ambiguous publish.');
assert(/context\.newPage\(\)/.test(source), 'Spreadshirt publish verification must use a separate verification page and preserve the prepared editor.');
assert(/actionNumber <= 2/.test(source), 'Spreadshirt final publish retries must remain bounded.');
assert(/recordPublish/.test(source) && /status:\s*'published'/.test(source), 'Verified Spreadshirt publish must update project state and ledger.');

console.log('Spreadshirt final publish frame + Marketplace verification smoke checks passed.');
