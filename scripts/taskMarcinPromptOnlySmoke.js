const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const Module=require('module');

async function main(){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'zeropod-marcin-promptonly-'));
 const referencePath=path.join(temp,'resolved-reference.png');
 const generated=path.join(temp,'generated.png');
 const exported=path.join(temp,'final-4500x5400.png');
 fs.writeFileSync(referencePath,'RESOLVED REFERENCE');
 fs.writeFileSync(generated,'GENERATED');
 fs.writeFileSync(exported,'EXPORT');
 const originalLoad=Module._load;
 try{
   Module._load=function(request,parent,isMain){
     if(request==='electron')return {app:{getPath:kind=>path.join(temp,kind)}};
     if(request==='sharp')return input=>({
       png(){return {toFile:async output=>fs.copyFileSync(input,output)}},
       metadata:async()=>({format:'png',width:4500,height:5400,hasAlpha:true})
     });
     return originalLoad.call(this,request,parent,isMain);
   };
   const {TaskWorkload}=require('../src/main/taskWorkload');
   const activePrompt='EXACT USER ACTIVE PROMPT\nKEEP EXACTLY THESE WORDS';
   const calls=[];
   const chatgpt={
     buildPrompt:()=>activePrompt,
     async start(payload){
       calls.push({payload,pastedPrompt:this.buildPrompt()});
       return {projectId:'test-project'};
     }
   };
   const projects={
     read(id){return {id,status:'awaiting-review',generatedImagePath:generated}},
     getProjectDir(){const directory=path.join(temp,'project');fs.mkdirSync(directory,{recursive:true});return directory},
     update(){return {}}
   };
   const args={
     projects,chatgpt,
     vectorizer:{start:async()=>{}},
     exporter:{exportPng:async()=>({path:exported})}
   };
   const marcin=new TaskWorkload({...args,mode:'marcin'});
   const productUrl='https://www.amazon.com/dp/B00EXAMPLE';
   const marcinRow={
     no:'137920',
     name:'Some Music T-Shirt',
     market:'US',
     mainKeyword:'rock band',
     subNiche:'musical',
     linkSource:productUrl
   };
   marcin.referenceImage=async(row,url)=>{
     assert.strictEqual(row,marcinRow);
     assert.strictEqual(url,productUrl,'Link Source used only to retrieve reference image');
     return referencePath;
   };
   await marcin.process(marcinRow);
   assert.strictEqual(calls.length,1);
   assert.strictEqual(calls[0].pastedPrompt,activePrompt,
     'Task Marcin must submit the exact active ZeroPOD prompt, no appended instructions');
   assert.deepStrictEqual(calls[0].payload,{
     referencePath,sourceUrl:'',reviewNotes:''
   },'Task Marcin must attach reference image without URL or notes');
   assert.strictEqual(chatgpt.buildPrompt(),activePrompt,'prompt override must be restored');
   assert.strictEqual(fs.existsSync(marcinRow.output),true,'Marcin PNG export still works');
   assert.ok(marcinRow.output.endsWith('137920 Some Music T-Shirt.png'));

   const anuk=new TaskWorkload(args);
   const anukRow={id:'I-123',niche:'antlers',idea:'Vintage antler image',text:'EXACT IMAGE TEXT',reference:'',difference:'Use red'};
   anuk.referenceImage=async()=>referencePath;
   await anuk.process(anukRow);
   assert.strictEqual(calls.length,2);
   assert.ok(calls[1].pastedPrompt.startsWith(activePrompt),
     'Anuk must keep its existing prompt');
   assert.match(calls[1].pastedPrompt,/TASK \[ANUK\] DESIGN INSTRUCTIONS/);
   assert.match(calls[1].pastedPrompt,/Vintage antler image/);
   assert.strictEqual(chatgpt.buildPrompt(),activePrompt,'Anuk prompt override must also be restored');
   console.log('Task Marcin reference-image plus exact active prompt only; Anuk unchanged: OK');
 }finally{
   Module._load=originalLoad;
   fs.rmSync(temp,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error(error);process.exitCode=1});
