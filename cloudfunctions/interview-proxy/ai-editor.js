/**
 * ai-editor.js — 管理端「AI 辅助修改报告」
 *
 * 要解决的问题：报告正文虽然可以手工改，但改起来要么得整段重打，
 * 要么得自己通读几千字找位置。希望用一句话说清「把结果节的 30% 改成 32%」
 * 或「补一句这个客户是 2023 年的老客户」，由模型落地。
 *
 * ★ 这个模块唯一的设计目标就是「模型不许自由发挥」。做法是三条：
 *
 *   1. **模型永远不输出全文，只输出补丁**（{sec, op, before, after}）。
 *      没被补丁点到的段落由前端代码原样保留 —— 「顺手改写别处」在物理上
 *      不可能发生，不需要靠提示词去求模型守规矩。
 *   2. **before 必须是逐字原句，由前端拿去做精确定位**（indexOf）。
 *      对不上就整条作废并标红，绝不让模型对「改哪里」的描述直接生效。
 *      模型可以撒谎说某句话存在，但一句都不匹配就什么都改不了。
 *   3. **每条改动必须写出它对应哪条指令**（why）。写不出来的改动进 unclear，
 *      不进 ops。落到 diff 上，人能一眼看出「这一条是谁让它改的」。
 *
 * 本模块只负责「生成补丁」，**不负责写库**。落地一律由管理端走已有的
 * action:'update' + fields:{report_md} —— 那条路径自带 report_orig 首次快照、
 * report_rev 累加、分隔符 ≥5 的服务端校验。这里另开一个写入口等于绕开留痕。
 *
 * 零 npm 依赖（云函数 256MB 内存约束 + 免打包），只用 Node 内置 https。
 */

const https = require("https");
const tagger = require("./tagger");

/* ───────────────────────── 节结构 ───────────────────────── */

/**
 * 报告正文靠 ---SECTION--- 切节。这里刻意**不写死节数**：
 * 历史报告有 6 节（末节「新人注意事项」）也有 7 节（末节「新人容易踩的坑」+
 * 「海报摘要」）。写死节数会让老报告错位，所以按实际切出来的段数走，
 * 只借用标题表来给人看的名字。
 */
const SECTION_TITLES = [
  "背景与挑战",
  "核心做法",
  "关键判断与取舍",
  "结果",
  "可复制的经验点",
  "新人容易踩的坑",
  "海报摘要",
];

const SEP = "---SECTION---";

/** 按分隔符切段。返回的数组原样保留尾部内容，不做补齐、不做截断。 */
function splitSections(md) {
  return String(md || "").split(SEP);
}

function sectionLabel(i) {
  return SECTION_TITLES[i] || "第 " + (i + 1) + " 节";
}

/* ───────────────────────── 提示词 ───────────────────────── */

/**
 * 铁律部分。三个模式共用。
 *
 * 措辞上刻意用「不许」「一个字都不许动」这类硬话，而不是「请尽量」——
 * 这类模型的默认行为就是「顺手润色一下」，软性措辞压不住。
 */
const RULES = `你是一个报告编辑助手。你的任务**不是**润色或重写报告，而是**只做用户明确点名的那几处改动**。

铁律（违反任何一条，本次修改即作废）：
1. 除了用户指令里点名要改的地方，**其余内容一个字都不许动**。
   不要顺手改错别字、不要顺手统一标点、不要顺手调整顺序、不要顺手润色。
2. **不许新增用户没有提供的事实。** 数字、人名、时间、地点、机构、
   产品名、金额、比例——用户没说的，一律不许自己补。宁可少改，不可多写。
3. 每一条改动都必须能对应到用户指令里的某一条，并在 why 里写明是照哪一条改的。
   对应不上的改动，不要做，写进 unclear。
4. before 必须是原文里的**逐字原句（含标点）**。一个字都不许改、不许省略、
   不许用你自己的话概括。系统会拿它去原文里做精确定位，对不上的那一条直接作废。
5. 指令含糊、说不清改哪里、或需要你猜的，**不做**，写进 unclear 说明原因。
   宁可空手而归，也不要猜着改。
6. 保持原文的写法风格（口语化表述保留、人物原话仍用「」包裹、
   不使用 markdown 的星号加粗）。
7. 数字与单位保持原样格式，不改写、不换算、不四舍五入。`;

