const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {generatedDomCandidates,fingerprintDistance,attachmentState}=require('../src/main/chatgptLiveReliabilityPatch');
(async()=>{
 const dom=new JSDOM('<main><article data-turn="assistant" data-testid="conversation-turn-1"><img src="https://example.test/old.png" alt="Generated image"><button aria-label="Download image"></button></article><article data-turn="user"><img src="https://example.test/ref.png"></article><article data-turn="assistant" data-testid="conversation-turn-3"><img src="https://example.test/preview.png" alt="Generating image"><button aria-label="Download image"></button></article><form><div id="prompt-textarea" contenteditable="true"></div><img src="https://example.test/upload.png"><button data-testid="send-button"></button></form></main>');
 const win=dom.window;
 for(const el of win.document.querySelectorAll('*')){
  el.getClientRects=()=>[{width:600,height:600}];el.getBoundingClientRect=()=>({width:600,height:600,left:0,right:600,top:0,bottom:600});
 }
 for(const img of win.document.images)Object.defineProperties(img,{naturalWidth:{value:1024},naturalHeight:{value:1024},complete:{value:true}});
 const page={evaluate:async(fn,args)=>{
  const saved={document:global.document,getComputedStyle:global.getComputedStyle};
  global.document=win.document;global.getComputedStyle=win.getComputedStyle.bind(win);
  try{return fn(args)}finally{Object.assign(global,saved)}
 }};
 const base={count:1,ids:['conversation-turn-1'],lastId:'conversation-turn-1',sources:new Set(['https://example.test/old.png'])};
 assert.deepEqual(await generatedDomCandidates(page,base),[],'preview rejected even with image control');
 const img=win.document.querySelector('[data-testid="conversation-turn-3"] img');
 img.alt='Generated image';img.src='https://example.test/final.png';
 const button=win.document.querySelector('[data-testid="conversation-turn-3"] button');
 button.setAttribute('aria-label','Edit');
 assert.deepEqual(await generatedDomCandidates(page,base),[],'generic control does not prove final image');
 button.setAttribute('aria-label','Download image');
 assert.deepEqual((await generatedDomCandidates(page,base)).map(x=>x.src),['https://example.test/final.png']);
 img.src='https://example.test/ref.png';
 assert.deepEqual(await generatedDomCandidates(page,base),[],'user attachment rejected');
 img.src='https://example.test/final.png';
 win.document.querySelector('[data-testid="conversation-turn-3"]').setAttribute('aria-busy','true');
 // Busy descendant simulates image-generation progress.
 img.setAttribute('aria-busy','true');
 assert.deepEqual(await generatedDomCandidates(page,base),[]);
 const upload=await attachmentState(page,[],'test.png');
 assert.equal(upload.newImage,true);assert.equal(upload.sendEnabled,true);
 assert.equal((await attachmentState(page,['https://example.test/upload.png'],'test.png')).newImage,false,'old chat pictures cannot prove a new upload');
 assert.equal(fingerprintDistance(Buffer.from([1,2,3]).toString('base64'),Buffer.from([1,2,3]).toString('base64')),0);
 const {assertDistinctOutput}=require('../src/main/taskWorkload');
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),sharp=require('sharp');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zeropod-duplicate-'));
 try{
  const a=path.join(dir,'a.png'),b=path.join(dir,'b.png'),c=path.join(dir,'c.png');
  await sharp({create:{width:512,height:512,channels:3,background:'#999999'}}).png().toFile(a);
  await sharp({create:{width:512,height:512,channels:3,background:'#9a9a9a'}}).png().toFile(b);
  await sharp({create:{width:512,height:512,channels:3,background:'#ee2233'}}).png().toFile(c);
  await assert.rejects(()=>assertDistinctOutput(b,[a]),/duplicates another job/);
  await assertDistinctOutput(c,[a]);
  // White designs on transparent backgrounds must not collapse into the
  // same all-white fingerprint or be confused with the blank reference.
  const whiteA=path.join(dir,'white-a.png'),whiteB=path.join(dir,'white-b.png'),blank=path.join(dir,'blank.png');
  const transparent={width:512,height:512,channels:4,background:'#00000000'};
  await sharp({create:transparent}).composite([{input:Buffer.from('<svg width="512" height="512"><rect x="10" y="10" width="200" height="180" fill="white"/></svg>')}]).png().toFile(whiteA);
  await sharp({create:transparent}).composite([{input:Buffer.from('<svg width="512" height="512"><circle cx="380" cy="380" r="95" fill="white"/></svg>')}]).png().toFile(whiteB);
  await sharp({create:{width:512,height:512,channels:4,background:'#ffffff'}}).png().toFile(blank);
  await assertDistinctOutput(whiteB,[whiteA]);
  const {isReferenceImage}=require('../src/main/chatgptReferenceImageFilterPatch');
  assert.equal(await isReferenceImage(whiteA,blank),false);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
 dom.window.close();
 console.log('Final image and attachment DOM regression checks passed');
})().catch(e=>{console.error(e);process.exitCode=1});
