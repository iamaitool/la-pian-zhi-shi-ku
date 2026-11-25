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

/* 提炼到知识库：用 AI 把一条拉片的字段写成一段连贯的视听语言规律描述。
   纯文本调用，不发图片。返回 {desc, tags, rhythm, why}。
   desc 是一段话（不是字段堆叠）：讲这条镜头用的景别、机位、运镜、构图和光线
   是怎么表现画面内容和人物动作的、传递了什么情绪、转场和蒙太奇在前后镜头间
   起到什么辅助作用，最后总括为什么这么用。只用已填字段，不编造没有的
   对白/背景音乐/音效，不照搬“待填写”占位；字段里明显不合理或自相矛盾的，
   按视听语言常识合理纠正、补全，同时保留原镜头的核心内容。
   rhythm 和 why 单独输出，供剧本转分镜加权匹配用：rhythm 只取 快/中/慢；
   why 是一句话的“为什么这么用”。注意：知识库表没有单独的 why 列，
   why 不单独存库，匹配时从 desc（已融进描述段落）+ 标题里读；rhythm
   存进已有的 rhythm 列。 */
async function extractKnowledge({ shot }) {
  const s = shot || {};
  const kv = (v) => { const t = String(v ?? '').trim(); return (t && t !== '待填写') ? t : ''; };
  const fields = [
    ['片名 / 场次', s.title], ['景别', s.shotSize], ['机位', s.camera],
    ['构图', s.composition], ['运镜', s.movement], ['光线', s.lighting],
    ['画面内容', s.content], ['人物动作', s.action], ['情绪', s.emotion],
    ['对白', s.dialogue], ['背景音乐', s.music], ['音效', s.sfx],
    ['转场方式', s.transition], ['蒙太奇运用', s.montage], ['为什么这样用', s.why],
  ].filter(([, v]) => kv(v)).map(([k, v]) => `${k}：${kv(v)}`);
  if (!fields.length) throw new Error('这条拉片没有已填字段，无法提炼');
  const text = await chatCompletions({
    messages: [
      { role: 'system', content: '你是电影拉片分析师，擅长把单条拉片提炼成视听语言知识库里的一条规律。只按提供的字段写，返回 JSON。' },
      {
        role: 'user',
        content: [
          '下面是一条拉片的全部已填字段。请把它提炼成一条视听语言知识库里的规律，用中文返回 JSON：{"desc":"…","tags":["…"],"rhythm":"快/中/慢","why":"…"}。',
          'desc 的要求：只写一段连贯的中文描述，不要分条，不要出现【画面】【声音】【衔接】【用意】这类分组标签；',
          '把这条镜头用的景别、机位、运镜、构图和光线是怎么表现画面内容和人物动作的、传递了什么情绪、以及前后镜头之间的转场和蒙太奇起到了什么辅助作用融进同一段话里，最后总括为什么这么用；',
          '严格以提供的字段为准，优先保留原镜头的核心内容；如果字段里有明显不合理或自相矛盾的地方，可以按视听语言常识合理纠正、补全，但不要凭空编造；',
          '只用已填的字段：没有的对白、背景音乐、音效不要写进描述里；不要照搬“待填写”这类占位文字。',
          'tags：最多 6 个，挑最有代表性的手法或情绪，如景别、运镜、蒙太奇、情绪。',
          'rhythm：判断这条规律整体的节奏快慢，只取 快、中、慢 之一：运镜或蒙太奇里有快速剪辑、短镜头、跳切等为快；长镜头、慢推、缓慢为慢；其余为中。',
          'why：为什么这么用，一句话，只按提供的字段提炼（优先用“为什么这样用”字段），不要编造。',
          '只返回 JSON，不要其他文字。',
          '拉片字段：' + fields.join('；'),
        ].join('\n'),
      },
    ],
  });
  const out = extractJson(text);
  const desc = typeof out.desc === 'string' ? out.desc.trim() : '';
  const tags = Array.isArray(out.tags)
    ? [...new Set(out.tags.map((t) => String(t).trim()).filter(Boolean))].slice(0, 6)
    : [];
  const rhythm = ['快', '中', '慢'].includes(out.rhythm) ? out.rhythm : '中';
  const why = typeof out.why === 'string' ? out.why.trim() : '';
  if (!desc) throw new Error('模型没有返回有效的规律描述');
  return { desc, tags, rhythm, why };
}

/* “为什么这样用”AI 总结（视频导入草稿镜头）：只按当前镜头已填的全部内容
   写一句总结，200 字以内。纯文本调用，不发图片。只用已填字段，不编造没有的
   对白/背景音乐/音效，不照搬“待填写”占位；已有“为什么这样用”内容时以它
   为准、改写得更凝练。没有本地模板兜底：AI 未配置时 chatCompletions 抛
   配置错误，由调用方返回 503 明确提示，绝不编造。 */
