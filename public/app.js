/* 拉片知识库 — Render + Supabase + DeepSeek 全栈版（前端）
   数据 CRUD 走 /api（服务端 → Supabase；未配 Supabase 时服务端用内存存储）。
   AI 功能（识图预填 / 顺序预填 / 剧本转分镜）走 /api/ai/*（服务端调用 DeepSeek，
   密钥只在服务端，绝不发给浏览器）。AI 未配置时明确提示，绝不编造结果。
   localStorage 只用作视频导入草稿的离线缓存。 */
'use strict';
const DRAFT_LS = 'lapian-fullstack-draft-v1';
const FIELDS = ['shotSize','camera','composition','movement','lighting','content','action','emotion','dialogue','music','sfx','transition','montage','why'];
const FIELD_LABEL = {shotSize:'景别',camera:'机位',composition:'构图',movement:'运镜',lighting:'光线',content:'画面内容',action:'人物动作',emotion:'情绪',dialogue:'对白',music:'背景音乐',sfx:'音效',transition:'转场方式',montage:'蒙太奇运用',why:'为什么这样用'};
const AI_NOT_CONFIGURED_MSG = 'AI 未配置，请在 Render 环境变量里设置 AI_API_KEY / AI_BASE_URL / AI_MODEL';
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtTime = s => { s = Math.max(0, Math.round(s||0)); const m = Math.floor(s/60), ss = String(s%60).padStart(2,'0'); return String(m).padStart(2,'0') + ':' + ss; };
const parseTime = t => { const p = String(t||'0').split(':').map(Number); return p.length===2 ? p[0]*60+p[1] : (p[0]||0); };

async function api(path, opts) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...(opts || {}) });
  let data = null;
  try { data = await res.json(); } catch (_) { /* 非 JSON */ }
  if (!res.ok) throw new Error((data && data.error) || ('请求失败 HTTP ' + res.status));
  return data;
}
async function aiApi(path, body) {
  try { return await api(path, { method: 'POST', body: JSON.stringify(body) }); }
  catch (err) { throw new Error(String(err.message || err)); }
}

let db = { shots: [], knowledge: [], history: [], draft: null };
function loadDraftFromCache() {
  try { const raw = localStorage.getItem(DRAFT_LS); if (raw) { const d = JSON.parse(raw); if (d && Array.isArray(d.shots)) return d; } } catch (e) {}
  return null;
}
function saveDraft() {
  if (db.draft) {
    db.draft.savedAt = new Date().toLocaleTimeString();
    try { localStorage.setItem(DRAFT_LS, JSON.stringify(db.draft)); } catch (e) {}
    const el = document.getElementById('importProgressText');
    if (el) el.textContent = (db.draft.phase || '草稿') + ' · 已自动保存：' + db.draft.savedAt;
  }
}
async function refreshData() {
  const [shots, knowledge, history] = await Promise.all([
    api('/api/shots'), api('/api/knowledge'), api('/api/storyboards'),
  ]);
  db.shots = shots; db.knowledge = knowledge; db.history = history;
}
async function refreshHealth() {
  try {
    const h = await api('/api/health');
    const el = document.getElementById('aiStatus');
    if (el) el.textContent = (h.aiConfigured ? 'AI 已配置（DeepSeek，服务端调用）' : 'AI 未配置：' + AI_NOT_CONFIGURED_MSG) +
      ' · 数据：' + (h.supabaseConfigured ? 'Supabase 已连接' : 'Supabase 未配置，当前为内存存储（重启会丢）');
  } catch (e) { /* 健康检查失败不阻塞页面 */ }
}

/* ---- tabs ---- */
document.querySelectorAll('nav button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('nav button').forEach(x=>x.classList.remove('active')); b.classList.add('active');
  document.querySelectorAll('section.page').forEach(s=>s.classList.remove('active'));
  document.getElementById('page-'+b.dataset.page).classList.add('active');
}));

