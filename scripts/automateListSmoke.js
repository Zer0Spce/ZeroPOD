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

  // Reproduce the reported namespace-prefixed shared string table.
  const JSZip = require(require.resolve('jszip',{paths:[require.resolve('exceljs')]}));
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const shared = zip.file('xl/sharedStrings.xml');
  assert.ok(shared, 'fixture must contain shared strings');
  const xml = await shared.async('string');
  zip.file('xl/sharedStrings.xml', xml
    .replace(/<(\/?)(sst|si|t|r|rPr)(?=[\s/>])/g, '<$1x:$2')
    .replace(/xmlns="http:\/\/schemas.openxmlformats.org\/spreadsheetml\/2006\/main"/, 'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'));
  const prefixed = path.join(dir,'prefixed.xlsx');
  fs.writeFileSync(prefixed,await zip.generateAsync({type:'nodebuffer'}));
  assert.deepStrictEqual(await extractUrlsFromFile(prefixed),fromWorkbook);
  const XLSX = require('xlsx');
  const linked = XLSX.utils.book_new();
  const links = XLSX.utils.aoa_to_sheet([['Product'],['Japan'],['Canada']]);
  links.A2.l={Target:'https://www.amazon.co.jp/dp/B07VCFBBMF'};
  links.A3.l={Target:'https://www.amazon.ca/dp/B0F5N8QFL5'};
  XLSX.utils.book_append_sheet(linked,links,'Links');
  const linkedFile=path.join(dir,'hyperlinks.xlsx');
  XLSX.writeFile(linked,linkedFile);
  assert.deepStrictEqual(await extractUrlsFromFile(linkedFile),[links.A2.l.Target,links.A3.l.Target]);

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('Automate List smoke test passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
