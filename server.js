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

const app = express();
app.use(express.json({ limit: '10mb' }));
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

/* ---- AI：剧本转分镜 ---- */
app.post('/api/ai/storyboard', asyncHandler(async (req, res) => {
  try {
    const out = await ai.storyboard({
      script: req.body && req.body.script,
      emotion: req.body && req.body.emotion,
      sceneType: req.body && req.body.sceneType,
      rhythm: req.body && req.body.rhythm,
      knowledge: req.body && req.body.knowledge,
    });
    res.json({ shots: out });
  } catch (err) { aiErrorResponse(res, err); }
}));

/* ---- 兜底：SPA 入口 ---- */
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

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