/* ---- shots ---- */
function shotCard(s, i){
  const ai = s.aiFilled ? ' <span class="badge ai">AI预填</span>' : '';
  const sample = s.sample ? ' <span class="badge">示例</span>' : '';
  const rows = FIELDS.map(f=>`<tr><td style="width:90px">${FIELD_LABEL[f]}</td><td>${esc(s[f]||'待填写')}</td></tr>`).join('');
  return `<article class="shot" data-id="${s.id}">
    <div class="shot-head">
      ${s.thumb ? `<img class="thumb" src="${s.thumb}" alt="关键帧" data-num="${i+1}" data-start="${esc(s.start||'')}" data-duration="${esc(s.duration??'')}" tabindex="0">` : '<div class="thumb" style="display:flex;align-items:center;justify-content:center;color:#999">无关键帧</div>'}
      <div style="flex:1"><strong>#${i+1} ${esc(s.title)}</strong>${sample}${ai}<br>
      <span class="kbd">开始 ${esc(s.start||'')} · 时长 ${esc(s.duration??'')} 秒 · 情绪 ${esc(s.emotion||'')}</span><br>
      <span class="kbd">${esc(s.dialogue||'')}</span></div>
      <div class="row"><button data-edit-shot="${s.id}">编辑</button><button data-del-shot="${s.id}">删除</button><button data-extract="${s.id}">提炼到知识库</button></div>
    </div>
    <table style="margin-top:10px">${rows}</table>
  </article>`;
}
function renderShots(){
  const q = (document.getElementById('shotSearch').value||'').toLowerCase();
  const em = document.getElementById('shotFilterEmotion').value;
  const list = db.shots.filter(s => (!em || s.emotion===em) && (!q || [s.title,s.content,s.dialogue,s.shotSize,s.emotion].join(' ').toLowerCase().includes(q)));
  document.getElementById('shotCount').textContent = `共 ${db.shots.length} 条`;
  document.getElementById('shotList').innerHTML = list.length ? list.map(shotCard).join('') : '<p class="muted">没有符合条件的镜头。</p>';
}
document.getElementById('shotSearch').addEventListener('input', renderShots);
document.getElementById('shotFilterEmotion').addEventListener('change', renderShots);
document.getElementById('clearSamples').addEventListener('click', async () => {
  if(!confirm('只删除标记为“示例”的拉片和知识条目，你自己的数据不会被删。确定吗？')) return;
  await api('/api/clear-samples', { method: 'POST', body: '{}' });
  await refreshData(); renderShots(); renderKnowledge();
});
document.getElementById('shotForm').addEventListener('submit', async e => {
  e.preventDefault();
  const id = document.getElementById('shotId').value;
  const rec = {title: v('f-title'), start: v('f-start'), duration: Number(v('f-duration'))||0, emotion: v('f-emotion'),
    shotSize: v('f-shotSize'), camera: v('f-camera'), composition: v('f-composition'), movement: v('f-movement'), lighting: v('f-lighting'),
    content: v('f-content'), action: v('f-action'), dialogue: v('f-dialogue'), music: v('f-music'), sfx: v('f-sfx'),
    transition: v('f-transition'), montage: v('f-montage'), why: v('f-why'), sample:false};
  const file = document.getElementById('f-thumb').files[0];
  const submit = async () => {
    if (id) await api('/api/shots/' + id, { method: 'PUT', body: JSON.stringify(rec) });
    else await api('/api/shots', { method: 'POST', body: JSON.stringify(rec) });
    await refreshData(); e.target.reset(); document.getElementById('shotId').value=''; renderShots();
  };
  if (file) { const r = new FileReader(); r.onload = () => { rec.thumb = r.result; submit().catch(err => alert(err.message)); }; r.readAsDataURL(file); }
  else submit().catch(err => alert(err.message));
});
function v(id){ return document.getElementById(id).value.trim(); }
document.getElementById('shotReset').addEventListener('click', () => { document.getElementById('shotForm').reset(); document.getElementById('shotId').value=''; });
document.getElementById('shotList').addEventListener('click', async e => {
  const del = e.target.closest('[data-del-shot]'); const ed = e.target.closest('[data-edit-shot]'); const ex = e.target.closest('[data-extract]');
  if(del){ if(confirm('删除这条拉片？')){ await api('/api/shots/' + del.dataset.delShot, { method: 'DELETE' }); await refreshData(); renderShots(); } }
  if(ed){ const s=db.shots.find(x=>x.id===ed.dataset.editShot); if(!s) return; document.getElementById('shotId').value=s.id;
    const map={title:'f-title',start:'f-start',duration:'f-duration',emotion:'f-emotion',shotSize:'f-shotSize',camera:'f-camera',composition:'f-composition',movement:'f-movement',lighting:'f-lighting',content:'f-content',action:'f-action',dialogue:'f-dialogue',music:'f-music',sfx:'f-sfx',transition:'f-transition',montage:'f-montage',why:'f-why'};
    Object.entries(map).forEach(([k,el])=>document.getElementById(el).value=s[k]??''); window.scrollTo({top:0,behavior:'smooth'}); }
  if(ex){ const s=db.shots.find(x=>x.id===ex.dataset.extract); if(!s) return;
    await api('/api/knowledge', { method: 'POST', body: JSON.stringify({title:`${s.emotion||'某情绪'}时：${s.shotSize||''}${s.movement? ' + '+s.movement:''}（来自 ${s.title}）`,emotion:s.emotion||'紧张',scene:'',rhythm:'渐紧',tags:[s.shotSize,s.movement].filter(Boolean),desc:s.why||`${s.composition||''}；${s.lighting||''}`,sample:false}) });
    await refreshData(); renderKnowledge(); alert('已提炼到知识库，可在知识库页修改。'); }
});

