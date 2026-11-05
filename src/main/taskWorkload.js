const fs=require('fs'),path=require('path'),{app}=require('electron'),sharp=require('sharp');
const FIELDS=['id','niche','idea','text','reference','difference'];
const safe=v=>String(v||'').trim().replace(/[^a-z0-9_-]+/gi,'_').replace(/^_+|_+$/g,'').slice(0,100);
const safeTitle=v=>String(v||'').trim().replace(/[\\/:*?"<>|]+/g,' ').replace(/\s+/g,' ').slice(0,185).trim();
const localDate=()=>{const d=new Date();return [d.getMonth()+1,d.getDate(),String(d.getFullYear()).slice(-2)].join('-')};
const marcinFields=['no','name','market','mainKeyword','subNiche','linkSource'];
class TaskWorkload {
 constructor({projects,chatgpt,vectorizer,exporter,mode='anuk'}){Object.assign(this,{projects,chatgpt,vectorizer,exporter,mode});this.running=false;this.stopRequested=false;this.paused=false;this.busy=false;this.rows=[];this.load();}
 get keys(){return this.mode==='marcin'?marcinFields:FIELDS}
 get keyField(){return this.mode==='marcin'?'no':'id'}
 assertRow(row){if(this.mode==='marcin'){if(!row.no||!row.name||!row.linkSource)throw Error('No., Name, and Link Source are required.')}else if(!row.id||!row.niche||!row.idea)throw Error('ID, Niche and Idea are required.')}
 get outputRoot(){return path.join(app.getPath('documents'),'ZeroPOD',this.mode==='marcin'?'Task [Marcin]':'Task [Anuk]')}
 get file(){return path.join(app.getPath('userData'),this.mode==='marcin'?'task-marcin.json':'task-workload.json')}
 get outputDir(){return path.join(this.outputRoot,localDate())}
 async preview(index){
  if(!Number.isInteger(index)||index<0||index>=this.rows.length)throw Error('Job not found.');
  const row=this.rows[index];
  if(!row.output)return {src:null};
  const filename=path.resolve(row.output);
  const parent=path.resolve(this.outputDir);
  const legacy=path.resolve(path.join(app.getPath('documents'),'ZeroPOD','Task Workload'));
  if(!(filename.startsWith(path.resolve(this.outputRoot)+path.sep)||filename.startsWith(legacy+path.sep))||path.extname(filename).toLowerCase()!=='.png')throw Error('Invalid Task Workload output path.');
  if(!fs.existsSync(filename))return {src:null,missing:true};
  const thumbnail=await sharp(filename).resize(360,360,{fit:'inside',withoutEnlargement:true}).webp({quality:78}).toBuffer();
  return {src:'data:image/webp;base64,'+thumbnail.toString('base64'),mtimeMs:fs.statSync(filename).mtimeMs};
 }
 load(){try{this.rows=JSON.parse(fs.readFileSync(this.file,'utf8')).rows||[]}catch{this.rows=[]}for(const row of this.rows)if(row.status==='working')row.status='pending';this.save()}
 save(){fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file,JSON.stringify({rows:this.rows},null,2))}
 snapshot(){return {rows:this.rows,running:this.running,paused:this.paused,outputDir:this.outputRoot}}
 setRows(rows){if(this.running)throw Error('Pause or stop before editing the queue.');if(!Array.isArray(rows)||rows.length>50)throw Error('Maximum 50 jobs');this.rows=rows.map((r,i)=>{const row=Object.fromEntries(this.keys.map(k=>[k,String(r[k]||'').trim()]));const old=this.rows[i];const unchanged=old&&this.keys.every(k=>old[k]===row[k]);const sameOutput=old&&(this.mode==='marcin'?old.no===row.no:(old.id===row.id&&old.niche===row.niche));return {...row,status:unchanged?old.status:'pending',output:sameOutput?old.output:null,error:unchanged?old.error:null,completedAt:sameOutput?old.completedAt:null,projectId:unchanged?old.projectId:null,manualNote:unchanged?(old.manualNote||null):null}});this.save();return this.snapshot()}
 appendRows(rows){
  if(this.running)throw Error('Stop Task Workload before importing an Excel list.');
  if(!Array.isArray(rows))throw Error('Invalid Excel import.');
  const fields=this.keys;
  const seen=new Set(this.rows.map(row=>String(row[this.keyField]||'').trim().toLowerCase()).filter(Boolean));
  const additions=[];let skipped=0;
  for(const incoming of rows){
   const row=Object.fromEntries(fields.map(key=>[key,String(incoming[key]||'').trim()]));
   this.assertRow(row);
   const id=row[this.keyField].toLowerCase();
   if(seen.has(id)){skipped++;continue}
   seen.add(id);additions.push({...row,status:'pending',output:null,error:null,manualNote:null});
  }
  if(this.rows.length+additions.length>50)throw Error('Task Workload supports 50 rows total. Clear old jobs or import fewer rows.');
  this.rows.push(...additions);this.save();
  return {added:additions.length,skipped,snapshot:this.snapshot()};
 }
 retryRow(index){
  if(this.running)throw Error('Pause or stop the active Task Workload before retrying a design.');
  if(!Number.isInteger(index)||index<0||index>=this.rows.length)throw Error('Task Workload row not found.');
  const row=this.rows[index];
  this.assertRow(row);
  row.retryRequested=true;
  row.status='pending';row.error=null;row.manualNote=null;
  this.stopRequested=false;this.paused=false;this.running=true;
  this.save();
  // A retry is a one-row run; other pending/failed rows are left untouched.
  this.loop([row]).catch(()=>{});
  return this.snapshot();
 }
 retryRows(indices){
  if(this.running)throw Error('Stop the current queue before retrying designs.');
  if(!Array.isArray(indices)||!indices.length)throw Error('Select one or more designs to retry.');
  const indexes=[...new Set(indices)].filter(i=>Number.isInteger(i)&&i>=0&&i<this.rows.length).sort((a,b)=>a-b);
  if(!indexes.length)throw Error('No valid rows selected.');
  const targets=indexes.map(i=>this.rows[i]);targets.forEach(r=>this.assertRow(r));
  if(TaskWorkload.active?.running&&TaskWorkload.active!==this)throw Error('Another Task tab is running.');
  for(const r of targets){r.retryRequested=true;r.status='pending';r.error=null;r.manualNote=null}
  this.stopRequested=false;this.paused=false;this.running=true;TaskWorkload.active=this;this.save();
  this.loop(targets).catch(()=>{});return this.snapshot();
 }
 deleteRows(indices){
  // Remove selected queue records ONLY. Exported PNGs and dated folders are permanent
  // user outputs and must never be deleted by a queue-management action.
  if(this.running)throw Error('Stop the running queue before deleting selected jobs.');
  if(!Array.isArray(indices)||!indices.length)throw Error('Select jobs to delete.');
  const indexes=[...new Set(indices)].filter(i=>Number.isInteger(i)&&i>=0&&i<this.rows.length).sort((a,b)=>a-b);
  if(!indexes.length)throw Error('No valid jobs selected.');
  const removed=new Set(indexes);
  this.rows=this.rows.filter((_,i)=>!removed.has(i));
  this.save();
  return {deletedRows:indexes.length,snapshot:this.snapshot()};
 }
 clear(status){if(this.running)throw Error('Stop queue before clearing.');this.rows=this.rows.filter(r=>r.status!==status);this.save();return this.snapshot()}
 pause(){this.paused=true;return this.snapshot()}
 stop(){this.stopRequested=true;this.paused=false;return this.snapshot()}
 start(){
  if(this.running){this.paused=false;return this.snapshot()}
  if(TaskWorkload.active?.running&&TaskWorkload.active!==this)throw Error('Another Task tab is running.');
  this.stopRequested=false;this.paused=false;this.running=true;TaskWorkload.active=this;
  this.loop().catch(()=>{});return this.snapshot()
 }
 async loop(targetRows=this.rows){try{for(const row of targetRows){if(this.stopRequested)break;while(this.paused&&!this.stopRequested)await new Promise(r=>setTimeout(r,300));if(this.stopRequested)break;if(['completed','manual-needed'].includes(row.status)&&!row.retryRequested)continue;row.status='working';row.error=null;row.manualNote=null;this.save();try{await this.process(row,{replaceExisting:Boolean(row.retryRequested)});row.status='completed';row.completedAt=new Date().toISOString()}catch(e){
    if(this.mode==='marcin'&&e.code==='MANUAL_NEEDED'){
     row.status='manual-needed';row.manualNote='Manual Needed — '+String(e.message||'Source design not available');row.error=null;
    }else{row.status='failed';row.error=String(e.message||e)}
   }row.retryRequested=false;this.save()}}finally{this.running=false;this.paused=false;if(TaskWorkload.active===this)TaskWorkload.active=null;this.save()}}
 async process(row,{replaceExisting=false}={}){
  this.assertRow(row);
  const filename=this.mode==='marcin'?(safeTitle(row.no)+' '+safeTitle(row.name)+'.png'):(safe(row.id)+'_'+safe(row.niche)+'.png');
  if(this.mode==='marcin'?(!safeTitle(row.no)||!safeTitle(row.name)):(!safe(row.id)||!safe(row.niche)))throw Error('Invalid output filename.');
  fs.mkdirSync(this.outputDir,{recursive:true});const target=path.join(this.outputDir,filename);
  const priorIsOwnOutput=Boolean(row.output&&path.resolve(row.output)===path.resolve(target));
  if(fs.existsSync(target)&&!(replaceExisting&&priorIsOwnOutput))throw Error('Output already exists: '+filename);
  const reference=this.mode==='marcin'?row.linkSource:(/^https?:\/\//i.test(row.reference)?row.reference:/^https?:\/\//i.test(row.idea)?row.idea:'');
  const imagePath=await this.referenceImage(row,reference);
  // Task [Marcin] sends only the resolved reference image plus the active
  // ZeroPOD prompt. Never append link, row data, or additional instructions.
  const hasVisualReference=this.mode==='anuk'&&Boolean((row.reference||'').trim()||/^https?:\/\//i.test(row.idea||'')||fs.existsSync(row.idea||''));
  // Marcin remains strictly image + active ZeroPOD prompt only.
  // Anuk uses the attached original image as concept input, then creates a
  // distinct variation governed by the job's Idea, exact text and changes.
  const prompt=this.mode==='marcin'?this.chatgpt.buildPrompt():[
    this.chatgpt.buildPrompt(),
    'TASK [ANUK] — REFERENCE-BASED ORIGINAL DESIGN VARIATION',
    hasVisualReference
      ? 'STUDY THE ATTACHED REFERENCE IMAGE FIRST. Understand its subject, niche, visual motifs, meaning or joke, and any existing slogan. Use it as the concept and inspiration for a NEW, distinct design; do not simply reproduce its layout or copy its artwork.'
      : 'If the attachment is blank, derive the design concept entirely from the Idea and Niche below.',
    'Niche: '+row.niche,
    'Design idea / intended direction: '+row.idea,
    row.text&&!/^(none|nothing|n\/a)$/i.test(row.text)
      ? 'EXACT OUTPUT WORDING (overrides any slogan in reference): '+row.text+'. Copy precisely; do not add, remove, or change words, spelling, or punctuation.'
      : 'When the reference has a slogan, preserve that exact slogan unless the Idea or Changes specifically say otherwise. If no slogan is present or requested, do not add text.',
    row.difference
      ? 'REQUIRED CHANGES / VERSION RELATIVE TO THE ORIGINAL (apply these visibly, not just tiny adjustments): '+row.difference
      : 'Create a visually different original version of the concept with new styling, typography, composition or supporting elements while preserving its recognizable idea.',
    'Priority: exact Text in Image > requested Changes / Version > Idea / Niche > original reference styling.',
    'Keep the reference concept and requested changes coherent. Do not copy watermarks, marketplace mockups, backgrounds, brand logos or unrequested trademarks.',
    'Produce only one clean, POD-friendly design with genuine transparency (not a fake checkerboard).'
  ].filter(Boolean).join('\n');
  // Use a per-instance prompt override only during submission; restore before async image capture.
  const original=this.chatgpt.buildPrompt;this.chatgpt.buildPrompt=()=>prompt;
  const payload=this.mode==='marcin'
    ? {referencePath:imagePath,sourceUrl:'',reviewNotes:''}
    : {referencePath:imagePath,sourceUrl:reference,reviewNotes:row.difference};
  let result;try{result=await this.chatgpt.start(payload)}finally{this.chatgpt.buildPrompt=original}
  row.projectId=result.projectId;this.save();
  let project;for(let n=0;n<240;n++){project=this.projects.read(result.projectId);if(project.status==='awaiting-review'&&project.generatedImagePath&&fs.existsSync(project.generatedImagePath))break;if(project.status==='chatgpt-recovery-needed')throw Error(project.chatgptError?.message||'Generation failed');await new Promise(r=>setTimeout(r,1500))}
  if(project.status!=='awaiting-review')throw Error('Image generation timed out');
  const approved=path.join(this.projects.getProjectDir(project.id),'approved.png');await sharp(project.generatedImagePath).png().toFile(approved);
  // The vectorizer checks metadata presence, not SEO validity. This is local-only and never published.
  this.projects.update(project.id,{approvedImagePath:approved,status:'metadata-ready',metadata:{title:this.mode==='marcin'?row.name:row.niche,mainTag:this.mode==='marcin'?(row.mainKeyword||row.name):row.niche,supportingTags:[],description:'Local Task export'}});
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
  const previous=row.output;row.output=target;
  if(replaceExisting&&previous&&path.resolve(previous)!==path.resolve(target)&&fs.existsSync(previous)){
   const p=path.resolve(previous);
   const roots=[path.resolve(this.outputRoot),path.resolve(path.join(app.getPath('documents'),'ZeroPOD','Task Workload'))];
   if(roots.some(root=>p.startsWith(root+path.sep)))try{fs.rmSync(p,{force:true})}catch{}
  }
 }
 async referenceImage(row,url){
  if(this.mode==='marcin'){
   try{
    if(!/^https?:\/\//i.test(url))throw Error('Link Source is missing or invalid.');
    const {resolver}=require('./sourceImageIpc');
    const found=await resolver.resolve(url);
    if(!found?.path||!fs.existsSync(found.path))throw Error('Source design image was not found.');
    const file=await sharp(found.path).metadata();
    if(!file.width||!file.height||file.width<120||file.height<120)throw Error('Source design image is too small or invalid.');
    return found.path;
   }catch(error){
    const manual=new Error(String(error.message||'Could not retrieve source image.'));
    manual.code='MANUAL_NEEDED';
    throw manual;
   }
  }
  // Anuk prioritizes the explicit Reference Link field (even when the column
  // is visually hidden). Historic jobs may also use an image URL/path in Idea.
  const explicit=String(row.reference||'').trim();
  const idea=String(row.idea||'').trim();
  const candidate=explicit||( (/^https?:\/\//i.test(idea)||fs.existsSync(idea))?idea:'' );
  if(candidate){
   const isWeb=/^https?:\/\//i.test(candidate);
   if(!isWeb){
    let file=candidate;
    if(/^file:\/\//i.test(candidate))file=require('url').fileURLToPath(candidate);
    if(!fs.existsSync(file)||!fs.statSync(file).isFile()){
     throw Error('Task [Anuk] reference file not found: '+candidate);
    }
    try{
     const metadata=await sharp(file).metadata();
     if(!metadata.width||!metadata.height||metadata.width<120||metadata.height<120)throw Error('Image is too small.');
    }catch(error){throw Error('Task [Anuk] reference is not a usable image: '+error.message)}
    return file;
   }
   // Direct image URLs: download the image, not an HTML page or link string.
   // Marketplace/product URLs: reuse the proven product image resolver.
   if(/\.(?:png|jpe?g|webp|gif|avif)(?:[?#]|$)/i.test(candidate)){
    try{
     const response=await fetch(candidate,{signal:AbortSignal.timeout(30000)});
     if(response.ok&&/^image\//i.test(response.headers.get('content-type')||'')){
      const bytes=Buffer.from(await response.arrayBuffer());
      const metadata=await sharp(bytes).metadata();
      if(metadata.width>=220&&metadata.height>=220){
       const dest=path.join(app.getPath('temp'),'zeropod-anuk-ref-'+process.pid+'-'+Date.now()+'-'+Math.random().toString(16).slice(2)+'.png');
       await sharp(bytes).png().toFile(dest);
       return dest;
      }
     }
    }catch{/* Page resolver below may still find the actual reference. */}
   }
   try{
    const {resolver}=require('./sourceImageIpc');
    const resolved=await resolver.resolve(candidate);
    if(!resolved?.path||!fs.existsSync(resolved.path))throw Error('No image found on the reference page.');
    const meta=await sharp(resolved.path).metadata();
    if(!meta.width||!meta.height||meta.width<220||meta.height<220)throw Error('Resolved reference image is too small.');
    return resolved.path;
   }catch(error){
    // Do not silently substitute a white canvas when the user specified a
    // reference: it would lose the original concept and produce the wrong job.
    throw Error('Task [Anuk] could not retrieve the reference design for '+(row.id||'this job')+': '+error.message);
   }
  }
  // Idea-only jobs continue to work exactly as before.
  const dest=path.join(app.getPath('temp'),'zeropod-task-blank.png');
  if(!fs.existsSync(dest))await sharp({create:{width:800,height:1000,channels:4,background:'#ffffff'}}).png().toFile(dest);
  return dest;
 }
}
module.exports={TaskWorkload};
