/**
 * tagger.js — 归档时的「主题回归 + 自动打标」
 *
 * 为什么放在服务端而不是前端：
 *   ① 打标依据必须是**已归档的报告正文**，前端手里那份可能还被用户改过；
 *   ② 旧数据要能批量补跑，逻辑必须能被脚本直接 require；
 *   ③ 打标结果要写回库，只有服务端持有 CLOUDBASE_APIKEY。
 *
 * 设计要点（与用户确认过的三条）：
 *   1. 固定词表 + 自由补充：模型先从 TAXONOMY 里选，选不到才新造并加「自由:」前缀，
 *      人工在管理端一眼能看出哪些是新词、需要归并。
 *   2. 归档时自动打：调用方（handleSubmit）拿到归档 id 后 fire-and-forget，
 *      失败只记日志，绝不影响已成功的归档。
 *   3. 原文保留：只写 ai_topic / tags / tags_model / tags_at，
 *      绝不覆盖 topic（运营岗口述原文），两相对照才能看出「口述 vs 实际」的偏差。
 *
 * 零 npm 依赖（云函数 256MB 内存约束 + 免打包），只用 Node 内置 https。
 */

const https = require("https");

/* ───────────────────────── 固定词表 ───────────────────────── */

/**
 * 五个维度全部来自对线上 9 份报告正文的实际归纳，不是凭空设计：
 *   获客方式 / 产品类型 / 客户来源 / 客户阶段 / 关键能力
 * 每个维度给 4-8 个取值。模型必须优先从这里选；
 * 实在没有合适的才新造，并以「自由:」开头，等人工归并进词表。
 */
const TAXONOMY = {
  获客方式: [
    "老客户转介绍",
    "主动请托转介绍",
    "陌拜电销",
    "孤儿单盘活",
    "存量客户再营销",
    "老关系激活",
    "同业转接",
    "网点到店",
  ],
  产品类型: ["棱镜", "陆易花薪", "易贷", "房抵二押", "车抵", "其他"],
  客户来源: [
    "自营老客户",
    "他人转介绍",
    "孤儿单",
    "名单电销",
    "转接转化",
    "存量到期",
  ],
  客户阶段: [
    "新手破冰期",
    "额度异议期",
    "进件卡点期",
    "犹豫拖延期",
    "已成交维护期",
    "二次开发期",
  ],
  关键能力: [
    "费率谈判",
    "需求转接挖潜",
    "信任背书借用",
    "行业节奏把握",
    "长期关系保温",
    "快速触达",
    "异议处理",
    "资料补正",
  ],
};

const DIMENSIONS = Object.keys(TAXONOMY);

/* ───────────────────── 提示词 ───────────────────── */

/**
 * 打标提示词。要点：
 *   - 只依据报告正文，不看运营岗口述的 topic（那可能不准，正是要修正的对象）；
 *   - 严格 JSON 输出，便于解析；
 *   - 词表外的新词必须加「自由:」前缀，便于人工归并；
 *   - ai_topic 要能区分「这个人的做法特殊在哪」，不要写成产品广告名。
 *
 * 注意：模板串里不能出现 markdown 反引号（会终止字符串）。
 */