/* ---- knowledge ---- */
function renderKnowledge(){
  const q = (document.getElementById('knowSearch').value||'').toLowerCase();
  const em = document.getElementById('knowFilterEmotion').value;
  const list = db.knowledge.filter(k => (!em || k.emotion===em) && (!q || [k.title,k.desc,(k.tags||[]).join(' ')].join(' ').toLowerCase().includes(q)));
  document.getElementById('knowCount').textContent = `共 ${db.knowledge.length} 条`;
  document.getElementById('knowList').innerHTML = list.length ? list.map(k=>`<article class="shot">
    <strong>${esc(k.title)}</strong>${k.sample?' <span class="badge">示例</span>':''}<br>
    <span class="kbd">情绪 ${esc(k.emotion)} · 场景 ${esc(k.scene||'—')} · 节奏 ${esc(k.rhythm)}</span><br>
    ${(k.tags||[]).map(t=>`<span class="tag">${esc(t)}</span>`).join('')}
    <p>${esc(k.desc||'')}</p>
    <div class="row"><button data-edit-know="${k.id}">编辑</button><button data-del-know="${k.id}">删除</button></div>
  </article>`).join('') : '<p class="muted">没有符合条件的规律。</p>';
}
document.getElementById('knowSearch').addEventListener('input', renderKnowledge);
document.getElementById('knowFilterEmotion').addEventListener('change', renderKnowledge);
document.getElementById('knowForm').addEventListener('submit', async e => {
  e.preventDefault(); const id=document.getElementById('k-id').value;
  const rec={title:v('k-title'),emotion:v('k-emotion'),scene:v('k-scene'),rhythm:v('k-rhythm'),tags:v('k-tags').split(/[,，]/).map(s=>s.trim()).filter(Boolean),desc:v('k-desc'),sample:false};
  if(id) await api('/api/knowledge/' + id, { method: 'PUT', body: JSON.stringify(rec) });
  else await api('/api/knowledge', { method: 'POST', body: JSON.stringify(rec) });
  await refreshData(); e.target.reset(); document.getElementById('k-id').value=''; renderKnowledge();
});
document.getElementById('knowReset').addEventListener('click', () => { document.getElementById('knowForm').reset(); document.getElementById('k-id').value=''; });
document.getElementById('knowList').addEventListener('click', async e => {
  const del=e.target.closest('[data-del-know]'); const ed=e.target.closest('[data-edit-know]');
  if(del){ if(confirm('删除这条规律？')){ await api('/api/knowledge/' + del.dataset.delKnow, { method: 'DELETE' }); await refreshData(); renderKnowledge(); } }
  if(ed){ const k=db.knowledge.find(x=>x.id===ed.dataset.editKnow); if(!k) return; document.getElementById('k-id').value=k.id;
    document.getElementById('k-title').value=k.title; document.getElementById('k-emotion').value=k.emotion; document.getElementById('k-scene').value=k.scene||'';
    document.getElementById('k-rhythm').value=k.rhythm; document.getElementById('k-tags').value=(k.tags||[]).join(', '); document.getElementById('k-desc').value=k.desc||''; window.scrollTo({top:0,behavior:'smooth'}); }
});

