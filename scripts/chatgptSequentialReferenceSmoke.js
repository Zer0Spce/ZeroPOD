const assert=require('assert');
const fs=require('fs'),os=require('os'),path=require('path'),Module=require('module');

class FakeChatGPTController {
 constructor(){this.sessions={};}
 async assertNoHumanGate(){}
 composerLocator(){return {waitFor:async()=>{}}}
 async ensureReady(page){return this.composerLocator(page)}
 async snapshotAssistantState(){return {count:0,imageSources:new Set()}}
 async sendPrompt(page){page.sent++;if(page.preview)page.history.push(page.preview);page.preview='';return true}
}
class FakeInput {
 constructor(page,name,active=true){Object.assign(this,{page,name,active,uploads:0})}
 async getAttribute(field){return field==='accept'?'image/png,image/jpeg':''}
 async isEnabled(){return true}
 async setInputFiles(payload){
  this.uploads++;
  this.page.uploadChoices.push(this.name);
  if(this.active){this.page.preview='blob:reference-'+(++this.page.sequence)}
  return true;
 }
}
class FakePage {
 constructor(){this.history=[];this.preview='';this.sequence=0;this.sent=0;this.reloads=0;this.uploadChoices=[];
  this.inputs=[new FakeInput(this,'initial')];this.activateOnReload=true;}
 locator(selector){
  if(selector==='input[type="file"]')return {count:async()=>this.inputs.length,nth:i=>this.inputs[i]};
  if(selector==='img')return {evaluateAll:async()=>[...this.history,...(this.preview?[this.preview]:[])].map(src=>({src,currentSrc:src}))};
  if(selector.includes('composer-plus-btn'))return {count:async()=>0};
  throw Error('Unexpected selector: '+selector);
 }
 async evaluate(fn,baseline){
  const srcs=[...this.history,...(this.preview?[this.preview]:[])];
  const newImage=Boolean(this.preview&&!baseline.includes(this.preview));
  return {
   newImage,attachmentNode:Boolean(this.preview),attachmentCount:this.preview?1:0,
   attachmentLabels:this.preview?['attached '+this.preview]:[],
   busy:false,sendEnabled:true,failed:false
  };
 }
 async reload(){this.reloads++;this.preview='';this.inputs=[new FakeInput(this,'reloaded-'+this.reloads,this.activateOnReload)];}
}

async function run(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'zeropod-sequential-upload-'));
 const ref=path.join(root,'reference.png');fs.writeFileSync(ref,'image bytes');
 const originalLoad=Module._load,originalNow=Date.now;
 try{
  Module._load=function(request,parent,isMain){
   if(request==='./chatgptController')return {ChatGPTController:FakeChatGPTController};
   if(request==='sharp')return ()=>({});
   return originalLoad.call(this,request,parent,isMain);
  };
  const patch=require('../src/main/chatgptLiveReliabilityPatch');
  Module._load=originalLoad;
  let clock=0;
  Date.now=()=>{clock+=3000;return clock};
  const controller=new FakeChatGPTController(),page=new FakePage();
  // First reference works: image must be attached and confirmed before send.
  assert.strictEqual(await controller.attachReference(page,ref),true);
  assert.deepStrictEqual(page.uploadChoices,['initial']);
  await controller.sendPrompt(page,{});
  assert.strictEqual(page.sent,1);
  assert.strictEqual(page.reloads,0);

  // Consecutive job: the earliest input is stale. A fresh later input must win.
  page.inputs=[new FakeInput(page,'stale-first',false),new FakeInput(page,'live-second',true)];
  assert.strictEqual(await controller.attachReference(page,ref),true);
  await controller.sendPrompt(page,{});
  assert.strictEqual(page.sent,2,'second row must actually submit');
  assert.deepStrictEqual(page.uploadChoices,['initial','live-second']);
  assert.strictEqual(page.reloads,0);
  assert.strictEqual(page.history.length,2);

  // Chrome can accept bytes into a stale input with no visible preview.
  // Recovery reloads the SAME conversation and submits only after fresh preview.
  page.inputs=[new FakeInput(page,'stale-third',false)];
  page.activateOnReload=true;
  assert.strictEqual(await controller.attachReference(page,ref),true);
  assert.strictEqual(page.reloads,1,'failed attachment should trigger one fresh composer reload');
  assert.deepStrictEqual(page.uploadChoices.slice(-2),['stale-third','reloaded-1']);
  await controller.sendPrompt(page,{});
  assert.strictEqual(page.sent,3);

  // If Chrome never shows the image on either attempt, fail closed; do not send.
  page.inputs=[new FakeInput(page,'stale-fourth',false)];
  page.activateOnReload=false;
  await assert.rejects(()=>controller.attachReference(page,ref),/after two attempts.*Nothing was sent without the image/);
  assert.strictEqual(page.reloads,2);
  assert.strictEqual(page.sent,3,'missing attachment must never send a text-only prompt');

  // An existing attachment from a previous row alone is not proof of the new row.
  assert.strictEqual(patch.hasNewReferenceEvidence({
   newImage:false,attachmentCount:1,attachmentLabels:['old image']
  },{attachmentCount:1,attachmentLabels:['old image']}),false);
  assert.strictEqual(patch.hasNewReferenceEvidence({
   newImage:true,attachmentCount:1,attachmentLabels:['new image']
  },{attachmentCount:1,attachmentLabels:['old image']}),true);
  console.log('ChatGPT consecutive reference uploads: stale first input rejected, second job sent, reload recovery, failed upload never sent: OK');
 }finally{
  Date.now=originalNow;Module._load=originalLoad;
  fs.rmSync(root,{recursive:true,force:true});
 }
}
run().catch(error=>{console.error(error);process.exitCode=1});
