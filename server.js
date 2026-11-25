'use strict';
/* 拉片知识库 — Render + Neon + DeepSeek 全栈版
   启动：node server.js（端口取 process.env.PORT，默认 3000）
   环境变量（见 .env.example）：AI_API_KEY / AI_BASE_URL / AI_MODEL、
   DATABASE_URL（Neon Postgres，池化连接串）。
   AI 密钥只在服务端使用，绝不发给浏览器。 */
const path = require('path');
const express = require('express');
const store = require('./lib/store');
const ai = require('./lib/ai');
const match = require('./lib/match');

const app = express();
/* 50mb：590 个镜头的草稿（含关键帧 data URL）一次 PUT 可能超过 10mb；
   单人自用部署，服务端只做 JSON 解析，不存文件。 */
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function aiErrorResponse(res, err) {
  if (err && err.code === 'AI_NOT_CONFIGURED') return res.status(503).json({ error: err.message });
  if (err && err.code === 'AI_VISION_UNSUPPORTED') return res.status(400).json({ error: err.message });
  if (err && err.code === 'AI_TIMEOUT') return res.status(504).json({ error: err.message });
  return res.status(502).json({ error: (err && err.message) || 'AI 调用失败' });
}

/* ---- 健康检查：只返回是否已配置，不返回任何密钥值 ---- */
app.get('/api/health', (req, res) => {
  res.json({ ok: true, aiConfigured: ai.aiConfig().configured, neonConfigured: store.configured });
});

/* ---- 拉片 CRUD ---- */
app.get('/api/shots', asyncHandler(async (req, res) => res.json(await store.list('shots'))));
app.post('/api/shots', asyncHandler(async (req, res) => res.status(201).json(await store.create('shots', req.body || {}))));
app.put('/api/shots/:id', asyncHandler(async (req, res) => {
  const out = await store.update('shots', req.params.id, req.body || {});
  if (!out) return res.status(404).json({ error: '镜头不存在' });
  res.json(out);
}));
app.delete('/api/shots/:id', asyncHandler(async (req, res) => { await store.remove('shots', req.params.id); res.json({ ok: true }); }));
app.post('/api/shots/batch', asyncHandler(async (req, res) => {
  const items = Array.isArray(req.body && req.body.shots) ? req.body.shots : [];
  const created = [];
  for (const item of items) created.push(await store.create('shots', item));
  res.status(201).json(created);
}));
app.post('/api/clear-samples', asyncHandler(async (req, res) => {
  await store.clearSamples('shots');
  await store.clearSamples('knowledge_items');
  res.json({ ok: true });
}));

/* ---- 知识库 CRUD ---- */
app.get('/api/knowledge', asyncHandler(async (req, res) => res.json(await store.list('knowledge_items'))));
app.post('/api/knowledge', asyncHandler(async (req, res) => res.status(201).json(await store.create('knowledge_items', req.body || {}))));
app.put('/api/knowledge/:id', asyncHandler(async (req, res) => {
  const out = await store.update('knowledge_items', req.params.id, req.body || {});
  if (!out) return res.status(404).json({ error: '规律不存在' });
  res.json(out);
}));
app.delete('/api/knowledge/:id', asyncHandler(async (req, res) => { await store.remove('knowledge_items', req.params.id); res.json({ ok: true }); }));

/* ---- 分镜历史 ---- */
app.get('/api/storyboards', asyncHandler(async (req, res) => res.json(await store.list('storyboards'))));
app.post('/api/storyboards', asyncHandler(async (req, res) => res.status(201).json(await store.create('storyboards', req.body || {}))));
app.delete('/api/storyboards/:id', asyncHandler(async (req, res) => { await store.remove('storyboards', req.params.id); res.json({ ok: true }); }));

/* ---- AI：识图预填（关键帧） ---- */
app.post('/api/ai/analyze-keyframe', asyncHandler(async (req, res) => {
  try {
    const out = await ai.analyzeKeyframe({ imageDataUrl: req.body && req.body.imageDataUrl, shotContext: req.body && req.body.shotContext });
    res.json(out);
  } catch (err) { aiErrorResponse(res, err); }
}));

/* ---- AI：顺序预填（转场 / 蒙太奇 / 为什么） ----
   只接受小窗口摘要 + targetIndices（目标镜头编号），不接受整批镜头，
   避免一次生成几十上百条结果导致超时。 */
app.post('/api/ai/analyze-sequence', asyncHandler(async (req, res) => {
  try {
    const out = await ai.analyzeSequence({ shots: req.body && req.body.shots, targetIndices: req.body && req.body.targetIndices });
    res.json({ results: out });
  } catch (err) { aiErrorResponse(res, err); }
}));

/* ---- AI：提炼到知识库（单条拉片 → 一段连贯的规律描述） ---- */
app.post('/api/ai/extract-knowledge', asyncHandler(async (req, res) => {
  try {
    const out = await ai.extractKnowledge({ shot: req.body && req.body.shot });
    res.json(out);
  } catch (err) { aiErrorResponse(res, err); }
}));

/* ---- AI：“为什么这样用”总结（视频导入草稿镜头） ----
   只按镜头当前已填的全部内容总结，200 字以内；AI 未配置时返回 503 明确提示，
   不编造、不做本地模板兜底。 */
app.post('/api/ai/summarize-why', asyncHandler(async (req, res) => {
  try {
    const shot = (req.body && req.body.shot) || {};
    const filled = Object.values(shot).some((v) => { const t = String(v ?? '').trim(); return t && t !== '待填写'; });
    if (!filled) return res.status(400).json({ error: '这个镜头还没有填写任何内容，无法总结' });
    const out = await ai.summarizeWhy({ shot });
    res.json(out);
  } catch (err) { aiErrorResponse(res, err); }
}));