/* ---- storyboard（服务端 AI，按知识库生成） ---- */
let lastStoryboard = '';
document.getElementById('sbGenerate').addEventListener('click', async () => {
  const script = document.getElementById('sb-script').value.trim();
  if(!script){ alert('请先粘贴一段剧本。'); return; }
  const emotion = document.getElementById('sb-emotion').value, scene = document.getElementById('sb-scene').value.trim(), rhythm = document.getElementById('sb-rhythm').value;
  const btn = document.getElementById('sbGenerate'); btn.disabled = true; btn.textContent = '生成中…';
  try {
    const out = await aiApi('/api/ai/storyboard', { script, emotion, sceneType: scene, rhythm, knowledge: db.knowledge });
    const rows = out.shots || [];
    lastStoryboard = rows.map(r=>`镜头 ${r.n}（${r.shotSize}）\n剧本：${r.line}\n依据：${r.rule}\n中文提示词：${r.promptZh}\n英文提示词：${r.promptEn}\n`).join('\n');
    document.getElementById('sbResult').innerHTML = `<div class="card"><h3>分镜表</h3>
      <table><tr><th>镜头</th><th>剧本</th><th>景别</th><th>依据</th><th>中文提示词</th><th>英文提示词</th></tr>
      ${rows.map(r=>`<tr><td>${r.n}</td><td>${esc(r.line)}</td><td>${esc(r.shotSize)}</td><td>${esc(r.rule)}</td><td>${esc(r.promptZh)}</td><td>${esc(r.promptEn)}</td></tr>`).join('')}</table></div>`;
    await api('/api/storyboards', { method: 'POST', body: JSON.stringify({ script, emotion, scene, rhythm, lines: script.split('\n').filter(Boolean).length, shots: rows }) });
    await refreshData(); renderHistory();
  } catch (err) {
    alert(String(err.message || err));
  } finally { btn.disabled = false; btn.textContent = '生成分镜'; }
});
function renderHistory(){
  document.getElementById('sbHistory').innerHTML = db.history.length
    ? db.history.slice(0,10).map(h=>`<p>· ${esc(h.created_at || h.at || '')} · ${esc(h.emotion)} / ${esc(h.scene||'—')} · ${h.lines} 行剧本</p>`).join('')
    : '<p class="muted">暂无历史。</p>';
}
document.getElementById('sbCopy').addEventListener('click', async () => { if(!lastStoryboard) return alert('请先生成分镜。'); await navigator.clipboard.writeText(lastStoryboard).catch(()=>{}); alert('已复制。'); });
document.getElementById('sbExport').addEventListener('click', () => { if(!lastStoryboard) return alert('请先生成分镜。'); const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([lastStoryboard],{type:'text/plain;charset=utf-8'})); a.download='分镜表.txt'; a.click(); });

