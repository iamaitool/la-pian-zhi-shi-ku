/* 拉片知识库 — Render + Neon + DeepSeek 全栈版（前端）
   数据 CRUD 走 /api（服务端 → Neon Postgres；未配 Neon 时服务端用内存存储）。
   AI 功能（识图预填 / 顺序预填 / 剧本转分镜）走 /api/ai/*（服务端调用 DeepSeek，
   密钥只在服务端，绝不发给浏览器）。AI 未配置时明确提示，绝不编造结果。
   localStorage 只用作视频导入草稿的离线缓存。 */
'use strict';
const DRAFT_LS = 'lapian-fullstack-draft-v1';
const FIELDS = ['shotSize','camera','composition','movement','lighting','content','action','emotion','dialogue','music','sfx','transition','montage','why'];
const FIELD_LABEL = {shotSize:'景别',camera:'机位',composition:'构图',movement:'运镜',lighting:'光线',content:'画面内容',action:'人物动作',emotion:'情绪',dialogue:'对白',music:'背景音乐',sfx:'音效',transition:'转场方式',montage:'蒙太奇运用',why:'为什么这样用'};
const AI_NOT_CONFIGURED_MSG = 'AI 未配置，请在 Render 环境变量里设置 AI_API_KEY / AI_BASE_URL / AI_MODEL';
/* 情绪选项：拉片库 / 视听语言知识库 / 剧本转分镜三处共用同一份清单（12 个），
   改这里即可同步所有下拉框。旧数据里已有的 6 个情绪都在清单里，不会丢。 */
const EMOTIONS = ['紧张','悬疑','温馨','悲伤','喜悦','浪漫','愤怒','恐惧','平静','压抑','震撼','孤独'];
function fillEmotionSelects(){
  const fill = (id, withAll) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = (withAll ? '<option value="">全部情绪</option>' : '') +
      EMOTIONS.map(e => `<option>${e}</option>`).join('');
    if (cur && EMOTIONS.includes(cur)) sel.value = cur;
  };
  fill('shotFilterEmotion', true);
  fill('f-emotion', false);
  fill('knowFilterEmotion', true);
  fill('k-emotion', false);
  fill('sb-emotion', false);
}
fillEmotionSelects();
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
      ' · 数据：' + (h.neonConfigured ? "Neon 已连接" : "Neon 未配置，当前为内存存储（重启会丢）");
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
/* ---- 从一条拉片生成知识库条目（单条提炼与批量存入共用，保证一致） ---- */
function shotToKnowledge(s){
  return {title:`${s.emotion||'某情绪'}时：${s.shotSize||''}${s.movement? ' + '+s.movement:''}（来自 ${s.title}）`,emotion:s.emotion||'紧张',scene:'',rhythm:'渐紧',tags:[s.shotSize,s.movement].filter(Boolean),desc:s.why||`${s.composition||''}；${s.lighting||''}`,sample:false};
}
/* 当前拉片库列表（与 renderShots 同一套搜索 + 情绪筛选） */
function filteredShots(){
  const q = (document.getElementById('shotSearch').value||'').toLowerCase();
  const em = document.getElementById('shotFilterEmotion').value;
  return db.shots.filter(s => (!em || s.emotion===em) && (!q || [s.title,s.content,s.dialogue,s.shotSize,s.emotion].join(' ').toLowerCase().includes(q)));
}
function renderShots(){
  const list = filteredShots();
  document.getElementById('shotCount').textContent = `共 ${db.shots.length} 条`;
  document.getElementById('shotList').innerHTML = list.length ? list.map(shotCard).join('') : '<p class="muted">没有符合条件的镜头。</p>';
}
document.getElementById('shotSearch').addEventListener('input', renderShots);
document.getElementById('shotFilterEmotion').addEventListener('change', renderShots);
/* 一键批量存入知识库：按当前列表逐条存入，标题已存在则跳过 */
document.getElementById('batchExtract').addEventListener('click', async () => {
  const btn = document.getElementById('batchExtract');
  const list = filteredShots();
  if (!list.length) { alert('当前列表没有可存入的拉片。'); return; }
  if (!confirm(`将把当前列表的 ${list.length} 条拉片存入知识库，确定吗？`)) return;
  btn.disabled = true; btn.textContent = '正在存入…';
  try {
    await refreshData(); /* 拿最新的知识库标题，避免重复存入 */
    const existing = new Set(db.knowledge.map(k => k.title));
    let saved = 0, skipped = 0;
    for (const s of list) {
      const rec = shotToKnowledge(s);
      if (existing.has(rec.title)) { skipped++; continue; }
      await api('/api/knowledge', { method: 'POST', body: JSON.stringify(rec) });
      existing.add(rec.title); saved++;
    }
    await refreshData(); renderKnowledge();
    alert(`已存入 ${saved} 条，跳过 ${skipped} 条（已存在）。`);
  } catch (err) {
    alert('批量存入失败：' + String(err.message || err));
  } finally { btn.disabled = false; btn.textContent = '一键批量存入知识库'; }
});
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
    await api('/api/knowledge', { method: 'POST', body: JSON.stringify(shotToKnowledge(s)) });
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
let segmentDurationSec = 600; /* 分段导入默认每段 10 分钟 */
/* ---- 分段导入：长视频按固定时长切成若干段，逐段顺序处理 ----
   computeSegments 是纯函数（便于单测）：返回 [{index, start, end}]，
   start/end 为原片绝对秒数；每段最多 300 个镜头（上限在 detectShots 里执行）。 */
