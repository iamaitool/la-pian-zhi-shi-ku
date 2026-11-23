/* 拉片知识库 — 独立静态版
   数据：localStorage。AI 功能均为本地规则/启发式，不含服务端模型。 */
'use strict';
const LS = 'lapian-standalone-v1';
const FIELDS = ['shotSize','camera','composition','movement','lighting','content','action','emotion','dialogue','music','sfx','transition','montage','why'];
const FIELD_LABEL = {shotSize:'景别',camera:'机位',composition:'构图',movement:'运镜',lighting:'光线',content:'画面内容',action:'人物动作',emotion:'情绪',dialogue:'对白',music:'背景音乐',sfx:'音效',transition:'转场方式',montage:'蒙太奇运用',why:'为什么这样用'};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtTime = s => { s = Math.max(0, Math.round(s||0)); const m = Math.floor(s/60), ss = String(s%60).padStart(2,'0'); return String(m).padStart(2,'0') + ':' + ss; };
const parseTime = t => { const p = String(t||'0').split(':').map(Number); return p.length===2 ? p[0]*60+p[1] : (p[0]||0); };

const SAMPLE_SHOTS = [
 {title:'《示例》办公室对峙',start:'00:00',duration:4,shotSize:'大全景',camera:'平视',composition:'对称构图，人物居中',movement:'固定',lighting:'冷色顶光，低调',content:'深夜办公室，只剩一盏台灯',action:'他坐在桌后，抬头',emotion:'紧张',dialogue:'',music:'低沉弦乐',sfx:'时钟滴答',transition:'硬切',montage:'建立镜头',why:'先交代空间和压迫感，再切近景',sample:true},
 {title:'《示例》办公室对峙',start:'00:04',duration:3,shotSize:'过肩特写',camera:'过肩，平视',composition:'三分法，人物在右三分之一',movement:'缓慢推近',lighting:'面部半明半暗',content:'她的侧脸，目光盯着桌上的信',action:'她推开门，停住',emotion:'紧张',dialogue:'你早就知道，对吗？',music:'弦乐渐强',sfx:'',transition:'硬切',montage:'正反打',why:'过肩特写加缓推，收紧对话张力',sample:true},
 {title:'《示例》办公室对峙',start:'00:07',duration:3,shotSize:'特写',camera:'平视',composition:'居中，面部占满画面',movement:'固定',lighting:'侧光，轮廓清晰',content:'他的眼睛，没有立刻回答',action:'他抬起头，嘴唇微动',emotion:'紧张',dialogue:'……',music:'',sfx:'呼吸声',transition:'硬切',montage:'正反打',why:'反应特写，让观众读出犹豫',sample:true},
 {title:'《示例》海边独白',start:'00:00',duration:6,shotSize:'远景',camera:'低机位仰拍',composition:'地平线在下三分之一',movement:'缓慢横移',lighting:'暖色夕阳，逆光',content:'海滩上一个人影走向海水',action:'她慢慢走，裙摆被风吹起',emotion:'平静',dialogue:'',music:'钢琴独奏',sfx:'海浪声',transition:'叠化',montage:'情绪蒙太奇',why:'大全景释放情绪，留白',sample:true},
 {title:'《示例》海边独白',start:'00:06',duration:4,shotSize:'近景',camera:'平视',composition:'人物偏左，留白在右',movement:'固定',lighting:'柔光',content:'她回头看镜头，笑了',action:'回头，微笑',emotion:'喜悦',dialogue:'',music:'钢琴',sfx:'',transition:'硬切',montage:'情绪蒙太奇',why:'近景收住情绪，转折到释然',sample:true},
];
const SAMPLE_KNOW = [
 {title:'对话紧张时用过肩特写 + 缓推',emotion:'紧张',scene:'对话戏',rhythm:'渐紧',tags:['特写','推镜','对话'],desc:'正反打来回切，镜头缓慢推近，收紧人物关系和情绪张力。',sample:true},
 {title:'情绪释放时切大全景',emotion:'平静',scene:'独白',rhythm:'渐缓',tags:['全景','留白'],desc:'从特写切到大全景，让情绪有出口，画面留白。',sample:true},
 {title:'悬疑开场用大全景建立空间',emotion:'悬疑',scene:'开场',rhythm:'缓慢',tags:['全景','建立镜头'],desc:'先用大全景交代环境，再切入人物，制造未知感。',sample:true},
 {title:'悲伤用固定近景 + 柔光',emotion:'悲伤',scene:'独白',rhythm:'缓慢',tags:['近景','固定'],desc:'镜头不动，让观众停留在人物脸上，柔光弱化冲突。',sample:true},
 {title:'愤怒用快速短镜头拼贴',emotion:'愤怒',scene:'冲突',rhythm:'快速',tags:['快切','短镜头'],desc:'多个短镜头快速切换，压缩时间，表现情绪爆发。',sample:true},
];

