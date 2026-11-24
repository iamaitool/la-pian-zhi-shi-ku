'use strict';
/* 剧本转分镜的参考匹配：加权打分（服务端 /api/ai/storyboard 与浏览器本地规则
   生成共用同一份逻辑；浏览器通过 /match.js 加载本文件，服务端 require 本文件）。
   权重：情绪相同 +3，场景类型相同 +2，节奏匹配 +2，为什么相近 +3（满分 10 分）。
   节奏：参考的快慢先看规律自身的 rhythm 字段（快/中/慢，或 快速/缓慢/渐紧/
   渐缓/平稳等旧值归一化），没有再从标签/用法说明里的快慢信号词推导；用户选的
   节奏结合该行在剧本里的位置换算成期望快慢（渐紧越往后越要快，渐缓反之）。
   为什么：剧本行与规律的“为什么”文本（标题 + 用法说明 + 标签）共享意图词
   或共享双字词。意图词不含 12 个纯情绪词（紧张/悬疑/温馨/悲伤/喜悦/浪漫/
   愤怒/恐惧/平静/压抑/震撼/孤独），情绪已单独计分，避免重复加分。
   注意：知识库没有单独的 why 列，“为什么”文本就是规律的标题 + 用法说明
   （提炼时 AI 已把“为什么这么用”融进描述段落里），匹配时直接读这两处。 */

var FAST_SIGNALS = ['快速剪辑', '短镜头', '跳切', '快节奏', '快切', '快速切换'];
var SLOW_SIGNALS = ['长镜头', '慢推', '缓慢', '长 take', '长take', '慢移', '慢摇'];

/* 意图词：手法要达到的效果（爆发/压迫/收紧/留白……），不是情绪本身。 */
var INTENT_WORDS = [
  '爆发', '压迫', '张力', '对峙', '冲突', '追逐', '逃离', '告白', '表白',
  '未知', '窒息', '释放', '释然', '争吵', '沉默', '对视', '犹豫', '害怕',
  '留白', '回忆', '闪回', '梦境', '逼近', '收紧', '转折', '崩溃', '失控',
  '试探', '隐瞒', '揭穿', '等待', '离别', '重逢', '危险', '躲藏', '秘密',
  '谎言', '真相', '选择', '放弃', '希望', '绝望', '无助', '救赎', '守护',
  '背叛', '信任', '怀疑', '误会', '道歉', '原谅', '复仇', '牺牲', '成长',
  '觉醒', '迷失', '寻找', '发现', '喘不过气', '拉开', '贴近', '疏离',
  '亲近', '拥抱', '告别', '启程', '归来', '高潮', '低落', '悬念',
];

/* 从一段文本的快慢信号词推导快慢：快信号多为快，慢信号多为慢，都没有为中。 */
function deriveTempo(text) {
  var t = String(text || '');
  var fast = 0, slow = 0, i;
  for (i = 0; i < FAST_SIGNALS.length; i++) if (t.indexOf(FAST_SIGNALS[i]) >= 0) fast++;
  for (i = 0; i < SLOW_SIGNALS.length; i++) if (t.indexOf(SLOW_SIGNALS[i]) >= 0) slow++;
  if (fast > slow) return '快';
  if (slow > fast) return '慢';
  return '中';
}

/* 把规律的 rhythm 归一化成 快/中/慢：先看字段本身（兼容 快速/缓慢/渐紧/
   渐缓/平稳等旧值），认不出来再从标签/用法说明/标题推导。 */
function normalizeTempo(k) {
  var r = String((k && k.rhythm) || '').trim();
  if (/快速|快|渐紧/.test(r)) return '快';
  if (/缓慢|慢|渐缓/.test(r)) return '慢';
  if (/中|平稳/.test(r)) return '中';
  var text = [((k && k.tags) || []).join(' '), (k && k.desc) || '', (k && k.title) || ''].join(' ');
  return deriveTempo(text);
}

/* 用户选的节奏 + 该行在剧本里的位置 → 期望快慢。
   渐紧：越往后越要快；渐缓：越往后越要慢；快速/缓慢：整段都要快/慢；平稳：中。 */
function desiredTempo(rhythm, lineIndex, lineCount) {
  var p = lineCount <= 1 ? 0.5 : lineIndex / (lineCount - 1);
  switch (String(rhythm || '')) {
    case '快速': return '快';
    case '缓慢': return '慢';
    case '渐紧': return p < 0.34 ? '慢' : (p < 0.67 ? '中' : '快');
    case '渐缓': return p < 0.34 ? '快' : (p < 0.67 ? '中' : '慢');
    case '平稳': return '中';
    default: return '中';
  }
}

