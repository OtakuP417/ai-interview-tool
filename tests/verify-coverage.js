/* 覆盖度评估自检：assessCoverage 的判据必须真实反映"有没有拿到有价值的信息"。
   核心口径：
     · 价值由【内容维度覆盖度】决定，不由轮数决定 —— 短而准 > 长而空
     · 必备三维 = 背景 + 做法 + 结果；三缺一即 valuable=false
     · 做法还必须落到方法层（频次／话术／载体／应对），光有"做了什么"不算
   回归背景：旧代码用 softMaxRounds=18 这类轮数闸门来判断"聊够了没"，
   实测把 19 轮、六维度齐备的好案例也一起催停了。
*/
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.resolve(__dirname, "../web/index.html"), "utf-8");

/* 从源码里精确抽一段：marker 开始，到与之配平的结束括号为止。
   ★ 必须先剥掉注释再配平：本项目的注释里出现过大括号字面量
   （如「把 report_md 解析成 {节标题: 正文}」），会把深度算歪，
   导致抽出半个函数 → 拼起来的脚本语法错误，看起来像 grab 坏了。 */
function grab(marker) {
  const i = html.indexOf(marker);
  if (i < 0) { console.error("not found: " + marker); process.exit(1); }
  const rest = html.slice(i);
  const nl = rest.indexOf("\n");
  const head = nl < 0 ? rest : rest.slice(0, nl);
  // 单行声明（正则/数组字面量等）且以分号收尾 → 直接返回。
  if (head.indexOf("function") < 0 && /;\s*$/.test(head)) return head;

  const src = stripComments(rest);
  /* 收尾判定：找与之配平的结束符。
     ★ 深度扫描走 maskForBalance(src)（它把正则字面量也抹成空白），
     但最终 **返回原文 src** —— 正则不能被抹掉，否则抽出来的函数跑不起来。 */
  const mask = maskForBalance(src);
  const headMasked = maskForBalance(head);
  const openBrace = /[([{]\s*$/.test(headMasked) ? headMasked.match(/[([{]\s*$/)[0].trim() : "";
  const open = openBrace || (head.indexOf("function") >= 0 ? "{" : "(");
  const closeOf = { "{": "}", "[": "]", "(": ")" }[open];
  let start = 0;
  if (head.indexOf("function") >= 0) {
    start = mask.indexOf("{");
    if (start < 0) return src;
  }
  let depth = 0, seen = false;
  for (let p = start; p < mask.length; p++) {
    const ch = mask[p];
    if (ch === open) { depth++; seen = true; }
    else if (ch === closeOf) {
      depth--;
      if (seen && depth === 0) {
        const e = src.indexOf("\n", p);
        return src.slice(0, e < 0 ? src.length : e);
      }
    }
  }
  return src;
}

/* 在 stripComments 的基础上，额外把「正则字面量」也抹成等长空白，
   专供括号配平使用（正则里的 ()[]{} 不能参与配平）。 */
function maskForBalance(s) {
  let out = "";
  let p = 0;
  const canEndExpr = (ch) => ch === undefined || /[A-Za-z0-9_$\)\]\}'"`.]/.test(ch);
  while (p < s.length) {
    if (s[p] === "/" && !canEndExpr(s.slice(0, p).replace(/\s+$/, "").slice(-1))) {
      let stop = p + 1, inClass = false, closed = false;
      while (stop < s.length) {
        const c = s[stop];
        if (c === "\\") { stop += 2; continue; }
        if (c === "\n") break;
        if (c === "[") inClass = true;
        else if (c === "]") inClass = false;
        else if (c === "/" && !inClass) { closed = true; break; }
        stop++;
      }
      const stop2 = Math.min(stop + 1, s.length);
      if (closed) { out += " ".repeat(stop2 - p); p = stop2; }
      else { out += s[p]; p++; }
    } else {
      out += s[p];
      p++;
    }
  }
  return out;
}

/* 把块注释 / 行注释替换成等长空白，保持字符下标不变。
   注意这里 **不动正则字面量** —— 抽出来的函数要能真跑，
   正则被抹掉就语法不合法了。正则只在 maskForBalance 里为配平而抹。 */
function stripComments(s) {
  let out = "";
  let p = 0;
  while (p < s.length) {
    if (s[p] === "/" && s[p + 1] === "*") {
      const end = s.indexOf("*/", p + 2);
      const stop = end < 0 ? s.length : end + 2;
      out += " ".repeat(stop - p);
      p = stop;
    } else if (s[p] === "/" && s[p + 1] === "/") {
      const end = s.indexOf("\n", p);
      const stop = end < 0 ? s.length : end;
      out += " ".repeat(stop - p);
      p = stop;
    } else if (s[p] === '"' || s[p] === "'" || s[p] === "`") {
      // 字符串里的括号同样要忽略，但整段保留原样（含内容）
      const q = s[p];
      let stop = p + 1;
      while (stop < s.length && s[stop] !== q) {
        if (s[stop] === "\\") stop++;
        stop++;
      }
      stop = Math.min(stop + 1, s.length);
      out += s.slice(p, stop);
      p = stop;
    } else {
      out += s[p];
      p++;
    }
  }
  return out;
}

const code = [
  grab("const GATE = {"),
  grab("const COVERAGE_DIMS = ["),
  grab("const COVERAGE_SECTION_ALIAS = {"),
  grab("const METHOD_SIGNAL_RE ="),
  grab("function sectionMap(raw)"),
  grab("function isSubstantive(text)"),
  grab("function assessCoverage(raw, messages)"),
  "module.exports = { GATE, COVERAGE_DIMS, METHOD_SIGNAL_RE, sectionMap, isSubstantive, assessCoverage };",
].join("\n");

const mod = { exports: {} };
new Function("module", "exports", code)(mod, mod.exports);
const { GATE, COVERAGE_DIMS, METHOD_SIGNAL_RE, sectionMap, isSubstantive, assessCoverage } = mod.exports;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra !== undefined ? "  -> " + extra : "")); }
}

