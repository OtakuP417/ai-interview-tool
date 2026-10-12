/* 上下文裁剪自检：必须保留 system + 最近的消息，不能丢最新发言。
   回归背景：曾用 slice(0,40) 保留最老的 40 条、丢弃最近的，
   导致长访谈里模型看不到用户刚说的话，反复重复提问。 */
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.resolve(__dirname, "../web/index.html"), "utf-8");

// 从页面源码里抽出 buildContext 与常量，保证测的是真实实现
const mFn = html.match(/const CTX_MAX_CHARS[\s\S]*?\nfunction buildContext\(messages, budget\) \{[\s\S]*?\n\}/);
if (!mFn) { console.error("buildContext not found"); process.exit(1); }
const GATE_M = html.match(/const GATE = \{[\s\S]*?\n\};/);
if (!GATE_M) { console.error("GATE not found"); process.exit(1); }

const code = mFn[0] + "\n" + GATE_M[0] + "\nmodule.exports = { buildContext, GATE, CTX_MAX_CHARS, CTX_MAX_CHARS_REPORT };";
const mod = { exports: {} };
new Function("module", "exports", code)(mod, mod.exports);
const { buildContext, GATE, CTX_MAX_CHARS, CTX_MAX_CHARS_REPORT } = mod.exports;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra !== undefined ? "  -> " + extra : "")); }
}

console.log("\n[1] 短对话：全部保留，system 在首位");
{
  const msgs = [{ role: "system", content: "SYS" }];
  for (let i = 1; i <= 5; i++) msgs.push({ role: "user", content: "问" + i }, { role: "assistant", content: "答" + i });
  const ctx = buildContext(msgs);
  ok("条数不变", ctx.length === msgs.length, ctx.length);
  ok("system 在首位", ctx[0].role === "system");
  ok("最后一条保留", ctx[ctx.length - 1].content === "答5");
}

console.log("\n[2] 长对话（21 轮 / 43 条，即 #10 的规模）：最近的必须还在");
{
  const msgs = [{ role: "system", content: "SYS" }];
  for (let i = 1; i <= 21; i++) msgs.push({ role: "user", content: "问" + i }, { role: "assistant", content: "答" + i });
  const ctx = buildContext(msgs);
  ok("system 保留", ctx[0].role === "system");
  ok("最后一条用户发言在上下文里", ctx.some(x => x.content === "问21"));
  ok("最后一条消息就是最新的", ctx[ctx.length - 1].content === "答21", ctx[ctx.length - 1].content);
  ok("未被砍到 40 条", ctx.length === 43, ctx.length);
}

console.log("\n[3] 超预算：丢最老的，保最新的");
{
  const big = "甲".repeat(5000);
  const msgs = [{ role: "system", content: "SYS" }];
  for (let i = 1; i <= 10; i++) msgs.push({ role: "user", content: "第" + i + "问" + big }, { role: "assistant", content: "第" + i + "答" + big });
  const ctx = buildContext(msgs);
  const body = ctx.filter(x => x.role !== "system");
  const chars = body.reduce((n, x) => n + x.content.length, 0);
  ok("未超字符预算太多", chars <= CTX_MAX_CHARS + 6000, chars);
  ok("最新一轮保留", ctx.some(x => String(x.content).startsWith("第10答")));
  ok("最老的被丢弃", !ctx.some(x => String(x.content).startsWith("第1问")));
  ok("system 仍保留", ctx[0].role === "system");
}

console.log("\n[4] 单条超长回答：至少保留它，不返回空");
{
  const huge = "乙".repeat(CTX_MAX_CHARS + 5000);
  const msgs = [{ role: "system", content: "SYS" }, { role: "user", content: "短问" }, { role: "assistant", content: huge }];
  const ctx = buildContext(msgs);
  const body = ctx.filter(x => x.role !== "system");
  ok("不会返回空对话", body.length > 0, body.length);
  ok("最新的超长回答被保留", body.some(x => x.content === huge));
}

