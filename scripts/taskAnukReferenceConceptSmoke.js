const assert=require('assert');
const fs=require('fs'),os=require('os'),path=require('path'),Module=require('module');

async function run(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'zeropod-anuk-ref-'));
 const local=path.join(root,'reference-local.png');
 const resolved=path.join(root,'reference-from-amazon.png');
 const generated=path.join(root,'generated.png');
 const exported=path.join(root,'exported-4500x5400.png');
 for(const file of [local,resolved,generated,exported])fs.writeFileSync(file,'TEST IMAGE '+path.basename(file));

 const captured=[];
 let resolverCalls=0, resolverError=false;
 const originalLoad=Module._load,originalFetch=global.fetch;
 const mockSharp=input=>({
  async metadata(){return {format:'png',width:4500,height:5400,hasAlpha:true}},
  png(){return {async toFile(file){
   if(Buffer.isBuffer(input))fs.writeFileSync(file,input);
   else if(typeof input==='string')fs.copyFileSync(input,file);
   else fs.writeFileSync(file,'BLANK');
  }}},
  resize(){return {webp(){return {async toBuffer(){return Buffer.from('preview')}}}}}
 });
 try{
  Module._load=function(request,parent,isMain){
   if(request==='electron')return {app:{getPath:key=>path.join(root,key)}};
   if(request==='sharp')return mockSharp;
   if(request==='./sourceImageIpc')return {resolver:{
    async resolve(url){
     resolverCalls++;
     if(resolverError)throw Error('product image temporarily unavailable');
     assert.match(url,/^https?:\/\//);
     return {path:resolved,title:'Original product reference'};
    }
   }};
   return originalLoad.call(this,request,parent,isMain);
  };
  const {TaskWorkload}=require('../src/main/taskWorkload');
  const chatgpt={
   buildPrompt:()=>'-THE EXISTING EXACT ZEROPOD PROMPT-',
   async start(payload){
    captured.push({payload,prompt:this.buildPrompt()});
    return {projectId:'project-'+captured.length};
   }
  };
  const projects={
   read(id){return {id,status:'awaiting-review',generatedImagePath:generated}},
   getProjectDir(id){const dir=path.join(root,'projects',id);fs.mkdirSync(dir,{recursive:true});return dir},
   update(){return {}}
  };
  const queue=new TaskWorkload({projects,chatgpt,vectorizer:{async start(){}},exporter:{async exportPng(){return {path:exported}}}});
  const amazon='https://www.amazon.com/dp/B0G5EXAMPLE';
  const first={
   id:'I-261028-15',niche:'wildflower garden',idea:'Botanical cottagecore wildflower design',
   text:'MAKE IT BLOOM',reference:amazon,
   difference:'Replace original colors, change typeface and rearrange the leaves'
  };
  await queue.process(first);
  assert.strictEqual(resolverCalls,1,'source product page must be resolved into a real image');
  assert.strictEqual(captured.length,1);
  assert.strictEqual(captured[0].payload.referencePath,resolved,'attach actual resolved reference image');
  assert.strictEqual(captured[0].payload.sourceUrl,amazon);
  assert.strictEqual(captured[0].payload.reviewNotes,first.difference);
  assert.ok(captured[0].prompt.startsWith('-THE EXISTING EXACT ZEROPOD PROMPT-'));
  for(const phrase of [
   'STUDY THE ATTACHED REFERENCE IMAGE FIRST',
   first.niche,first.idea,first.text,first.difference,
   'NEW, distinct design',
   'Priority: exact Text in Image'
  ])assert(captured[0].prompt.includes(phrase),'Missing concept variation instruction: '+phrase);
  assert.ok(!captured[0].prompt.includes(amazon),'Product URL must not substitute for attached image');
  assert.strictEqual(fs.existsSync(first.output),true,'should export generated art');

  const second={
   id:'I-261028-16',niche:'garden flowers',idea:'Use the flower design as inspiration',
   text:'',reference:local,difference:'New retro type and fewer leaves'
  };
  await queue.process(second);
  assert.strictEqual(captured[1].payload.referencePath,local,'local reference image should attach directly');
  assert.strictEqual(resolverCalls,1,'local references should not use a web resolver');
  assert.match(captured[1].prompt,/When the reference has a slogan, preserve that exact slogan/);
  assert.match(captured[1].prompt,/New retro type and fewer leaves/);

  const olderIdeaImage={
   id:'I-261028-17',niche:'garden flowers',idea:local,text:'',reference:'',difference:'Use an art deco version'
  };
  await queue.process(olderIdeaImage);
  assert.strictEqual(captured[2].payload.referencePath,local,'legacy image path in Idea must still attach');
  assert.match(captured[2].prompt,/STUDY THE ATTACHED REFERENCE IMAGE FIRST/);

  const noReference={
   id:'I-261028-18',niche:'original design',idea:'Make a simple positive quote',
   text:'STAY BRAVE',reference:'',difference:''
  };
  await queue.process(noReference);
  assert.match(captured[3].prompt,/If the attachment is blank, derive the design concept entirely/);
  assert.ok(fs.existsSync(captured[3].payload.referencePath),'idea-only rows retain blank-reference fallback');

  const direct='https://cdn.example.com/new-reference.png';
  global.fetch=async url=>{
   assert.strictEqual(url,direct);
   return {ok:true,headers:{get:()=> 'image/png'},arrayBuffer:async()=>Uint8Array.from([1,2,3,4]).buffer};
  };
  const directPath=await queue.referenceImage({id:'I-261028-19',idea:'test',reference:direct},direct);
  assert.ok(fs.existsSync(directPath),'direct image URL must be saved locally before attaching');
  assert.notStrictEqual(directPath,direct,'ChatGPT receives an actual image path, not a URL');
  assert.strictEqual(resolverCalls,1,'direct image must not go through product page extraction');

  resolverError=true;
  const failure={id:'I-261028-20',niche:'cats',idea:'Cat artwork',reference:'https://www.amazon.com/dp/B0BADREFFED',difference:'Restyle it'};
  await assert.rejects(()=>queue.process(failure),/could not retrieve the reference design.*product image temporarily unavailable/);
  assert.strictEqual(captured.length,4,'missing explicit reference must never silently generate from blank canvas');
  assert.strictEqual(fs.existsSync(path.join(queue.outputDir,'I-261028-20_cats.png')),false);
  assert.strictEqual(chatgpt.buildPrompt(),'-THE EXISTING EXACT ZEROPOD PROMPT-','prompt must be restored');

  console.log('Task [Anuk] real reference links, local image attachment, original concept/changes, exact text, legacy idea-only compatibility and missing-source safety: OK');
 }finally{
  Module._load=originalLoad;global.fetch=originalFetch;
  fs.rmSync(root,{recursive:true,force:true});
 }
}
run().catch(err=>{console.error(err);process.exitCode=1});
