const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const crypto = require('crypto');
const { ChatGPTController } = require('./chatgptController');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pendingUploads = new WeakMap();
const postSendBaselines = new WeakMap();
const dirtyPages = new WeakSet();

const previousSnapshot = ChatGPTController.prototype.snapshotAssistantState;
const previousSendPrompt = ChatGPTController.prototype.sendPrompt;

async function composerVisible(controller, page, timeout = 700) {
  try {
    const composer = controller.composerLocator(page);
    await composer.waitFor({ state: 'visible', timeout });
    return composer;
  } catch {
    return null;
  }
}

async function allImageSources(page) {
  return page.locator('img').evaluateAll((images) => images
    .map((img) => img.currentSrc || img.src || '')
    .filter(Boolean)).catch(() => []);
}

function mimeFromPath(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/png';
}

function validThread(controller, value) {
  if (typeof controller.sessions.isValidChatGPTThreadUrl === 'function') {
    return controller.sessions.isValidChatGPTThreadUrl(value);
  }
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.hostname !== 'chatgpt.com') return false;
    const match = url.pathname.match(/^\/c\/([A-Za-z0-9-]+)$/);
    return Boolean(match && match[1].length >= 20 && !/^local-chatgpt/i.test(match[1]));
  } catch {
    return false;
  }
}

// Do not navigate away from an already-usable ChatGPT composer. This removes the
// largest avoidable delay in live runs and still remembers a real thread when the
// current tab is already inside one.
ChatGPTController.prototype.openPreferredThread = async function openPreferredThreadLive(page) {
  if (page.url().startsWith('https://chatgpt.com')) {
    const composer = await composerVisible(this, page, 900);
    if (composer) {
      if (validThread(this, page.url())) this.sessions.rememberThreadUrl('chatgpt', page.url());
      return;
    }
  }

  const saved = this.sessions.getLastThreadUrl('chatgpt');
  if (saved && validThread(this, saved)) {
    try {
      await page.goto(saved, { waitUntil: 'domcontentloaded', timeout: 6000 });
      if (await composerVisible(this, page, 2200)) return;
    } catch {}
    this.sessions.clearLastThreadUrl?.('chatgpt');
  }

  if (!page.url().startsWith('https://chatgpt.com')) {
    try {
      await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 10000 });
    } catch (error) {
      if (!page.url().startsWith('https://chatgpt.com')) throw error;
    }
  }
};

ChatGPTController.prototype.ensureReady = async function ensureReadyLive(page) {
  await page.bringToFront();

  let composer = await composerVisible(this, page, 900);
  if (composer) return composer;

  if (!page.url().startsWith('https://chatgpt.com')) {
    try {
      await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 10000 });
    } catch (error) {
      if (!page.url().startsWith('https://chatgpt.com')) throw error;
    }
  }

  await this.assertNoHumanGate(page);
  const auth = await this.sessions.detectAuthState('chatgpt', page);
  if (auth.status === 'needs-login') {
    throw new Error('ChatGPT is not signed in. Open Connections → ChatGPT → Open Login Browser, finish login in Chrome, then Test Session.');
  }

  composer = await composerVisible(this, page, 7000);
  if (composer) return composer;

  throw new Error('ChatGPT opened, but the message composer did not become ready. ZeroPOD did not paste the image or prompt into an unready page.');
};