/* ---- video import: scene detection（浏览器本地） ---- */
let videoURL = null, videoDuration = 0, detectCancelled = false, currentVideoFile = null;
const player = document.getElementById('videoPlayer');
document.getElementById('sensitivity').addEventListener('input', e => document.getElementById('sensVal').textContent = e.target.value);
function setProgress(p, text){ document.getElementById('importProgress').value=p; document.getElementById('importProgressText').textContent = text + (db.draft && db.draft.savedAt ? ' · 已自动保存：'+db.draft.savedAt : ''); }
function ensureDraft(title){ if(!db.draft) db.draft = {title: title||'', phase:'准备导入', shots:[], savedAt:''}; return db.draft; }
function loadVideoFile(file){
  currentVideoFile = file; videoURL = URL.createObjectURL(file);
  player.src = videoURL; player.style.display='block';
  player.onloadedmetadata = () => { videoDuration = player.duration;
    document.getElementById('longWarn').style.display = videoDuration > 600 ? 'block' : 'none';
    document.getElementById('startDetect').disabled = false;
    ensureDraft(document.getElementById('importTitle').value || file.name); saveDraft(); renderDraft(); };
}
document.getElementById('videoFile').addEventListener('change', e => { if(e.target.files[0]) loadVideoFile(e.target.files[0]); });
document.getElementById('loadUrl').addEventListener('click', async () => {
  const url = document.getElementById('videoUrl').value.trim(); if(!url) return alert('请先粘贴视频链接。');
  try{ const res = await fetch(url); if(!res.ok) throw new Error('HTTP '+res.status); const blob = await res.blob();
    if(!blob.type.startsWith('video')) return alert('链接不是可直接下载的视频文件，请改用上传本地文件。');
    loadVideoFile(new File([blob], 'video.mp4', {type: blob.type})); }
  catch(err){ alert('链接打不开或不是直链视频文件（'+err.message+'），请改用上传本地文件。'); }
});
document.getElementById('startDetect').addEventListener('click', async () => { await detectShots(0); });
document.getElementById('cancelImport').addEventListener('click', () => { detectCancelled = true; });
document.getElementById('resumeImport').addEventListener('click', async () => {
  document.getElementById('resumeImport').style.display='none';
  if(!currentVideoFile){ alert('视频文件未保存在浏览器中，请重新选择同一个视频文件，系统会从断点继续。'); return; }
  const d = ensureDraft(); const from = d.shots.length ? parseTime(d.shots[d.shots.length-1].start) + (d.shots[d.shots.length-1].duration||0) : 0;
  await detectShots(from);
});
document.getElementById('discardDraft').addEventListener('click', () => { if(confirm('放弃这次导入草稿？')){ db.draft=null; try{localStorage.removeItem(DRAFT_LS);}catch(e){} renderDraft(); document.getElementById('resumeImport').style.display='none'; document.getElementById('discardDraft').style.display='none'; document.getElementById('importStatus').style.display='none'; } });

async function detectShots(fromSec){
  detectCancelled = false; document.getElementById('cancelImport').disabled=false;
  const draft = ensureDraft(document.getElementById('importTitle').value || '未命名');
  draft.phase='切分检测中'; const threshold = Number(document.getElementById('sensitivity').value);
  const canvas = document.createElement('canvas'); canvas.width=160; canvas.height=90; const ctx = canvas.getContext('2d');
  const step = 0.5; let prev = null, cutTimes = [fromSec];
  const total = videoDuration || player.duration || 0;
  for(let t = fromSec; t < total; t += step){
    if(detectCancelled){ draft.phase='已中断（可恢复）'; saveDraft(); showResume(); return; }
    await seekTo(t); ctx.drawImage(player, 0, 0, 160, 90);
    const data = ctx.getImageData(0,0,160,90).data; let diff=0;
    if(prev){ for(let i=0;i<data.length;i+=40){ diff += Math.abs(data[i]-prev[i]); } diff = diff / (data.length/40); }
    if(prev && diff > threshold && t - cutTimes[cutTimes.length-1] >= 0.6) cutTimes.push(t);
    prev = new Uint8ClampedArray(data);
    if(Math.round(t*2)%4===0) setProgress(Math.round(t/total*70), `切分检测中 ${fmtTime(t)} / ${fmtTime(total)}`);
    await new Promise(r=>setTimeout(r,0));
  }
  draft.phase='截取关键帧中';
  for(let i=0;i<cutTimes.length;i++){
    if(detectCancelled){ draft.phase='已中断（可恢复）'; saveDraft(); showResume(); return; }
    const start = cutTimes[i], end = (cutTimes[i+1] ?? total);
    await seekTo(Math.min(start+0.05, Math.max(start, end-0.05)));
    ctx.drawImage(player, 0, 0, 320, 180);
    const thumb = canvas.toDataURL('image/jpeg', 0.7);
    draft.shots.push({id:uid(), title: draft.title || '未命名', start: fmtTime(start), duration: Math.round((end-start)*10)/10, thumb,
      shotSize:'',camera:'',composition:'',movement:'',lighting:'',content:'',action:'',emotion:'',dialogue:'',music:'',sfx:'',transition:'',montage:'',why:'', sample:false});
    setProgress(70 + Math.round((i+1)/cutTimes.length*30), `截取关键帧 ${i+1}/${cutTimes.length}`);
    saveDraft(); renderDraft();
  }
  draft.phase='切分完成'; saveDraft(); renderDraft(); setProgress(100, '切分完成 · 已自动保存：'+draft.savedAt);
  document.getElementById('cancelImport').disabled=true;
}
function showResume(){ document.getElementById('resumeImport').style.display='inline-block'; document.getElementById('discardDraft').style.display='inline-block';
  const st=document.getElementById('importStatus'); st.style.display='block'; st.textContent='导入在“'+(db.draft&&db.draft.phase)+'”中断，已自动保存草稿，点“继续导入 / 恢复”可从断点接着跑。'; }
