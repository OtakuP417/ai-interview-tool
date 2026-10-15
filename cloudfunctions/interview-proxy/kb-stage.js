"use strict";
/**
 * kb-stage.js — 案例经验库的「动作阶段 + 场景」双维度分类
 *
 * 【为什么要有这个模块】2026-10-12 用户发现：棱镜签约主题下面混着跟棱镜无关的通用做法。
 * 量下来 69 张卡里只有 11 张（16%）的文本能自证自己属于所在组。根因两层：
 *   ① 归并判据挂错了地方 —— 跑在 row.topic（**报告主题**）上，一份报告只要求标题带"棱镜"，
 *      它下面所有做法被一起带走。判据该落在**卡片自身**。
 *   ② 只有一个"场景"维度 —— 而这些访谈产出的做法**约七成是跨场景通用招式**
 *      （致电/测额/约见/寒暄/算成本账/嫌费率处理/月度回访…），场景维度装不下它们。
 * 所以本模块一次判两件事：stage（客户旅程八阶段，**每条都有**）+ scene（只在真专属时才给）。
 *
 * 【设计三原则（与既有模块保持一致）】
 *   1. **受约束输出**：两个维度都从闭集里选，模型只能归类、不能造词，编不出不存在的内容。
 *   2. **内容锚校验**：要求模型原样回抄卡片标题，用标题反查下标 ——
 *      这类任务最容易出的错是**顺序错位**（第 3 条的结果写到第 4 条上），
 *      下标不可信、标题可信，所以以标题为准。
 *   3. **宁缺毋滥**：校验不过的条目直接丢弃（该卡 stage 为空），
 *      由调用方退回关键词判定 —— 绝不为了"填满"而塞一个猜的值。
 *
 * 零 npm 依赖；底层 chat 调用复用 tagger.callDeepseek。
 */

const kb = require("./kb");
const tagger = require("./tagger");

const STAGES = kb.STAGES;
const STAGE_NAMES = kb.STAGE_NAMES;
const GENERIC_SCENE = kb.GENERIC_SCENE;
const SCENE_NAMES = kb.TOPIC_GROUPS.map(function (g) { return g[0]; });

/* ───────────────────── 提示词 ───────────────────── */

/**
 * 注意：模板串里不能用 markdown 反引号（会终止字符串），用「」代替。
 *
 * ★ 提示词的两条硬约束（2026-10-12 实测踩过）：
 *   ① 输出必须是**对象** {"items":[...]} 而不是裸数组 —— tagger.parseJsonLoose
 *      只认对象（`!Array.isArray(v)`），返回裸数组会被判成解析失败。
 *   ② 【输出格式】要放在最前面。放在最后时模型先把两个维度都「推理」一遍再看格式，
 *      推理 token 容易吃满预算（实测 4000 不够，见 MAX_TOKENS 注释）。
 */
function buildStagePrompt(cards, ctx) {
  const c = ctx || {};
  const lines = [];

  lines.push("你是平安融易（融资担保/助贷）的业务训练编辑。");
  lines.push("任务：下面是一份访谈报告里提炼出来的若干条「做法」，给**每一条**打两个标签。");
  lines.push("");
  lines.push("【输出格式】只输出下面这个 JSON 对象，不要解释、不要代码块围栏：");
  lines.push('{"items":[{"i":0,"title":"（原样抄第 0 条的标题前 8 个字）","stage":"...","scene":"..."}]}');
  lines.push("items 里必须**每一条做法都有一项**，i 从 0 开始、与下面的编号一一对应，一条都不能漏、不能改顺序。");
  lines.push("");

  lines.push("【标签一 stage：动作阶段】这条做法发生在客户旅程的哪一段。");
  lines.push("从下面八个里选**恰好一个**，不能自造，也不能选两个：");
  STAGES.forEach(function (s) {
    lines.push("- " + s[0] + "：" + s[1]);
  });
  lines.push("判法：只看这条做法**主要**在解决哪个环节的问题。横跨多段时选它最核心的那一段。");
  lines.push("");

  lines.push("【标签二 scene：场景】这条做法是不是只在某个特定场景下才成立？");
  lines.push("从下面选一个，或者选「" + GENERIC_SCENE + "」：");
  lines.push("- " + SCENE_NAMES.join(" / "));
  lines.push("- " + GENERIC_SCENE);
  lines.push("★ 这是一次**纠偏**：原先知识库把做法按访谈主题归组，导致「棱镜签约」主题下");
  lines.push("  混进了大量跟棱镜无关的通用招式。所以要逐条独立判断。");
  lines.push("★ 事实上**大多数做法是放之四海皆准的通用招式**（打电话、约见面、寒暄、帮客户算成本账、");
  lines.push("  处理「嫌利息高」、月度回访、节日维护……），这类一律选「" + GENERIC_SCENE + "」。");
  lines.push("★ 只有当这条做法**离开那个场景就不成立、或明显只对那类客户有效**时，才选具体场景。");
  lines.push("  **宁可多选「" + GENERIC_SCENE + "」，也不要硬往场景上靠。**");
  lines.push("");

  lines.push("【重要背景】这份访谈的标题是「" + (c.topic || "（未填）") + "」。");
  lines.push("它只说明**这次访谈围绕什么聊**，**不代表**下面每条做法都属于这个场景。不要被标题带跑。");
  lines.push("");

  lines.push("【待分类的做法】");
  cards.forEach(function (card, i) {
    lines.push(i + ". 标题：" + card.title);
    const kv = [];
    Object.keys(card.fields || {}).forEach(function (k) {
      const v = String(card.fields[k] || "").trim();
      if (v) kv.push(kb.FIELD_LABELS[k] + "=" + v.slice(0, 60));
    });
    if (kv.length) lines.push("   要素：" + kv.join("；"));
    else if (card.body) lines.push("   内容：" + String(card.body).slice(0, 120));
  });

  return lines.join("\n");
}