function computeSegments(duration, segSec){
  const segs = [];
  if (!(duration > 0) || !(segSec > 0)) return segs;
  const n = Math.ceil(duration / segSec);
  for (let i = 0; i < n; i++) segs.push({ index: i, start: i * segSec, end: Math.min(duration, (i + 1) * segSec) });
  return segs;
}
function updateSegmentUI(){
  const panel = document.getElementById('segmentPanel');
  const info = document.getElementById('segmentInfo');
  const sel = document.getElementById('segmentDuration');
  if (!panel || !info || !sel) return;
  if (!videoDuration) { panel.style.display = 'none'; return; }
  const segs = computeSegments(videoDuration, segmentDurationSec);
  if (segs.length <= 1) { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  const d = db.draft;
  const done = (d && d.segmented && Array.isArray(d.segments)) ? d.segments.filter(s => s.status === 'done' || s.status === 'saved').length : 0;
  info.textContent = `视频总长 ${fmtTime(videoDuration)}，按每段 ${segmentDurationSec / 60} 分钟可切成 ${segs.length} 段` +
    (done ? `（已完成 ${done}/${segs.length} 段）` : '') + '。一段一段顺序处理，不会同时跑。';
  /* 已有分段进度时不允许改每段时长，避免新旧分段对不上；想换时长请先放弃草稿 */
  sel.disabled = !!(d && d.segmented && Array.isArray(d.segments) && d.segments.some(s => s.status === 'done' || s.status === 'saved' || s.status === 'processing'));
}
const player = document.getElementById('videoPlayer');
/* 切分灵敏度：拖动时实时说明当前值意味着什么（input 事件，拖动中持续更新） */
function sensHintText(v){
  if (v <= 10) return '低灵敏度：只在画面变化很大时才切分，切得少，慢镜头不容易被拆开，但可能把真实的切换并成一个镜头。';
  if (v <= 20) return '中等灵敏度：常规切分，适合大多数剧情片；缓慢推拉、光线渐变一般不会被误切。';
  if (v <= 30) return '较高灵敏度：切得更细，缓慢推拉或光线变化也可能被切成新镜头，适合节奏快的片子。';
  return '高灵敏度：切得最细，轻微的画面变化都会切分，容易把一个镜头拆成多个，之后需要手动合并。';
}
function updateSensHint(){
  const s = document.getElementById('sensitivity');
  document.getElementById('sensVal').textContent = s.value;
  const hint = document.getElementById('sensHint');
  if (hint) hint.textContent = '当前灵敏度 ' + s.value + '：' + sensHintText(Number(s.value));
}
document.getElementById('sensitivity').addEventListener('input', updateSensHint);
updateSensHint();
function setProgress(p, text){ document.getElementById('importProgress').value=p; document.getElementById('importProgressText').textContent = text + (db.draft && db.draft.savedAt ? ' · 已自动保存：'+db.draft.savedAt : ''); }
function ensureDraft(title){ if(!db.draft) db.draft = {title: title||'', phase:'准备导入', shots:[], savedAt:''}; return db.draft; }
function loadVideoFile(file){
  currentVideoFile = file; videoURL = URL.createObjectURL(file);
  player.src = videoURL; player.style.display='block';
  const hint = document.getElementById('previewHint'); if(hint) hint.style.display='none';
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
  const d = ensureDraft();
  if (d.segmented && Array.isArray(d.segments) && d.segments.length) { await runSegmentedImport(); return; }
  const from = d.shots.length ? parseTime(d.shots[d.shots.length-1].start) + (d.shots[d.shots.length-1].duration||0) : 0;
  await detectShots(from);
});
document.getElementById('discardDraft').addEventListener('click', () => { if(confirm('放弃这次导入草稿？')){ db.draft=null; try{localStorage.removeItem(DRAFT_LS);}catch(e){} renderDraft(); document.getElementById('resumeImport').style.display='none'; document.getElementById('discardDraft').style.display='none'; document.getElementById('importStatus').style.display='none'; } });
document.getElementById('segmentDuration').addEventListener('change', e => { segmentDurationSec = Number(e.target.value) || 600; updateSegmentUI(); });
document.getElementById('startSegmented').addEventListener('click', async () => { await runSegmentedImport(); });

/* ---- 分段导入：逐段顺序处理，绝不并行 ----
   每段走同一套 detectShots（只限本段时间范围 [start, end]），镜头的时间码
   是原片绝对时间（fmtTime(start)），不会从 0:00 重算。已完成的分段跳过；
   中途取消或刷新后，已完成的分段保留在草稿里，恢复时从下一段接着跑。 */
async function runSegmentedImport(){
  const draft = ensureDraft(document.getElementById('importTitle').value || '未命名');
  if (!videoDuration) return alert('请先加载视频。');
  if (draft.shots.length && !draft.segmented) return alert('当前草稿已有单次导入的镜头，请先点「一键批量存入拉片库」保存，或点「放弃这次导入」清空草稿，再开始分段导入。');
  const segs = computeSegments(videoDuration, segmentDurationSec);
  if (segs.length <= 1) return alert('视频在一分段时长内，不需要分段导入，点「开始切分镜头」即可。');
  if (!draft.segmented || !Array.isArray(draft.segments) || draft.segments.length !== segs.length || draft.segmentDuration !== segmentDurationSec) {
    /* 只有没有任何一段已完成时才允许重建分段，避免丢进度 */
    if (draft.segmented && Array.isArray(draft.segments) && draft.segments.some(s => s.status === 'done' || s.status === 'saved')) {
      return alert('已有已完成的分段（每段 ' + (draft.segmentDuration / 60) + ' 分钟），改每段时长会丢进度；想换时长请先点「放弃这次导入」清空草稿。');
    }
    draft.segmented = true; draft.segmentDuration = segmentDurationSec;
    draft.segments = segs.map(s => ({ ...s, status: 'pending', shotCount: 0 }));
  }
  detectCancelled = false;
  document.getElementById('cancelImport').disabled = false;
  document.getElementById('startSegmented').disabled = true;
  document.getElementById('startDetect').disabled = true;
  try {
    for (let i = 0; i < draft.segments.length; i++) {
      const seg = draft.segments[i];
      if (seg.status === 'done' || seg.status === 'saved') continue;
      seg.status = 'processing';
      draft.phase = `正在处理第 ${i + 1}/${draft.segments.length} 段`;
      saveDraft(); renderDraft();
      await detectShots(seg.start, { endSec: seg.end, segmentIndex: seg.index, progressBase: i / draft.segments.length * 100, progressSpan: 100 / draft.segments.length, label: `第 ${i + 1}/${draft.segments.length} 段` });
      if (detectCancelled) { seg.status = 'cancelled'; draft.phase = '已中断（可恢复）'; saveDraft(); renderDraft(); showResume(); return; }
      seg.status = 'done';
      seg.shotCount = draft.shots.filter(s => s.segment === seg.index).length;
      draft.phase = `第 ${i + 1}/${draft.segments.length} 段完成`;
      saveDraft(); renderDraft();
    }
    draft.phase = '分段切分完成'; saveDraft(); renderDraft();
    setProgress(100, '分段切分完成 · 已自动保存：' + draft.savedAt);
  } finally {
    document.getElementById('startSegmented').disabled = false;
    document.getElementById('startDetect').disabled = false;
    document.getElementById('cancelImport').disabled = true;
  }
}

