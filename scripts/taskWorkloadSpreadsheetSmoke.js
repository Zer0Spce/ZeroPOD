const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const ExcelJS = require('exceljs');
const { readTaskWorkbook, parseTaskSheet, optionalText } = require('../src/main/taskWorkloadSpreadsheet');

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zeropod-task-smoke-'));
  try {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('How it works').getCell('A1').value = 'Instructions only';
    const sheet = workbook.addWorksheet('Orders');
    sheet.addRow([
      'ID', 'Niche', 'Path to original niche', 'Idea', 'Text in image (use exactly)',
      'Reference link', 'Difference from the original', 'Priority', 'Status',
      'Delivery link', 'Note', 'Ref (system, do not edit)'
    ]);
    sheet.addRow([
      'I-261025-1', 'Mallorca party bachelorette', 'Travel & Party', 'Flat vector mouse design',
      'BRAUTMAUS AUF MALLE', 'https://www.amazon.de/dp/B0HL64HGS9',
      'Use the bride instead of a leopard princess.', 'normal', 'open', null, null, 12
    ]);
    sheet.addRow([
      'I-261028-15', 'Coquette hunting women', 'Hunting', 'Antler with coquette bows',
      24, 'https://www.amazon.com/dp/B0HJNKQLYT', 'Antlers as main motif',
      'normal', 'open', null, null, 36
    ]);
    sheet.addRow(['I-261007-1', 'Flag Combinations', '24', 'Antigua and USA split badge', 24, 24, 24, 'normal', 'open']);
    const input = path.join(temp, 'Designer-Auftraege.xlsx');
    await workbook.xlsx.writeFile(input);

    const jobs = await readTaskWorkbook(input);
    assert.strictEqual(jobs.length, 3, 'all orders should be imported');
    assert.strictEqual(jobs[0].id, 'I-261025-1');
    assert.strictEqual(jobs[0].text, 'BRAUTMAUS AUF MALLE');
    assert.strictEqual(jobs[0].reference, 'https://www.amazon.de/dp/B0HL64HGS9');
    assert.strictEqual(jobs[0].difference, 'Use the bride instead of a leopard princess.');
    assert.strictEqual(jobs[1].text, '', '"24" should not be rendered as slogan');
    assert.strictEqual(jobs[2].reference, '', '"24" should not be treated as URL');
    assert.strictEqual(jobs[2].difference, '', '"24" should not be treated as design changes');
    assert.strictEqual(optionalText('none'), '');
    assert.strictEqual(optionalText('nothing'), '');
    assert.throws(() => parseTaskSheet(workbook.worksheets[0]), /Expected columns/);

    const originalLoad = Module._load;
    let TaskWorkload;
    try {
      Module._load = function (request, parent, isMain) {
        if (request === 'electron') return { app: { getPath: () => temp } };
        if (request === 'sharp') return () => ({});
        return originalLoad.call(this, request, parent, isMain);
      };
      TaskWorkload = require('../src/main/taskWorkload').TaskWorkload;
    } finally {
      Module._load = originalLoad;
    }

    const queue = new TaskWorkload({
      projects: {}, chatgpt: {}, vectorizer: {}, exporter: {}
    });
    queue.setRows([jobs[0]]);
    queue.rows[0].status = 'completed';
    queue.rows[0].output = 'C:\\ZeroPOD\\I-261025-1_mallorca.png';
    queue.save();

    const imported = queue.appendRows(jobs);
    assert.strictEqual(imported.added, 2);
    assert.strictEqual(imported.skipped, 1);
    assert.strictEqual(queue.rows.length, 3);
    assert.strictEqual(queue.rows[0].status, 'completed', 'keep existing status');
    assert.strictEqual(queue.rows[0].output, 'C:\\ZeroPOD\\I-261025-1_mallorca.png');
    assert.strictEqual(queue.rows[1].status, 'pending');
    assert.strictEqual(queue.rows[1].id, 'I-261028-15');
    assert.strictEqual(queue.rows[2].text, '');
    assert.strictEqual(new TaskWorkload({projects:{},chatgpt:{},vectorizer:{},exporter:{}}).rows.length, 3,
      'queue should remain persisted after restart');

    const before = queue.rows.length;
    assert.throws(
      () => queue.appendRows(Array.from({ length: 50 }, (_, i) => ({
        id: 'I-TEST-' + i, niche: 'test', idea: 'do something'
      }))),
      /50 rows total/
    );
    assert.strictEqual(queue.rows.length, before, 'overflow must not partially append');

    console.log('Task Workload Excel mapping, placeholders, deduplication, persistence, and 50-row limit: OK');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