console.log("\n[5] 报告预算比对聊更大");
{
  ok("REPORT 预算 > CHAT 预算", CTX_MAX_CHARS_REPORT > CTX_MAX_CHARS, CTX_MAX_CHARS_REPORT + " vs " + CTX_MAX_CHARS);
  const msgs = [{ role: "system", content: "SYS" }];
  for (let i = 1; i <= 30; i++) msgs.push({ role: "user", content: "问" + i }, { role: "assistant", content: "答" + i });
  const a = buildContext(msgs).length, b = buildContext(msgs, CTX_MAX_CHARS_REPORT).length;
  ok("同数据下报告保留不少于对聊", b >= a, b + " vs " + a);
}

console.log("\n[6] internal 开场白指令照常进入上下文（不能丢）");
{
  const msgs = [{ role: "system", content: "SYS" }, { role: "user", content: "请开始访谈", internal: true }, { role: "assistant", content: "你好" }];
  const ctx = buildContext(msgs);
  ok("含 internal 指令", ctx.some(x => x.content === "请开始访谈"));
}

console.log("\n[7] 刻意不设轮次上限：softMaxRounds 已移除，只留纯提示的 softWarnRounds");
{
  ok("softMaxRounds 已移除", typeof GATE.softMaxRounds === "undefined");
  ok("softWarnRounds 存在", typeof GATE.softWarnRounds === "number", GATE.softWarnRounds);
  ok("softWarnRounds > minRounds", GATE.softWarnRounds > GATE.minRounds, GATE.softWarnRounds + " vs " + GATE.minRounds);
  ok("不在代码里使用 softMaxRounds（注释提及历史值不算）",
     !/GATE\.softMaxRounds/.test(html) && !/^\s*softMaxRounds\s*:/m.test(html));
}

console.log("\n[8] 页面源码里不再有 slice(0, 40) 的老写法");
{
  ok("旧的 slice(0,40) 已移除", !/\.slice\(0,\s*40\)/.test(html));
  /* 2026-10-12：发送前先过 L1 条件注入，所以送的是 reqMsgs（注入只进本次请求） */
  ok("streamAI 用 buildContext（注入后的 reqMsgs）",
    /messages:\s*buildContext\(reqMsgs\)/.test(html) && /const reqMsgs = withIntervention\(msgs, tip\)/.test(html));
  ok("generateReport 用 buildContext", /buildContext\(state\.messages,\s*CTX_MAX_CHARS_REPORT\)/.test(html));
}

console.log("\n[9] 轮次徽标：不再靠轮数催生报告，改由覆盖度决定");
{
  ok("nudge 样式已定义", /\.header-btn\.nudge/.test(html));
  ok("nudge 只在「聊得久 且 素材仍偏薄」时触发", /toggle\('nudge',\s*long\s*&&\s*!a\.ok\)/.test(html));
  ok("徽标文案改为覆盖度口径", html.indexOf("素材够用") >= 0);
  ok("已去掉「聊久了就催生成」的旧文案", html.indexOf("建议就此生成") < 0);
  ok("收尾提示写进了访谈提示词", html.indexOf("不要无限聊下去") >= 0);
}