function seekTo(t){ return new Promise(res => { player.onseeked = () => res(); player.currentTime = Math.min(t, (player.duration||t)-0.01); setTimeout(res, 800); }); }

/* ---- drafts ---- */
function draftField(d, f){ return `<label>${FIELD_LABEL[f]}</label><input data-draft="${d.id}" data-field="${f}" value="${esc(d[f]||'')}" placeholder="待填写">`; }
function renderDraft(){
  const d = db.draft;
  document.getElementById('draftCount').textContent = d ? `共 ${d.shots.length} 个镜头 · ${d.phase||''}` : '暂无草稿';
  document.getElementById('importTitle').value = d ? d.title : '';
  if(d && d.phase && d.phase.includes('中断')) showResume();
  if(!d || !d.shots.length){ document.getElementById('draftList').innerHTML = '<p class="muted">还没有切分好的镜头草稿。</p>'; return; }
  document.getElementById('draftList').innerHTML = d.shots.map((s,i)=>`<article class="shot" data-draft-row="${s.id}">
    <div class="shot-head">
      ${s.thumb?`<img class="thumb" src="${s.thumb}" alt="关键帧" data-num="${i+1}" data-start="${esc(s.start)}" data-duration="${esc(s.duration)}" tabindex="0">`:''}
      <div style="flex:1"><strong>#${i+1} 开始 ${esc(s.start)}</strong> <span class="kbd">时长 ${esc(s.duration)} 秒</span>
      ${s.aiFilled?' <span class="badge ai">AI预填</span>':''}${s.subtitleSource?` <span class="badge">字幕来源：${esc(s.subtitleSource)}</span>`:''}<br>
      <span class="kbd">点「识图预填」补画面类字段；点「顺序预填」补转场/蒙太奇/为什么。</span></div>
      <div class="row"><input type="checkbox" data-check="${s.id}" ${s.checked!==false?'checked':''} style="width:20px;height:20px"><button data-heuristic="${s.id}">识图预填</button><button data-sequence="${s.id}">顺序预填</button><button data-del-draft="${s.id}">删除此镜</button></div>
    </div>
    <div class="grid">${FIELDS.map(f=>draftField(s,f)).join('')}</div>
  </article>`).join('');
}
document.getElementById('draftList').addEventListener('input', e => {
  const el = e.target.closest('[data-draft]'); if(!el) return;
  const d = db.draft.shots.find(x=>x.id===el.dataset.draft); if(d){ d[el.dataset.field]=el.value; saveDraft(); }
});
document.getElementById('draftList').addEventListener('change', e => {
  const c = e.target.closest('[data-check]'); if(!c) return;
  const d = db.draft.shots.find(x=>x.id===c.dataset.check); if(d){ d.checked=c.checked; saveDraft(); }
});
document.getElementById('draftList').addEventListener('click', e => {
  const del = e.target.closest('[data-del-draft]');
  if(del){ db.draft.shots = db.draft.shots.filter(s=>s.id!==del.dataset.delDraft); saveDraft(); renderDraft(); return; }
  const h = e.target.closest('[data-heuristic]'); if(h){ aiPrefill(h.dataset.heuristic); return; }
  const sq = e.target.closest('[data-sequence]'); if(sq){ sequencePrefill(sq.dataset.sequence); return; }
});
document.getElementById('batchSave').addEventListener('click', async () => {
  if(!db.draft || !db.draft.shots.length) return alert('没有可保存的草稿。');
  const chosen = db.draft.shots.filter(s=>s.checked!==false).map(s=>{ const {checked, aiFilled, subtitleSource, ...rest} = s; return {...rest, sample:false}; });
  await api('/api/shots/batch', { method: 'POST', body: JSON.stringify({ shots: chosen }) });
  db.draft = null; try{localStorage.removeItem(DRAFT_LS);}catch(e){} renderDraft(); await refreshData(); renderShots();
  alert(`已存入拉片库 ${chosen.length} 个镜头，草稿已清除。`);
});