/* opts：{ endSec（默认片尾）, segmentIndex（分段导入时为段号，否则 null）,
   progressBase/progressSpan（把本段进度映射到总进度条的哪一段）,
   label（进度文案前缀，如“第 2/6 段”） }。不传 opts 时行为与以前完全一致。 */
/* ---- 关键帧截取：按视频原始宽高比截整帧，绝不裁剪 ----
   画布按原片比例定尺寸（最长边 320px），再把整帧 drawImage 到画布上；
   之前画布固定 160x90 却按 320x180 画，画布只留下了左上 1/4（左半 + 上半画面），
   缩略图就只剩部分画面。检测循环仍用自己的 160x90 小画布做像素差，不受影响。 */
const thumbCanvas = document.createElement('canvas');
function captureThumbFromPlayer(){
  const vw = player.videoWidth || 0, vh = player.videoHeight || 0;
  if(!vw || !vh) return null;
  let w = 320, h = Math.round(320 * vh / vw);
  if(h > 320){ h = 320; w = Math.max(1, Math.round(320 * vw / vh)); }
  thumbCanvas.width = w; thumbCanvas.height = h;
  const ctx = thumbCanvas.getContext('2d');
  ctx.drawImage(player, 0, 0, w, h);
  return thumbCanvas.toDataURL('image/jpeg', 0.7);
}
async function detectShots(fromSec, opts){
  opts = opts || {};
  const endSec = (opts.endSec ?? (videoDuration || player.duration || 0));
  const segIndex = (opts.segmentIndex === undefined ? null : opts.segmentIndex);
  const base = opts.progressBase || 0, span = (opts.progressSpan === undefined ? 100 : opts.progressSpan);
  const label = opts.label ? opts.label + ' · ' : '';
  detectCancelled = false; document.getElementById('cancelImport').disabled=false;
  const draft = ensureDraft(document.getElementById('importTitle').value || '未命名');
  /* 滑条值是“灵敏度”（越大越敏感、切得越细），而这里需要的是像素差阈值（越大越难触发切分），
     所以要反向换算：灵敏度 5 → 阈值 40（切得少），灵敏度 40 → 阈值 5（切得最细）。
     直接用滑条值当阈值会反过来：灵敏度 5 时几乎任何微小变化都切分，切出最多镜头。 */
  draft.phase = label + '切分检测中'; const threshold = 45 - Number(document.getElementById('sensitivity').value);
  const canvas = document.createElement('canvas'); canvas.width=160; canvas.height=90; const ctx = canvas.getContext('2d');
  const step = 0.5; let prev = null, cutTimes = [fromSec], hitCap = false;
  const total = endSec, spanLen = Math.max(0.001, total - fromSec);
  for(let t = fromSec; t < total; t += step){
    if(detectCancelled){ draft.phase='已中断（可恢复）'; saveDraft(); showResume(); return; }
    await seekTo(t); ctx.drawImage(player, 0, 0, 160, 90);
    const data = ctx.getImageData(0,0,160,90).data; let diff=0;
    if(prev){ for(let i=0;i<data.length;i+=40){ diff += Math.abs(data[i]-prev[i]); } diff = diff / (data.length/40); }
    if(prev && diff > threshold && t - cutTimes[cutTimes.length-1] >= 0.6 && cutTimes.length < 300) cutTimes.push(t);
    prev = new Uint8ClampedArray(data);
    if(cutTimes.length >= 300){ hitCap = true; break; } /* 每段最多 300 个镜头，超了剩下的并进最后一个镜头 */
    if(Math.round(t*2)%4===0) setProgress(Math.round(base + (t-fromSec)/spanLen*span*0.7), `${label}切分检测中 ${fmtTime(t)} / ${fmtTime(total)}`);
    await new Promise(r=>setTimeout(r,0));
  }
  draft.phase = label + '截取关键帧中';
  for(let i=0;i<cutTimes.length;i++){
    if(detectCancelled){ draft.phase='已中断（可恢复）'; saveDraft(); showResume(); return; }
    const start = cutTimes[i], end = (cutTimes[i+1] ?? total);
    await seekTo(Math.min(start+0.05, Math.max(start, end-0.05)));
    const thumb = captureThumbFromPlayer();
    draft.shots.push({id:uid(), title: draft.title || '未命名', start: fmtTime(start), duration: Math.round((end-start)*10)/10, thumb, segment: segIndex,
      shotSize:'',camera:'',composition:'',movement:'',lighting:'',content:'',action:'',emotion:'',dialogue:'',music:'',sfx:'',transition:'',montage:'',why:'', sample:false});
    setProgress(Math.round(base + span*0.7 + (i+1)/cutTimes.length*span*0.3), `${label}截取关键帧 ${i+1}/${cutTimes.length}`);
    saveDraft(); renderDraft();
  }
  draft.phase = label + '切分完成'; saveDraft(); renderDraft(); setProgress(Math.round(base + span), label + '切分完成' + (hitCap ? '（已达每段 300 个镜头上限）' : '') + ' · 已自动保存：'+draft.savedAt);
  document.getElementById('cancelImport').disabled=true;
}
function showResume(){ document.getElementById('resumeImport').style.display='inline-block'; document.getElementById('discardDraft').style.display='inline-block';
  const st=document.getElementById('importStatus'); st.style.display='block'; st.textContent='导入在“'+(db.draft&&db.draft.phase)+'”中断，已自动保存草稿，点“继续导入 / 恢复”可从断点接着跑。'; }
function seekTo(t){ return new Promise(res => { player.onseeked = () => res(); player.currentTime = Math.min(t, (player.duration||t)-0.01); setTimeout(res, 800); }); }

