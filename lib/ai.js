'use strict';
/* AI 层（只在服务端使用）。
   调用 DeepSeek 兼容的 Chat Completions API：
   POST {AI_BASE_URL}/chat/completions
   模型来自 AI_MODEL，密钥来自 AI_API_KEY（绝不发给浏览器）。
   默认超时 30 秒；识图（vision）调用放宽到 60 秒。
   未配置时抛出配置错误，由调用方返回明确提示，绝不编造结果。 */

const TIMEOUT_MS = 30000;

function aiConfig() {
  const baseUrl = (process.env.AI_BASE_URL || '').replace(/\/+$/, '');
  const apiKey = process.env.AI_API_KEY || '';
  const model = process.env.AI_MODEL || '';
  return { baseUrl, apiKey, model, configured: Boolean(baseUrl && apiKey && model) };
}

function configError() {
  const e = new Error('AI 未配置，请在 Render 环境变量里设置 AI_API_KEY / AI_BASE_URL / AI_MODEL');
  e.code = 'AI_NOT_CONFIGURED';
  return e;
}

/* 从模型返回中尽量解析出 JSON：先直接解析，失败则取第一个 { ... } 片段。 */
function extractJson(text) {
  if (!text) throw new Error('模型返回为空');
  try { return JSON.parse(text); } catch (_) { /* fall through */ }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch (_) { /* fall through */ }
  }
  throw new Error('模型返回不是合法 JSON：' + text.slice(0, 200));
}

