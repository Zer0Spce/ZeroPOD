const ExcelJS = require('exceljs');

const MAX_TASK_ROWS = 50;
const REQUIRED_COLUMNS = Object.freeze({
  id: ['id', 'job_id', 'order_id'],
  niche: ['niche'],
  idea: ['idea', 'design_idea', 'concept']
});
const OPTIONAL_COLUMNS = Object.freeze({
  text: ['text_in_image_use_exactly', 'text_in_image_exact', 'text_in_image', 'image_text'],
  reference: ['reference_link', 'reference_url', 'reference', 'source_url'],
  difference: ['difference_from_the_original', 'difference_from_original', 'changes_from_original', 'difference', 'instructions']
});

function headerKey(value) {
  return String(value ?? '')
    .trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function cellText(cell) {
  if (!cell) return '';
  const value = cell.value;
  if (value == null) return '';
  if (typeof value === 'object' && typeof value.text === 'string') return value.text.trim();
  if (typeof value === 'object' && value.result != null) return String(value.result).trim();
  return String(cell.text ?? value).trim();
}

function optionalText(value) {
  const text = String(value ?? '').trim();
  // Some external order sheets export the placeholder "24" for empty fields.
  if (/^(?:none|nothing|n\/a|24)$/i.test(text)) return '';
  return text;
}

function getHeaderColumns(sheet) {
  const headers = new Map();
  sheet.getRow(1).eachCell((cell, index) => {
    const key = headerKey(cellText(cell));
    if (key) headers.set(key, index);
  });
  const find = aliases => aliases.map(name => headers.get(name)).find(Boolean);
  return {
    id: find(REQUIRED_COLUMNS.id),
    niche: find(REQUIRED_COLUMNS.niche),
    idea: find(REQUIRED_COLUMNS.idea),
    text: find(OPTIONAL_COLUMNS.text),
    reference: find(OPTIONAL_COLUMNS.reference),
    difference: find(OPTIONAL_COLUMNS.difference)
  };
}

function supportsTaskColumns(columns) {
  return Boolean(columns.id && columns.niche && columns.idea);
}

function parseTaskSheet(sheet) {
  if (!sheet) throw new Error('The Excel workbook has no readable worksheets.');
  const columns = getHeaderColumns(sheet);
  if (!supportsTaskColumns(columns)) {
    throw new Error('Expected columns: ID, Niche, Idea, Text in image (use exactly), Reference link, Difference from the original.');
  }

  const results = [];
  sheet.eachRow({ includeEmpty: false }, (sourceRow, rowNumber) => {
    if (rowNumber === 1) return;
    const field = key => columns[key] ? cellText(sourceRow.getCell(columns[key])) : '';
    const row = {
      id: field('id'),
      niche: field('niche'),
      idea: field('idea'),
      text: optionalText(field('text')),
      reference: optionalText(field('reference')),
      difference: optionalText(field('difference'))
    };
    if (!Object.values(row).some(Boolean)) return;
    if (!row.id || !row.niche || !row.idea) {
      throw new Error(`Orders row ${rowNumber} must include ID, Niche and Idea.`);
    }
    results.push(row);
    if (results.length > MAX_TASK_ROWS) throw new Error(`Excel list exceeds ${MAX_TASK_ROWS} jobs.`);
  });
  if (!results.length) throw new Error('No Task Workload jobs found in the selected Excel file.');
  return results;
}

async function readTaskWorkbook(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const orders = workbook.getWorksheet('Orders');
  const sheet = (orders && supportsTaskColumns(getHeaderColumns(orders)) ? orders : null)
    || workbook.worksheets.find(ws => supportsTaskColumns(getHeaderColumns(ws)));
  return parseTaskSheet(sheet);
}

module.exports = {
  MAX_TASK_ROWS,
  headerKey,
  cellText,
  optionalText,
  getHeaderColumns,
  parseTaskSheet,
  readTaskWorkbook
};