/* ---- drafts ---- */
function draftField(d, f){ return `<div class="field"><label>${FIELD_LABEL[f]}</label><input data-draft="${d.id}" data-field="${f}" value="${esc(d[f]||'')}" placeholder="待填写"></div>`; }
function renderDraft(){
  const d = db.draft;
  document.getElementById('draftCount').textContent = d ? `共 ${d.shots.length} 个镜头 · ${d.phase||''}` : '暂无草稿';
  document.getElementById('importTitle').value = d ? d.title : '';
  if(d && d.phase && d.phase.includes('中断')) showResume();
  updateSegmentUI();
  updateScrubber();
  if(!d || !d.shots.length){ document.getElementById('draftList').innerHTML = '<p class="muted">还没有切分好的镜头草稿。</p>'; return; }
  /* 草稿行的编号 i 是整份草稿里的全局序号（顺序预填按它找邻居），分段只分组显示，不重编号 */
  const shotRow = (s,i)=>`<article class="shot" data-draft-row="${s.id}">
    <div class="shot-head">
      ${s.thumb?`<img class="thumb" src="${s.thumb}" alt="关键帧" data-num="${i+1}" data-start="${esc(s.start)}" data-duration="${esc(s.duration)}" tabindex="0">`:''}
      <div style="flex:1"><strong>#${i+1} 开始 ${esc(s.start)}</strong> <span class="kbd">时长 ${esc(s.duration)} 秒</span>
      ${s.aiFilled?' <span class="badge ai">AI预填</span>':''}${s.subtitleSource?` <span class="badge">字幕来源：${esc(s.subtitleSource)}</span>`:''}<br>
      <span class="kbd">点「识图预填」补画面类字段；点「顺序预填」补转场/蒙太奇/为什么。</span></div>
      <div class="row"><input type="checkbox" data-check="${s.id}" ${s.checked!==false?'checked':''} style="width:20px;height:20px"><button data-heuristic="${s.id}" ${aiBusy.has('h:'+s.id)?'disabled':''}>${aiBusy.has('h:'+s.id)?'分析中…':'识图预填'}</button><button data-sequence="${s.id}" ${aiBusy.has('s:'+s.id)?'disabled':''}>${aiBusy.has('s:'+s.id)?'预填中…':'顺序预填'}</button><button data-recapture="${s.id}">重截关键帧</button><button data-del-draft="${s.id}">删除此镜</button></div>
    </div>
    <div class="shot-fields">${FIELDS.map(f=>draftField(s,f)).join('')}</div>
  </article>`;
  /* 分段导入的草稿按段分组显示，每段可单独存入拉片库；单次导入保持原来的平铺列表 */
  if (d.segmented && Array.isArray(d.segments) && d.segments.length) {
    const SEG_STATUS = { pending: '待处理', processing: '处理中…', done: '已完成', saved: '已存入拉片库', cancelled: '已中断' };
    document.getElementById('draftList').innerHTML = d.segments.map(seg => {
      const list = d.shots.map((s,i)=>({s,i})).filter(x => (x.s.segment ?? 0) === seg.index);
      const saved = seg.status === 'saved';
      return `<div class="seg-group">
        <div class="seg-head"><strong>第 ${seg.index+1} 段 ${fmtTime(seg.start)}–${fmtTime(seg.end)}</strong>
        <span class="muted">共 ${list.length} 个镜头 · ${SEG_STATUS[seg.status] || seg.status}</span>
        <span style="flex:1"></span>
        ${list.length && !saved ? `<button data-save-segment="${seg.index}">存入拉片库（本段）</button>` : ''}
        </div>
        ${list.length ? list.map(x => shotRow(x.s, x.i)).join('') : '<p class="muted">本段还没有镜头。</p>'}
      </div>`;
    }).join('');
    return;
  }
  document.getElementById('draftList').innerHTML = d.shots.map(shotRow).join('');
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
  const sv = e.target.closest('[data-save-segment]');
  if(sv){ saveSegmentShots(Number(sv.dataset.saveSegment)); return; }
  const del = e.target.closest('[data-del-draft]');
  if(del){ db.draft.shots = db.draft.shots.filter(s=>s.id!==del.dataset.delDraft); saveDraft(); renderDraft(); return; }
  const h = e.target.closest('[data-heuristic]'); if(h){ aiPrefill(h.dataset.heuristic); return; }
  const sq = e.target.closest('[data-sequence]'); if(sq){ sequencePrefill(sq.dataset.sequence); return; }
  const rc = e.target.closest('[data-recapture]'); if(rc){ recaptureThumb(rc.dataset.recapture); return; }
  /* 点某条镜头时，滑轨同步到该镜头编号（删除/预填按钮已在上面处理并返回），原视频预览也跳到该镜头 */
  const row = e.target.closest('article.shot');
  if(row){ const i = scrubRows().indexOf(row); if(i >= 0){ scrubValue = i + 1; updateScrubber(); previewSeekToShot(scrubValue); } }
});

/* ---- 重截关键帧：给已有草稿的某个镜头重新截一张整帧缩略图 ----
   旧草稿里的缩略图是裁过的 data URL，修不回来；视频文件还在当前浏览器里时，
   可跳到该镜头开始时间重截一张（按新逻辑截整帧），刷新后需先重选同一视频文件。 */
async function recaptureThumb(id){
  const s = db.draft && db.draft.shots.find(x => x.id === id); if(!s) return;
  if(!currentVideoFile || !player.src) return alert('请先重新选择同一视频文件，再重截关键帧。');
  if(!player.duration) return alert('视频还在加载，等一下再试。');
  if(!document.getElementById('cancelImport').disabled) return alert('切分检测进行中，稍后再试。');
  try {
    player.pause();
    await seekTo(Math.min(parseTime(s.start) + 0.05, Math.max(parseTime(s.start), player.duration - 0.01)));
    const thumb = captureThumbFromPlayer();
    if(!thumb) return alert('没取到视频画面，等一下再试。');
    s.thumb = thumb; saveDraft(); renderDraft();
  } catch(e){ alert('重截失败：' + (e.message || e)); }
}