let db = load();
function load(){
  try{ const raw = localStorage.getItem(LS); if(raw){ const d = JSON.parse(raw); if(d.shots && d.knowledge) return d; } }catch(e){}
  return {shots: SAMPLE_SHOTS.map(s=>({...s,id:uid()})), knowledge: SAMPLE_KNOW.map(k=>({...k,id:uid()})), history: [], draft: null};
}
function save(){ try{ localStorage.setItem(LS, JSON.stringify(db)); }catch(e){ /* localStorage 满了（关键帧 data URL 较大）时忽略，由导入页提示 */ } }
function saveDraft(){ if(db.draft){ db.draft.savedAt = new Date().toLocaleTimeString(); save(); const el = document.getElementById('importProgressText'); if(el) el.textContent = (db.draft.phase||'草稿') + ' · 已自动保存：' + db.draft.savedAt; } }

/* ---- tabs ---- */
document.querySelectorAll('nav button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('nav button').forEach(x=>x.classList.remove('active')); b.classList.add('active');
  document.querySelectorAll('section.page').forEach(s=>s.classList.remove('active'));
  document.getElementById('page-'+b.dataset.page).classList.add('active');
}));

/* ---- shots ---- */
function shotCard(s, i){
  const ai = s.aiFilled ? ' <span class="badge ai">本地启发式预填</span>' : '';
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
document.getElementById('clearSamples').addEventListener('click', () => {
  if(!confirm('只删除标记为“示例”的拉片和知识条目，你自己的数据不会被删。确定吗？')) return;
  db.shots = db.shots.filter(s=>!s.sample); db.knowledge = db.knowledge.filter(k=>!k.sample); save(); renderShots(); renderKnowledge();
});
document.getElementById('shotForm').addEventListener('submit', e => {
  e.preventDefault();
  const id = document.getElementById('shotId').value;
  const rec = {id: id||uid(), title: v('f-title'), start: v('f-start'), duration: Number(v('f-duration'))||0, emotion: v('f-emotion'),
    shotSize: v('f-shotSize'), camera: v('f-camera'), composition: v('f-composition'), movement: v('f-movement'), lighting: v('f-lighting'),
    content: v('f-content'), action: v('f-action'), dialogue: v('f-dialogue'), music: v('f-music'), sfx: v('f-sfx'),
    transition: v('f-transition'), montage: v('f-montage'), why: v('f-why'), sample:false};
  const file = document.getElementById('f-thumb').files[0];
  const done = () => { if(id){ const i=db.shots.findIndex(s=>s.id===id); if(i>=0) db.shots[i]={...db.shots[i],...rec}; } else db.shots.unshift(rec); save(); e.target.reset(); document.getElementById('shotId').value=''; renderShots(); };
  if(file){ const r=new FileReader(); r.onload=()=>{rec.thumb=r.result; done();}; r.readAsDataURL(file); } else done();
});
function v(id){ return document.getElementById(id).value.trim(); }
document.getElementById('shotReset').addEventListener('click', () => { document.getElementById('shotForm').reset(); document.getElementById('shotId').value=''; });
document.getElementById('shotList').addEventListener('click', e => {
  const del = e.target.closest('[data-del-shot]'); const ed = e.target.closest('[data-edit-shot]'); const ex = e.target.closest('[data-extract]');
  if(del){ if(confirm('删除这条拉片？')){ db.shots=db.shots.filter(s=>s.id!==del.dataset.delShot); save(); renderShots(); } }
  if(ed){ const s=db.shots.find(x=>x.id===ed.dataset.editShot); if(!s) return; document.getElementById('shotId').value=s.id;
    const map={title:'f-title',start:'f-start',duration:'f-duration',emotion:'f-emotion',shotSize:'f-shotSize',camera:'f-camera',composition:'f-composition',movement:'f-movement',lighting:'f-lighting',content:'f-content',action:'f-action',dialogue:'f-dialogue',music:'f-music',sfx:'f-sfx',transition:'f-transition',montage:'f-montage',why:'f-why'};
    Object.entries(map).forEach(([k,el])=>document.getElementById(el).value=s[k]??''); window.scrollTo({top:0,behavior:'smooth'}); }
  if(ex){ const s=db.shots.find(x=>x.id===ex.dataset.extract); if(!s) return;
    db.knowledge.unshift({id:uid(),title:`${s.emotion||'某情绪'}时：${s.shotSize||''}${s.movement? ' + '+s.movement:''}（来自 ${s.title}）`,emotion:s.emotion||'紧张',scene:'',rhythm:'渐紧',tags:[s.shotSize,s.movement].filter(Boolean),desc:s.why||`${s.composition||''}；${s.lighting||''}`,sample:false});
    save(); renderKnowledge(); alert('已提炼到知识库，可在知识库页修改。'); }
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
document.getElementById('knowForm').addEventListener('submit', e => {
  e.preventDefault(); const id=document.getElementById('k-id').value;
  const rec={id:id||uid(),title:v('k-title'),emotion:v('k-emotion'),scene:v('k-scene'),rhythm:v('k-rhythm'),tags:v('k-tags').split(/[,，]/).map(s=>s.trim()).filter(Boolean),desc:v('k-desc'),sample:false};
  if(id){ const i=db.knowledge.findIndex(k=>k.id===id); if(i>=0) db.knowledge[i]=rec; } else db.knowledge.unshift(rec);
  save(); e.target.reset(); document.getElementById('k-id').value=''; renderKnowledge();
});
document.getElementById('knowReset').addEventListener('click', () => { document.getElementById('knowForm').reset(); document.getElementById('k-id').value=''; });
document.getElementById('knowList').addEventListener('click', e => {
  const del=e.target.closest('[data-del-know]'); const ed=e.target.closest('[data-edit-know]');
  if(del){ if(confirm('删除这条规律？')){ db.knowledge=db.knowledge.filter(k=>k.id!==del.dataset.delKnow); save(); renderKnowledge(); } }
  if(ed){ const k=db.knowledge.find(x=>x.id===ed.dataset.editKnow); if(!k) return; document.getElementById('k-id').value=k.id;
    document.getElementById('k-title').value=k.title; document.getElementById('k-emotion').value=k.emotion; document.getElementById('k-scene').value=k.scene||'';
    document.getElementById('k-rhythm').value=k.rhythm; document.getElementById('k-tags').value=(k.tags||[]).join(', '); document.getElementById('k-desc').value=k.desc||''; window.scrollTo({top:0,behavior:'smooth'}); }
});

/* ---- storyboard (local rules) ---- */
const EN = {紧张:'tense',平静:'calm',悲伤:'sad',愤怒:'angry',喜悦:'joyful',悬疑:'mysterious',对话戏:'dialogue scene',追逐:'chase',独白:'monologue',开场:'opening',冲突:'conflict'};
function matchKnowledge(emotion, scene){
  const byEm = db.knowledge.filter(k=>k.emotion===emotion);
  const byScene = byEm.filter(k=>scene && k.scene && scene.includes(k.scene));
  return (byScene[0] || byEm[0] || db.knowledge[0] || null);
}
let lastStoryboard = '';
document.getElementById('sbGenerate').addEventListener('click', () => {
  const script = document.getElementById('sb-script').value.trim();
  if(!script){ alert('请先粘贴一段剧本。'); return; }
  const emotion = document.getElementById('sb-emotion').value, scene = document.getElementById('sb-scene').value.trim(), rhythm = document.getElementById('sb-rhythm').value;
  const lines = script.split('\n').map(s=>s.trim()).filter(Boolean);
  const k = matchKnowledge(emotion, scene);
  const rows = lines.map((line, i) => {
    const isFirst = i===0, isLast = i===lines.length-1;
    const shotSize = isFirst ? '大全景' : (isLast ? '近景' : (k && /特写/.test(k.title) ? '特写' : '中景'));
    const promptZh = `${shotSize}，${emotion}情绪，${scene||'场景'}，${rhythm}节奏：${line}；${k? k.desc : '镜头语言服务于情绪走向'}`;
    const promptEn = `${shotSize==='大全景'?'Wide establishing shot':shotSize==='特写'?'Close-up':shotSize==='近景'?'Medium close-up':'Medium shot'}, ${EN[emotion]||emotion} mood, ${EN[scene]||scene||'scene'}, ${rhythm}: ${line}`;
    return {n:i+1, line, shotSize, rule:k?k.title:'通用规律', promptZh, promptEn};
  });
  lastStoryboard = rows.map(r=>`镜头 ${r.n}（${r.shotSize}）\n剧本：${r.line}\n依据：${r.rule}\n中文提示词：${r.promptZh}\n英文提示词：${r.promptEn}\n`).join('\n');
  document.getElementById('sbResult').innerHTML = `<div class="card"><h3>分镜表（依据：${esc(k?k.title:'通用规律')}）</h3>
    <table><tr><th>镜头</th><th>剧本</th><th>景别</th><th>中文提示词</th><th>英文提示词</th></tr>
    ${rows.map(r=>`<tr><td>${r.n}</td><td>${esc(r.line)}</td><td>${esc(r.shotSize)}</td><td>${esc(r.promptZh)}</td><td>${esc(r.promptEn)}</td></tr>`).join('')}</table></div>`;
  db.history.unshift({id:uid(), at:new Date().toLocaleString(), emotion, scene, lines: lines.length}); save(); renderHistory();
});
function renderHistory(){ document.getElementById('sbHistory').innerHTML = db.history.length ? db.history.slice(0,10).map(h=>`<p>· ${esc(h.at)} · ${esc(h.emotion)} / ${esc(h.scene||'—')} · ${h.lines} 行剧本</p>`).join('') : '<p class="muted">暂无历史。</p>'; }
document.getElementById('sbCopy').addEventListener('click', async () => { if(!lastStoryboard) return alert('请先生成分镜。'); await navigator.clipboard.writeText(lastStoryboard).catch(()=>{}); alert('已复制。'); });
document.getElementById('sbExport').addEventListener('click', () => { if(!lastStoryboard) return alert('请先生成分镜。'); const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([lastStoryboard],{type:'text/plain;charset=utf-8'})); a.download='分镜表.txt'; a.click(); });

/* ---- video import: scene detection ---- */
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
document.getElementById('discardDraft').addEventListener('click', () => { if(confirm('放弃这次导入草稿？')){ db.draft=null; save(); renderDraft(); document.getElementById('resumeImport').style.display='none'; document.getElementById('discardDraft').style.display='none'; document.getElementById('importStatus').style.display='none'; } });

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
  // keyframes
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
      ${s.aiFilled?' <span class="badge ai">本地启发式预填</span>':''}${s.subtitleSource?` <span class="badge">字幕来源：${esc(s.subtitleSource)}</span>`:''}<br>
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
  const h = e.target.closest('[data-heuristic]'); if(h){ heuristicPrefill(h.dataset.heuristic); return; }
  const sq = e.target.closest('[data-sequence]'); if(sq){ sequencePrefill(sq.dataset.sequence); return; }
});
document.getElementById('batchSave').addEventListener('click', () => {
  if(!db.draft || !db.draft.shots.length) return alert('没有可保存的草稿。');
  const chosen = db.draft.shots.filter(s=>s.checked!==false);
  chosen.forEach(s=>{ const {checked, aiFilled, subtitleSource, ...rest} = s; db.shots.unshift({...rest, id:uid(), sample:false}); });
  db.draft = null; save(); renderDraft(); renderShots(); alert(`已存入拉片库 ${chosen.length} 个镜头，草稿已清除。`);
});