async function summarizeWhy({ shot }) {
  const s = shot || {};
  const kv = (v) => { const t = String(v ?? '').trim(); return (t && t !== '待填写') ? t : ''; };
  const fields = [
    ['景别', s.shotSize], ['机位', s.camera], ['构图', s.composition], ['运镜', s.movement],
    ['光线', s.lighting], ['画面内容', s.content], ['人物动作', s.action], ['情绪', s.emotion],
    ['对白', s.dialogue], ['背景音乐', s.music], ['音效', s.sfx],
    ['转场方式', s.transition], ['蒙太奇运用', s.montage], ['为什么这样用（已有内容）', s.why],
  ].filter(([, v]) => kv(v)).map(([k, v]) => `${k}：${kv(v)}`);
  if (!fields.length) throw new Error('这个镜头还没有填写任何内容，无法总结');
  const text = await chatCompletions({
    messages: [
      { role: 'system', content: '你是电影拉片分析师，只按提供的镜头内容写总结，返回 JSON。' },
      {
        role: 'user',
        content: [
          '下面是一条拉片镜头当前已填的全部内容。请用中文写一句“为什么这样用”，总结这条镜头为什么用这样的拍法，返回 JSON：{"summary":"…"}。',
          '要求：200 字以内；只根据下面提供的已填内容总结，不要编造没有的对白、背景音乐、音效；不要照搬“待填写”这类占位文字；',
          '如果已有“为什么这样用”内容，以它为准，帮它改写得更凝练准确，不要另起一套说法。',
          '只返回 JSON，不要其他文字。',
          '镜头内容：' + fields.join('；'),
        ].join('\n'),
      },
    ],
  });
  const out = extractJson(text);
  let summary = typeof out.summary === 'string' ? out.summary.trim() : '';
  if (!summary) throw new Error('模型没有返回有效的总结');
  if (summary.length > 200) summary = summary.slice(0, 200); /* 硬上限，保证 200 字以内 */
  return { summary };
}

/* 剧本转分镜：按提供的知识库规律生成分镜，每镜含中英文视频提示词。
   调用方（服务端）已先用 lib/match.js 给每行剧本按四维加权打分
   （情绪相同 +3、场景类型相同 +2、节奏匹配 +2、为什么相近 +3，满分 10 分），
   取每行得分最高的前几条作候选：candidates = {pool: [...], perLine: [[池编号...]]}，
   pool 里的每条含 title / emotion / scene / tempo / tags / desc / score / matched。
   模型只需在每行的候选里选最合适的一条作依据，并写一句话匹配原因；
   候选都不合适时 rule 写“通用规律”并在原因里写明。返回的每镜含 matchReason。 */
async function storyboard({ lines, emotion, sceneType, rhythm, candidates }) {
  const ls = Array.isArray(lines) ? lines.filter((l) => typeof l === 'string' && l.trim()) : [];
  if (!ls.length) throw new Error('剧本为空');
  const pool = (candidates && Array.isArray(candidates.pool)) ? candidates.pool : [];
  const perLine = (candidates && Array.isArray(candidates.perLine)) ? candidates.perLine : [];
  const poolText = pool.length
    ? pool.map((c, i) => `${i + 1}. 《${c.title || ''}》情绪：${c.emotion || '—'}；场景：${c.scene || '—'}；节奏：${c.tempo || '中'}；标签：${(c.tags || []).join('、') || '—'}；综合分：${c.score ?? '—'}/10；匹配上：${(c.matched || []).join('、') || '无'}；用法：${c.desc || ''}`).join('\n')
    : '（知识库为空，没有候选规律）';
  const linesText = ls.map((line, i) => {
    const idxs = Array.isArray(perLine[i]) ? perLine[i] : [];
    return `第 ${i + 1} 行：「${line}」候选规律编号：${idxs.length ? idxs.map((x) => x + 1).join('、') : '无'}`;
  }).join('\n');
  const text = await chatCompletions({
    messages: [
      { role: 'system', content: '你是分镜师。只使用用户提供的视听语言知识库规律来设计分镜；没有相关规律时用通用规律并说明。返回 JSON。' },
      {
        role: 'user',
        content: [
          '请把以下剧本按行（每行一个节拍）转成分镜表。',
          `情绪：${emotion || ''}；场景类型：${sceneType || ''}；节奏：${rhythm || ''}。`,
          '候选规律池（已按情绪/场景/节奏/为什么加权打分，情绪相同+3、场景相同+2、节奏匹配+2、为什么相近+3，满分10分；只列出每行得分最高的前几条）：',
          poolText,
          '各行与候选：',
          linesText,
          '要求：',
          '每行优先从它的候选规律编号里选最合适的一条作为依据（rule 写规律标题）；若候选都不合适，rule 写“通用规律”。',
          'matchReason 写一句话，说明这条规律为什么适合这行剧本，点出匹配上的维度（情绪/场景/节奏/为什么）；用通用规律时写明“知识库中没有匹配的规律，按通用经验生成”。',
          '每镜返回：n（序号）、line（原剧本行）、shotSize（景别）、rule（依据的知识库规律标题）、matchReason（匹配原因，一句话）、promptZh（中文视频提示词，含景别、情绪、运镜、光线）、promptEn（英文视频提示词）。',
          '只返回 JSON，格式：{"shots":[{"n":1,"line":"…","shotSize":"…","rule":"…","matchReason":"…","promptZh":"…","promptEn":"…"}]}。',
        ].join('\n'),
      },
    ],
  });
  const out = extractJson(text);
  if (!Array.isArray(out.shots)) throw new Error('模型返回格式不正确，缺少 shots');
  return out.shots.map((s, i) => ({
    n: s.n || i + 1,
    line: typeof s.line === 'string' ? s.line : ls[i] || '',
    shotSize: typeof s.shotSize === 'string' ? s.shotSize : '',
    rule: typeof s.rule === 'string' ? s.rule : '',
    matchReason: typeof s.matchReason === 'string' ? s.matchReason : '',
    promptZh: typeof s.promptZh === 'string' ? s.promptZh : '',
    promptEn: typeof s.promptEn === 'string' ? s.promptEn : '',
  }));
}

module.exports = { aiConfig, analyzeKeyframe, analyzeSequence, storyboard, extractKnowledge, summarizeWhy };
