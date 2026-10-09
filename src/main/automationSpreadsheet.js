const ExcelJS = require('exceljs');

function normalizeBoolean(value) {
  if (typeof value === 'boolean') return value;
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return true;
  return !['false', '0', 'no', 'off', 'disabled'].includes(text);
}

function cellText(cell) {
  if (!cell) return '';
  if (cell.text !== undefined) return String(cell.text || '').trim();
  return String(cell.value ?? '').trim();
}

async function readAutomationWorkbook(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const headerMap = new Map();
  sheet.getRow(1).eachCell((cell, columnNumber) => {
    headerMap.set(cellText(cell).toLowerCase().replace(/\s+/g, '_'), columnNumber);
  });
  const column = (...names) => names.map((name) => headerMap.get(name)).find(Boolean);
  const enabledCol = column('enabled', 'on');
  const imageCol = column('reference_image', 'referenceimage', 'image', 'reference');
  const linkCol = column('amazon_link', 'amazonlink', 'source_link', 'sourcelink', 'url', 'link');
  const notesCol = column('notes', 'instructions', 'instruction');

  if (!imageCol && !linkCol) throw new Error('Excel sheet needs reference_image and amazon_link/source_link columns.');

  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const referenceImage = imageCol ? cellText(row.getCell(imageCol)) : '';
    const amazonLink = linkCol ? cellText(row.getCell(linkCol)) : '';
    const notes = notesCol ? cellText(row.getCell(notesCol)) : '';
    if (!referenceImage && !amazonLink && !notes) return;
    rows.push({
      enabled: enabledCol ? normalizeBoolean(row.getCell(enabledCol).value) : true,
      referenceImage,
      amazonLink,
      notes
    });
  });
  return rows;
}

async function writeAutomationWorkbook(filePath, rows) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ZeroPOD';
  const sheet = workbook.addWorksheet('Automation List', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: 'enabled', key: 'enabled', width: 12 },
    { header: 'reference_image', key: 'reference_image', width: 55 },
    { header: 'amazon_link', key: 'amazon_link', width: 62 },
    { header: 'notes', key: 'notes', width: 55 }
  ];
  rows.forEach((row) => sheet.addRow({
    enabled: row.enabled !== false,
    reference_image: row.referenceImage || '',
    amazon_link: row.amazonLink || '',
    notes: row.notes || ''
  }));
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = { from: 'A1', to: 'D1' };
  await workbook.xlsx.writeFile(filePath);
  return filePath;
}

module.exports = { readAutomationWorkbook, writeAutomationWorkbook };