const PATCH_FORMAT = `只输出一个 JSON 对象。不要任何解释文字，不要 markdown 代码块围栏。

{
  "ops": [
    {
      "sec": 4,
      "op": "replace",
      "before": "原文里逐字复制的一句话",
      "after": "改后的话",
      "why": "对应指令：把结果节的 30% 改成 32%"
    }
  ],
  "unclear": ["指令里某处我没把握，原因如下……"]
}

op 只能是这三种：
- "replace"       把 before 换成 after
- "insert_after"  把 after 作为新的一段，插在 before 所在的位置之后
- "delete"        删掉 before 那段，after 留空字符串 ""

sec 是节序号（1 开始），必须准确。没有要改的就让 ops 是空数组。`;

const SECTION_FORMAT = `只输出一个 JSON 对象。不要任何解释文字，不要 markdown 代码块围栏。

{
  "sections": [
    { "sec": 4, "body": "重写后的整节正文" }
  ],
  "unclear": ["……"]
}

body 里**不要**写节标题，**不要**写 ---SECTION--- 分隔符。
只输出用户点名要重写的那几节，其余节一个字都不许出现在输出里。`;

/** 把报告正文拼成给模型看的、带序号的节列表。 */
function renderSections(parts) {
  return parts
    .map(function (body, i) {
      return "【第 " + (i + 1) + " 节 · " + sectionLabel(i) + "】\n" + String(body || "").trim();
    })
    .join("\n\n");
}

/**
 * 定点补丁模式的提示词。
 *
 * @param {string[]} parts       报告各节正文
 * @param {string}   instruction 用户这一轮的指令
 * @param {Array}    history     [ {role, content} ]，前几轮已说过的话
 */
function buildPatchPrompt(parts, instruction, history) {
  const ctx = (history || [])
    .filter(function (h) { return h && h.content; })
    .slice(-6)
    .map(function (h) {
      return (h.role === "assistant" ? "助手：" : "用户：") + String(h.content).slice(0, 300);
    })
    .join("\n");

  return RULES + "\n\n" + PATCH_FORMAT +
    "\n\n# 报告正文（按节给出）\n\n" + renderSections(parts) +
    (ctx ? "\n\n# 之前已经说过的（供理解语境，不要重复执行）\n\n" + ctx : "") +
    "\n\n# 这一轮用户的要求\n\n" + instruction +
    "\n\n现在只输出那个 JSON 对象。";
}

/**
 * 指定节重写模式的提示词。只重写 targets 里的那几节，其余节不进入输出。
 *
 * @param {string[]} parts       报告各节正文
 * @param {number[]} targets     要重写的节序号（1 开始）
 * @param {string}   instruction 补充信息 / 重写要求
 * @param {Array}    history     前几轮
 */
function buildSectionPrompt(parts, targets, instruction, history) {
  const list = targets
    .filter(function (n) { return n >= 1 && n <= parts.length; })
    .map(function (n) {
      return "【第 " + n + " 节 · " + sectionLabel(n - 1) + "】\n" + String(parts[n - 1] || "").trim();
    })
    .join("\n\n");

  const ctx = (history || [])
    .filter(function (h) { return h && h.content; })
    .slice(-6)
    .map(function (h) {
      return (h.role === "assistant" ? "助手：" : "用户：") + String(h.content).slice(0, 300);
    })
    .join("\n");

  return RULES + "\n\n" + SECTION_FORMAT +
    "\n\n# 要重写的节（只有这几节）\n\n" + list +
    (ctx ? "\n\n# 之前已经说过的\n\n" + ctx : "") +
    "\n\n# 用户的补充信息与要求\n\n" + instruction +
    "\n\n现在只输出那个 JSON 对象。";
}

/* ───────────────────────── 调用上游 ───────────────────────── */

const DEFAULT_MODEL = "deepseek-v4-flash";