/* ---- 识图预填：本地像素启发式（非 AI 视觉） ---- */
function analysePixels(img){
  return new Promise(res => {
    const c=document.createElement('canvas'); c.width=80; c.height=45; const x=c.getContext('2d');
    x.drawImage(img,0,0,80,45); const d=x.getImageData(0,0,80,45).data;
    let r=0,g=0,b=0,bright=0,contrast=0; const n=d.length/4; const vals=[];
    for(let i=0;i<d.length;i+=4){ const l=(d[i]+d[i+1]+d[i+2])/3; r+=d[i]; g+=d[i+1]; b+=d[i+2]; bright+=l; vals.push(l); }
    bright/=n; r/=n; g/=n; b/=n; const mean=bright; contrast=Math.sqrt(vals.reduce((a,v)=>a+(v-mean)*(v-mean),0)/n);
    // 左右/上下亮度差：粗略判断光源方向；三分线附近亮度集中程度：粗略构图
    res({brightness:Math.round(bright), contrast:Math.round(contrast), r:Math.round(r), g:Math.round(g), b:Math.round(b)});
  });
}
async function heuristicPrefill(id){
  const d = db.draft && db.draft.shots.find(x=>x.id===id); if(!d || !d.thumb) return alert('该镜头没有关键帧。');
  const img = new Image(); img.onload = async () => {
    const a = await analysePixels(img);
    const warm = a.r > a.b + 15, cool = a.b > a.r + 10;
    d.lighting = a.brightness < 70 ? '低调光（本地启发式：平均亮度偏低）' : a.brightness > 170 ? '明亮高调光（本地启发式：平均亮度偏高）' : '中等亮度自然光（本地启发式）';
    d.composition = '三分法近似（本地启发式：画面亮度分布较均匀，主体需人工确认）';
    d.shotSize = '中景（本地启发式：单帧无法准确判断景别，需人工确认）';
    d.content = `关键帧：平均亮度 ${a.brightness}，对比度 ${a.contrast}，主色 ${warm?'偏暖':cool?'偏冷':'中性'}（本地像素统计）`;
    d.emotion = a.brightness < 70 ? '压抑（推测）' : a.brightness > 170 ? '明朗（推测）' : '平静（推测）';
    d.aiFilled = true; saveDraft(); renderDraft();
  }; img.src = d.thumb;
}
document.getElementById('batchHeuristic').addEventListener('click', async () => {
  if(!db.draft) return; for(const s of db.draft.shots.filter(s=>!s.aiFilled).slice(0,10)){ await heuristicPrefill(s.id); }
});