/* ---- 识图预填：服务端 DeepSeek 视觉分析 ---- */
async function aiPrefill(id){
  const d = db.draft && db.draft.shots.find(x=>x.id===id); if(!d || !d.thumb) return alert('该镜头没有关键帧。');
  try {
    const out = await aiApi('/api/ai/analyze-keyframe', { imageDataUrl: d.thumb, shotContext: `${d.title || ''} 开始 ${d.start} 时长 ${d.duration} 秒` });
    ['shotSize','camera','composition','lighting','content','action','emotion'].forEach(f => { if (out[f]) d[f] = out[f]; });
    d.aiFilled = true; saveDraft(); renderDraft();
  } catch (err) { alert(String(err.message || err)); }
}
document.getElementById('batchHeuristic').addEventListener('click', async () => {
  if(!db.draft) return;
  for(const s of db.draft.shots.filter(s=>!s.aiFilled).slice(0,10)){ await aiPrefill(s.id); }
});

/* ---- 顺序预填：服务端 DeepSeek，看前后镜头 + 对白 ---- */
async function sequencePrefill(id){
  const shots = db.draft ? db.draft.shots : []; const i = shots.findIndex(s=>s.id===id); if(i<0) return;
  try {
    const out = await aiApi('/api/ai/analyze-sequence', { shots });
    const r = (out.results || []).find(x => x.index === i + 1);
    if (!r) return alert('顺序预填没有返回该镜头的结果。');
    const s = shots[i];
    if (r.transition) s.transition = r.transition;
    if (r.montage) s.montage = r.montage;
    if (r.why) s.why = r.why;
    s.aiFilled = true; saveDraft(); renderDraft();
  } catch (err) { alert(String(err.message || err)); }
}
document.getElementById('batchSequence').addEventListener('click', async () => {
  if(!db.draft) return;
  try {
    const targets = db.draft.shots.slice(0,10);
    const out = await aiApi('/api/ai/analyze-sequence', { shots: db.draft.shots });
    (out.results || []).forEach(r => {
      const s = db.draft.shots[r.index - 1];
      if (!s || !targets.includes(s)) return;
      if (r.transition) s.transition = r.transition;
      if (r.montage) s.montage = r.montage;
      if (r.why) s.why = r.why;
      s.aiFilled = true;
    });
    saveDraft(); renderDraft();
  } catch (err) { alert(String(err.message || err)); }
});