/* ── 造数据助手 ─────────────────────────────────────── */
// 拼一份报告正文：sections 形如 { '背景与挑战': '...', ... }
function mkReport(sections) {
  return Object.keys(sections)
    .map(t => t + "\n" + sections[t])
    .join("\n---SECTION---\n");
}
function mkMsgs(answers) {
  const out = [{ role: "system", content: "SYS" }];
  answers.forEach(a => { out.push({ role: "assistant", content: "提问？" }); out.push({ role: "user", content: a }); });
  return out;
}

const FULL_REPORT = mkReport({
  "背景与挑战": "客户是经营五金批发的个体工商户，2024 年通过老客户介绍接触，当时需要 25 万周转。",
  "核心做法": "做法\n建立转介绍台账：每周五固定整理当周成交客户，逐一致电回访\n首次接触：先微信发送产品要点，三天后电话跟进\n对方没反应时怎么办：两次不回就换微信节日问候，不催贷款\n频次：每位成交客户每月至少联系一次",
  "结果": "半年内通过转介绍新增放款 9 笔，累计 210 万，首逾率 0。",
  "关键判断与取舍": "额度低于 15 万的不主动推转介绍，先做存量盘活，避免客户觉得被推销。",
  "新人容易踩的坑": "新人常在放款当天就开口要转介绍，客户还没感受到服务，容易被直接拒绝。",
  "海报摘要": "每周五整理成交客户名单，逐一致电回访，三天后微信补一条节日问候。",
});
const FULL_TALK = [
  "客户是五金批发的，老客户介绍来的，要 25 万周转。",
  "我每周五会整理一次当周成交的客户名单，然后一个一个打电话回访。",
  "第一次接触我先发微信，把产品要点发过去，三天后再打电话跟进。",
  "他不回我微信，我就隔几天发个节日问候，不催他贷款的事，两次不回就先放着。",
  "半年新增了 9 笔转介绍，210 万，没有逾期。",
  "额度太小的客户我不会主动提转介绍，先做存量，不然客户觉得你在推销。",
];

console.log("\n[1] 声明式检查：轮次上限已彻底移除，覆盖度成为唯一判据");
{
  ok("GATE 里没有 softMaxRounds", typeof GATE.softMaxRounds === "undefined");
  ok("softWarnRounds 是纯提示（>20 轮）", GATE.softWarnRounds > 20, GATE.softWarnRounds);
  ok("六个内容维度", COVERAGE_DIMS.length === 6, COVERAGE_DIMS.length);
  ok("六个维度键名齐备",
     ["background", "action", "method", "result", "decision", "pitfall"].every(k => COVERAGE_DIMS.some(d => d.k === k)));
  ok("每个维度都带 probe（缺口提示语）", COVERAGE_DIMS.every(d => typeof d.probe === "string" && d.probe.length > 4));
}

console.log("\n[2] sectionMap：标题带序号/井号/粗体也要能归位");
{
  const sm = sectionMap(mkReport({ "1. 背景与挑战": "abc", "## 核心做法": "def", "**结果**": "ghi" }));
  ok("剥掉「1. 」前缀", "背景与挑战" in sm, Object.keys(sm).join("|"));
  ok("剥掉「## 」前缀", "核心做法" in sm);
  ok("剥掉粗体星号", "结果" in sm);
  ok("正文被正确保留", sm["核心做法"] === "def", sm["核心做法"]);
}

