(() => {
 const root=document.getElementById('taskWorkload');if(!root)return;
 const fields=[['id','ID'],['niche','Niche'],['idea','Idea (text or link)'],['text','Text in Image (exact)'],['reference','Reference Link'],['difference','Difference from Original']];
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let rows=[],running=false,paused=false,dirty=false;
 const style=document.createElement('style');style.textContent='.tw-scroll{overflow-x:auto}.tw-table{min-width:1260px;width:100%;border-collapse:separate;border-spacing:7px}.tw-table th{text-align:left;font-size:12px;color:#aeb8c7}.tw-table input{width:100%;min-width:0;box-sizing:border-box}.tw-table td{min-width:160px}.tw-table td:first-child{min-width:38px;width:38px}.tw-actions{display:flex;flex-wrap:wrap;gap:9px;margin:15px 0}.tw-status{font-size:12px;color:#aeb8c7}.tw-error{color:#ffabb4}.tw-result{color:#91e2b5;word-break:break-all}';document.head.appendChild(style);
 root.innerHTML='<div class="eyebrow">LOCAL PNG PRODUCTION</div><h2>Task Workload</h2><p class="muted">One line per job. Generate → Vectorize → 4500×5400 transparent PNG. No manual review or publishing.</p><div class="panel"><div class="tw-scroll"><table class="tw-table"><thead><tr><th>#</th>'+fields.map(f=>'<th>'+f[1]+'</th>').join('')+'<th>Status</th></tr></thead><tbody id="twRows"></tbody></table></div><div class="tw-actions"><button id="twAdd">+ Add Row</button><button id="twSave">Save Queue</button><button class="primary" id="twStart">Start Automation</button><button id="twPause">Pause / Resume</button><button class="danger" id="twStop">Stop</button><button id="twClearCompleted">Clear Completed</button><button id="twClearFailed">Clear Failed Jobs</button></div><p id="twSummary" class="muted"></p></div>';
 const body=document.getElementById('twRows');
 function render(){body.innerHTML=rows.map((r,i)=>'<tr><td>'+(i+1)+'</td>'+fields.map(([k])=>'<td><input data-i="'+i+'" data-k="'+k+'" value="'+esc(r[k])+'" '+(running?'disabled':'')+' /></td>').join('')+'<td class="tw-status">'+esc(r.status||'pending')+(r.error?'<div class="tw-error">'+esc(r.error)+'</div>':'')+(r.output?'<div class="tw-result">'+esc(r.output)+'</div>':'')+'</td></tr>').join('');document.getElementById('twSummary').textContent=rows.length+' / 50 jobs · '+(running?(paused?'Paused':'Running'):'Stopped')+(dirty?' · Unsaved edits':'');}
 body.addEventListener('input',e=>{const el=e.target;if(!el.dataset.k)return;rows[Number(el.dataset.i)][el.dataset.k]=el.value;dirty=true;});
 async function refresh(){if(dirty)return;const data=await window.zeroPOD.taskWorkload.list();rows=data.rows;running=data.running;paused=data.paused;render();}
 async function save(){if(running)throw Error('Stop before editing jobs');const data=await window.zeroPOD.taskWorkload.set(rows);rows=data.rows;dirty=false;render();}
 async function act(fn){try{await fn();await refresh()}catch(e){alert(e.message||String(e))}}
 document.getElementById('twAdd').onclick=()=>{if(running)return;if(rows.length>=50)return alert('50 job maximum');rows.push(Object.fromEntries(fields.map(([k])=>[k,''])));dirty=true;render()};
 document.getElementById('twSave').onclick=()=>act(save);
 document.getElementById('twStart').onclick=()=>act(async()=>{if(dirty)await save();await window.zeroPOD.taskWorkload.start();});
 document.getElementById('twPause').onclick=()=>act(()=>paused?window.zeroPOD.taskWorkload.start():window.zeroPOD.taskWorkload.pause());
 document.getElementById('twStop').onclick=()=>act(()=>window.zeroPOD.taskWorkload.stop());
 document.getElementById('twClearCompleted').onclick=()=>act(()=>window.zeroPOD.taskWorkload.clear('completed'));
 document.getElementById('twClearFailed').onclick=()=>act(()=>window.zeroPOD.taskWorkload.clear('failed'));
 refresh().catch(e=>console.error(e));setInterval(()=>{if(document.getElementById('taskWorkload').classList.contains('active-view'))refresh().catch(()=>{})},1500);
})();