function buildTagPrompt(reportMd, ctx) {
  const lines = [];
  lines.push("你是平安融易（融资担保/助贷）业务的经验萃取编辑。");
  lines.push("下面是一份已经完成的访谈案例报告。请只依据报告正文，完成两件事。");
  lines.push("");
  lines.push("【一、归纳规范主题 ai_topic】");
  lines.push("用一句话说清「这份经验的核心是什么」，18-32 字。");
  lines.push("要求：");
  lines.push("- 必须含「做法」或「场景」，不能只写产品名或金额；");
  lines.push("- 能区分经验内容，让同事看标题就知道要不要点开；");
  lines.push("- 不出现具体客户姓名、企业全称、小区名、城市名；");
  lines.push("反例（不合格）：200万棱镜签约 / 转介绍成交案例 / 新人快速签约开单");
  lines.push("正例（合格）：靠老客户请托转介绍、用同行案例破冰拿下200万棱镜");
  lines.push("");
  lines.push("【二、打结构化标签 tags】");
  lines.push("从下面五个维度各选 0-3 个取值，合计 3-8 个。");
  lines.push("**必须优先从词表里选**；某个维度词表里确实没有贴切的，");
  lines.push("才允许新造一个，并且必须在前面加「自由:」三个字符，例如「自由:商会圈子获客」。");
  lines.push("拿不准的维度宁可不选，也不要硬凑。");
  lines.push("");
  lines.push("词表：");
  DIMENSIONS.forEach(function (d) {
    lines.push("- " + d + "：" + TAXONOMY[d].join(" / "));
  });
  lines.push("");
  lines.push("【输出格式 · 只输出这个 JSON，不要任何解释文字、不要代码块围栏】");
  lines.push('{"ai_topic":"...","tags":["维度:取值","..."],"reason":"一句话说明为什么这么打"}');
  lines.push("");
  lines.push("【参考信息（仅供定位背景，不作为打标依据）】");
  lines.push("- 运营岗口述主题：" + (ctx.topic || "（未填）"));
  lines.push("- 被访谈人岗位：" + (ctx.position || "（未填）"));
  lines.push("");
  lines.push("【报告正文】");
  lines.push(String(reportMd || "").slice(0, 12000));

  return lines.join("\n");
}

/* ───────────────────── JSON 解析（容错） ───────────────────── */

/**
 * 模型可能把 JSON 包在代码块里、或前后带解释文字。
 * 这里做三层兜底：直接解析 → 剥代码块 → 抓第一个平衡的大括号。
 */
function parseJsonLoose(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const candidates = [];
  candidates.push(raw);

  // 剥 ```json ... ``` 围栏
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) candidates.push(fence[1].trim());

  // 抓第一个平衡的大括号块
  const start = raw.indexOf("{");
  if (start >= 0) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < raw.length; i++) {
      const c = raw[i];
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) { candidates.push(raw.slice(start, i + 1)); break; }
      }
    }
  }

  for (const c of candidates) {
    try {
      const v = JSON.parse(c);
      if (v && typeof v === "object" && !Array.isArray(v)) return v;
    } catch (e) { /* 试下一个 */ }
  }
  return null;
}

/* ───────────────────── 结果规整 ───────────────────── */

const TOPIC_MAX = 60;
const TAGS_MAX = 10;

function asText(v, maxLen) {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  return maxLen ? s.slice(0, maxLen) : s;
}

/**
 * 把模型输出规整成入库值。
 *
 * 规整规则（宁缺毋滥，绝不为了凑数编标签）：
 *   - ai_topic：去掉首尾引号，超长截断，太短（<6 字）视为无效 → null；
 *   - tags：必须是「维度:取值」数组，逐个校验：
 *       · 维度必须在 DIMENSIONS 内（否则整条丢弃，避免模型自造维度）
 *       · 取值已在词表内 → 原样保留
 *       · 取值带「自由:」前缀 → 保留（待人工归并）
 *       · 取值在词表外且没带前缀 → 自动补「自由:」前缀，不假装它是标准词
 *       · 去重、限长、限量
 */