/* ---- 镜头游标滑轨：拖动滑到第 N 个镜头，镜头表滚动到该镜头置顶并短暂高亮 ----
   编号是整份草稿的全局序号（分段草稿也一样），拖到 10 就是全局第 10 个镜头。
   滚动只发生在 #draftList 容器内部（容器有固定高度、自己滚），绝不滚整页，
   滑轨用 position:sticky 吸在页签导航下方，拖动时滑轨和上面页面都不动，只有下面镜头区动。
   renderDraft 会整体重渲染草稿列表，所以滑轨位置记在 scrubValue 变量里，渲染时恢复；
   手动滚动/点镜头行会同步滑轨，但拖动时拖动优先（scrubDragging 为 true 时不同步）。
   滑轨两边的 ‹ › 按钮点一下前后移动一个镜头，到头自动禁用。 */
let scrubDragging = false;
let scrubValue = 1;
let scrubFlashTimer = null;
function scrubRows(){ return Array.from(document.querySelectorAll('#draftList article.shot')); }
function updateScrubber(){
  const box = document.getElementById('shotScrubber');
  const range = document.getElementById('shotScrubberRange');
  const hint = document.getElementById('previewHint');
  const n = db.draft ? db.draft.shots.length : 0;
  if(!n){ box.style.display = 'none'; if(hint) hint.style.display='none'; return; }
  box.style.display = 'flex';
  /* 有镜头但视频文件没加载（刷新后续跑草稿、还没重选文件）时，提示重选文件后再定位 */
  if(hint) hint.style.display = (!currentVideoFile || !player.src) ? 'block' : 'none';
  /* 吸顶位置按实际导航高度算（窄屏导航换行变高时也不会盖住导航） */
  box.style.top = (((document.querySelector('nav') || {}).offsetHeight) || 0) + 'px';
  scrubValue = Math.min(Math.max(scrubValue || 1, 1), n);
  range.max = n;
  range.value = scrubValue;
  document.getElementById('scrubLabel').textContent = `第 ${scrubValue} / 共 ${n} 个镜头`;
  document.getElementById('scrubPrev').disabled = scrubValue <= 1;
  document.getElementById('scrubNext').disabled = scrubValue >= n;
}
function scrollToShot(n, smooth){
  const row = scrubRows()[n - 1]; if(!row) return;
  /* 只滚 #draftList 容器内部：按目标行相对容器的位置算 scrollTop，整页不动 */
  const list = document.getElementById('draftList');
  const top = list.scrollTop + row.getBoundingClientRect().top - list.getBoundingClientRect().top - 8;
  list.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
  row.classList.add('scrub-target');
  clearTimeout(scrubFlashTimer);
  scrubFlashTimer = setTimeout(() => row.classList.remove('scrub-target'), 1600);
  previewSeekToShot(n);
}
/* ---- 预览联动：滑轨定位到第 N 个镜头时，原视频预览也跳到该镜头的开始时间并暂停 ----
   只改 currentTime、绝不自动播放，方便对照原视频核对镜头信息。切分检测进行中时
   视频正忙着逐帧采样，不联动（避免打断检测）；视频文件没加载时只显示提示，不报错。 */
function previewSeekToShot(n){
  const shot = db.draft && db.draft.shots[n - 1];
  if(!shot) return;
  const hint = document.getElementById('previewHint');
  if(!currentVideoFile || !player.src){ if(hint) hint.style.display = 'block'; return; }
  if(hint) hint.style.display = 'none';
  if(!player.duration) return; /* 元数据还没加载好，等一下再拖 */
  if(!document.getElementById('cancelImport').disabled) return; /* 检测进行中，视频正忙 */
  try {
    player.pause();
    const t = parseTime(shot.start);
    player.currentTime = Math.min(Math.max(t, 0), Math.max(player.duration - 0.01, 0));
  } catch(e){ /* 浏览器不支持 seek 时静默忽略，不影响滑轨本身 */ }
}
/* 滑轨两边的 ‹ › 按钮：点一下前后移动一个镜头 */
function scrubStep(delta){
  const n = db.draft ? db.draft.shots.length : 0; if(!n) return;
  scrubValue = Math.min(Math.max((scrubValue || 1) + delta, 1), n);
  updateScrubber();
  scrollToShot(scrubValue, true);
}
document.getElementById('scrubPrev').addEventListener('click', () => scrubStep(-1));
document.getElementById('scrubNext').addEventListener('click', () => scrubStep(1));
document.getElementById('shotScrubberRange').addEventListener('input', () => {
  scrubDragging = true;
  scrubValue = Number(document.getElementById('shotScrubberRange').value);
  document.getElementById('scrubLabel').textContent = `第 ${scrubValue} / 共 ${db.draft ? db.draft.shots.length : 0} 个镜头`;
  scrollToShot(scrubValue, false);
});
document.getElementById('shotScrubberRange').addEventListener('change', () => {
  scrubDragging = false;
  scrollToShot(scrubValue, true);
});
/* 手动滚动镜头表时同步滑轨到当前置顶的镜头（拖动时不同步，拖动优先） */
let scrubScrollTick = false;
document.getElementById('draftList').addEventListener('scroll', () => {
  if(scrubDragging || scrubScrollTick) return;
  if(!document.getElementById('page-import').classList.contains('active')) return;
  if(!db.draft || !db.draft.shots.length) return;
  scrubScrollTick = true;
  requestAnimationFrame(() => {
    scrubScrollTick = false;
    if(scrubDragging || !db.draft || !db.draft.shots.length) return;
    const list = document.getElementById('draftList');
    const top = list.getBoundingClientRect().top + 8;
    const rows = scrubRows();
    let idx = rows.findIndex(r => r.getBoundingClientRect().bottom > top);
    if(idx < 0) idx = rows.length - 1;
    if(idx >= 0 && idx + 1 !== scrubValue){ scrubValue = idx + 1; updateScrubber(); }
  });
}, { passive: true });
document.getElementById('batchSave').addEventListener('click', async () => {
  if(!db.draft || !db.draft.shots.length) return alert('没有可保存的草稿。');
  const chosen = db.draft.shots.filter(s=>s.checked!==false).map(s=>{ const {checked, aiFilled, subtitleSource, ...rest} = s; return {...rest, sample:false}; });
  await api('/api/shots/batch', { method: 'POST', body: JSON.stringify({ shots: chosen }) });
  db.draft = null; try{localStorage.removeItem(DRAFT_LS);}catch(e){} renderDraft(); await refreshData(); renderShots();
  alert(`已存入拉片库 ${chosen.length} 个镜头，草稿已清除。`);
});