console.log("\n[3] isSubstantive：空话/占位不算实质内容");
{
  ok("正常句子算实质", isSubstantive("客户是五金批发的个体工商户，需要二十五万周转") === true);
  ok("「访谈中未展开」不算", isSubstantive("访谈中未展开") === false);
  ok("「暂无」不算", isSubstantive("暂无") === false);
  ok("「不适用」不算", isSubstantive("不适用") === false);
  ok("纯空字符串不算", isSubstantive("") === false);
  ok("太短（<12 字的净内容）不算", isSubstantive("他做得挺好") === false);
}

console.log("\n[4] 满分案例：六维度齐备 + 做法落到方法层 → valuable=true");
{
  const c = assessCoverage(FULL_REPORT, mkMsgs(FULL_TALK));
  ok("valuable 为真", c.valuable === true, JSON.stringify(c.reasons));
  ok("覆盖 6 / 6", c.covered === 6, c.covered);
  ok("方法层判定为真", c.methodCovered === true);
  ok("无缺口原因", c.reasons.length === 0, JSON.stringify(c.reasons));
  ok("每个维度都标了 ok", c.dims.every(d => d.ok));
}

console.log("\n[5] 缺失维度：必备三维缺一个，valuable 必须为假并点明缺哪块");
{
  // 抽掉「结果」
  const noResult = mkReport({
    "背景与挑战": "客户是五金批发的个体工商户，通过老客户介绍接触，需要二十五万周转。",
    "核心做法": "做法\n每周五整理成交客户名单逐一回访\n对方没反应时怎么办：两次不回就发节日问候不催贷款",
    "关键判断与取舍": "额度低于 15 万的不主动推转介绍，先做存量盘活。",
    "新人容易踩的坑": "新人常在放款当天就开口要转介绍，客户还没感受到服务。",
  });
  const c1 = assessCoverage(noResult, mkMsgs(FULL_TALK));
  ok("valuable 为假", c1.valuable === false);
  ok("缺口原因点名「结果与数据」", c1.reasons.join("").indexOf("结果与数据") >= 0, JSON.stringify(c1.reasons));
  ok("覆盖 5 / 6", c1.covered === 5, c1.covered);

  // 抽掉「核心做法」
  const noAction = mkReport({
    "背景与挑战": "客户是五金批发的个体工商户，通过老客户介绍接触，需要二十五万周转。",
    "结果": "半年内通过转介绍新增放款 9 笔，累计 210 万，首逾率 0。",
  });
  const c2 = assessCoverage(noAction, mkMsgs(FULL_TALK));
  ok("缺做法 → valuable 为假", c2.valuable === false);
  ok("缺口原因点名「具体做法」", c2.reasons.join("").indexOf("具体做法") >= 0, JSON.stringify(c2.reasons));
}

console.log("\n[6] 方法层：光有「做了什么」不算，必须有频次/话术/载体/应对");
{
  // 做法写得很空，没有任何方法层信号词
  const vague = mkReport({
    "背景与挑战": "客户是五金批发的个体工商户，通过老客户介绍接触，需要二十五万周转。",
    "核心做法": "做好客户服务，维护好关系，多和客户沟通交流，让客户满意。",
    "结果": "半年内通过转介绍新增放款 9 笔，累计 210 万，首逾率 0。",
  });
  const c = assessCoverage(vague, mkMsgs(["客户是五金批发的，老客户介绍来的。", "就是做好服务，多沟通。"]));
  ok("valuable 为假", c.valuable === false);
  ok("点名「做法还没落到方法层」", c.reasons.join("").indexOf("方法层") >= 0, JSON.stringify(c.reasons));
  ok("方法层维度标为未覆盖", c.dims.find(d => d.k === "method").ok === false);
}

console.log("\n[7] 方法层的两个来源：报告里写了、对话里没支撑 → 仍算缺");
{
  // 报告做法有条文但对话全无可回溯的细节
  const reportOnly = mkReport({
    "背景与挑战": "客户是五金批发的个体工商户，通过老客户介绍接触，需要二十五万周转。",
    "核心做法": "每周五整理名单，逐一电话回访，两天不回就发微信节日问候。",
    "结果": "半年内通过转介绍新增放款 9 笔，累计 210 万，首逾率 0。",
  });
  const c = assessCoverage(reportOnly, mkMsgs(["客户是五金批发的，老客户介绍来的。", "就是服务做好一点。"]));
  const m = c.dims.find(d => d.k === "method");
  ok("方法层未通过", m.ok === false);
  ok("提示语点明「对话中未见支撑」", m.note.indexOf("对话中未见支撑") >= 0, m.note);
}