/**
 * 非流式调用 DeepSeek，返回 content 字符串。
 *
 * max_tokens 说明：deepseek-v4-flash 是推理模型，**推理 token 也计入预算**，
 * 且推理长度随输入长度增长。这里的输入是整篇报告（约 2-4k 字）+ 一大段规则，
 * 给 4000 有被推理吃光的风险（content 空串、finish_reason=length），
 * 所以基线给 6000，并在调用方按 finish_reason 判断是否值得重试。
 */
function callDeepseek(apiKey, prompt, model, maxTokens) {
  return new Promise(function (resolve, reject) {
    const body = JSON.stringify({
      model: model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.1,
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
        timeout: 90000,
      },
      function (res) {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", function (c) { raw += c; });
        res.on("end", function () {
          if ((res.statusCode || 500) >= 400) {
            reject(new Error("ai_edit_upstream_" + res.statusCode + ": " + raw.slice(0, 300)));
            return;
          }
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch (e) {
            reject(new Error("ai_edit_bad_upstream_json"));
            return;
          }
          const choice = (parsed.choices && parsed.choices[0]) || {};
          const content = (choice.message && choice.message.content) || "";
          /* 推理模型的典型失败形态：预算被推理吃光，content 是空串。
             必须当错误抛，否则前端会把「什么都没改」当成「不用改」静默接受。 */
          if (!String(content).trim()) {
            reject(new Error("ai_edit_empty_content:" + (choice.finish_reason || "empty")));
            return;
          }
          resolve({ content: content, finish: choice.finish_reason || "", model: parsed.model || model });
        });
      }
    );

    req.on("timeout", function () { req.destroy(new Error("ai_edit_timeout")); });
    req.on("error", reject);
    req.end(body);
  });
}

/* ───────────────────────── 输出规整 ───────────────────────── */

function asStr(v, max) {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  return max ? s.slice(0, max) : s;
}

const OPS = ["replace", "insert_after", "delete"];
const MAX_OPS = 40;

/**
 * 规整补丁。
 *
 * 这里只做「格式上能不能用」的判断，**不做内容判断** ——
 * before 到底在不在原文里、改动是不是用户要的，交给人在 diff 里看，
 * 以及交给前端做精确定位。服务端替人做内容判断只会引入新的猜测。
 */
function normalizeOps(parsed, partCount) {
  const raw = parsed && Array.isArray(parsed.ops) ? parsed.ops : [];
  const ops = [];
  const seen = Object.create(null);

  for (const o of raw) {
    if (ops.length >= MAX_OPS) break;
    if (!o || typeof o !== "object") continue;

    const op = asStr(o.op, 20);
    if (OPS.indexOf(op) < 0) continue;

    const sec = Math.trunc(Number(o.sec) || 0);
    if (sec < 1 || sec > partCount) continue;

    const before = asStr(o.before, 2000);
    if (!before) continue;                    // 没有锚点 = 无法定位，直接丢

    const after = op === "delete" ? "" : asStr(o.after, 4000);

    // 同一节里同一个锚点重复出现时只取第一条，避免二次替换把正文改乱
    const key = sec + "\u0000" + before;
    if (seen[key]) continue;
    seen[key] = 1;

    // 改了个寂寞（before === after）不算改动，丢掉
    if (op !== "insert_after" && before === after) continue;

    ops.push({
      sec: sec,
      op: op,
      before: before,
      after: after,
      why: asStr(o.why, 300),
    });
  }

  return ops;
}

/** 规整「重写指定节」的输出：只收 targets 里的节，其余一律丢弃。 */
function normalizeSections(parsed, targets, partCount) {
  const raw = parsed && Array.isArray(parsed.sections) ? parsed.sections : [];
  const allow = Object.create(null);
  (targets || []).forEach(function (n) { allow[Math.trunc(Number(n) || 0)] = 1; });

  const out = [];
  const seen = Object.create(null);
  for (const s of raw) {
    if (!s || typeof s !== "object") continue;
    const sec = Math.trunc(Number(s.sec) || 0);
    if (sec < 1 || sec > partCount) continue;
    if (!allow[sec]) continue;                // 没点名要重写的节，模型给了也不收
    if (seen[sec]) continue;
    const body = asStr(s.body, 20000);
    if (!body) continue;
    seen[sec] = 1;
    out.push({ sec: sec, body: body });
  }
  return out;
}