async function attachmentState(page, beforeSources, filename = '') {
  return page.evaluate(({baseline, filename}) => {
    const visible = el => {
      if (!el) return false;
      const r = el.getBoundingClientRect(), style = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const composer = ['#prompt-textarea','[data-testid="composer-text-input"]','textarea[placeholder*="Message" i]','[contenteditable="true"]','textarea']
      .flatMap(sel => [...document.querySelectorAll(sel)]).find(visible);
    if (!composer) return {newImage:false, attachmentNode:false, busy:false, sendEnabled:false, failed:false};
    const scope = composer.closest('form') || composer.closest('[data-testid="composer"]') || composer.closest('[data-type="unified-composer"]') || document;
    const cr = composer.getBoundingClientRect();
    const near = el => {
      if (!visible(el) || el.closest('[data-message-author-role], [data-turn="user"], [data-turn="assistant"], [data-testid^="conversation-turn-"]')) return false;
      if (scope !== document) return scope.contains(el);
      const r = el.getBoundingClientRect();
      return r.bottom >= cr.top - 420 && r.top <= cr.bottom + 180 && r.right >= cr.left - 220 && r.left <= cr.right + 220;
    };
    const seen = new Set(baseline || []);
    const images = [...scope.querySelectorAll('img')].filter(img => {
      const r=img.getBoundingClientRect(); return near(img) && r.width>=24 && r.height>=24;
    });
    const newImage = images.some(img => {
      const src=img.currentSrc||img.src||''; return src && !seen.has(src);
    });
    const remove = [...scope.querySelectorAll('button')].filter(near).some(el => /remove (?:file|image|attachment|upload)|delete (?:file|image|attachment)/i.test([el.getAttribute('aria-label'),el.getAttribute('title'),el.getAttribute('data-testid')].join(' ')));
    const named = filename && [...scope.querySelectorAll('[title],[aria-label],[data-testid*="attachment" i],[data-testid*="file" i]')].filter(near).some(el =>
      [el.getAttribute('title'),el.getAttribute('aria-label'),el.textContent].some(v=>String(v||'').includes(filename)));
    const busy = [...scope.querySelectorAll('[role="progressbar"],[aria-busy="true"],[data-testid*="uploading" i],[data-testid*="progress" i]')].some(near);
    const send = [...scope.querySelectorAll('button[data-testid="send-button"],button[aria-label="Send prompt" i],button[aria-label="Send message" i],button[aria-label="Send" i]')].find(near);
    const sendEnabled = !!(send && !send.disabled && send.getAttribute('aria-disabled') !== 'true');
    const failed = [...document.querySelectorAll('[role="alert"],[data-testid*="error" i]')].filter(near).some(el=>/upload failed|failed to upload|couldn['’]t upload|unsupported file|file too large/i.test(el.innerText||el.textContent||''));
    return {newImage,attachmentNode:!!(remove||named),busy,sendEnabled,failed};
  }, {baseline:beforeSources,filename});
}

async function findComposerFileInput(page) {
  const inputs = page.locator('input[type="file"]');
  const count = await inputs.count();
  let fallback = null;
  for (let i=count-1;i>=0;i--) {
    const input=inputs.nth(i);
    if (!(await input.isEnabled().catch(()=>false))) continue;
    const accept=await input.getAttribute('accept').catch(()=>'');
    if (accept && !/image|\.png|\.jpe?g|\.webp|\.gif/i.test(accept)) continue;
    const owned=await input.evaluate(el=>!!el.closest('form,[data-testid="composer"],[data-type="unified-composer"]')).catch(()=>false);
    if (owned) return input;
    if (!fallback) fallback=input;
  }
  return fallback;
}

async function setInputBytes(input, referencePath, filename) {
  const buffer = fs.readFileSync(referencePath);
  await input.setInputFiles({
    name: filename,
    mimeType: mimeFromPath(referencePath),
    buffer
  }, { timeout: 3500 });
}

async function injectFast(page, referencePath, filename, menuFirst = false) {
  let input = await findComposerFileInput(page);
  if (input && !menuFirst) {
    await setInputBytes(input, referencePath, filename);
    return 'memory-file-input';
  }

  const plus = page.locator('button[data-testid="composer-plus-btn"]:visible, button[aria-label*="add" i]:visible').first();
  if (await plus.count()) {
    await plus.click({ timeout: 1500 }).catch(() => {});
    await wait(120);
    input = await findComposerFileInput(page);
    if (input && !menuFirst) {
      await setInputBytes(input, referencePath, filename);
      return 'composer-plus-file-input';
    }
  }

  const menuItems = [
    page.getByRole('menuitem', { name: /upload|photo|file/i }).first(),
    page.getByRole('button', { name: /upload from computer|add photos|add files|photos.*files/i }).first(),
    page.getByText(/upload from computer|add photos(?:\s*&\s*| and )files/i).first()
  ];

  for (const item of menuItems) {
    try {
      await item.waitFor({ state: 'visible', timeout: 350 });
      const chooserPromise = page.waitForEvent('filechooser', { timeout: 1200 }).catch(() => null);
      await item.click({ timeout: 900 });
      const chooser = await chooserPromise;
      if (chooser) {
        const buffer = fs.readFileSync(referencePath);
        await chooser.setFiles({ name: filename, mimeType: mimeFromPath(referencePath), buffer });
        return 'native-file-chooser-memory';
      }
      input = await findComposerFileInput(page);
      if (input) {
        await setInputBytes(input, referencePath, filename);
        return 'upload-menu-file-input';
      }
    } catch {}
  }

  throw new Error('ChatGPT composer is ready, but ZeroPOD could not access its image upload control.');
}

function uniqueFilename(referencePath) {
  return 'zeropod-' + crypto.randomBytes(6).toString('hex') + (path.extname(referencePath)||'.png');
}

async function pasteReference(composer, referencePath, filename) {
  const bytes=fs.readFileSync(referencePath);
  await composer.click({timeout:5000});
  return composer.evaluate((el, {base64,filename,mime})=>{
    const decoded=atob(base64), bytes=Uint8Array.from(decoded,ch=>ch.charCodeAt(0));
    const transfer=new DataTransfer();
    transfer.items.add(new File([bytes],filename,{type:mime}));
    el.focus();
    el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));
  },{base64:bytes.toString('base64'),filename,mime:mimeFromPath(referencePath)});
}

ChatGPTController.prototype.attachReference = async function attachReferenceLive(page, referencePath) {
  await this.assertNoHumanGate(page);
  pendingUploads.delete(page);
  if (dirtyPages.has(page)) {
    await page.reload({waitUntil:'domcontentloaded',timeout:30000});
    await this.ensureReady(page);
  }
  dirtyPages.add(page);
  const composer=await composerVisible(this,page,10000);
  if (!composer) throw new Error('ChatGPT composer is not ready for the reference image.');
  const beforeSources=await allImageSources(page);
  const filename=uniqueFilename(referencePath);
  const before=await attachmentState(page,beforeSources,filename);
  if (before.attachmentNode) throw new Error('An old attachment is still in the composer. Remove it before retrying.');
  try { await injectFast(page,referencePath,filename); }
  catch { await pasteReference(composer,referencePath,filename); }
  pendingUploads.set(page,{referencePath,beforeSources,filename,injectedAt:Date.now()});
  // Preserve #558: paste text immediately after local file injection.
  return true;
};

async function composerText(composer) {
  return composer.evaluate((el) => {
    if ('value' in el) return String(el.value || '');
    return String(el.innerText || el.textContent || '');
  }).catch(() => '');
}

ChatGPTController.prototype.fillPrompt = async function fillPromptLive(page, prompt) {
  await this.assertNoHumanGate(page);
  const composer = await composerVisible(this, page, 10000);
  if (!composer) throw new Error('ChatGPT composer disappeared before the generation prompt could be pasted.');

  // Avoid locator.fill() here: on the current ChatGPT contenteditable it can sit on
  // actionability checks for ~30 seconds. keyboard.insertText sends one immediate
  // input operation and preserves newlines without per-character typing delays.
  try {
    await composer.click({ timeout: 1200 });
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.insertText(prompt);
  } catch {}

  let value = await composerText(composer);
  if (!value.includes(prompt.split('\n')[0]) || value.length < Math.min(prompt.length * 0.75, 120)) {
    await composer.evaluate((el, text) => {
      el.focus();
      if ('value' in el) {
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(el, text); else el.value = text;
      } else {
        el.innerHTML = '';
        const lines = String(text).split('\n');
        for (const line of lines) {
          const p = document.createElement('p');
          p.textContent = line || '\u00a0';
          el.appendChild(p);
        }
      }
      try {
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      } catch {
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, prompt);
    await wait(80);
    value = await composerText(composer);
  }

  if (!value.includes(prompt.split('\n')[0]) || value.length < Math.min(prompt.length * 0.75, 120)) {
    throw new Error('ChatGPT accepted the image, but ZeroPOD could not verify that the generation prompt was pasted. Nothing was sent.');
  }
  return composer;
};

async function waitForUploadReady(page, pending, timeoutMs=45000) {
  const end=Date.now()+timeoutMs;
  let saw=false, stable=0;
  while(Date.now()<end) {
    const state=await attachmentState(page,pending.beforeSources,pending.filename);
    if(state.failed) throw new Error('ChatGPT reported that the reference upload failed.');
    const present=state.newImage||state.attachmentNode;
    saw ||= present;
    if(present && !state.busy && state.sendEnabled) {
      if(!stable) stable=Date.now();
      if(Date.now()-stable>=600) return {ready:true,saw:true};
    } else stable=0;
    await wait(200);
  }
  return {ready:false,saw};
}

async function responseSnapshot(page) {
  return page.evaluate(()=>{
    const selector='[data-message-author-role="assistant"],[data-turn="assistant"]';
    const nodes=[...document.querySelectorAll(selector)].filter(el=>!el.parentElement?.closest(selector));
    const key=el=>el.getAttribute('data-message-id')||el.querySelector('[data-message-id]')?.getAttribute('data-message-id')||el.closest('[data-testid^="conversation-turn-"]')?.getAttribute('data-testid')||'';
    const visible=el=>!!el.getClientRects().length && getComputedStyle(el).visibility!=='hidden';
    return {count:nodes.length,ids:nodes.map(key).filter(Boolean),lastId:nodes.length?key(nodes.at(-1)):'',
      busy:[...document.querySelectorAll('button[data-testid="stop-button"],button[aria-label*="stop generating" i],button[aria-label="Stop response" i],button[aria-label*="cancel generation" i]')].some(visible)};
  });
}

ChatGPTController.prototype.sendPrompt = async function sendPromptLive(page, composer) {
  let pending=pendingUploads.get(page);
  postSendBaselines.delete(page);
  try {
    if(pending) {
      let status=await waitForUploadReady(page,pending,45000);
      if(!status.ready && !status.saw) {
        // First file-input path accepted bytes but never showed a preview.
        // Refresh the same thread, attach via paste, then restore the prompt.
        const prompt=await composerText(composer);
        await page.reload({waitUntil:'domcontentloaded',timeout:30000});
        await this.ensureReady(page);
        composer=await composerVisible(this,page,10000);
        if(!composer) throw new Error('Composer unavailable after attachment recovery.');
        const filename=uniqueFilename(pending.referencePath);
        const beforeSources=await allImageSources(page);
        const old=await attachmentState(page,beforeSources,filename);
        if(old.attachmentNode) throw new Error('Old attachment survived reload; remove it before retrying.');
        try { await injectFast(page,pending.referencePath,filename,true); }
        catch { await pasteReference(composer,pending.referencePath,filename); }
        composer=await this.fillPrompt(page,prompt);
        pending={...pending,beforeSources,filename};
        status=await waitForUploadReady(page,pending,90000);
      }
      if(!status.ready) throw new Error(status.saw?'Reference preview appeared but the upload did not become send-ready. Prompt was not sent.':'Reference preview did not appear after file upload and paste recovery. Prompt was not sent.');
    }
    const snapshot=await responseSnapshot(page);
    if(snapshot.busy) throw new Error('Previous ChatGPT response is still generating. Prompt was not sent.');
    const sources=new Set(await allImageSources(page));
    postSendBaselines.set(page,{...snapshot,sources});
    // Restore the exact #558 submission path. No brittle user-turn/text gate.
    return await previousSendPrompt.call(this,page,composer);
  } catch(error) {
    postSendBaselines.delete(page);
    throw error;
  } finally { pendingUploads.delete(page); }
};

ChatGPTController.prototype.snapshotAssistantState = async function snapshotAssistantStateLive(page) {
  const baseline = await previousSnapshot.call(this, page);
  return { ...baseline, allImageSources: new Set(await allImageSources(page)) };
};

// Only a new assistant turn with completed image controls can authorize
// capture. No network-only images, user attachments or in-progress previews.
async function generatedDomCandidates(page, submission) {
  return page.evaluate(({count,ids,lastId,sources})=>{
    const visible=el=>!!el.getClientRects().length && getComputedStyle(el).visibility!=='hidden';
    const label=el=>[el.getAttribute('aria-label'),el.getAttribute('title'),el.getAttribute('data-testid'),el.innerText].filter(Boolean).join(' ');
    const selector='[data-message-author-role="assistant"],[data-turn="assistant"]';
    const nodes=[...document.querySelectorAll(selector)].filter(el=>!el.parentElement?.closest(selector));
    const key=el=>el.getAttribute('data-message-id')||el.querySelector('[data-message-id]')?.getAttribute('data-message-id')||el.closest('[data-testid^="conversation-turn-"]')?.getAttribute('data-testid')||'';
    if(!nodes.length) return [];
    const assistant=nodes.at(-1), id=key(assistant), known=new Set(ids);
    if(id && known.has(id)) return [];
    const prior=lastId?nodes.findIndex(el=>key(el)===lastId):-1;
    if(!(nodes.length>count || (prior>=0 && prior<nodes.length-1))) return [];
    if([...document.querySelectorAll('button[data-testid="stop-button"],button[aria-label*="stop generating" i],button[aria-label="Stop response" i],button[aria-label*="cancel generation" i]')].some(visible)) return [];
    const turn=assistant.closest('[data-testid^="conversation-turn-"],article,[data-turn="assistant"]')||assistant;
    if(turn.getAttribute('aria-busy')==='true'||[...turn.querySelectorAll('[aria-busy="true"],[role="progressbar"],[data-state="loading"],[data-testid*="image-loading" i]')].some(visible)) return [];
    const excluded=new Set(sources);
    for(const img of document.images) if(!assistant.contains(img)) excluded.add(img.currentSrc||img.src);
    const buttons=[...turn.querySelectorAll('button,[role="button"],a[download]')].filter(visible);
    const completeTurn=buttons.some(el=>/good response|bad response|copy response|copy-turn|thumbs-up|thumbs-down|share response/i.test(label(el)));
    const imageAction=el=>/download image|download-image|image-download|edit image|edit-image|save image/i.test(label(el))||el.hasAttribute('download');
    const candidates=[];
    for(const img of assistant.querySelectorAll('img')) {
      const src=img.currentSrc||img.src||'', alt=img.alt||'';
      if(!src||excluded.has(src)||!img.complete||!visible(img)||img.naturalWidth<512||img.naturalHeight<512) continue;
      if(/placeholder|preview|loading|generating|blurry|progressive/i.test(alt)||img.closest('[aria-busy="true"],[data-state="loading"],[data-testid*="placeholder" i]')) continue;
      let imageControls=false;
      for(let node=img.parentElement;node && node!==turn.parentElement;node=node.parentElement) {
        if([...node.querySelectorAll('button,[role="button"],a[download]')].some(el=>visible(el)&&(imageAction(el)||(node!==turn&&node.querySelectorAll('img').length===1&&/^download$/i.test((el.getAttribute('aria-label')||el.getAttribute('title')||'').trim()))))) {imageControls=true;break;}
        if(node===turn)break;
      }
      // Image-specific final controls OR finished response toolbar with an
      // explicitly generated image; generic "Edit" and "Download" do not qualify.
      if(!imageControls && !(completeTurn && /image created|generated image|image generated/i.test(alt))) continue;
      candidates.push({src,id:id||'assistant-'+nodes.length,width:img.naturalWidth,height:img.naturalHeight});
    }
    return candidates.sort((a,b)=>b.width*b.height-a.width*a.height);
  },{count:submission.count,ids:submission.ids,lastId:submission.lastId,sources:[...submission.sources]});
}

async function fingerprint(input) {
  const bytes=await sharp(input,{failOn:'error'}).rotate().resize(32,32,{fit:'fill'}).flatten({background:'#767676'}).removeAlpha().raw().toBuffer();
  return bytes.toString('base64');
}
function fingerprintDistance(a,b) {
  const x=Buffer.from(a,'base64'),y=Buffer.from(b,'base64');
  if(!x.length||x.length!==y.length)return Infinity;
  let total=0,active=0;
  for(let i=0;i<x.length;i+=3) {
    const ink=[x[i],x[i+1],x[i+2],y[i],y[i+1],y[i+2]].some(v=>Math.abs(v-118)>12);
    if(!ink) continue;
    total+=Math.abs(x[i]-y[i])+Math.abs(x[i+1]-y[i+1])+Math.abs(x[i+2]-y[i+2]);active+=3;
  }
  return active?total/active:0;
}
async function historicalFingerprints(controller, projectId) {
  const history=(controller.projects.list?.({includeArchived:true})||[]).slice(0,100);
  const fingerprints=[];
  for(const project of history) {
    if(project.id===projectId)continue;
    for(const file of [project.referencePath,project.generatedImagePath]) {
      if(file&&fs.existsSync(file)) {
        try {fingerprints.push(await fingerprint(file));}catch{}
      }
    }
  }
  return fingerprints;
}

ChatGPTController.prototype.captureGeneratedImage = async function captureGeneratedImageLive(page, projectId, baseline, step) {
  const submission=postSendBaselines.get(page);
  const projectDir=this.projects.getProjectDir(projectId);
  const deadline=Date.now()+330000;
  const stable=new Map();
  let lastError=null;
  try {
    if(!submission)throw new Error('Missing pre-send image baseline.');
    const previous=await historicalFingerprints(this,projectId);
    step('Waiting for finished ChatGPT artwork');
    while(Date.now()<deadline) {
      await this.assertNoHumanGate(page);
      const candidates=await generatedDomCandidates(page,submission);
      const active=new Set(candidates.map(c=>c.id+'|'+c.src));
      for(const k of stable.keys())if(!active.has(k))stable.delete(k);
      for(const candidate of candidates) {
        const key=candidate.id+'|'+candidate.src;
        const now=Date.now();
        if(!stable.has(key))stable.set(key,now);
        if(now-stable.get(key)<5000)continue;
        let saved;
        try {
          saved=await this.saveGeneratedAsset(page,candidate.src,projectDir);
          if(saved.metadata.width<512||saved.metadata.height<512)throw new Error('Final artwork is too small.');
          const first=await fingerprint(saved.savePath);
          if(previous.some(f=>fingerprintDistance(f,first)<=2.5))throw new Error('Rejected duplicate or previous reference artwork.');
          // Re-fetch pixels after a delay. A progressive placeholder can keep
          // the same URL while its bytes change; only stable final pixels pass.
          await wait(1800);
          const still=await generatedDomCandidates(page,submission);
          if(!still.some(c=>c.id===candidate.id&&c.src===candidate.src))throw new Error('Artwork changed during verification.');
          const asset=await this.fetchImageBytes(page,candidate.src);
          const second=await fingerprint(asset.body);
          if(fingerprintDistance(first,second)>0.25)throw new Error('Artwork pixels still changing.');
          this.projects.update(projectId,{status:'awaiting-review',generatedImagePath:saved.savePath,
            generatedImage:{mime:saved.mime,width:saved.metadata.width,height:saved.metadata.height,hasAlpha:!!saved.metadata.hasAlpha,source:'verified-final-assistant-image',assistantMessageId:candidate.id},
            automationStep:'Ready for review',chatgptError:null});
          dirtyPages.delete(page);
          step('Ready for review');
          return {ok:true,path:saved.savePath,method:'verified-final-assistant-image'};
        } catch(error) {
          lastError=error;
          if(saved?.savePath)fs.rmSync(saved.savePath,{force:true});
          stable.set(key,Date.now());
        }
      }
      await wait(400);
    }
    throw new Error('No finished, distinct ChatGPT artwork was verified.'+(lastError?' '+lastError.message:''));
  } catch(error) {
    this.projects.update(projectId,{status:'chatgpt-recovery-needed',generatedImagePath:null,generatedImage:null,automationStep:'Image capture failed',chatgptError:{service:'chatgpt',step:'capture-generated-image',message:error.message}});
    throw error;
  } finally {
    postSendBaselines.delete(page);
    if(baseline?.networkObserver){baseline.networkObserver.generationStartedAt=0;baseline.networkObserver.assets=[];}
  }
};

module.exports={generatedDomCandidates,fingerprintDistance,attachmentState};