async function chatCompletions({ messages, responseFormatJson = true, timeoutMs = TIMEOUT_MS }) {
  const cfg = aiConfig();
  if (!cfg.configured) throw configError();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body = { model: cfg.model, messages, temperature: 0.2 };
    if (responseFormatJson) body.response_format = { type: 'json_object' };
    const res = await fetch(cfg.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + cfg.apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`AI 接口返回 HTTP ${res.status}：${text.slice(0, 300)}`);
      err.code = 'AI_UPSTREAM_ERROR';
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) throw new Error('AI 接口返回中没有内容');
    return typeof content === 'string' ? content : JSON.stringify(content);
  } catch (err) {
    if (err.name === 'AbortError') {
      const e = new Error(`AI 接口超时（${timeoutMs / 1000} 秒），请稍后重试`);
      e.code = 'AI_TIMEOUT';
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/* 识图预填：把关键帧图片发给模型（需要配置的模型支持 vision / image_url）。
   若模型不支持图片，会返回明确错误，绝不编造。 */
async function analyzeKeyframe({ imageDataUrl, shotContext }) {
  if (!imageDataUrl || !imageDataUrl.startsWith('data:image/')) {
    throw new Error('关键帧图片格式不支持，无法识图预填');
  }
  const prompt = [
    '你是一位电影拉片分析师。请只根据这张电影关键帧画面，判断以下字段，用中文回答，返回 JSON：',
    'shotSize（景别：特写/近景/中景/全景/远景/大远景/过肩特写等）、camera（机位：平视/仰拍/俯拍/过肩/低机位等，大概角度和高低）、',
    'composition（构图：三分法/对称/框式/居中/引导线等）、lighting（光线：硬光/柔光/低调/逆光/暖色/冷色等）、',
    'content（画面内容：一句话描述画面里有什么）、action（人物动作）、emotion（情绪，推测，值后面要带“（推测）”）。',
    '只填画面里能直接看到的内容；看不出来的不要编造，留空字符串。',
    '只返回 JSON，不要其他文字。',
    shotContext ? '镜头上下文：' + shotContext : '',
  ].join('\n');
  let text;
  try {
    text = await chatCompletions({
      timeoutMs: 60000, /* 识图要传图片、模型看图更慢，超时放宽到 60 秒 */
      messages: [
        { role: 'system', content: '你是电影拉片分析师，只按画面事实回答，返回 JSON。' },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        },
      ],
    });
  } catch (err) {
    const msg = String((err && err.message) || err);
    if (/400|invalid|image|vision|unsupported|不支持/.test(msg)) {
      const e = new Error('当前配置的模型不支持图片识别（vision），请换一个支持图片的模型，或改用手动填写。原始错误：' + msg.slice(0, 200));
      e.code = 'AI_VISION_UNSUPPORTED';
      throw e;
    }
    throw err;
  }
  const out = extractJson(text);
  const pick = (k) => (typeof out[k] === 'string' ? out[k] : '');
  return {
    shotSize: pick('shotSize'),
    camera: pick('camera'),
    composition: pick('composition'),
    lighting: pick('lighting'),
    content: pick('content'),
    action: pick('action'),
    emotion: pick('emotion'),
  };
}

/* 顺序预填：看前后镜头、镜头顺序和对白，推测转场、蒙太奇和为什么这样用（均为推测）。
   纯文本调用，不发任何图片。调用方只传一个小窗口（目标镜头前后各 2 个邻居，
   最多 5 条摘要），targetIndices 指定本次要返回结果的镜头编号（用摘要里的 index），
   避免一次让模型生成几十上百条结果导致超时。 */
async function analyzeSequence({ shots, targetIndices }) {
  if (!Array.isArray(shots) || shots.length === 0) throw new Error('没有可分析的镜头');
  const targets = Array.isArray(targetIndices) && targetIndices.length ? targetIndices : null;
  const summary = shots.map((s, i) => ({
    index: (typeof s.index === 'number' ? s.index : i + 1),
    start: s.start || '',
    duration: s.duration ?? '',
    shotSize: s.shotSize || '',
    camera: s.camera || '',
    content: s.content || '',
    action: s.action || '',
    emotion: s.emotion || '',
    dialogue: s.dialogue || '',
  }));
  const text = await chatCompletions({
    messages: [
      { role: 'system', content: '你是电影拉片分析师。所有转场、蒙太奇和“为什么这样用”都是推测，要标明“（推测）”。返回 JSON。' },
      {
        role: 'user',
        content: [
          targets
            ? '下面是按时间顺序排列的一段镜头的关键信息（可能含对白）。请只为以下编号的镜头推测转场、蒙太奇和为什么这样用（编号按下面列表里的 index）：' + targets.join('、') + '。'
            : '下面是按时间顺序排列的一段镜头的关键信息（可能含对白）。请为每个镜头推测：',
          'transition（转场方式：硬切/叠化/淡入淡出/匹配剪辑/跳切等，结合前后画面和对白判断）、',
          'montage（蒙太奇运用：正反打/平行蒙太奇/闪回蒙太奇/情绪蒙太奇/连续蒙太奇等）、',
          'why（为什么这样用：一句话，结合对白和情绪走向说明）。',
          '不要编造听不到的背景音乐和音效。只返回 JSON，格式：{"results":[{"index":1,"transition":"…（推测）","montage":"…（推测）","why":"…（推测）"}]}。',
          '镜头列表：' + JSON.stringify(summary),
        ].join('\n'),
      },
    ],
  });
  const out = extractJson(text);
  if (!Array.isArray(out.results)) throw new Error('模型返回格式不正确，缺少 results');
  return out.results.map((r) => ({
    index: r.index,
    transition: typeof r.transition === 'string' ? r.transition : '',
    montage: typeof r.montage === 'string' ? r.montage : '',
    why: typeof r.why === 'string' ? r.why : '',
  }));
}

/* 剧本转分镜：按提供的知识库规律生成分镜，每镜含中英文视频提示词。 */
async function storyboard({ script, emotion, sceneType, rhythm, knowledge }) {
  if (!script || !script.trim()) throw new Error('剧本为空');
  const lines = script.split('\n').map((s) => s.trim()).filter(Boolean);
  const text = await chatCompletions({
    messages: [
      { role: 'system', content: '你是分镜师。只使用用户提供的视听语言知识库规律来设计分镜；没有相关规律时用通用规律并说明。返回 JSON。' },
      {
        role: 'user',
        content: [
          '请把以下剧本按行（每行一个节拍）转成分镜表。',
          `情绪：${emotion || ''}；场景类型：${sceneType || ''}；节奏：${rhythm || ''}。`,
          '视听语言知识库（优先使用）：' + JSON.stringify(knowledge || []),
          '每镜返回：line（原剧本行）、shotSize（景别）、rule（依据的知识库规律标题）、promptZh（中文视频提示词，含景别、情绪、运镜、光线）、promptEn（英文视频提示词）。',
          '只返回 JSON，格式：{"shots":[{"n":1,"line":"…","shotSize":"…","rule":"…","promptZh":"…","promptEn":"…"}]}。',
          '剧本：' + JSON.stringify(lines),
        ].join('\n'),
      },
    ],
  });
  const out = extractJson(text);
  if (!Array.isArray(out.shots)) throw new Error('模型返回格式不正确，缺少 shots');
  return out.shots.map((s, i) => ({
    n: s.n || i + 1,
    line: typeof s.line === 'string' ? s.line : lines[i] || '',
    shotSize: typeof s.shotSize === 'string' ? s.shotSize : '',
    rule: typeof s.rule === 'string' ? s.rule : '',
    promptZh: typeof s.promptZh === 'string' ? s.promptZh : '',
    promptEn: typeof s.promptEn === 'string' ? s.promptEn : '',
  }));
}

module.exports = { aiConfig, analyzeKeyframe, analyzeSequence, storyboard };
