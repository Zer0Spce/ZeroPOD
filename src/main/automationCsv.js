function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && quoted && next === '"') {
      field += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  if (!rows.length) return [];

  const headers = rows.shift().map((value) => value.trim().toLowerCase());
  const pick = (values, names) => {
    for (const name of names) {
      const index = headers.indexOf(name);
      if (index >= 0) return values[index] || '';
    }
    return '';
  };

  return rows.map((values) => ({
    enabled: !/^(false|0|no)$/i.test(pick(values, ['enabled', 'on']).trim()),
    referenceImage: pick(values, ['reference_image', 'reference image', 'image', 'referenceimage']).trim(),
    amazonLink: pick(values, ['amazon_link', 'amazon link', 'source_url', 'source url', 'link']).trim(),
    notes: pick(values, ['notes', 'instructions']).trim()
  })).filter((item) => item.referenceImage || item.amazonLink || item.notes);
}

function escapeCsv(value) {
  const text = String(value ?? '');
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function toCsv(rows) {
  const header = ['enabled', 'reference_image', 'amazon_link', 'notes', 'status', 'step', 'project_id', 'last_error'];
  const lines = rows.map((row) => [
    row.enabled !== false,
    row.referenceImage,
    row.amazonLink,
    row.notes,
    row.status,
    row.step,
    row.projectId || '',
    row.lastError || ''
  ].map(escapeCsv).join(','));
  return [header.join(','), ...lines].join('\r\n');
}

module.exports = { parseCsv, toCsv };
