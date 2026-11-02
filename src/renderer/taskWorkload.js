(() => {
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const specs=[
    {id:'taskWorkload',api:'taskWorkload',name:'Task [Anuk]',ref:true,
      fields:[['id','ID',125],['niche','Niche',150],['idea','Idea (text or link)',240],['text','Text in Image (exact)',190],['reference','Reference Link',220],['difference','Difference from Original',240]]},
    {id:'taskMarcin',api:'taskMarcin',name:'Task [Marcin]',ref:false,
      fields:[['no','No.',95],['name','Name',300],['market','Market (DE, US)',110],['mainKeyword','Main niche / Main keyword',220],['subNiche','Sub niche',145],['linkSource','Link Source',260]]}
  ];
  const style=document.createElement('style');style.id='taskDualLayout';style.textContent=[
    '#taskWorkload.view,#taskMarcin.view{max-width:none!important;width:100%;min-width:0}',
    '.content:has(#taskWorkload.active-view),.content:has(#taskMarcin.active-view){padding:28px 20px 30px 28px}',
    '.tw-panel{background:var(--surface,#15191f);border:1px solid var(--border,#29313c);border-radius:14px;padding:17px;margin:18px 0}',
    '.tw-top{display:flex;align-items:center;justify-content:space-between;gap:15px;flex-wrap:wrap}',
    '.tw-stats{display:flex;gap:8px;flex-wrap:wrap}',
    '.tw-stats span{border:1px solid var(--border,#29313c);background:var(--surface-2,#1b2027);padding:8px 11px;border-radius:10px;color:var(--muted,#9ca6b6);font-size:12px}',
    '.tw-stats b{color:var(--text,#fff)}',
    '.tw-controls,.tw-actions{display:flex;gap:9px;flex-wrap:wrap;align-items:center}',
    '.tw-table-wrap{overflow-x:auto;width:100%;border:1px solid var(--border,#29313c);border-radius:11px;background:var(--bg-elevated,#101318)}',
    '.tw-table{min-width:1050px;width:100%;table-layout:fixed;border-collapse:collapse}',
    '.tw-table th{background:var(--surface-2,#1b2027);color:var(--muted,#9ca6b6);font-size:11px;padding:12px 7px;text-align:left;border-bottom:1px solid var(--border,#29313c)}',
    '.tw-table td{padding:8px 5px;vertical-align:middle;border-bottom:1px solid var(--border-soft,#222933)}',
    '.tw-table tr:last-child td{border-bottom:0}',
    '.tw-table td input:not([type=checkbox]){height:42px;width:100%;min-width:0;padding:8px;font-size:12px;text-overflow:ellipsis;white-space:nowrap}',
    '.tw-table .tw-check,.tw-table .tw-number{text-align:center}',
    '.tw-table input[type=checkbox]{width:18px;height:18px;accent-color:var(--accent,#3b82f6)}',
    '.tw-status{font-weight:700;font-size:11px;color:#9bc2f1}',
    '.tw-status.completed{color:#85ddb0}.tw-status.failed{color:#ffb4bc}.tw-status.manual-needed{color:#ffca82}',
    '.tw-manual-note{font-size:10px;color:#ffca82;margin-top:5px;line-height:1.35;overflow-wrap:anywhere}',
    '.tw-toggle{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--border,#29313c);background:var(--surface-2,#1b2027);border-radius:9px;padding:9px 12px;font-size:12px;font-weight:600;cursor:pointer}',
    '.tw-toggle input{width:18px;height:18px;margin:0;accent-color:var(--accent,#3b82f6)}',
    '.tw-newchat{margin:15px 0;background:var(--surface-2,#1b2027);border:1px solid var(--border,#29313c);border-radius:10px;padding:13px 16px}',
    '.tw-newchat label{display:flex;gap:11px;align-items:start;cursor:pointer}',
    '.tw-newchat input{width:19px;height:19px;margin:2px 0;accent-color:var(--accent,#3b82f6)}',
    '.tw-newchat p{font-weight:400;color:var(--muted,#9ca6b6);font-size:12px;margin:4px 0 0}',
    '.tw-hint{font-size:12px;color:var(--muted,#9ca6b6);margin:13px 0 0;overflow-wrap:anywhere}',
    '.tw-note{color:#85ddb0;font-size:12px;min-height:16px;margin-top:9px}',
    '.tw-results{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:13px;margin-top:13px}',
    '.tw-card{display:flex;flex-direction:column;gap:9px;padding:12px;border-radius:12px;border:1px solid var(--border,#29313c);background:var(--surface-2,#1b2027);min-width:0}',
    '.tw-card strong{font-size:12px;overflow-wrap:anywhere}', '.tw-card small{font-size:11px;color:var(--muted,#9ca6b6);overflow-wrap:anywhere}',
    '.tw-card .tw-error{color:#ffb4bc}',
    '.tw-image{height:200px;background:var(--bg-elevated,#101318);border:1px solid var(--border,#29313c);border-radius:9px;display:flex;align-items:center;justify-content:center;color:var(--muted,#9ca6b6);font-size:12px}',
    '.tw-image img{width:100%;height:100%;object-fit:contain}',
    '@media(max-width:960px){.content:has(#taskWorkload.active-view),.content:has(#taskMarcin.active-view){padding:20px 12px}}'
  ].join('');document.head.appendChild(style);

  function mount(spec){
    const root=document.getElementById(spec.id);if(!root)return;
    const api=window.zeroPOD[spec.api];
    const pfx=spec.id;
    const ids=k=>pfx+k;
    const chatKey='zeropod.'+spec.api+'.newChat.v1';
    const refKey='zeropod.'+spec.api+'.showReference.v1';
    let rows=[],running=false,paused=false,dirty=false,busy=false,signature='',showRef=localStorage.getItem(refKey)==='true';
    const selected=new Set();
    const thumbs=new Map();
    const keyFor=r=>spec.ref?String(r.id||''):String(r.no||'');
    const valid=r=>spec.ref?Boolean(r.id&&r.niche&&r.idea):Boolean(r.no&&r.name&&r.linkSource);
    root.innerHTML=
      '<div class="tw-top"><div><div class="eyebrow">LOCAL PNG PRODUCTION</div><h2>'+esc(spec.name)+'</h2>'+
      '<p class="muted">Generate → Vectorize → 4500×5400 transparent PNG. Dated output folders. No manual review or publishing.</p></div><div class="tw-stats" id="'+ids('Stats')+'"></div></div>'+
      '<div class="tw-panel"><div class="tw-controls">'+
      '<button id="'+ids('Add')+'">+ Add Row</button>'+
      '<button id="'+ids('Import')+'">Add List (.xlsx)</button>'+
      '<button id="'+ids('Save')+'">Save Queue</button>'+
      '<button id="'+ids('Open')+'">Open Output Folder</button>'+
      '<button id="'+ids('CheckAll')+'">Check All</button>'+
      '<button class="danger" id="'+ids('Delete')+'">Delete Selected</button>'+
      (spec.ref?'<label class="tw-toggle"><input type="checkbox" id="'+ids('Reference')+'">Show Reference Link</label>':'')+
      '</div><div class="tw-table-wrap" style="margin-top:15px"><table class="tw-table"><colgroup id="'+ids('Cols')+'"></colgroup><thead><tr id="'+ids('Header')+'"></tr></thead><tbody id="'+ids('Body')+'"></tbody></table></div>'+
      '<div class="tw-newchat"><label><input type="checkbox" id="'+ids('Chat')+'"><div><strong>New Chat</strong><p>Start each automation run in one fresh ChatGPT conversation. Every row in that run shares the same chat.</p></div></label></div>'+
      '<div class="tw-actions">'+
      '<button class="primary" id="'+ids('Start')+'">Start Automation</button>'+
      '<button id="'+ids('Pause')+'">Pause</button>'+
      '<button id="'+ids('Resume')+'">Resume Job</button>'+
      '<button class="danger" id="'+ids('Stop')+'">Stop</button>'+
      '<button id="'+ids('ClearCompleted')+'">Clear Completed</button>'+
      '<button id="'+ids('ClearFailed')+'">Clear Failed Jobs</button>'+
      '<button id="'+ids('Retry')+'">Retry Design</button>'+
      '</div><p class="tw-hint" id="'+ids('Summary')+'"></p><p class="tw-note" id="'+ids('Note')+'"></p></div>'+
      '<div class="tw-panel"><h3>Finished PNGs and job details</h3><p class="tw-hint">Output files are saved under '+esc(spec.name)+' in dated subfolders.</p>'+
      '<div class="tw-results" id="'+ids('Results')+'"></div></div>';
    const el=id=>document.getElementById(ids(id));
    const body=el('Body'),results=el('Results'),chat=el('Chat'),ref=spec.ref?el('Reference'):null;
    chat.checked=localStorage.getItem(chatKey)==='true';
    chat.onchange=()=>localStorage.setItem(chatKey,String(chat.checked));
    if(ref){ref.checked=showRef;ref.onchange=()=>{showRef=ref.checked;localStorage.setItem(refKey,String(showRef));render();}}
    function render(){
      const cols=spec.fields.filter(f=>!spec.ref||f[0]!=='reference'||showRef);
      el('Cols').innerHTML=[40,35,...cols.map(f=>f[2]),115].map(w=>'<col style="width:'+w+'px">').join('');
      el('Header').innerHTML='<th class="tw-check">✓</th><th>#</th>'+cols.map(f=>'<th>'+esc(f[1])+'</th>').join('')+'<th>Status</th>';
      body.innerHTML=rows.map((row,i)=>'<tr><td class="tw-check"><input type="checkbox" data-select="'+i+'"'+(selected.has(i)?' checked':'')+(running?' disabled':'')+'></td><td class="tw-number">'+(i+1)+'</td>'+
        cols.map(f=>{const val=esc(row[f[0]]||'');return '<td><input data-index="'+i+'" data-field="'+f[0]+'" value="'+val+'" title="'+val+'"'+(running?' disabled':'')+'></td>';}).join('')+
        '<td title="'+esc(row.manualNote||row.error||row.output||'')+'"><span class="tw-status '+esc(row.status||'pending')+'">'+esc(row.status==='manual-needed'?'Manual Needed':(row.status||'pending'))+'</span>'+(row.manualNote?'<div class="tw-manual-note">'+esc(row.manualNote)+'</div>':'')+'</td></tr>').join('');
      const count=status=>rows.filter(r=>r.status===status).length;
      el('Stats').innerHTML='<span>Total <b>'+rows.length+'</b> / 50</span><span>Completed <b>'+count('completed')+'</b></span><span>Working <b>'+count('working')+'</b></span><span>Failed <b>'+count('failed')+'</b></span><span>Manual Needed <b>'+count('manual-needed')+'</b></span>';
      const items=rows.map((row,i)=>({row,i})).filter(x=>x.row.output||x.row.error||x.row.manualNote);
      results.innerHTML=items.length?items.map(({row,i})=>
        '<article class="tw-card"><div class="tw-image">'+
        (row.output?'<img data-preview="'+i+'" alt="Image for '+esc(keyFor(row))+'">':'<span>Not generated</span>')+
        '</div><strong>'+esc(spec.ref?(row.id+' · '+row.niche):(row.no+' · '+row.name))+'</strong>'+
        '<small>'+esc(row.output?row.output.split(/[\\/]/).pop():'')+'</small>'+
        '<small class="'+(row.error||row.manualNote?'tw-error':'')+'">'+esc(row.manualNote||row.error||row.status||'')+'</small></article>').join(''):'<p class="tw-hint">Finished PNGs will appear here.</p>';
      for(const img of results.querySelectorAll('[data-preview]')){
        const i=Number(img.dataset.preview),r=rows[i],key=r.output+'|'+(r.completedAt||'');
        if(thumbs.has(key)){img.src=thumbs.get(key);continue;}
        api.preview(i).then(data=>{if(data&&data.src){thumbs.set(key,data.src);if(img.isConnected)img.src=data.src;}else if(img.isConnected)img.alt='PNG missing';}).catch(()=>{if(img.isConnected)img.alt='Preview unavailable';});
      }
      el('Summary').textContent=rows.length+' / 50 jobs · '+(running?(paused?'Paused':'Running'):'Stopped')+(dirty?' · Unsaved edits':'')+(selected.size?' · '+selected.size+' selected':'');
      ['Add','Import','Save','ClearCompleted','ClearFailed','Retry','CheckAll','Delete'].forEach(id=>{el(id).disabled=busy||running;});
      el('CheckAll').textContent=rows.length>0&&selected.size===rows.length?'Uncheck All':'Check All';
      el('CheckAll').disabled=busy||running||!rows.length;
      el('Delete').disabled=busy||running||!selected.size;
      el('Add').disabled=busy||running||rows.length>=50;
      el('Retry').disabled=busy||running||!selected.size;
      el('Start').disabled=busy||running;
      el('Pause').disabled=busy||!running||paused;
      el('Resume').disabled=busy||!(paused||(!running&&rows.some(r=>r.status==='pending'||r.status==='failed')));
      el('Stop').disabled=busy||!running;
      chat.disabled=busy||running;
    }
    function selectionClean(){
      for(const i of selected)if(!Number.isInteger(i)||i<0||i>=rows.length)selected.delete(i);
    }
    async function refresh(force=false){
      if(dirty&&!force)return;
      const data=await api.list(),sig=JSON.stringify([data.rows,data.running,data.paused]);
      if(sig===signature&&!force)return;
      signature=sig;rows=data.rows;running=Boolean(data.running);paused=Boolean(data.paused);selectionClean();render();
    }
    async function save(){
      if(running)throw Error('Stop running jobs before editing.');
      const next=await api.set(rows);rows=next.rows;dirty=false;signature='';render();
    }
    async function act(fn){
      if(busy)return;busy=true;render();
      try{await fn();await refresh(true);}catch(e){alert(e.message||String(e));}finally{busy=false;render();}
    }
    body.addEventListener('input',e=>{
      const x=e.target,i=Number(x.dataset.index);
      if(!x.dataset.field||!rows[i]||running)return;
      rows[i][x.dataset.field]=x.value;dirty=true;
      el('Summary').textContent=rows.length+' jobs · Unsaved edits';
    });
    body.addEventListener('change',e=>{
      const x=e.target;if(x.dataset.select===undefined)return;
      const row=rows[Number(x.dataset.select)];if(!row)return;
      const i=Number(x.dataset.select);if(x.checked)selected.add(i);else selected.delete(i);render();
    });
    el('Add').onclick=()=>{if(running||busy||rows.length>=50)return;rows.push(Object.fromEntries(spec.fields.map(f=>[f[0],''])));dirty=true;render();};
    el('Save').onclick=()=>act(save);
    el('Import').onclick=()=>act(async()=>{
      if(dirty)await save();
      const added=await api.importXlsx();if(added.canceled)return;
      rows=added.snapshot.rows;dirty=false;selected.clear();el('Note').textContent='Imported '+added.added+' design(s) from '+added.file+(added.skipped?' · '+added.skipped+' duplicate IDs skipped':'');
    });
    el('Open').onclick=()=>act(()=>api.openOutputFolder());
    el('CheckAll').onclick=()=>{
      if(running||busy)return;
      if(selected.size===rows.length)selected.clear();
      else{selected.clear();rows.forEach((_,i)=>selected.add(i));}
      render();
    };
    el('Delete').onclick=()=>act(async()=>{
      if(!selected.size)throw Error('Select the jobs to delete.');
      if(dirty)await save();
      const indexes=[...selected].sort((a,b)=>a-b);
      if(!window.confirm('Delete '+indexes.length+' selected job(s) and their matching exported PNG files? This cannot be undone.'))return;
      const removed=await api.deleteRows(indexes);
      rows=removed.snapshot.rows;selected.clear();dirty=false;
      el('Note').textContent='Deleted '+removed.deletedRows+' job(s) and '+removed.deletedFiles+' PNG(s).'+(removed.keptFiles?' '+removed.keptFiles+' files were kept because they could not be safely matched.':'');
    });
    el('Start').onclick=()=>act(async()=>{
      if(dirty)await save();
      if(!rows.some(r=>!['completed','manual-needed'].includes(r.status)))throw Error('No runnable designs. Fix a Manual Needed source and use Retry Design on that row.');
      if(chat.checked){await window.zeroPOD.generation.newChat();}
      await api.start();
    });
    el('Pause').onclick=()=>act(()=>api.pause());
    el('Resume').onclick=()=>act(()=>api.start());
    el('Stop').onclick=()=>act(()=>api.stop());
    el('ClearCompleted').onclick=()=>act(async()=>{await api.clear('completed');selected.clear();});
    el('ClearFailed').onclick=()=>act(async()=>{await api.clear('failed');selected.clear();});
    el('Retry').onclick=()=>act(async()=>{
      if(dirty)await save();
      const positions=rows.map((r,i)=>selected.has(i)?i:-1).filter(i=>i>=0);
      if(!positions.length)throw Error('Select designs using the row checkboxes.');
      if(chat.checked)await window.zeroPOD.generation.newChat();
      await api.retryRows(positions);
      el('Note').textContent='Retrying '+positions.length+' checked design(s), in order.';
    });
    refresh(true).catch(e=>console.error(spec.name,e));
    setInterval(()=>{if(root.classList.contains('active-view'))refresh().catch(()=>{});},1500);
  }
  specs.forEach(mount);
})();