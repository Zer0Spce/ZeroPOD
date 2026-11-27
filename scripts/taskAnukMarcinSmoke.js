const assert=require('assert');
const fs=require('fs'),os=require('os'),path=require('path'),Module=require('module'),ExcelJS=require('exceljs');
const {parseSheet}=require('../src/main/taskMarcinSpreadsheet');
async function main(){
 const wb=new ExcelJS.Workbook();const ws=wb.addWorksheet('Tabelle1');
 ws.addRow(['No.','Name','Market (DE, US)','Main niche / Main keyword','Sub niche','Link Source']);
 ws.addRow([137920,'You Got A Fast Car I Got A Plan to Get Us Out of Here Music T-Shirt',null,'90s Music','Humor','https://www.amazon.com/dp/B0H4W45C15']);
 ws.addRow([137921,'Funny Hair Vintage T-Shirt','DE','Bald','Humor','https://www.amazon.de/dp/B0H4LFYL23']);
 const imported=parseSheet(ws);
 assert.strictEqual(imported.length,2);
 assert.strictEqual(imported[0].no,'137920');
 assert.strictEqual(imported[0].mainKeyword,'90s Music');
 assert.strictEqual(imported[0].market,'');
 assert.strictEqual(imported[1].market,'DE');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'zeropod-anuk-marcin-'));
 const original=Module._load;
 try{
  Module._load=function(req,parent,isMain){
   if(req==='electron')return {app:{getPath:kind=>path.join(root,kind)}};
   if(req==='sharp')return ()=>({});
   return original.call(this,req,parent,isMain);
  };
  const {TaskWorkload}=require('../src/main/taskWorkload');
  const args={projects:{},chatgpt:{},vectorizer:{},exporter:{}};
  const anuk=new TaskWorkload(args);
  const marcin=new TaskWorkload({...args,mode:'marcin'});
  assert.notStrictEqual(anuk.file,marcin.file);
  assert.notStrictEqual(anuk.outputRoot,marcin.outputRoot);
  assert.match(anuk.outputDir,/Task \[Anuk\][\\/][0-9]+-[0-9]+-[0-9]{2}$/);
  assert.match(marcin.outputDir,/Task \[Marcin\][\\/][0-9]+-[0-9]+-[0-9]{2}$/);
  marcin.appendRows(imported);
  assert.strictEqual(marcin.rows.length,2);
  assert.strictEqual(marcin.rows[0].no,'137920');
  assert.strictEqual(anuk.rows.length,0);
  const old=marcin.rows.map(r=>({...r}));
  marcin.setRows(old);
  assert.strictEqual(marcin.rows[0].name,imported[0].name);
  assert.strictEqual(marcin.rows[0].linkSource,imported[0].linkSource);
  const originalLoop=marcin.loop;
  marcin.loop=async function(targets){
    assert.deepStrictEqual(targets.map(r=>r.no),['137920','137921']);
    this.running=false;TaskWorkload.active=null;
  };
  marcin.retryRows([1,0,1]);
  assert.strictEqual(marcin.rows[0].retryRequested,true);
  assert.strictEqual(marcin.rows[1].retryRequested,true);
  marcin.loop=originalLoop;
  assert.strictEqual(marcin.rows[0].status,'pending');
  console.log('Anuk/Marcin workbook mapping, isolated queue data, dated folders, ordered retries: OK');
 }finally{Module._load=original;fs.rmSync(root,{recursive:true,force:true})}
}
main().catch(e=>{console.error(e);process.exitCode=1});
