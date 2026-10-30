const fs=require('fs'),path=require('path'),{app}=require('electron'),sharp=require('sharp');
const FIELDS=['id','niche','idea','text','reference','difference'];
const safe=v=>String(v||'').trim().replace(/[^a-z0-9_-]+/gi,'_').replace(/^_+|_+$/g,'').slice(0,100);
class TaskWorkload {
 constructor({projects,chatgpt,vectorizer,exporter}){Object.assign(this,{projects,chatgpt,vectorizer,exporter});this.running=false;this.stopRequested=false;this.paused=false;this.busy=false;this.rows=[];this.load();}
 get file(){return path.join(app.getPath('userData'),'task-workload.json')}
 get outputDir(){return path.join(app.getPath('documents'),'ZeroPOD','Task Workload')}
 async preview(index){
  if(!Number.isInteger(index)||index<0||index>=this.rows.length)throw Error('Job not found.');
  const row=this.rows[index];
  if(!row.output)return {src:null};
  const filename=path.resolve(row.output);
  const parent=path.resolve(this.outputDir);
  if(path.dirname(filename)!==parent||path.extname(filename).toLowerCase()!=='.png')throw Error('Invalid Task Workload output path.');
  if(!fs.existsSync(filename))return {src:null,missing:true};
  const thumbnail=await sharp(filename).resize(360,360,{fit:'inside',withoutEnlargement:true}).webp({quality:78}).toBuffer();
  return {src:'data:image/webp;base64,'+thumbnail.toString('base64'),mtimeMs:fs.statSync(filename).mtimeMs};
 }
 load(){try{this.rows=JSON.parse(fs.readFileSync(this.file,'utf8')).rows||[]}catch{this.rows=[]}for(const row of this.rows)if(row.status==='working')row.status='pending';this.save()}
 save(){fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file,JSON.stringify({rows:this.rows},null,2))}
 snapshot(){return {rows:this.rows,running:this.running,paused:this.paused,outputDir:this.outputDir}}
 setRows(rows){if(this.running)throw Error('Pause or stop before editing the queue.');if(!Array.isArray(rows)||rows.length>50)throw Error('Maximum 50 jobs');this.rows=rows.map((r,i)=>{const row=Object.fromEntries(FIELDS.map(k=>[k,String(r[k]||'').trim()]));const old=this.rows[i];const unchanged=old&&FIELDS.every(k=>old[k]===row[k]);return {...row,status:unchanged?old.status:'pending',output:unchanged?old.output:null,error:unchanged?old.error:null,completedAt:unchanged?old.completedAt:null,projectId:unchanged?old.projectId:null}});this.save();return this.snapshot()}
 appendRows(rows){
  if(this.running)throw Error('Stop Task Workload before importing an Excel list.');
  if(!Array.isArray(rows))throw Error('Invalid Excel import.');
  const fields=FIELDS;
  const seen=new Set(this.rows.map(row=>String(row.id||'').trim().toLowerCase()).filter(Boolean));
  const additions=[];let skipped=0;
  for(const incoming of rows){
   const row=Object.fromEntries(fields.map(key=>[key,String(incoming[key]||'').trim()]));
   if(!row.id||!row.niche||!row.idea)throw Error('Imported rows require ID, Niche and Idea.');
   const id=row.id.toLowerCase();
   if(seen.has(id)){skipped++;continue}
   seen.add(id);additions.push({...row,status:'pending',output:null,error:null});
  }
  if(this.rows.length+additions.length>50)throw Error('Task Workload supports 50 rows total. Clear old jobs or import fewer rows.');
  this.rows.push(...additions);this.save();
  return {added:additions.length,skipped,snapshot:this.snapshot()};
 }
 retryRow(index){
  if(this.running)throw Error('Pause or stop the active Task Workload before retrying a design.');
  if(!Number.isInteger(index)||index<0||index>=this.rows.length)throw Error('Task Workload row not found.');
  const row=this.rows[index];
  if(!row.id||!row.niche||!row.idea)throw Error('Complete the row ID, Niche and Idea before retrying.');
  row.retryRequested=true;
  row.status='pending';row.error=null;
  this.stopRequested=false;this.paused=false;this.running=true;
  this.save();
  // A retry is a one-row run; other pending/failed rows are left untouched.
  this.loop([row]).catch(()=>{});
  return this.snapshot();
 }
 clear(status){if(this.running)throw Error('Stop queue before clearing.');this.rows=this.rows.filter(r=>r.status!==status);this.save();return this.snapshot()}
 pause(){this.paused=true;return this.snapshot()}
 stop(){this.stopRequested=true;this.paused=false;return this.snapshot()}
 start(){if(this.running){this.paused=false;return this.snapshot()}this.stopRequested=false;this.paused=false;this.running=true;this.loop().catch(()=>{});return this.snapshot()}
 async loop(targetRows=this.rows){try{for(const row of targetRows){if(this.stopRequested)break;while(this.paused&&!this.stopRequested)await new Promise(r=>setTimeout(r,300));if(this.stopRequested)break;if(row.status==='completed'&&!row.retryRequested)continue;row.status='working';row.error=null;this.save();try{await this.process(row,{replaceExisting:Boolean(row.retryRequested)});row.status='completed';row.completedAt=new Date().toISOString()}catch(e){row.status='failed';row.error=String(e.message||e)}row.retryRequested=false;this.save()}}finally{this.running=false;this.paused=false;this.save()}}
 async process(row,{replaceExisting=false}={}){
  if(!row.id||!row.niche||!row.idea)throw Error('ID, Niche and Idea are required.');
  const filename=safe(row.id)+'_'+safe(row.niche)+'.png';if(!safe(row.id)||!safe(row.niche))throw Error('Invalid output filename.');
  fs.mkdirSync(this.outputDir,{recursive:true});const target=path.join(this.outputDir,filename);
  const priorIsOwnOutput=Boolean(row.output&&path.resolve(row.output)===path.resolve(target));
  if(fs.existsSync(target)&&!(replaceExisting&&priorIsOwnOutput))throw Error('Output already exists: '+filename);
  const reference=/^https?:\/\//i.test(row.reference)?row.reference:/^https?:\/\//i.test(row.idea)?row.idea:'';
  const imagePath=await this.referenceImage(row,reference);
  const prompt=[this.chatgpt.buildPrompt(),'TASK WORKLOAD DESIGN INSTRUCTIONS:', 'Niche: '+row.niche,'Idea: '+row.idea,row.text&&!/^(none|nothing)$/i.test(row.text)?'Required image text (copy EXACTLY): '+row.text:'Do not invent a slogan or text unless explicitly specified in the idea or reference.',row.reference?'Reference: '+row.reference:'',row.difference?'Changes from original: '+row.difference:'','Create one finished POD design. Real alpha transparency; no checkerboard.'].filter(Boolean).join('\n');
  // Use a per-instance prompt override only during submission; restore before async image capture.
  const original=this.chatgpt.buildPrompt;this.chatgpt.buildPrompt=()=>prompt;
  let result;try{result=await this.chatgpt.start({referencePath:imagePath,sourceUrl:reference,reviewNotes:row.difference})}finally{this.chatgpt.buildPrompt=original}
  row.projectId=result.projectId;this.save();
  let project;for(let n=0;n<240;n++){project=this.projects.read(result.projectId);if(project.status==='awaiting-review'&&project.generatedImagePath&&fs.existsSync(project.generatedImagePath))break;if(project.status==='chatgpt-recovery-needed')throw Error(project.chatgptError?.message||'Generation failed');await new Promise(r=>setTimeout(r,1500))}
  if(project.status!=='awaiting-review')throw Error('Image generation timed out');
  const approved=path.join(this.projects.getProjectDir(project.id),'approved.png');await sharp(project.generatedImagePath).png().toFile(approved);
  // The vectorizer checks metadata presence, not SEO validity. This is local-only and never published.
  this.projects.update(project.id,{approvedImagePath:approved,status:'metadata-ready',metadata:{title:row.niche,mainTag:row.niche,supportingTags:[],description:'Task Workload local export'}});
  await this.vectorizer.start(project.id);const exported=await this.exporter.exportPng(project.id);
  // Stage the fully exported design beside the destination. Replacing is atomic:
  // the previous PNG remains untouched until the new export is ready.
  const staged=path.join(this.outputDir,'.task-'+process.pid+'-'+Date.now()+'-'+Math.random().toString(16).slice(2)+'.png');
  try{
   fs.copyFileSync(exported.path,staged);
   const info=await sharp(staged).metadata();
   if(info.format!=='png'||info.width!==4500||info.height!==5400||!info.hasAlpha)throw Error('Exported PNG failed 4500x5400 alpha verification.');
   // renameSync uses replacement semantics on Windows, avoiding an intermediate
   // missing-file state. If replacement fails, the original PNG is preserved.
   fs.renameSync(staged,target);
  }finally{if(fs.existsSync(staged))fs.rmSync(staged,{force:true})}
  row.output=target;
 }
 async referenceImage(row,url){
  const local=row.reference&&!/^https?:\/\//i.test(row.reference)?row.reference:(!/^https?:\/\//i.test(row.idea)&&fs.existsSync(row.idea)?row.idea:'');
  if(local&&fs.existsSync(local))return local;
  if(url){const response=await fetch(url,{signal:AbortSignal.timeout(30000)});if(response.ok&&/^image\//i.test(response.headers.get('content-type')||'')){const bytes=Buffer.from(await response.arrayBuffer());const dest=path.join(app.getPath('temp'),'zeropod-task-'+Date.now()+'.png');await sharp(bytes).png().toFile(dest);return dest}}
  // Text-only jobs use a blank white reference; generation instructions supply the actual concept.
  const dest=path.join(app.getPath('temp'),'zeropod-task-blank.png');if(!fs.existsSync(dest))await sharp({create:{width:800,height:1000,channels:4,background:'#ffffff'}}).png().toFile(dest);return dest;
 }
}
module.exports={TaskWorkload};