/* ---- 字幕：SRT 优先；画面 OCR 用 Tesseract.js（需联网，失败则手动） ---- */
function parseSrt(text){
  const blocks = text.replace(/\r/g,'').split('\n\n'); const out=[];
  const toSec = t => { const m=t.match(/(\d+):(\d+):(\d+)[,.](\d+)/); return m? (+m[1])*3600+(+m[2])*60+(+m[3])+(+m[4])/1000 : 0; };
  blocks.forEach(b=>{ const lines=b.trim().split('\n'); if(lines.length<2) return;
    const tm = lines[1] && lines[1].match(/(.+?)\s*-->\s*(.+)/); if(!tm) return;
    out.push({start:toSec(tm[1]), end:toSec(tm[2]), text:lines.slice(2).join(' ').trim()}); });
  return out;
}
document.getElementById('srtFile').addEventListener('change', e => {
  const f = e.target.files[0]; if(!f || !db.draft) return alert('请先导入并切分视频，再传 SRT。');
  const r = new FileReader(); r.onload = () => {
    const subs = parseSrt(String(r.result));
    db.draft.shots.forEach(s=>{ const t=parseTime(s.start); const hit=subs.find(u=>t>=u.start && t<u.end) || subs.find(u=>u.start>=t && u.start < t+(s.duration||0));
      if(hit){ s.dialogue=hit.text; s.subtitleSource='SRT'; } });
    document.getElementById('subtitleStatus').textContent = `SRT 已对齐 ${subs.length} 条字幕`;
    saveDraft(); renderDraft();
  }; r.readAsText(f);
});
document.getElementById('ocrBtn').addEventListener('click', async () => {
  if(!db.draft || !db.draft.shots.length) return alert('请先导入并切分视频。');
  const note = document.getElementById('ocrNote');
  note.textContent = '正在加载 Tesseract.js（需联网）…';
  try{
    if(!window.Tesseract){ await new Promise((res,rej)=>{ const sc=document.createElement('script'); sc.src='https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js'; sc.onload=res; sc.onerror=()=>rej(new Error('CDN 加载失败')); document.head.appendChild(sc); }); }
    let done=0;
    for(const s of db.draft.shots.slice(0,10)){
      const worker = await Tesseract.createWorker('chi_sim+eng');
      const {data} = await worker.recognize(s.thumb);
      await worker.terminate();
      const text = (data.text||'').replace(/\s+/g,' ').trim();
      if(text){ s.dialogue=text; s.subtitleSource='画面OCR（置信度 '+(Math.round((data.confidence||0)))+'，可能有错字，请核对）'; }
      done++; document.getElementById('subtitleStatus').textContent = `画面 OCR 进行中 ${done}/10`;
    }
    document.getElementById('subtitleStatus').textContent = '画面 OCR 完成（请逐条核对错字）';
    saveDraft(); renderDraft();
  }catch(err){ note.textContent = '画面 OCR 无法使用（'+err.message+'）。请改用 SRT 字幕文件，或直接在草稿的“对白”栏手动填写。'; }
});

/* ---- 悬停大图：放在行下方 / 空白处，绝不盖住输入框 ---- */
const preview = document.getElementById('hoverPreview');
let previewPinned = false;
function showPreview(img){
  preview.querySelector('img').src = img.src;
  preview.querySelector('.meta').textContent = `镜头 #${img.dataset.num||''} · 开始 ${img.dataset.start||''} · 时长 ${img.dataset.duration||''} 秒`;
  preview.style.display='block';
  const rect = img.getBoundingClientRect();
  const pw = Math.min(500, window.innerWidth-40), ph = 300;
  let top = rect.bottom + 10, left = Math.max(10, Math.min(rect.left, window.innerWidth - pw - 10));
  if(top + ph > window.innerHeight){ top = Math.max(10, rect.top - ph - 10); }
  const el = document.elementFromPoint(Math.min(left+20, window.innerWidth-20), Math.min(top+20, window.innerHeight-20));
  if(el && /INPUT|TEXTAREA|SELECT/.test(el.tagName)){ top = Math.max(10, window.innerHeight - ph - 10); left = 10; }
  preview.style.top = top+'px'; preview.style.left = left+'px';
}
function hidePreview(){ if(!previewPinned) preview.style.display='none'; }
document.addEventListener('mouseover', e => { const img=e.target.closest && e.target.closest('img.thumb'); if(img && !previewPinned) showPreview(img); });
document.addEventListener('mouseout', e => { const img=e.target.closest && e.target.closest('img.thumb'); if(img) hidePreview(); });
document.addEventListener('click', e => {
  const img = e.target.closest && e.target.closest('img.thumb');
  if(img){ previewPinned = !previewPinned; if(previewPinned) showPreview(img); else hidePreview(); return; }
  if(previewPinned && !e.target.closest('#hoverPreview')){ previewPinned=false; hidePreview(); }
});

/* ---- init ---- */
(async () => {
  db.draft = loadDraftFromCache();
  try { await refreshData(); } catch (err) { alert('加载数据失败：' + err.message + '。请确认服务已启动、Supabase 已配置。'); }
  refreshHealth();
  renderShots(); renderKnowledge(); renderHistory(); renderDraft();
  if(db.draft && db.draft.shots.length){
    const st=document.getElementById('importStatus'); st.style.display='block';
    st.textContent = `检测到上次未完成的导入草稿（${db.draft.shots.length} 个镜头，${db.draft.phase||''}，保存于 ${db.draft.savedAt||''}）。草稿已保留，点“继续导入 / 恢复”可接着跑，或点“放弃这次导入”。`;
    showResume();
  }
})();