/* ---- 按段存入拉片库：只保存该段打勾的镜头，从草稿中移除，其它段不受影响 ----
   全部段都存完、草稿空了时，整个草稿清除（与一键批量保存一致）。 */
async function saveSegmentShots(segIndex){
  const d = db.draft; if(!d) return;
  const seg = Array.isArray(d.segments) ? d.segments.find(s => s.index === segIndex) : null;
  const chosen = d.shots.filter(s => (s.segment ?? 0) === segIndex && s.checked !== false)
    .map(s => { const {checked, aiFilled, subtitleSource, segment, ...rest} = s; return {...rest, sample:false}; });
  if(!chosen.length) return alert('本段没有可保存的镜头（可能都未勾选）。');
  if(!confirm(`把第 ${segIndex + 1} 段的 ${chosen.length} 个镜头存入拉片库吗？本段镜头将从草稿中移除，其他段不受影响。`)) return;
  await api('/api/shots/batch', { method: 'POST', body: JSON.stringify({ shots: chosen }) });
  d.shots = d.shots.filter(s => !((s.segment ?? 0) === segIndex && s.checked !== false));
  if (seg) { seg.status = 'saved'; seg.shotCount = d.shots.filter(s => (s.segment ?? 0) === segIndex).length; }
  if (!d.shots.length) { db.draft = null; try{localStorage.removeItem(DRAFT_LS);}catch(e){} }
  else saveDraft();
  renderDraft(); await refreshData(); renderShots();
  alert(`第 ${segIndex + 1} 段已存入拉片库 ${chosen.length} 个镜头。`);
}

/* ---- AI 预填加载态：renderDraft 会整体重渲染草稿列表，所以按钮的
   “分析中 / 预填中”状态不能只改 DOM，必须记在这个集合里，渲染时查它 ---- */
const aiBusy = new Set(); /* 元素形如 'h:<镜头id>'（识图）或 's:<镜头id>'（顺序） */

/* 顺序预填只发精简文本摘要：不含关键帧图片（thumb 是几十 KB 的 base64，
   整批发过去既慢又可能撑爆请求体），index 用镜头在整批草稿里的原始编号。 */
function seqSummaryShot(s, originalIndex){
  return { index: originalIndex, start: s.start || '', duration: s.duration ?? '',
    shotSize: s.shotSize || '', camera: s.camera || '', content: s.content || '',
    action: s.action || '', emotion: s.emotion || '', dialogue: s.dialogue || '' };
}

/* ---- 识图预填：服务端 DeepSeek 视觉分析 ---- */
async function aiPrefill(id){
  const d = db.draft && db.draft.shots.find(x=>x.id===id); if(!d || !d.thumb) return alert('该镜头没有关键帧。');
  const key = 'h:' + id; if (aiBusy.has(key)) return; /* 已在跑，防重复点击 */
  aiBusy.add(key); renderDraft();
  try {
    const out = await aiApi('/api/ai/analyze-keyframe', { imageDataUrl: d.thumb, shotContext: `${d.title || ''} 开始 ${d.start} 时长 ${d.duration} 秒` });
    ['shotSize','camera','composition','lighting','content','action','emotion'].forEach(f => { if (out[f]) d[f] = out[f]; });
    d.aiFilled = true; saveDraft();
  } catch (err) { alert(String(err.message || err)); }
  finally { aiBusy.delete(key); renderDraft(); }
}
document.getElementById('batchHeuristic').addEventListener('click', async (e) => {
  if(!db.draft) return;
  const btn = e.currentTarget; btn.disabled = true; btn.textContent = '批量分析中…';
  try {
    for(const s of db.draft.shots.filter(s=>!s.aiFilled).slice(0,10)){ await aiPrefill(s.id); }
  } finally { btn.disabled = false; btn.textContent = '批量识图前10个'; }
});

/* ---- 顺序预填：服务端 DeepSeek，看前后镜头 + 对白 ----
   只发目标镜头前后各 2 个邻居（最多 5 条精简摘要），一次只让模型返回
   目标镜头 1 条结果；以前是把全部镜头一次发过去，模型要生成几十上百条
   结果，30 秒内写不完就超时。 */