/* 为什么相近：共享意图词 2 个以上 +3，1 个 +2；没有意图词时共享双字词
   3 个以上 +2，1–2 个 +1；否则 0。返回 {score, words}，words 供匹配原因展示。 */
function whyScore(line, whyText) {
  if (!line || !whyText) return { score: 0, words: [] };
  var shared = INTENT_WORDS.filter(function (w) {
    return line.indexOf(w) >= 0 && whyText.indexOf(w) >= 0;
  });
  if (shared.length >= 2) return { score: 3, words: shared.slice(0, 3) };
  if (shared.length === 1) return { score: 2, words: shared };
  var bigrams = function (s) {
    var t = String(s).replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
    var set = new Set();
    for (var i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
    return set;
  };
  var a = bigrams(line), b = bigrams(whyText), n = 0;
  a.forEach(function (g) { if (b.has(g)) n++; });
  if (n >= 3) return { score: 2, words: [] };
  if (n >= 1) return { score: 1, words: [] };
  return { score: 0, words: [] };
}

/* 对一条剧本行，给全部知识库规律打分并按分从高到低排。
   opts: {line, lineIndex, lineCount, emotion, sceneType, rhythm, knowledge}
   返回 [{item, score, matched: ['情绪','场景','节奏','为什么'], whyWords, tempo, want}] */
function scoreKnowledge(opts) {
  var o = opts || {};
  var line = String(o.line || '');
  var emotion = String(o.emotion || '');
  var sceneType = String(o.sceneType || '');
  var list = Array.isArray(o.knowledge) ? o.knowledge : [];
  var idx = typeof o.lineIndex === 'number' ? o.lineIndex : 0;
  var count = typeof o.lineCount === 'number' && o.lineCount > 0 ? o.lineCount : 1;
  var want = desiredTempo(o.rhythm, idx, count);
  var scored = list.map(function (k) {
    var score = 0;
    var matched = [];
    if (emotion && k.emotion && k.emotion === emotion) { score += 3; matched.push('情绪'); }
    var ks = String(k.scene || '').trim();
    if (sceneType && ks && (sceneType.indexOf(ks) >= 0 || ks.indexOf(sceneType) >= 0)) { score += 2; matched.push('场景'); }
    var tempo = normalizeTempo(k);
    if (tempo === want) { score += 2; matched.push('节奏'); }
    else if (tempo === '中' || want === '中') { score += 1; matched.push('节奏接近'); }
    var whyText = [k.title || '', k.desc || '', (k.tags || []).join(' ')].join(' ');
    var w = whyScore(line, whyText);
    score += w.score;
    if (w.score > 0) matched.push('为什么');
    return { item: k, score: score, matched: matched, whyWords: w.words, tempo: tempo, want: want };
  });
  scored.sort(function (a, b) { return b.score - a.score; });
  return scored;
}

function topCandidates(opts, n) {
  return scoreKnowledge(opts).slice(0, n || 4);
}

/* 把一条打分结果写成一句匹配原因，供分镜表“匹配原因”列展示。 */
function matchReasonText(s) {
  if (!s || !s.item) return '知识库没有匹配的规律，按通用经验生成';
  var parts = [];
  if (s.matched.indexOf('情绪') >= 0) parts.push('情绪相同');
  if (s.matched.indexOf('场景') >= 0) parts.push('场景相同');
  if (s.matched.indexOf('节奏') >= 0) parts.push('节奏匹配');
  else if (s.matched.indexOf('节奏接近') >= 0) parts.push('节奏接近');
  if (s.matched.indexOf('为什么') >= 0) {
    parts.push(s.whyWords && s.whyWords.length ? '为什么相近（' + s.whyWords.join('、') + '）' : '为什么相近');
  }
  if (!parts.length) return '综合分最高（' + s.score + ' 分），无单项完全匹配';
  return parts.join(' · ') + '（' + s.score + ' 分）';
}

var StoryMatch = {
  FAST_SIGNALS: FAST_SIGNALS,
  SLOW_SIGNALS: SLOW_SIGNALS,
  INTENT_WORDS: INTENT_WORDS,
  deriveTempo: deriveTempo,
  normalizeTempo: normalizeTempo,
  desiredTempo: desiredTempo,
  whyScore: whyScore,
  scoreKnowledge: scoreKnowledge,
  topCandidates: topCandidates,
  matchReasonText: matchReasonText,
};

if (typeof module !== 'undefined' && module.exports) module.exports = StoryMatch;
