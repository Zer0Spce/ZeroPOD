const ExcelJS=require('exceljs');
const {headerKey,cellText,optionalText}=require('./taskWorkloadSpreadsheet');
function columns(sheet){
 const headers=new Map();sheet.getRow(1).eachCell((cell,index)=>headers.set(headerKey(cellText(cell)),index));
 const get=(...aliases)=>aliases.map(a=>headers.get(a)).find(Boolean);
 return {no:get('no'),name:get('name'),market:get('market_de_us','market'),mainKeyword:get('main_niche_main_keyword','main_keyword','main_niche'),subNiche:get('sub_niche','subniche'),linkSource:get('link_source','source_link')};
}
function parseSheet(sheet){
 if(!sheet)throw Error('Expected Excel headers: No., Name, Market (DE, US), Main niche / Main keyword, Sub niche, Link Source.');
 const c=columns(sheet);if(!c.no||!c.name||!c.linkSource)throw Error('Missing No., Name or Link Source header.');
 const rows=[];
 sheet.eachRow({includeEmpty:false},(record,i)=>{
  if(i===1)return;
  const get=k=>c[k]?cellText(record.getCell(c[k])):'';
  const row={no:String(get('no')).replace(/\.0+$/,'').trim(),name:get('name'),market:optionalText(get('market')),mainKeyword:optionalText(get('mainKeyword')),subNiche:optionalText(get('subNiche')),linkSource:optionalText(get('linkSource'))};
  if(!Object.values(row).some(Boolean))return;
  if(!row.no||!row.name||!row.linkSource)throw Error('Excel row '+i+' needs No., Name and Link Source.');
  if(!/^https?:\/\//i.test(row.linkSource))throw Error('Invalid Link Source URL in row '+i);
  rows.push(row);if(rows.length>50)throw Error('Maximum 50 jobs per list.');
 });
 if(!rows.length)throw Error('No Task [Marcin] rows found in workbook.');
 return rows;
}
async function readMarcinWorkbook(file){
 const book=new ExcelJS.Workbook();await book.xlsx.readFile(file);
 const sheet=book.worksheets.find(ws=>{const c=columns(ws);return c.no&&c.name&&c.linkSource});
 return parseSheet(sheet);
}
module.exports={columns,parseSheet,readMarcinWorkbook};