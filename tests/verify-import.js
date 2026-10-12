"use strict";
/**
 * verify-import.js — 「批量导入历史访谈稿」通路的护栏
 *
 * 为什么需要它：importer.js 里的提示词是 **web/index.html 的 REPORT_PROMPT 的兄弟副本**。
 * 经验库 kb.js 按「---SECTION--- 七节 + 可复制的经验点六要素」解析卡片 ——
 * 两边的节名/要素名一旦漂移，导入件就会在经验库里解析不出卡片，
 * 而且**不会报错**，只是那一栏悄悄空了。这类"两边各写一份"的重复是最容易烂的地方，
 * 所以这里直接把两份文件的结构要求抽出来比对。
 *
 * 另外守住 import_insert 的两条防线：节数闸（残缺报告不入库）与脱敏（PII 兜底）。
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const imp = require(path.join(ROOT, "cloudfunctions/interview-proxy/importer.js"));

const SECTIONS = ["背景与挑战", "核心做法", "关键判断与取舍", "结果", "可复制的经验点", "新人容易踩的坑", "海报摘要"];
const FIELDS = ["频次/时机", "话术/方法", "载体/工具", "对方没反应时怎么办", "触发信号", "哪些情况不适用"];

const html = fs.readFileSync(path.join(ROOT, "web/index.html"), "utf8");
const idx = fs.readFileSync(path.join(ROOT, "cloudfunctions/interview-proxy/index.js"), "utf8");
const prompt = imp.buildImportPrompt({ name: "测试对象", position: "咨询顾问", topic: "测试主题" });

let pass = 0;
let fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log("  ✓ " + label); }
  else { fail++; console.log("  ✗ " + label + (extra !== undefined ? "  → " + extra : "")); }
}

/* ── [1] importer 提示词的结构要求 ── */
console.log("\n[1] importer 提示词含全部结构要求");
SECTIONS.forEach(function (s) { ok(prompt.indexOf(s) >= 0, "含节「" + s + "」"); });
FIELDS.forEach(function (f) { ok(prompt.indexOf(f) >= 0, "含要素「" + f + "」"); });
ok(prompt.indexOf("---SECTION---") >= 0, "含分隔符的格式说明");
ok(prompt.indexOf("【访谈对象】测试对象") >= 0, "把访谈对象填进了提示词");
ok(prompt.indexOf("【案例主题】测试主题") >= 0, "把案例主题填进了提示词");
ok(prompt.indexOf("不要写进报告") >= 0, "要求逐字稿里提问者的话不进报告");
ok(prompt.indexOf("不要写真实姓名") >= 0, "要求原话归属不写真实姓名");
ok(prompt.indexOf(String.fromCharCode(96)) < 0,
  "★ 提示词里没有 markdown 反引号（会终止模板串 → Unexpected identifier）");

/* ── [2] 与前端 REPORT_PROMPT 的结构对齐（防两边漂移）── */
console.log("\n[2] 与 web/index.html 的 REPORT_PROMPT 结构对齐");
ok(/const REPORT_PROMPT/.test(html), "index.html 里找得到 REPORT_PROMPT");
SECTIONS.forEach(function (s) { ok(html.indexOf(s) >= 0, "REPORT_PROMPT 侧也有节「" + s + "」"); });
FIELDS.forEach(function (f) { ok(html.indexOf(f) >= 0, "REPORT_PROMPT 侧也有要素「" + f + "」"); });
ok(/不要硬凑一条"被否掉的路"/.test(html) || /不要硬凑一条「被否掉的路」/.test(html),
  "「被否掉的路」不是每条必填这条判据两边都在");
ok(prompt.indexOf("不要硬凑一条「被否掉的路」") >= 0,
  "★ importer 侧也写明了「被否掉的路」不是必填（否则模型会为每条做法编一个取舍）");

