const XLSX = require('xlsx');

const HEADERS = ['enabled', 'reference_image', 'amazon_link', 'notes'];

function normalizeBoolean(value) {
  if (typeof value === 'boolean') return value;
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return true;
  return !['false', '0', 'no', 'off', 'disabled'].includes(text);
}

function readAutomationWorkbook(filePath) {
  const workbook = XLSX.readFile(filePath, { cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
  return rows.map((row) => ({
    enabled: normalizeBoolean(row.enabled ?? row.Enabled),
    referenceImage: String(row.reference_image ?? row.referenceImage ?? row['Reference Image'] ?? '').trim(),
    amazonLink: String(row.amazon_link ?? row.amazonLink ?? row['Amazon Link'] ?? row['Source Link'] ?? '').trim(),
    notes: String(row.notes ?? row.Notes ?? '').trim()
  })).filter((row) => row.referenceImage || row.amazonLink || row.notes);
}

function writeAutomationWorkbook(filePath, rows) {
  const data = rows.map((row) => ({
    enabled: row.enabled !== false,
    reference_image: row.referenceImage || '',
    amazon_link: row.amazonLink || '',
    notes: row.notes || ''
  }));
  const sheet = XLSX.utils.json_to_sheet(data, { header: HEADERS });
  sheet['!cols'] = [{ wch: 10 }, { wch: 52 }, { wch: 58 }, { wch: 48 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Automation List');
  XLSX.writeFile(workbook, filePath);
  return filePath;
}

module.exports = { readAutomationWorkbook, writeAutomationWorkbook };