function normalizeUnclear(parsed) {
  const raw = parsed && Array.isArray(parsed.unclear) ? parsed.unclear : [];
  return raw.slice(0, 6).map(function (u) { return asStr(u, 300); }).filter(Boolean);
}

/* ───────────────────────── 对外入口 ───────────────────────── */

/**
 * 生成修改补丁。**不写库**，只把补丁回给管理端。
 *
 * 失败一律抛 Error，由 handleAdmin 转成 JSON 错误码；
 * 调用方不要吞异常 —— 这是人主动点出来的操作，必须让他看到为什么没成。
 *
 * @param {object} o
 *   o.apiKey       DeepSeek Key
 *   o.reportMd     当前报告正文
 *   o.instruction  用户的修改/补充要求
 *   o.mode         'patch' | 'section'
 *   o.targets      mode='section' 时要重写的节序号
 *   o.history      前几轮对话
 *   o.model        可选
 */
function editReport(o) {
  const opts = o || {};
  const apiKey = opts.apiKey;
  if (!apiKey) return Promise.reject(new Error("ai_edit_no_api_key"));

  const md = String(opts.reportMd || "");
  if (!md.trim()) return Promise.reject(new Error("ai_edit_empty_report"));

  const instruction = asStr(opts.instruction, 4000);
  if (!instruction) return Promise.reject(new Error("ai_edit_no_instruction"));

  const parts = splitSections(md);
  const mode = opts.mode === "section" ? "section" : "patch";
  const targets = (Array.isArray(opts.targets) ? opts.targets : [])
    .map(function (n) { return Math.trunc(Number(n) || 0); })
    .filter(function (n) { return n >= 1 && n <= parts.length; });

  if (mode === "section" && !targets.length) {
    return Promise.reject(new Error("ai_edit_no_targets"));
  }

  const model = opts.model || DEFAULT_MODEL;
  const prompt = mode === "section"
    ? buildSectionPrompt(parts, targets, instruction, opts.history)
    : buildPatchPrompt(parts, instruction, opts.history);

  /* 重写整节要输出几百字的正文，比补丁模式需要更多预算；
     但也不能给到 16000 —— 实测 16000 时模型会返回空 content（finish_reason=stop）。
     6000 / 8000 都落在安全区内。 */
  const maxTokens = mode === "section" ? 8000 : 6000;

  const attempt = function (left) {
    return callDeepseek(apiKey, prompt, model, maxTokens).catch(function (e) {
      const msg = String((e && e.message) || e);
      // 只有「推理吃光预算」和网络抖动值得重试，配置类错误重试也没用
      const retriable =
        msg.indexOf("ai_edit_empty_content") === 0 ||
        msg === "ai_edit_timeout" ||
        msg.indexOf("ai_edit_bad_upstream_json") === 0;
      if (left > 0 && retriable) return attempt(left - 1);
      throw e;
    });
  };

  return attempt(1).then(function (out) {
    const parsed = tagger.parseJsonLoose(out.content);
    if (!parsed) throw new Error("ai_edit_unparsable_output");

    const unclear = normalizeUnclear(parsed);
    if (mode === "section") {
      const sections = normalizeSections(parsed, targets, parts.length);
      if (!sections.length) throw new Error("ai_edit_no_change");
      return {
        mode: mode,
        targets: targets,
        sections: sections,
        unclear: unclear,
        model: out.model,
        truncated: out.finish === "length",
      };
    }

    const ops = normalizeOps(parsed, parts.length);
    /* ops 空但 unclear 有内容 → 是模型「不敢改」的正常结果，回给前端展示，
       不当错误。两者都空才是真的什么都没发生。 */
    if (!ops.length && !unclear.length) throw new Error("ai_edit_no_change");
    return {
      mode: mode,
      ops: ops,
      unclear: unclear,
      model: out.model,
      truncated: out.finish === "length",
    };
  });
}

module.exports = {
  SECTION_TITLES: SECTION_TITLES,
  splitSections: splitSections,
  buildPatchPrompt: buildPatchPrompt,
  buildSectionPrompt: buildSectionPrompt,
  normalizeOps: normalizeOps,
  normalizeSections: normalizeSections,
  editReport: editReport,
};