function normalizeTagResult(parsed) {
  if (!parsed || typeof parsed !== "object") {
    return { ai_topic: null, tags: null, reason: "" };
  }

  let topic = asText(parsed.ai_topic, 200)
    .replace(/^[「『"“']+/, "")
    .replace(/[」』"”']+$/, "")
    .replace(/\s+/g, "")
    .trim();
  if (topic.length < 6) topic = "";
  if (topic.length > TOPIC_MAX) topic = topic.slice(0, TOPIC_MAX);

  const rawTags = Array.isArray(parsed.tags) ? parsed.tags : [];
  const seen = Object.create(null);
  const tags = [];

  for (const t of rawTags) {
    if (tags.length >= TAGS_MAX) break;
    const s = asText(t, 60);
    if (!s) continue;

    const idx = s.indexOf(":");
    const idxCn = s.indexOf("：");
    const sep = idx >= 0 ? idx : idxCn;
    if (sep <= 0) continue; // 没有「维度:取值」结构，丢弃

    const dim = s.slice(0, sep).trim();
    let val = s.slice(sep + 1).trim();
    if (!val) continue;
    if (DIMENSIONS.indexOf(dim) === -1) continue; // 维度必须来自词表

    const known = TAXONOMY[dim].indexOf(val) >= 0;
    if (!known && val.indexOf("自由:") !== 0) val = "自由:" + val;

    const full = dim + ":" + val;
    if (seen[full]) continue;
    seen[full] = 1;
    tags.push(full);
  }

  return {
    ai_topic: topic || null,
    tags: tags.length ? tags : null,
    reason: asText(parsed.reason, 200),
  };
}

/* ───────────────────── 调用 DeepSeek ───────────────────── */

/**
 * 调 DeepSeek。
 *
 * @param {string} apiKey
 * @param {string} prompt
 * @param {string} model
 * @param {number} maxTokens  覆盖默认预算
 * @param {object} opts       { raw: true } 时**不做空内容判定**，
 *        把 { content, reasoning, finish_reason, usage, model } 原样返回 ——
 *        给诊断探针用（要看清「预算是不是被推理吃光」，就必须拿到 finish_reason
 *        和 usage.reasoning_tokens；光看一句 tag_empty_content 定位不了）。
 */
function callDeepseek(apiKey, prompt, model, maxTokens, opts) {
  /* ★ 变量名不能叫 raw —— http 回调里有 `let raw = ""`（响应原文）会把它遮蔽掉 */
  const rawMode = !!(opts && opts.raw);
  return new Promise(function (resolve, reject) {
    const body = JSON.stringify({
      model: model,
      messages: [
        { role: "user", content: prompt },
      ],
      /* deepseek-v4-flash 是推理模型，推理 token 也计入 max_tokens 预算。
         2026-09-29 实测：给 1600 时，2650 字的报告整份预算被推理吃光
         （reasoning_tokens=1600，completion_tokens=1600，content 为空字符串），
         finish_reason 返回 length，打标静默失败。
         打标本身的输出只有几十个 token，但推理长度随报告长度增长，
         所以这里给足 4000，并在下面把「推理占满」当成可重试的失败处理。
         maxTokens 可由调用方覆盖（kb-stage 也走这里，避免两份 https 实现漂移）。 */
      max_tokens: Number(maxTokens) > 0 ? Math.trunc(Number(maxTokens)) : 4000,
      temperature: 0.2,
      stream: false,
    });

    const req = https.request(
      {
        hostname: "api.deepseek.com",
        path: "/chat/completions",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + apiKey,
          "Content-Length": Buffer.byteLength(body),
        },
        /* ★ socket 超时必须可调：打标是短任务，60s 够；但 kb-stage 的分类
           实测推理能到 4000–8000 token，一次调用 50s 上下 —— 预算再放宽就顶到
           60s 这个旧上限，报出来的是 tag_timeout，会被误当成"网络抖动"。
           调用方通过 opts.timeoutMs 传（见 kb-stage 的 STAGE_TIMEOUT_MS）。 */
        timeout: Number(opts && opts.timeoutMs) > 0 ? Math.trunc(Number(opts.timeoutMs)) : 60000,
      },
      function (res) {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", function (c) { raw += c; });
        res.on("end", function () {
          if ((res.statusCode || 500) >= 400) {
            reject(new Error("tag_upstream_" + res.statusCode + ": " + raw.slice(0, 300)));
            return;
          }
          try {
            const parsed = JSON.parse(raw);
            const choice = (parsed.choices && parsed.choices[0]) || {};
            const msg = choice.message || {};
            const content = msg.content || "";
            /* 探针模式：原样返回，包含 finish_reason 与 usage —— 诊断「推理吃光预算」必需 */
            if (rawMode) {
              resolve({
                content: content,
                reasoning: msg.reasoning_content || msg.reasoning || "",
                finish_reason: choice.finish_reason || "",
                usage: parsed.usage || null,
                model: parsed.model || model,
              });
              return;
            }
            /* 推理模型的典型失败形态：预算被推理吃光，content 是空串，
               finish_reason=length。这必须当成错误抛出去，
               否则调用方会把「什么都没打上」当成正常结果静默写库。 */
            if (!String(content).trim()) {
              const reason = choice.finish_reason || "empty";
              reject(new Error("tag_empty_content:" + reason));
              return;
            }
            resolve({ content: content, model: parsed.model || model });
          } catch (e) {
            reject(new Error("tag_bad_upstream_json"));
          }
        });
      }
    );

    req.on("timeout", function () { req.destroy(new Error("tag_timeout")); });
    req.on("error", reject);
    req.end(body);
  });
}

/* ───────────────────── 对外入口 ───────────────────── */

const DEFAULT_MODEL = "deepseek-chat";
/* ★ 2026-10-15 改为非推理模型：
   打标输出只需几十个 token，用 deepseek-v4-flash（推理模型）推理开销反而极大：
   实测单条报告耗时 150-300s+，批量打标全部超时（socket 60s 远不够）。
   deepseek-chat 是非推理版，打标耗时降到 5-15s，无推理 token 吃预算问题。
   对话/报告生成/分类 继续用 v4-flash（由各自调用方指定），不受此处改动影响。 */

/**
 * 由报告正文生成 { ai_topic, tags, tags_model, reason }。
 * 任何失败都抛错，由调用方决定怎么处置（归档路径一律吞掉）。
 *
 * 重试：推理预算被吃光（tag_empty_content）是**偶发**的——
 * 同一份报告重跑通常就正常了（推理长度非确定）。这类错误重试一次；
 * 配置类错误（缺 Key、空报告）和上游 4xx 不重试，重试也没用。
 *
 * @param {string} reportMd  报告正文（---SECTION--- 分隔）
 * @param {object} ctx       { topic, position } 仅作背景参考
 * @param {object} opts      { apiKey, model, retries }
 */
function tagReport(reportMd, ctx, opts) {
  const o = opts || {};
  const apiKey = o.apiKey;
  if (!apiKey) return Promise.reject(new Error("tag_no_api_key"));
  if (!reportMd || !String(reportMd).trim()) {
    return Promise.reject(new Error("tag_empty_report"));
  }

  const model = o.model || DEFAULT_MODEL;
  const prompt = buildTagPrompt(reportMd, ctx || {});
  const retries = typeof o.retries === "number" ? o.retries : 1;

  const attempt = function (left) {
    return callDeepseek(apiKey, prompt, model).catch(function (e) {
      const msg = String(e && e.message || e);
      // 只有「推理吃光预算」和网络类抖动值得重试
      const retriable =
        msg.indexOf("tag_empty_content") === 0 ||
        msg === "tag_timeout" ||
        msg.indexOf("tag_bad_upstream_json") === 0;
      if (left > 0 && retriable) return attempt(left - 1);
      throw e;
    });
  };

  return attempt(retries).then(function (out) {
    const parsed = parseJsonLoose(out.content);
    const norm = normalizeTagResult(parsed);
    return {
      ai_topic: norm.ai_topic,
      tags: norm.tags,
      tags_model: out.model,
      reason: norm.reason,
    };
  });
}

module.exports = {
  TAXONOMY: TAXONOMY,
  DIMENSIONS: DIMENSIONS,
  buildTagPrompt: buildTagPrompt,
  parseJsonLoose: parseJsonLoose,
  normalizeTagResult: normalizeTagResult,
  tagReport: tagReport,
  DEFAULT_MODEL: DEFAULT_MODEL,
  /* 底层 chat 调用。kb-stage.js 复用它，避免两份 https 实现各自漂移
     （超时、推理吃预算的判定、错误码命名都会不一致）。 */
  callDeepseek: callDeepseek,
};
