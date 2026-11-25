const assert=require('assert');
const fs=require('fs'),os=require('os'),path=require('path'),Module=require('module');

class FakeChatGPTController {
 constructor(){this.sessions={};}
 async assertNoHumanGate(){}
 composerLocator(){return {waitFor:async()=>{},evaluate:async()=>''}}
 async ensureReady(page){return this.composerLocator(page)}
 async snapshotAssistantState(){return {count:0,imageSources:new Set()}}
 async sendPrompt(page){throw Error('Legacy broad Send must not be called')}
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
 constructor(){this.turns=[];this.history=[];this.preview='';this.sequence=0;this.sent=0;this.reloads=0;this.uploadChoices=[];
  this.inputs=[new FakeInput(this,'initial')];this.activateOnReload=true;}
 locator(selector){
  if(selector==='input[type="file"]')return {count:async()=>this.inputs.length,nth:i=>this.inputs[i]};
  if(selector==='img')return {evaluateAll:async()=>[...this.history,...(this.preview?[this.preview]:[])].map(src=>({src,currentSrc:src}))};
  if(selector.includes('button[data-testid="send-button"]'))return {first:()=>({waitFor:async()=>{},click:async()=>{
   this.sent++;
   if(this.preview)this.history.push(this.preview);
   // The second submission intentionally has no observable user-role node.
   if(this.sent!==2)this.turns.push({role:'user',id:'user-'+this.sent,index:this.turns.length,images:[{src:this.preview}],busy:false});
   this.preview='';
   this.turns.push({role:'assistant',id:'assistant-'+this.sent,index:this.turns.length,images:[{src:'blob:generated-'+this.sent,ready:true,width:1024,height:1024}],busy:false});
  }})};
  if(selector.includes('composer-plus-btn'))return {count:async()=>0};
  throw Error('Unexpected selector: '+selector);
 }
 async evaluate(fn,baseline){
  if (baseline === undefined) return {turns:this.turns,draft:'',busy:false,composerPresent:true};
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
  controller.projects={getProjectDir:()=>root,update:()=>{}};
  controller.saveGeneratedAsset=async()=>({savePath:path.join(root,'generated.png'),metadata:{width:1024,height:1024},mime:'image/png'});
  const complete=()=>controller.captureGeneratedImage(page,'project',{},()=>{});
  // First reference works: image must be attached and confirmed before send.
  assert.strictEqual(await controller.attachReference(page,ref),true);
  assert.deepStrictEqual(page.uploadChoices,['initial']);
  await controller.sendPrompt(page,{evaluate:async()=> 'test prompt'});
  await complete();
  assert.strictEqual(page.sent,1);
  assert.strictEqual(page.reloads,0);

  // Consecutive job: the earliest input is stale. A fresh later input must win.
  page.inputs=[new FakeInput(page,'stale-first',false),new FakeInput(page,'live-second',true)];
  assert.strictEqual(await controller.attachReference(page,ref),true);
  await controller.sendPrompt(page,{evaluate:async()=> 'test prompt'});
  await complete();
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
  await controller.sendPrompt(page,{evaluate:async()=> 'test prompt'});
  await complete();
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
  // Regression: old assistant images and user uploads cannot authorize capture.
  const baseline={assistantCount:1,lastAssistantId:'old',userCount:1,known:new Set(['old','user-old']),sources:new Set(['blob:old'])};
  const old={role:'assistant',id:'old',index:1,images:[{src:'blob:old',ready:true,width:1024,height:1024}],busy:false};
  const user={role:'user',id:'user-old',index:0,images:[],busy:false};
  assert.strictEqual(patch.freshAssistant({turns:[user,old]},baseline),null);
  const fresh={role:'assistant',id:'new',index:2,images:[{src:'blob:old',ready:true,width:1024,height:1024},{src:'blob:fresh',ready:true,width:1024,height:1024}],busy:false};
  const pageWith=state=>({evaluate:async()=>state});
  assert.deepStrictEqual((await patch.generatedDomCandidates(pageWith({turns:[user,old,fresh],busy:false}),baseline)).map(x=>x.src),['blob:fresh']);
  assert.deepStrictEqual(await patch.generatedDomCandidates(pageWith({turns:[user,old,fresh],busy:true}),baseline),[]);
  // Execute the production DOM evaluator, rather than faking its output:
  // newer ChatGPT markup with data-turn, no user author-role node, and a
  // previous assistant image plus a newly generated image.
  const {JSDOM}=require('jsdom');
  const dom=new JSDOM('<main><article data-turn="user"><img src="https://example.test/ref.png"></article><article data-turn="assistant" data-testid="conversation-turn-2"><img src="https://example.test/old.png"></article><article data-turn="assistant" data-testid="conversation-turn-3"><img src="https://example.test/fresh.png"></article><div id="prompt-textarea"></div></main>');
  const win=dom.window;
  for(const img of win.document.images){
   Object.defineProperties(img,{naturalWidth:{value:1024},naturalHeight:{value:1024},complete:{value:true}});
   img.getClientRects=()=>[{width:400,height:400}];
  }
  const realDOMPage={evaluate:async fn=>{
   const oldDocument=global.document,oldStyle=global.getComputedStyle;
   global.document=win.document;global.getComputedStyle=win.getComputedStyle.bind(win);
   try{return fn()}finally{global.document=oldDocument;global.getComputedStyle=oldStyle}
  }};
  const domBaseline={assistantCount:1,lastAssistantId:'conversation-turn-2',userCount:1,known:new Set(['conversation-turn-2']),sources:new Set(['https://example.test/old.png'])};
  assert.deepStrictEqual((await patch.generatedDomCandidates(realDOMPage,domBaseline)).map(x=>x.src),['https://example.test/fresh.png']);
  win.document.querySelector('[data-testid="conversation-turn-3"]').remove();
  assert.deepStrictEqual(await patch.generatedDomCandidates(realDOMPage,domBaseline),[]);
  dom.window.close();
  console.log('ChatGPT consecutive reference uploads: stale first input rejected, second job sent, reload recovery, failed upload never sent: OK');
 }finally{
  Date.now=originalNow;Module._load=originalLoad;
  fs.rmSync(root,{recursive:true,force:true});
 }
}
run().catch(error=>{console.error(error);process.exitCode=1});