console.log("\n[8] 反证：短访谈（3 轮）但六维度齐备 → valuable 仍为真");
{
  // 3 轮，但每轮都答得很实，报告六维度齐备 —— 旧轮数闸门会误判为"没聊够"
  const shortTalk = [
    "客户五金批发，老客户介绍的，要 25 万。我每周五整理成交客户名单逐个电话回访。",
    "第一次先发微信再三天后电话；两次不回就发节日问候不催，先放着。半年新增 9 笔 210 万无逾期。",
    "额度小的不主动提转介绍，先做存量。新人最爱放款当天就开口要转介绍，客户反感。",
  ];
  const c = assessCoverage(FULL_REPORT, mkMsgs(shortTalk));
  ok("轮次只有 3", shortTalk.length === 3);
  ok("valuable 为真（轮数少但内容齐）", c.valuable === true, JSON.stringify(c.reasons));
  ok("覆盖满分", c.covered === c.total);
}

console.log("\n[9] 反证：长访谈（22 轮）但只有空话 → valuable 为假");
{
  const longTalk = new Array(22).fill("还行吧").concat(["就多做服务", "多沟通"]);
  const empty = mkReport({
    "背景与挑战": "访谈中未展开",
    "核心做法": "暂无",
    "结果": "不适用",
  });
  const c = assessCoverage(empty, mkMsgs(longTalk));
  ok("轮次有 24", longTalk.length === 24);
  ok("valuable 为假（聊得久但没内容）", c.valuable === false);
  ok("覆盖极少", c.covered <= 1, c.covered);
}

console.log("\n[10] 边界：空输入不抛异常");
{
  let threw = false;
  let c;
  try { c = assessCoverage("", []); } catch (e) { threw = true; }
  ok("空报告+空对话不抛异常", threw === false);
  ok("返回结构完整", c && Array.isArray(c.dims) && typeof c.valuable === "boolean");
  ok("valuable 为假", c.valuable === false);
  c = assessCoverage(null, null);
  ok("null 输入不抛异常", c && c.dims.length === 6, c && c.dims.length);
}

console.log("\n[11] 每个维度都带 note，报告页要展示");
{
  const c = assessCoverage(FULL_REPORT, mkMsgs(FULL_TALK));
  ok("六条 note 全非空", c.dims.every(d => typeof d.note === "string" && d.note.length > 0));
  const c2 = assessCoverage("", []);
  ok("缺口时 note 说明是空的", c2.dims.every(d => d.note.length > 0));
  ok("probe 用作补访提示", c.dims.every(d => d.probe && d.probe.length > 4));
}

console.log("\n[12] 节标题包含匹配：模型不照模板写标题也能命中");
{
  const r = mkReport({
    "背景与挑战": "客户是五金批发的个体工商户，通过老客户介绍接触，需要二十五万周转。",
    "核心做法": "每周五整理名单，逐一电话回访，两天不回就发微信节日问候。",
    "结果与数据": "半年内通过转介绍新增放款 9 笔，累计 210 万，首逾率 0。",
  });
  const c = assessCoverage(r, mkMsgs(FULL_TALK));
  ok("「结果与数据」命中别名「结果」", c.dims.find(d => d.k === "result").ok === true);
  ok("含数字 → note 保持「有实质内容」", c.dims.find(d => d.k === "result").note === "有实质内容",
     c.dims.find(d => d.k === "result").note);
}

console.log("\n[13] 结果无数字：覆盖仍成立，但 note 要点出说服力弱");
{
  const r = mkReport({
    "背景与挑战": "客户是五金批发的个体工商户，通过老客户介绍接触，需要二十五万周转。",
    "核心做法": "每周五整理名单，逐一电话回访，两天不回就发微信节日问候。",
    "结果": "客户顺利成交，全程未遇卡点，最关键的因素是老客户的信任背书。",
  });
  const c = assessCoverage(r, mkMsgs(FULL_TALK));
  const d = c.dims.find(x => x.k === "result");
  ok("定性结果仍算覆盖", d.ok === true);
  ok("note 点出「没数字」", d.note.indexOf("没数字") >= 0, d.note);
  ok("valuable 不因此变假（软提示不做硬门槛）", c.valuable === true, JSON.stringify(c.reasons));
}

console.log("\n" + "=".repeat(52));
console.log("  覆盖度评估验证：通过 " + pass + " 项，失败 " + fail + " 项");
console.log("=".repeat(52));
process.exit(fail ? 1 : 0);