async function sequencePrefill(id){
  const shots = db.draft ? db.draft.shots : []; const i = shots.findIndex(s=>s.id===id); if(i<0) return;
  const key = 's:' + id; if (aiBusy.has(key)) return;
  aiBusy.add(key); renderDraft();
  try {
    const from = Math.max(0, i - 2), to = Math.min(shots.length, i + 3);
    const window = shots.slice(from, to).map((s, k) => seqSummaryShot(s, from + k + 1));
    const out = await aiApi('/api/ai/analyze-sequence', { shots: window, targetIndices: [i + 1] });
    const r = (out.results || []).find(x => x.index === i + 1);
    if (!r) return alert('顺序预填没有返回该镜头的结果。');
    const s = shots[i];
    if (r.transition) s.transition = r.transition;
    if (r.montage) s.montage = r.montage;
    if (r.why) s.why = r.why;
    s.aiFilled = true; saveDraft();
  } catch (err) { alert(String(err.message || err)); }
  finally { aiBusy.delete(key); renderDraft(); }
}
document.getElementById('batchSequence').addEventListener('click', async (e) => {
  if(!db.draft) return;
  const btn = e.currentTarget; btn.disabled = true; btn.textContent = '顺序预填中…';
  try {
    /* 前 10 个镜头按 5 个一组分批调用，每组附带前后各 2 个邻居作上下文，
       每组只返回该组 5 条结果，避免一次生成全部结果超时。 */
    const targets = db.draft.shots.slice(0, 10);
    for (let c = 0; c < targets.length; c += 5) {
      const chunk = targets.slice(c, c + 5);
      const chunkStart = db.draft.shots.indexOf(chunk[0]);
      const chunkEnd = db.draft.shots.indexOf(chunk[chunk.length - 1]);
      const from = Math.max(0, chunkStart - 2), to = Math.min(db.draft.shots.length, chunkEnd + 3);
      const window = db.draft.shots.slice(from, to).map((s, k) => seqSummaryShot(s, from + k + 1));
      const targetIndices = chunk.map(s => db.draft.shots.indexOf(s) + 1);
      const out = await aiApi('/api/ai/analyze-sequence', { shots: window, targetIndices });
      (out.results || []).forEach(r => {
        const s = db.draft.shots[r.index - 1];
        if (!s) return;
        if (r.transition) s.transition = r.transition;
        if (r.montage) s.montage = r.montage;
        if (r.why) s.why = r.why;
        s.aiFilled = true;
      });
    }
    saveDraft();
  } catch (err) { alert(String(err.message || err)); }
  finally { btn.disabled = false; btn.textContent = '顺序预填（前10个）'; renderDraft(); }
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

/* ---- 帮助弹窗：每页一个 ? 按钮，点开看详细说明 ---- */
const HELP = {
  shots: { title: '拉片库 — 使用帮助', body: `
    <h4>这个页面是做什么的</h4>
    <p>拉片库是你的逐镜头拆解记录本。每一个镜头一张卡片，记录景别、机位、构图、运镜、光线、画面内容、人物动作、情绪、对白、背景音乐、音效、转场方式、蒙太奇运用和“为什么这样用”共 14 个字段。积累得越多，后面剧本转分镜时 AI 能参考的依据就越多。</p>
    <h4>怎么新增 / 编辑镜头</h4>
    <ul>
      <li>在「新增 / 编辑镜头」表单里填好各字段，点「保存镜头」。片名/场次必填，其余可先留空、以后再补。</li>
      <li>点卡片上的「编辑」，表单会自动填入该镜头的内容，改完再点保存即更新；点「清空表单」可重新开始。</li>
      <li>可以上传一张关键帧图片（本地文件，只存为 data URL），鼠标停在截图上可看大图，手机上点一下打开。</li>
    </ul>
    <h4>搜索和筛选</h4>
    <p>顶部搜索框可按片名、场景、对白、景别搜索；情绪下拉框可只看某一情绪的镜头。</p>
    <h4>提炼到知识库</h4>
    <p>点卡片上的「提炼到知识库」，会用这个镜头的情绪、景别、运镜和“为什么这样用”自动生成一条视听语言规律，存进知识库，你可以在知识库页再修改完善。</p>
    <h4>示例数据</h4>
    <p>第一次打开时自带 5 条示例拉片，带“示例”标记。点「一键清空示例」只删示例，你自己的数据不会被删。</p>
    <h4>数据存在哪</h4>
    <p>数据存在 Neon 数据库里（服务端接口 /api），换设备登录也能看到。顶部状态栏会显示数据库是否已连接；若显示“内存存储”，说明 Neon 未配置，重启服务后数据会丢。</p>` },
  knowledge: { title: '视听语言知识库 — 使用帮助', body: `
    <h4>这个页面是做什么的</h4>
    <p>知识库把你从拉片里提炼出来的规律沉淀下来：某种情绪、某种场景下，用什么景别、运镜和节奏效果最好。它是剧本转分镜的“依据库”——生成分镜时，AI 会优先引用这里的规律。</p>
    <h4>一条规律包含什么</h4>
    <ul>
      <li><b>标题</b>：一句话说清规律，例如“对话紧张时用过肩特写 + 缓推”。</li>
      <li><b>情绪</b>：紧张 / 悬疑 / 温馨 / 悲伤 / 喜悦 / 浪漫 / 愤怒 / 恐惧 / 平静 / 压抑 / 震撼 / 孤独（共 12 个，两页统一），分镜匹配时优先按情绪找。</li>
      <li><b>场景类型</b>：对话戏 / 追逐 / 独白等，情绪相同或没有匹配时再按场景找。</li>
      <li><b>节奏</b>：渐紧 / 渐缓 / 快速 / 缓慢。</li>
      <li><b>标签</b>：用逗号分隔，如“特写, 推镜, 对话”，方便搜索。</li>
      <li><b>用法说明</b>：具体怎么用、为什么有效，写得越具体，分镜生成时参考价值越高。</li>
    </ul>
    <h4>规律从哪来</h4>
    <ul>
      <li>在拉片库点「提炼到知识库」，自动生成一条，再到这里修改完善。</li>
      <li>直接在本页「新增规律」表单里手动添加。</li>
    </ul>
    <h4>搜索和筛选</h4>
    <p>顶部搜索框可按规律标题、用法说明、标签搜索；情绪下拉框可只看某一情绪的规律。每条规律都可编辑和删除，示例规律带“示例”标记。</p>` },
  storyboard: { title: '剧本转分镜 — 使用帮助', body: `
    <h4>这个页面是做什么的</h4>
    <p>把一段剧本变成一张分镜表：每个剧本节拍对应一个镜头，给出景别、引用了哪条知识库规律，以及可直接用的中文和英文 AI 视频提示词。</p>
    <h4>操作步骤</h4>
    <ul>
      <li>选好本段剧本的<b>情绪</b>、<b>场景类型</b>和<b>节奏</b>。</li>
      <li>在「剧本」框里粘贴剧本，<b>每行一段 / 一个场景节拍</b>，一行就是一个镜头。</li>
      <li>点「生成分镜」，稍等片刻，下方出现分镜表。</li>
    </ul>
    <h4>AI 是怎么生成的</h4>
    <p>服务端 AI（DeepSeek）按你的知识库生成分镜：优先匹配相同情绪的规律，其次匹配场景类型。分镜表每一行都写明“依据”——引用了哪条规律，方便你核对。</p>
    <h4>复制和导出</h4>
    <ul>
      <li>「复制全部」：把整张分镜表（含中英文提示词）复制到剪贴板。</li>
      <li>「导出 TXT」：下载一份分镜表 .txt 文件。</li>
      <li>每次生成都会保存到「生成历史」，可查看最近 10 次。</li>
    </ul>
    <h4>注意事项</h4>
    <ul>
      <li>知识库越丰富，分镜越贴合你的风格；知识库为空时 AI 只能按通用经验生成。</li>
      <li>如果顶部状态栏显示 AI 未配置，点生成会明确报错，不会编造结果——需要在 Render 环境变量里设置 AI_API_KEY / AI_BASE_URL / AI_MODEL。</li>
    </ul>` },
  import: { title: '视频导入 — 使用帮助', body: `
    <h4>这个页面是做什么的</h4>
    <p>上传一段视频，浏览器在本地自动按画面变化切分镜头，截取每个镜头的关键帧，生成一份待填写的镜头草稿；你确认、补全后批量存入拉片库。<b>视频全程在浏览器本地处理，不会上传到任何服务器。</b></p>
    <h4>操作步骤</h4>
    <ul>
      <li>先填片名，再上传本地视频文件（或粘贴可直接下载的 mp4/webm 链接，点「加载链接」）。</li>
      <li>「切分灵敏度」默认 15：数值越大切得越碎、镜头越多；数值越小切得越少。调好后点「开始切分镜头」。</li>
      <li>切分按画面变化检测（每 0.5 秒采样一次），每个镜头自动截取一张关键帧，时间码和时长自动填好，分析字段留空等你确认。</li>
      <li>在草稿里逐条填写，或用下面的 AI 预填帮忙，再点「一键批量存入拉片库」（只保存打勾的镜头，保存后草稿自动清除）。</li>
    </ul>
    <h4>长视频：分段导入</h4>
    <p>60 分钟这样的长片可以直接用「分段导入」：选好每段时长（默认 10 分钟），系统会算出要切成几段（60 分钟就是 6 段），然后一段一段顺序处理，不会同时跑。每段最多 300 个镜头，时间码按原片绝对时间算，不会从 0:00 重算。</p>
    <p>处理中会显示“正在处理第 2/6 段”和总进度；随时可以点「取消」，已完成的分段会保留下来。刷新页面后，重新选同一个视频文件再点「继续导入 / 恢复」，会从下一段没处理完的接着跑。草稿里每段自成一组，标着“第 1 段 00:00–10:00”，可以按段点「存入拉片库（本段）」，也可以最后点「一键批量存入拉片库」全部一起存。超过 10 分钟的视频若不分段，仍会提示先截取 5–10 分钟的关键段落再导入。</p>
    <h4>字幕来源（按优先级）</h4>
    <ul>
      <li><b>SRT 字幕文件（最准）</b>：切分完成后再传 .srt 文件，按时间码自动对齐到每个镜头的「对白」栏。</li>
      <li><b>画面字幕 OCR</b>：没有 SRT 时点「识别画面字幕」，用 Tesseract.js 识别关键帧下方的字幕（需联网加载，识别前 10 个镜头）。识别结果可能有错字，旁边会标出置信度，请逐条核对。</li>
      <li>内嵌字幕轨浏览器一般读不到，会如实提示；这时请用 SRT 文件或手动填写对白。</li>
    </ul>
    <h4>识图预填和顺序预填</h4>
    <ul>
      <li><b>识图预填</b>：看关键帧图片，只补景别、机位、构图、光线、画面内容、人物动作、情绪这 7 个能“看出来”的字段，标“AI预填”。运镜、转场、蒙太奇、对白、音乐、音效和“为什么”留空。</li>
      <li><b>顺序预填</b>：看当前镜头和前后镜头、结合对白，推测转场方式、蒙太奇运用和“为什么这样用”，标“AI预填·推测”，请核对后再保存。</li>
      <li>两个批量按钮都只处理前 10 个镜头；单个镜头也有自己的预填按钮。AI 未配置时会明确报错，不会编造。</li>
    </ul>
    <h4>草稿断点恢复</h4>
    <p>导入草稿会自动保存到浏览器本地缓存（localStorage），切页签、刷新后仍在；中途刷新或中断会显示「继续导入 / 恢复」，点它可从断点接着跑（若视频文件没保住，会提示你重新选择同一个视频文件）。不想要了点「放弃这次导入」。</p>
    <h4>小技巧</h4>
    <p>鼠标停在关键帧上可看大图；草稿里每条前面的复选框可取消勾选，不想存入拉片库的镜头去掉勾即可。镜头多了可以用草稿上方的「快速定位镜头」滑轨：拖到第 N 个，下面镜头表就滚动到第 N 个镜头置顶并高亮，拖动时滑轨固定不动；滑轨两边的 ‹ › 按钮点一下前后移动一个镜头。拖滑轨、点箭头或点某条镜头时，草稿上方的原视频预览也会跳到该镜头的开始时间并暂停，方便对照原视频核对信息；若刷新后还没重新选择视频文件，预览下方会提示重选同一文件后再定位。</p>` },
};
function openHelp(key){
  const h = HELP[key]; if(!h) return;
  document.getElementById('helpTitle').textContent = h.title;
  document.getElementById('helpBody').innerHTML = h.body;
  document.getElementById('helpModal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}
function closeHelp(){
  document.getElementById('helpModal').style.display = 'none';
  document.body.style.overflow = '';
}
document.addEventListener('click', e => {
  const btn = e.target.closest && e.target.closest('[data-help]');
  if(btn){ openHelp(btn.dataset.help); return; }
  if(e.target.id === 'helpModal' || e.target.closest('#helpClose')) closeHelp();
});
document.addEventListener('keydown', e => {
  if(e.key === 'Escape' && document.getElementById('helpModal').style.display !== 'none') closeHelp();
});

/* ---- init ---- */
(async () => {
  db.draft = loadDraftFromCache();
  try { await refreshData(); } catch (err) { alert('加载数据失败：' + err.message + '。请确认服务已启动、Neon 已配置。'); }
  refreshHealth();
  renderShots(); renderKnowledge(); renderHistory(); renderDraft();
  if(db.draft && db.draft.shots.length){
    const st=document.getElementById('importStatus'); st.style.display='block';
    st.textContent = `检测到上次未完成的导入草稿（${db.draft.shots.length} 个镜头，${db.draft.phase||''}，保存于 ${db.draft.savedAt||''}）。草稿已保留，点“继续导入 / 恢复”可接着跑，或点“放弃这次导入”。`;
    showResume();
  }
})();
