const assert=require('assert');
const fs=require('fs'),os=require('os'),path=require('path'),Module=require('module'),ExcelJS=require('exceljs');
const {parseSheet}=require('../src/main/taskMarcinSpreadsheet');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function settle(queue){
  for(let i=0;i<100&&queue.running;i++)await wait(15);
  assert.strictEqual(queue.running,false,'queue should stop normally');
}
async function run(){
  const excel=new ExcelJS.Workbook(),sheet=excel.addWorksheet('Tabelle1');
  sheet.addRow(['No.','Name','Market (DE, US)','Main niche / Main keyword','Sub niche','Link Source']);
  sheet.addRow([137920,'Source unavailable','','90s Music','Humor','https://www.amazon.com/dp/B0H4W45C15']);
  sheet.addRow([137921,'Second Design','DE','Fishing','Hobby','https://www.amazon.de/dp/B0H4LFYL23']);
  sheet.addRow([137922,null,null,null,null,null]); // Number-only allocation; must be ignored.
  const parsed=parseSheet(sheet);
  assert.strictEqual(parsed.length,2);
  assert.deepStrictEqual(parsed.map(r=>r.no),['137920','137921']);

  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zeropod-select-manual-'));
  const prior=Module._load;
  try{
    Module._load=function(req,parent,isMain){
      if(req==='electron')return {app:{getPath:kind=>path.join(dir,kind)}};
      if(req==='sharp')return ()=>({metadata:async()=>({width:500,height:500})});
      if(req==='./sourceImageIpc')return {resolver:{resolve:async()=>{throw Error('Amazon source reference is unavailable')}}};
      return prior.call(this,req,parent,isMain);
    };
    const {TaskWorkload}=require('../src/main/taskWorkload');
    const args={projects:{},chatgpt:{},vectorizer:{},exporter:{}};
    const marcin=new TaskWorkload({...args,mode:'marcin'});
    const anuk=new TaskWorkload(args);
    marcin.appendRows(parsed);

    let generated=0;
    marcin.process=async function(row){
      if(row.no==='137920')await this.referenceImage(row,row.linkSource);
      generated++;
    };
    marcin.start();await settle(marcin);
    assert.strictEqual(marcin.rows[0].status,'manual-needed');
    assert.match(marcin.rows[0].manualNote,/Manual Needed/);
    assert.match(marcin.rows[0].manualNote,/Amazon source reference/);
    assert.strictEqual(marcin.rows[1].status,'completed','failure to fetch source must not block next row');
    assert.strictEqual(generated,1);

    marcin.start();await settle(marcin);
    assert.strictEqual(generated,1,'Manual Needed and completed jobs should be skipped on normal restart');

    marcin.retryRows([0]);await settle(marcin);
    assert.strictEqual(marcin.rows[0].status,'manual-needed','explicit retry must be allowed and return to Manual Needed if source stays missing');
    assert.strictEqual(generated,1,'other jobs must remain completed on selected retry');

    // Deleting queue records NEVER deletes any user PNG, even if it exactly
    // matches a selected job's expected output filename.
    const folder=marcin.outputDir;fs.mkdirSync(folder,{recursive:true});
    const target=path.join(folder,'137921 Second Design.png');fs.writeFileSync(target,'PNG');
    marcin.rows[1].output=target;marcin.save();
    const keep=path.join(folder,'untouched.png');fs.writeFileSync(keep,'PNG');
    const deleted=marcin.deleteRows([1,1]);
    assert.strictEqual(deleted.deletedRows,1);
    assert.strictEqual(fs.readFileSync(target,'utf8'),'PNG','Marcin output PNG must remain');
    assert.strictEqual(fs.existsSync(keep),true);
    assert.strictEqual(marcin.rows.length,1);
    assert.strictEqual(marcin.rows[0].status,'manual-needed');

    // The same rule applies to Anuk and to legacy absolute/undated output paths.
    const anukFolder=anuk.outputDir;fs.mkdirSync(anukFolder,{recursive:true});
    const anukPng=path.join(anukFolder,'I-TEST_art.png');fs.writeFileSync(anukPng,'ANUK PNG');
    const otherPng=path.join(dir,'elsewhere.png');fs.writeFileSync(otherPng,'KEEP');
    anuk.setRows([{id:'I-TEST',niche:'art',idea:'design'},{id:'I-SECOND',niche:'art',idea:'design'}]);
    anuk.rows[0].output=anukPng;
    anuk.rows[1].output=otherPng;
    anuk.save();
    const removedAnuk=anuk.deleteRows([1,0]);
    assert.strictEqual(removedAnuk.deletedRows,2);
    assert.strictEqual(anuk.rows.length,0);
    assert.strictEqual(fs.readFileSync(anukPng,'utf8'),'ANUK PNG','Anuk output PNG must remain');
    assert.strictEqual(fs.readFileSync(otherPng,'utf8'),'KEEP','External files must remain');

    assert.throws(()=>marcin.deleteRows([]),/Select jobs/);
    console.log('Task select/delete, no-only Excel skips, Manual Needed and next-row continuation: OK');
  }finally{
    Module._load=prior;
    fs.rmSync(dir,{recursive:true,force:true});
  }
}
run().catch(error=>{console.error(error);process.exitCode=1});