console.log("\n[10] 覆盖度评估 assessCoverage 已定义并接入报告页");
{
  ok("assessCoverage 已定义", /function assessCoverage/.test(html));
  ok("六个维度已定义", /const COVERAGE_DIMS/.test(html));
  ok("必备三维判定存在", /const required = \['background',\s*'action',\s*'result'\]/.test(html));
  ok("方法层信号词表存在", /const METHOD_SIGNAL_RE/.test(html));
  ok("报告页渲染覆盖度", /function renderCoverage/.test(html) && /id="report-coverage"/.test(html));
  ok("报告告警改为先给覆盖度结论", /function buildReportAlerts/.test(html));
  ok("头条结论融合字数信号（三分支）", /cov\.valuable && a\.totalChars >= GATE\.minTotalChars/.test(html) && /cov\.valuable && a\.totalChars < GATE\.minTotalChars/.test(html));
  ok("结构齐但原话极少时不骗「够用」", /大部分内容可能是模型补的通用说法/.test(html));
  ok("结果无数字时 note 点出说服力弱", /有内容但没数字，说服力偏弱/.test(html));
  ok("节标题包含匹配兜底", /t\.indexOf\(a\) >= 0/.test(html));
  ok("生成报告后渲染覆盖度", /renderCoverage\(assessCoverage\(normalized,\s*state\.messages\)\)/.test(html));
  ok("报告生成后先做节标题归一（normalizeReport）", /const normalized = normalizeReport\(raw\)/.test(html));
  ok("续接草稿时也渲染覆盖度", /renderCoverage\(assessCoverage\(state\.reportRaw,\s*state\.messages\)\)/.test(html));
  ok("素材面板按覆盖度列出缺口", /还没问到 · /.test(html));
  ok("评估不再设轮次上限闸门", !/^\s*softMaxRounds\s*:/m.test(html) && !/GATE\.softMaxRounds/.test(html));
}

console.log("\n[11] 后线对接人改下拉选择（归因键不能是自由文本）");
{
  ok("OWNER_LIST 名单已定义", /const OWNER_LIST = \[/.test(html));
  ok("对接人字段是 select 不是 input", /<select id="f-owner">/.test(html) && !/<input[^>]*id="f-owner"/.test(html));
  ok("有填充函数 fillOwnerOptions", /function fillOwnerOptions/.test(html));
  ok("选择后自动带出所属中心", /function syncOwnerOrg/.test(html) && /opt\.dataset\.org/.test(html));
  ok("所属中心字段只读（防止与所选人冲突）", /id="f-owner-org"[^>]*readonly/.test(html));
  ok("初始化时填充并绑定 change", /fillOwnerOptions\(\);/.test(html) && /addEventListener\('change',\s*syncOwnerOrg\)/.test(html));
  ok("记住上次选择（同批萃取少点一次）", /localStorage\.setItem\('last_owner'/.test(html));
  ok("名单含 8 位运营岗", (html.match(/const OWNER_LIST = \[([\s\S]*?)\];/)||['',''])[1].split('\n').filter(l=>l.indexOf("|")>=0).length === 8,
     (html.match(/const OWNER_LIST = \[([\s\S]*?)\];/)||['',''])[1].split('\n').filter(l=>l.indexOf("|")>=0).length);
  ok("魏婷已加入名单（西安第三咨询中心）", /'魏婷\|西安第三咨询中心'/.test(html));
  ok("中心命名已统一（田敏=西安第三咨询中心 / 刘龙刚=咸阳中心）",
     /'田敏\|西安第三咨询中心'/.test(html) && /'刘龙刚\|咸阳中心'/.test(html)
     && !/'田敏\|三中心'/.test(html) && !/'刘龙刚\|咸阳安康营业部'/.test(html));
  ok("名单无重复姓名", (() => {
    const names = (html.match(/const OWNER_LIST = \[([\s\S]*?)\];/)||['',''])[1]
      .split('\n').filter(l => l.indexOf('|') >= 0)
      .map(l => l.replace(/^\s*'/, '').split('|')[0]);
    return new Set(names).size === names.length;
  })());
  ok("UM 号仍保留（用户要求）", /id="f-um"/.test(html));
}

console.log("\n[12] 归档信息与说明样式");
{
  ok("field-hint 样式已定义", /^\.field-hint\s*\{/m.test(html));
  ok("readonly 字段有样式", /input\[readonly\]/.test(html));
  ok("对接人栏标注了它是运营岗", /发起本次萃取的运营岗/.test(html));
}

console.log("\n" + "=".repeat(52));
console.log("  上下文裁剪验证：通过 " + pass + " 项，失败 " + fail + " 项");
console.log("=".repeat(52));
process.exit(fail ? 1 : 0);