/* ───────────────────── 结果解析 ───────────────────── */

/**
 * 解析模型输出。@see 提示词注释 ①：tagger.parseJsonLoose 不认裸数组，
 * 所以先走它，拿不到再自己补一个「方括号平衡扫描」的兜底 ——
 * 模型偶尔仍会忽略格式要求直接吐数组，没必要因此整份丢弃。
 */
function parseStageOutput(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const obj = tagger.parseJsonLoose(raw);
  if (obj) {
    if (Array.isArray(obj.items)) return obj.items;
    /* parseJsonLoose 扫到的是第一个 {} 块，可能是 items 里的一项而不是外层对象，
       这时从原文里找方括号块兜底（下面统一处理） */
  }

  /* 剥 ```json 围栏后抓第一个平衡的方括号块 */
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const src = fence && fence[1] ? fence[1].trim() : raw;
  const start = src.indexOf("[");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        try {
          const v = JSON.parse(src.slice(start, i + 1));
          if (Array.isArray(v)) return v;
        } catch (e) { /* 落回 null */ }
        break;
      }
    }
  }
  return null;
}

/* ───────────────────── 结果校验与对齐 ───────────────────── */

/* 归一化：去掉空白与常见标点，只留实义字符，用于标题比对 */
function normKey(s) {
  return String(s || "")
    .replace(/[\s，。、；：:！？!?（）()「」『』"'“”‘’…—\-·]/g, "")
    .trim();
}

/* 两条标题是否指向同一张卡：取共同前缀，≥6 个实义字符即认可 */
function titleMatches(a, b) {
  const x = normKey(a);
  const y = normKey(b);
  if (!x || !y) return false;
  const n = Math.min(x.length, y.length, 20);
  if (n < 6) return x === y;
  let k = 0;
  while (k < n && x[k] === y[k]) k++;
  return k >= 6;
}

/**
 * 把模型输出对齐到 cards 上。
 *
 * ★ 两遍制（2026-10-12 修）：初版只有「标题锚定」一遍，标题抄歪就整条丢弃；
 *   实测 #5（主题=房抵二押签约，6 张卡）连续 4 轮 matched=0 —— 除了 parseJsonLoose
 *   不认数组这个硬伤，标题抄歪也会被一票否决。改成：
 *     第一遍 标题锚定（优先，顺序错位也纠得回来）
 *     第二遍 位置兜底（标题没抄/抄歪，只要 i 合法且该位还没被占）
 *   位置兜底不是无条件信任下标 —— 它只在标题锚定没认领的位置上生效，
 *   所以「第 3 条的结果写到第 4 条上」这种情况下，标题能对上就仍以标题为准。
 *
 * @returns {{labels: Array<{stage,scene}|null>, matched, dropped, anchored, positional}}
 *   labels 与 cards **同长同序**；null 表示没判出来（调用方退回关键词判定）。
 */
function normalizeStageResult(parsed, cards) {
  const list = Array.isArray(cards) ? cards : [];
  const arr = Array.isArray(parsed)
    ? parsed
    : (parsed && Array.isArray(parsed.items) ? parsed.items : null);
  const labels = new Array(list.length).fill(null);

  let anchored = 0;
  let positional = 0;
  let dropped = 0;
  if (!arr) return { labels: labels, matched: 0, dropped: 0, anchored: 0, positional: 0 };

  /* 闭集校验 + 落位。返回 false 表示这条内容不合法（stage/scene 都不在词表里），
     调用方不要把它算成「成功」。 */
  const claim = function (idx, it) {
    const stage = STAGE_NAMES.indexOf(String(it.stage || "").trim()) >= 0
      ? String(it.stage).trim() : null;
    let scene = String(it.scene || "").trim();
    if (scene !== GENERIC_SCENE && SCENE_NAMES.indexOf(scene) < 0) scene = "";
    if (!stage && !scene) return false;
    labels[idx] = { stage: stage, scene: scene };
    return true;
  };

  const claimed = arr.map(function () { return false; });

  /* ── 第一遍：标题锚定 ── */
  arr.forEach(function (it, n) {
    if (!it || typeof it !== "object") return;
    const hits = [];
    list.forEach(function (card, k) {
      if (titleMatches(it.title, card.title)) hits.push(k);
    });
    const free = hits.filter(function (k) { return !labels[k]; });
    /* 标题指向唯一一张未被认领的卡 → 用它 */
    let pick = free.length === 1 ? free[0] : -1;
    /* 标题撞车（多张卡共用前缀）：退回下标，但下标必须落在撞车集合里 */
    if (pick < 0 && free.length > 1) {
      const i = Number(it.i);
      if (isFinite(i) && Math.floor(i) === i && free.indexOf(i) >= 0) pick = i;
    }
    if (pick >= 0 && claim(pick, it)) {
      claimed[n] = true;
      anchored++;
    }
  });

  /* ── 第二遍：位置兜底 ── */
  arr.forEach(function (it, n) {
    if (!it || typeof it !== "object") { dropped++; return; }
    if (claimed[n]) return;
    const i = Number(it.i);
    if (!isFinite(i) || Math.floor(i) !== i || i < 0 || i >= list.length) { dropped++; return; }
    if (labels[i]) { dropped++; return; }
    if (claim(i, it)) { positional++; return; }
    dropped++;
  });

  return {
    labels: labels,
    matched: anchored + positional,
    dropped: dropped,
    anchored: anchored,
    positional: positional,
  };
}

/* ───────────────────── 对外入口 ───────────────────── */

const DEFAULT_MODEL = "deepseek-chat";
/* ★ 2026-10-15 改为非推理模型：分类实测推理 token 起伏极大（4000–16000+），
   deepseek-v4-flash 推理 token 也计入 max_tokens 预算，导致 content 为空或 socket 超时。
   deepseek-chat 无推理开销，分类耗时稳定在 10–30s，与打标侧同步。
   （原注释保留供排障参考）
   原 deepseek-v4-flash 是推理模型，推理 token 也计入 max_tokens 预算。
   打标用 4000 够（输出只有几十个 token），但这里要逐条比对标题 + 判两个维度，
   实测推理 4000–8000+ token 起伏很大：给 4000 必被吃光（content 为空、finish_reason=length），
   给 8000 也仍有整份报告判不完的情况。所以给到 16000 留足余量。
   ★ 项目里 2026-10-10 记录过 16000 让模型返回空 content（stop）的现象 ——
     那是报告生成的长提示词场景；本模块 2026-10-12 用探针在 16000 下实测 finish_reason=stop
     且 content 正常，所以这里可用。若将来又出空 content，用 tests/tmp/probe-kb-stage.py 复测。 */
const MAX_TOKENS = 16000;
/* 一次分类的 socket 超时。要和上面的大预算配套：
   8000 token 的生成实测就要 50s 上下，16000 会到 100s+。
   （函数超时已相应放宽到 300s，见云函数配置） */
const STAGE_TIMEOUT_MS = 240000;

/**
 * 给一份报告的做法卡片打「动作阶段 + 场景」。
 *
 * 关于 retries：默认 **0**（函数内不重试）。一次真实调用几十秒到一百多秒，
 * 在函数里重试容易顶到函数超时；重试交给外层 —— 服务端按 kb_stages_at IS NULL
 * 或按 id 重扫，没跑成的报告下一轮自然还会被捞到。
 *
 * @param {Array}  cards   kb.js 解析出的卡片（需有 title / fields / body）
 * @param {object} ctx     { topic } 仅作背景，提示词里明确说了不许被它带跑
 * @param {object} opts    { apiKey, model, retries, maxTokens }
 * @returns {Promise<{labels, stages_model, matched, dropped, anchored, positional, parse_failed}>}
 */
function classifyCards(cards, ctx, opts) {
  const o = opts || {};
  const apiKey = o.apiKey;
  if (!apiKey) return Promise.reject(new Error("stage_no_api_key"));
  const list = Array.isArray(cards) ? cards : [];
  if (!list.length) return Promise.reject(new Error("stage_no_cards"));

  const model = o.model || DEFAULT_MODEL;
  const budget = typeof o.maxTokens === "number" && o.maxTokens > 0 ? o.maxTokens : MAX_TOKENS;
  const prompt = buildStagePrompt(list, ctx || {});
  const retries = typeof o.retries === "number" ? o.retries : 0;

  const attempt = function (left) {
    return tagger
      .callDeepseek(apiKey, prompt, model, budget, { timeoutMs: STAGE_TIMEOUT_MS })
      .catch(function (e) {
        const msg = String((e && e.message) || e);
        const retriable =
          msg.indexOf("tag_empty_content") === 0 ||
          msg === "tag_timeout" ||
          msg.indexOf("tag_bad_upstream_json") === 0;
        if (left > 0 && retriable) return attempt(left - 1);
        throw e;
      });
  };

  return attempt(retries).then(function (out) {
    const parsed = parseStageOutput(out.content);
    const r = normalizeStageResult(parsed, list);
    return {
      labels: r.labels,
      stages_model: out.model,
      matched: r.matched,
      dropped: r.dropped,
      anchored: r.anchored,
      positional: r.positional,
      /* 一条都没对上 —— 说明模型没按格式输出，调用方该当成失败而不是"分类完成" */
      parse_failed: r.matched === 0,
    };
  });
}

/**
 * 诊断探针：只调模型，**不写任何库**，把 finish_reason / usage / content 长度原样返回。
 *
 * 为什么需要它：「分类失败」在业务层只有一句错误，但有三种完全不同的成因 ——
 *   ① 推理 token 吃光预算（finish_reason=length、content 为空）
 *   ② 模型没按格式输出（content 有内容但解析不出）
 *   ③ 标题锚 + 位置兜底都对不上（解析出来了但 matched=0）
 * 修法各不相同，靠一句 tag_empty_content 定位不了。这个探针把区别摆出来。
 *
 * @returns {Promise<object>} 见下方字段
 */
function probeCards(cards, ctx, opts) {
  const o = opts || {};
  if (!o.apiKey) return Promise.reject(new Error("stage_no_api_key"));
  const list = Array.isArray(cards) ? cards : [];
  const prompt = buildStagePrompt(list, ctx || {});
  const budget = typeof o.maxTokens === "number" && o.maxTokens > 0 ? o.maxTokens : MAX_TOKENS;
  return tagger
    .callDeepseek(o.apiKey, prompt, o.model || DEFAULT_MODEL, budget,
      { raw: true, timeoutMs: STAGE_TIMEOUT_MS })
    .then(function (out) {
      const parsed = parseStageOutput(out.content);
      const r = normalizeStageResult(parsed, list);
      return {
        model: out.model,
        max_tokens: budget,
        finish_reason: out.finish_reason,
        usage: out.usage,
        content_len: String(out.content || "").length,
        reasoning_len: String(out.reasoning || "").length,
        content_head: String(out.content || "").slice(0, 600),
        cards: list.length,
        prompt_len: prompt.length,
        parsed_ok: !!parsed,
        matched: r.matched,
        anchored: r.anchored,
        positional: r.positional,
        dropped: r.dropped,
      };
    });
}

module.exports = {
  STAGES: STAGES,
  STAGE_NAMES: STAGE_NAMES,
  SCENE_NAMES: SCENE_NAMES,
  buildStagePrompt: buildStagePrompt,
  parseStageOutput: parseStageOutput,
  normalizeStageResult: normalizeStageResult,
  titleMatches: titleMatches,
  classifyCards: classifyCards,
  probeCards: probeCards,
  DEFAULT_MODEL: DEFAULT_MODEL,
  MAX_TOKENS: MAX_TOKENS,
  STAGE_TIMEOUT_MS: STAGE_TIMEOUT_MS,
};