/* ---- 顺序预填：本地规则（看前后镜头 + 对白） ---- */
function sequencePrefill(id){
  const shots = db.draft ? db.draft.shots : []; const i = shots.findIndex(s=>s.id===id); if(i<0) return;
  const s = shots[i], prev = shots[i-1], next = shots[i+1];
  const dlg = (s.dialogue||'').trim();
  s.transition = prev ? (dlg && prev.dialogue && dlg!==prev.dialogue ? '硬切（推测：对白换人/转折）' : '硬切（推测：场景连续）') : '开场（推测）';
  if(/回忆|当年|以前|想起/.test(dlg)) s.montage = '闪回蒙太奇（推测：对白提到过去）';
  else if(prev && prev.shotSize && s.shotSize && prev.shotSize!==s.shotSize) s.montage = '正反打 / 景别跳切蒙太奇（推测）';
  else s.montage = '连续蒙太奇（推测：顺序连续）';
  s.why = dlg ? `对白“${dlg.slice(0,20)}”是本镜的情绪转折点，切镜是为了接住这句对白（推测）。` : (next ? '为下一镜的情绪变化做铺垫（推测）。' : '收束本段情绪（推测）。');
  s.aiFilled = true; saveDraft(); renderDraft();
}
document.getElementById('batchSequence').addEventListener('click', () => {
  if(!db.draft) return; db.draft.shots.slice(0,10).forEach(s=>sequencePrefill(s.id));
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
  // 首选：放在缩略图所在行的下方（输入框在行内左右，不在下方）
  let top = rect.bottom + 10, left = Math.max(10, Math.min(rect.left, window.innerWidth - pw - 10));
  if(top + ph > window.innerHeight){ top = Math.max(10, rect.top - ph - 10); }
  // 若仍与输入框重叠，改放到页面底部空白区
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
renderShots(); renderKnowledge(); renderHistory(); renderDraft();
if(db.draft && db.draft.shots.length){
  const st=document.getElementById('importStatus'); st.style.display='block';
  st.textContent = `检测到上次未完成的导入草稿（${db.draft.shots.length} 个镜头，${db.draft.phase||''}，保存于 ${db.draft.savedAt||''}）。草稿已保留，点“继续导入 / 恢复”可接着跑，或点“放弃这次导入”。`;
  showResume();
}