/* ── [3] index.js 接线 ── */
console.log("\n[3] index.js 的两个 action");
ok(/require\("\.\/importer"\)/.test(idx), "已 require importer");
ok(/action === "import_extract"/.test(idx), "有 import_extract（只生成不写库）");
ok(/action === "import_insert"/.test(idx), "有 import_insert（入库）");
ok(/import:linghang/.test(idx), "入库写了来源标记（区别于本工具访谈）");
ok(/report_sections_invalid/.test(idx), "import_insert 保留了节数闸");
ok(/maskSensitive\(asText\(body\.report_md/.test(idx), "import_insert 对报告正文做脱敏");
ok(/maskTranscript/.test(idx), "import_insert 对来源稿做脱敏");
/* extract 分支里不许出现写库调用 —— 与 ai_edit 同一条铁律 */
{
  const seg = idx.slice(idx.indexOf('action === "import_extract"'), idx.indexOf('action === "import_insert"'));
  ok(seg.indexOf("pgRequest") < 0, "★ import_extract 分支里没有任何数据库调用（只生成）");
}

/* ── [4] inspect() 的行为 ── */
console.log("\n[4] inspect() 能判出报告可不可解析");
function buildReport(cardCount) {
  const cards = [];
  for (let i = 0; i < cardCount; i++) {
    cards.push("做法：第" + (i + 1) + "条做法标题\n  具体怎么做：\n  - 频次/时机：每月一次\n  - 话术/方法：照这么说\n  - 载体/工具：微信\n  - 对方没反应时怎么办：停一停\n  - 触发信号：到点没动静\n  - 哪些情况不适用：未提到哪些情况不适用");
  }
  return SECTIONS.map(function (s, i) {
    if (s === "可复制的经验点") return s + "\n" + cards.join("\n\n");
    return s + "\n内容" + i;
  }).join("\n---SECTION---\n");
}
{
  const r = imp.inspect(buildReport(4));
  ok(r.separator_count === 6, "完整报告 = 6 个分隔符", r.separator_count);
  ok(r.sections === 7, "完整报告 = 7 节", r.sections);
  ok(r.missing_sections.length === 0, "无缺节", JSON.stringify(r.missing_sections));
  ok(r.card_count === 4, "识别出 4 张卡", r.card_count);
  ok(r.field_hits.length === 6, "六要素全识别", r.field_hits.join(","));
  ok(r.parseable === true, "判为可解析");
}
{
  const cut = imp.inspect(buildReport(2).slice(0, 300));
  ok(cut.parseable === false, "★ 被截断的报告判为不可解析", JSON.stringify(cut.missing_sections));
}
{
  /* 海报摘要被截断（首轮 16000 时真实出现过）—— 节数够但缺节，必须能看出来 */
  const md = buildReport(3).split("---SECTION---").slice(0, 6).join("---SECTION---");
  const r = imp.inspect(md);
  ok(r.parseable === false && r.missing_sections.indexOf("海报摘要") >= 0,
    "★ 末尾节被截断时能指出缺哪一节", JSON.stringify(r.missing_sections));
}
{
  /* ★ 模型实际写成「可复制经验点」（少个「的」）时，精确匹配会误报缺节+无卡片，
     而 kb.js 认得出 —— 一份完好的报告会被判成要重跑。实测 15 份里中了 3 份。 */
  const md = SECTIONS.map(function (s) {
    if (s === "可复制的经验点") return "可复制经验点\n做法：某做法\n- 频次/时机：每天";
    return s + "\n内容";
  }).join("\n---SECTION---\n");
  const r = imp.inspect(md);
  ok(r.missing_sections.length === 0,
    "★ inspect 认节名别名「可复制经验点」（少个「的」不误报缺节）", JSON.stringify(r.missing_sections));
  ok(r.card_count === 1, "别名节里的卡片照样数得出", r.card_count);
  ok(r.parseable === true, "别名写法判为可解析");
}

/* ── [6] 三处判据要互相认得出（这是最容易静默失效的一类耦合）── */
console.log("\n[6] 提示词占位写法 ↔ 经验库解析 ↔ 节名别名");
const KB = require(path.join(ROOT, "cloudfunctions/interview-proxy/kb.js"));
const PLACEHOLDERS = ["（稿子中未展开）", "（稿子中未提到）", "（稿子中未留下原话）", "（稿子中未覆盖主题中的 XX）"];
PLACEHOLDERS.forEach(function (s) {
  ok(prompt.indexOf(s) >= 0, "提示词里写明了占位写法「" + s + "」");
  ok(KB.MISSING_RE.test(s) === true,
    "★ 经验库 MISSING_RE 认得出「" + s + "」（认不出就会被当成正常内容显示出来）");
});
ok(KB.MISSING_RE.test("（访谈中未提到）") === true, "老报告写法「（访谈中未提到）」仍然认（不回归）");
{
  /* 节名别名表必须与 kb.js 的 SECTIONS 是同一套正则 —— 两边各写一份，最容易烂 */
  const kbSrc = fs.readFileSync(path.join(ROOT, "cloudfunctions/interview-proxy/kb.js"), "utf8");
  ok(imp.SECTION_ALIASES.length === 7, "别名表 7 节");
  imp.SECTION_ALIASES.forEach(function (a) {
    ok(kbSrc.indexOf(a[1].source) >= 0,
      "★ 节「" + a[0] + "」的正则 /" + a[1].source + "/ 在 kb.js 里也存在");
  });
}

/* ── [7] 主题表与素材清单一致 ── */
console.log("\n[7] 待导入素材的主题表");
{
  const runPy = fs.readFileSync(path.join(__dirname, "tmp/import-run.py"), "utf8");
  const m = runPy.match(/META = \{([\s\S]*?)\n\}/);
  ok(!!m, "import-run.py 里有 META 表");
  if (m) {
    const names = (m[1].match(/^\s*"([^"]+)":\s*\{/gm) || []).map(function (s) {
      return s.replace(/^\s*"/, "").replace(/":\s*\{$/, "");
    });
    ok(names.length > 0, "META 非空（" + names.length + " 人）", names.length);
    /* ★ 这里**不写被访谈人姓名**：脱敏铁律要求真名不进仓库，而
       「不得出现 XX」这类反向断言恰恰是最容易把真名写进代码的做法。
       改成与素材清单逐名比对 —— manifest.json 在 tests/tmp/（不入库），
       是这批姓名的唯一来源；它不在（换台机器/CI）时退化为只查非空。 */
    const mfPath = path.join(__dirname, "tmp/import-src/manifest.json");
    if (fs.existsSync(mfPath)) {
      const want = JSON.parse(fs.readFileSync(mfPath, "utf8")).map(function (x) { return x.name; }).sort();
      const got = names.slice().sort();
      ok(JSON.stringify(want) === JSON.stringify(got),
        "★ META 的 key 与素材清单 manifest.json 完全一致（" + got.length + " 人）",
        "manifest 有而 META 缺：" + want.filter(function (n) { return got.indexOf(n) < 0; }).join("、"));
    } else {
      ok(names.length >= 15, "manifest.json 不存在，跳过逐名比对", names.length);
    }
    /* 两份课件是运营岗整理的，经验主人 ≠ 素材署名 —— 必须显式配 interviewee，
       否则入库人会被写成整理人（用户 2026-10-12 拍板按经验主人入库）。 */
    const withInter = (m[1].match(/"interviewee"\s*:/g) || []).length;
    ok(withInter >= 2, "课件类素材配了 interviewee（经验主人）", withInter);
  }
}

console.log("\n" + (fail ? "✗ " + fail + " 项失败（通过 " + pass + "）" : "✓ 全部通过（" + pass + " 项）"));
process.exit(fail ? 1 : 0);
