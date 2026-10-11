const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const { extractUrls, extractUrlsFromFile } = require('../src/main/automateListFeature');

(async () => {
  const urls = extractUrls('one https://www.amazon.com/dp/B07VCFBBMF?th=1 and https://www.amazon.de/dp/B08WJZCZRK.');
  assert.deepStrictEqual(urls, [
    'https://www.amazon.com/dp/B07VCFBBMF?th=1',
    'https://www.amazon.de/dp/B08WJZCZRK'
  ]);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeropod-automate-list-'));
  const file = path.join(dir, 'sample.xlsx');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Links');
  sheet.getCell('A1').value = '';
  sheet.getCell('A2').value = 'https://www.amazon.com/dp/B07VCFBBMF?customId=B0752XJYNL&th=1';
  sheet.getCell('A3').value = 'https://www.amazon.com/dp/B0F5N8QFL5';
  sheet.getCell('A5').value = 'not a link';
  await workbook.xlsx.writeFile(file);

  const fromWorkbook = await extractUrlsFromFile(file);
  assert.strictEqual(fromWorkbook.length, 2);
  assert.ok(fromWorkbook[0].includes('/dp/B07VCFBBMF'));
  assert.ok(fromWorkbook[1].includes('/dp/B0F5N8QFL5'));

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('Automate List smoke test passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