/* ---- 视频导入草稿（服务端持久化，Neon import_drafts 表，单人用只存一条） ----
   草稿只在用户手动清除或批量存入拉片库时删除；其它任何时候（刷新、换设备、
   换浏览器）下次打开都从服务端恢复同样的镜头和数量。 */
/* Neon 免费额度：1 GB Postgres 存储 / 项目（2026-10-02 起由 0.5 GB 上调，
   20 GB 跨项目总计），见 neon.com/docs/introduction/plans。单份草稿上限
   50 MB 只是该额度的约 5%，留足余量。 */
const NEON_FREE_LIMIT_MB = 1024;
const DRAFT_MAX_BYTES = 50 * 1024 * 1024;
app.get('/api/import-drafts/current', asyncHandler(async (req, res) => {
  res.json(await store.getDraft());
}));
app.put('/api/import-drafts/current', asyncHandler(async (req, res) => {
  const draft = req.body || {};
  if (!Array.isArray(draft.shots)) return res.status(400).json({ error: '草稿格式不正确（缺少镜头列表）' });
  const size = Buffer.byteLength(JSON.stringify(draft), 'utf8');
  if (size > DRAFT_MAX_BYTES) return res.status(413).json({ error: `草稿太大（约 ${(size / 1048576).toFixed(1)} MB，超过 50 MB 上限），未保存到服务器；本机缓存仍保留，请分段存入拉片库后清除草稿再继续。` });
  res.json(await store.saveDraft(draft));
}));
app.delete('/api/import-drafts/current', asyncHandler(async (req, res) => {
  await store.deleteDraft();
  res.json({ ok: true });
}));

/* ---- 数据库用量：pg_database_size，供导入页显示“已用 X MB / 免费额度 1024 MB” ---- */
app.get('/api/db-size', asyncHandler(async (req, res) => {
  const bytes = await store.getDbSize();
  if (bytes === null) return res.json({ available: false });
  res.json({ available: true, bytes, mb: +(bytes / 1048576).toFixed(1), limitMb: NEON_FREE_LIMIT_MB });
}));

/* ---- 匹配逻辑：浏览器加载同一份 lib/match.js，本地规则生成与服务端共用加权打分 ---- */
app.get('/match.js', (req, res) => res.sendFile(path.join(__dirname, 'lib', 'match.js')));

/* ---- AI：剧本转分镜 ----
   先在服务端用 lib/match.js 给每行剧本按四维加权打分（情绪+3、场景+2、节奏+2、
   为什么+3），取每行得分最高的前 4 条作候选（候选池按标题去重），再交给 AI
   从候选里选最合适的一条并写一句话匹配原因。AI 未配置时 ai.storyboard 会
   抛配置错误，返回 503 明确提示，不生成、不编造。 */
app.post('/api/ai/storyboard', asyncHandler(async (req, res) => {
  try {
    const body = req.body || {};
    const lines = String(body.script || '').split('\n').map((s) => s.trim()).filter(Boolean);
    if (!lines.length) return res.status(400).json({ error: '剧本为空' });
    const knowledge = Array.isArray(body.knowledge) ? body.knowledge : [];
    const pool = [];
    const poolKey = new Map();
    const perLine = lines.map((line, i) => {
      const top = match.topCandidates(
        { line, lineIndex: i, lineCount: lines.length, emotion: body.emotion, sceneType: body.sceneType, rhythm: body.rhythm, knowledge },
        4,
      );
      return top.map((t) => {
        const key = String((t.item && t.item.id) || t.item.title || '');
        if (!poolKey.has(key)) {
          poolKey.set(key, pool.length);
          pool.push({
            title: t.item.title || '', emotion: t.item.emotion || '', scene: t.item.scene || '',
            tempo: t.tempo, tags: t.item.tags || [], desc: t.item.desc || '',
            score: t.score, matched: t.matched, whyWords: t.whyWords,
          });
        }
        return poolKey.get(key);
      });
    });
    const out = await ai.storyboard({
      lines, emotion: body.emotion, sceneType: body.sceneType, rhythm: body.rhythm,
      candidates: { pool, perLine },
    });
    res.json({ shots: out });
  } catch (err) { aiErrorResponse(res, err); }
}));

/* ---- 兜底：SPA 入口 ---- */
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

/* 请求体超过 50mb 上限（body-parser 在路由处理前拦截）：返回明确的 413，
   而不是通用的 500，让客户端显示“草稿太大，未保存到服务器”。 */
/* eslint-disable-next-line no-unused-vars */
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: '草稿太大（超过 50 MB 上限），未保存到服务器；本机缓存仍保留，请分段存入拉片库后清除草稿再继续。' });
  }
  return next(err);
});

/* eslint-disable-next-line no-unused-vars */
app.use((err, req, res, next) => {
  console.error('[server]', err);
  res.status(500).json({ error: (err && err.message) || '服务器错误' });
});

const PORT = Number(process.env.PORT) || 3000;
store.seedIfEmpty().catch((e) => console.error('[store] 示例数据写入失败：', e.message));
app.listen(PORT, () => {
  console.log(`[server] 拉片知识库已启动，端口 ${PORT}`);
  console.log(`[server] AI 已配置：${ai.aiConfig().configured}（模型名不打印密钥）`);
  console.log(`[server] Neon 已配置：${store.configured}`);
});
