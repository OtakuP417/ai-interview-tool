/* 端到端验证 2026-09-29 的 P0/P1 提示词改进是否真的生效
   —— 把线上 REPORT_PROMPT 抽出来，喂一段访谈（含参照系、被放弃的路、
      原话、失败单线索），看模型产出的报告是否出现了新要求的结构。

   只调 /api/chat，不写库。产出 tests/e2e/out/p01-report.md
   用法：node tests/e2e/out/t-p01-report.js
*/
const fs = require("fs");
const http = require("http");

const html = fs.readFileSync("web/index.html", "utf-8");
const m = html.match(/const REPORT_PROMPT = \(n, p, t\) => `([\s\S]*?)`;/);
if (!m) { console.error("REPORT_PROMPT not found"); process.exit(1); }
const REPORT_PROMPT = (n, p, t) =>
  m[1].replace(/\$\{n\}/g, n).replace(/\$\{p\}/g, p).replace(/\$\{t\}/g, t);

/* 刻意把 P0/P1 需要的素材都放进去：
   - 结果数字 + 参照系（团队平均 / 他自己平时）
   - 两条走法 + 被否掉的那条 + 否掉的理由
   - 逐句原话
   - 触发信号（"我再考虑一下"出现两次）
   - 失效边界（只在见过面的客户身上有效）
   - 触发信号的可观察现象（到账第 3 天没动静）
   - 失败单（丢过一个纯电话名单的客户）  */
const DIALOGUE = [
  { role: "system", content: "你是访谈助手，围绕案例逐层追问具体动作与原因。" },
  { role: "user", content: "先说说这批客户是怎么来的？" },
  { role: "assistant", content: "手上四十来个到期老客户，都是我自己经手放过的款。" },
  { role: "user", content: "那你是先做老客户还是先扫新名单？当时还有别的走法吗？" },
  { role: "assistant", content: "本来有两条路。A 是先把手上四十个到期老客户回访一遍；B 是跟着营业部的陌拜名单扫新客户。我先做了老客户。陌拜名单我试过两周，一天扫十条，能搭上话的就一两个，太慢了，撑不起当月的件数要求。" },
  { role: "user", content: "你怎么判断老客户更值得做？" },
  { role: "assistant", content: "我翻了批款名单，发现有十二个额度到账满三个月还没动过，其中八个是我自己经手的。我问过的那几个，都知道我姓什么。" },
  { role: "user", content: "具体是怎么联系的？多久一次？" },
  { role: "assistant", content: "放款后第 3 天必发一条到账提醒，之后每月月初发一次。第 3 天我发的是，哥，款到了记得查一下，有问题随时找我。月初发的是跟业务无关的问候，不催不推。都是微信私聊，不群发，不加表情包。" },
  { role: "user", content: "什么情况下你会启动这个动作？" },
  { role: "assistant", content: "批款到账后第 3 天还没收到客户的回执消息，我就发。还有一个信号是客户说'我再考虑一下'超过两次，我也会转成这种低频维护，先不做产品。" },
  { role: "user", content: "那这个做法有没有不管用的时候？" },
  { role: "assistant", content: "有。这个做法只在已经见过面、加过微信的客户身上有效。纯电话名单上直接发，会被当成营销短信，投诉过一次。" },
  { role: "user", content: "对方不回你怎么办？" },
  { role: "assistant", content: "两次不回就停一到两个月，节日再发一次，别连着追。" },
  { role: "user", content: "有没有哪一单你是跟进丢了、或者做砸过的？" },
  { role: "assistant", content: "丢过一个，纯电话名单的客户，我上来就发到账提醒，第二天他直接拉黑了。后来我改成先打电话确认加微信，再发消息。" },
  { role: "user", content: "最后结果怎么样？跟别人比呢？" },
  { role: "assistant", content: "半年新增了九笔转介绍，做了两百一十万，首逾零。同期我们营业部人均大概五单，我做了十二单，算靠前那一档。我平时一个月也就三四单的量。" },
];

const messages = [...DIALOGUE, { role: "user", content: REPORT_PROMPT("测试", "咨询顾问", "老客户盘活与转介绍") }];

const body = JSON.stringify({ model: "deepseek-v4-flash", messages, stream: false, max_tokens: 8000 });
const req = http.request({
  hostname: "work-d1gs0jzrg2277d75e-1391683363.ap-shanghai.app.tcloudbase.com",
  path: "/api/chat", method: "POST",
  headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
  timeout: 180000,
}, function (res) {
  let data = "";
  res.on("data", c => (data += c));
  res.on("end", function () {
    let j;
    try { j = JSON.parse(data); } catch (e) { console.error("bad json:", data.slice(0, 300)); process.exit(5); }
    const ch = (j.choices && j.choices[0]) || {};
    const content = (ch.message && ch.message.content) || "";
    fs.writeFileSync("tests/e2e/out/p01-report.md", content, "utf-8");

    console.log("finish_reason:", ch.finish_reason);
    console.log("report length:", content.length);
    console.log("");

    /* 逐项检查 P0/P1 结构是否真的出现 */
    const checks = [
      ["P0-a 决策三段式：可选走法", /可选走法/.test(content)],
      ["P0-a 决策三段式：选择依据", /选择依据/.test(content)],
      ["P0-a 决策三段式：被否掉的那条路", /被否掉的那条路为什么不行|被否掉/.test(content)],
      ["P0-a 真的写了「陌拜」这条路", /陌拜/.test(content)],
      ["P0-a 真的写了否掉的理由", /搭上话|太慢|扫十条/.test(content)],
      ["P0-b 结果参照系：团队参照", /团队参照/.test(content)],
      ["P0-b 参照里带上了营业部人均", /人均|平均/.test(content)],
      ["P0-c 核心做法带原话", /原话/.test(content)],
      ["P0-c 原话是真实引句", /款到了记得查一下|我再考虑一下|随时找我/.test(content)],
      ["P1-f 经验点：触发信号", /触发信号/.test(content)],
      ["P1-f 经验点：失效边界", /失效边界/.test(content)],
      ["P1-f 触发信号是可观察现象", /第\s*3\s*天|回执|考虑一下/.test(content)],
      ["P1-f 失效边界写了纯电话名单", /电话名单|营销短信|投诉/.test(content)],
      ["保底 七节齐全", ["背景与挑战", "核心做法", "关键判断与取舍", "结果", "可复制的经验点", "新人容易踩的坑", "海报摘要"]
        .every(t => content.includes(t))],
      /* 注意：`（访谈中未留下原话）` 这类占位是「诚实兜底」，不是缺陷——
         只要它出现的位置对应的是对话里确实没有原话的那一步，就是正确行为。
         真正的缺陷是「通篇只有占位、一句真实原话都没有」，所以改为检查真实原话数量。 */
      ["保底 原话占位没有被滥用（真实原话数 >= 2）",
        (content.match(/原话：[『「][^』」]{4,}/g) || []).length >= 2,
        "真实原话 " + ((content.match(/原话：[『「][^』」]{4,}/g) || []).length) + " 处"],
    ];
    let bad = 0;
    checks.forEach(([label, ok]) => { if (ok) console.log("  ✓ " + label); else { bad++; console.log("  ✗ " + label); } });
    console.log("\n" + (bad ? "失败 " + bad + " 项" : "全部通过"));
    console.log("报告已写到 tests/e2e/out/p01-report.md");

    /* 顺手用归一函数自查：产出的标题是否本来就是标准标题 */
    const secs = content.split(/---SECTION---/).map(p => {
      const ls = p.split("\n");
      let h = 0; while (h < ls.length && !ls[h].trim()) h++;
      return String(ls[h] || "").trim();
    });
    console.log("\n实际产出的节标题：");
    secs.forEach((s, i) => console.log("  " + (i + 1) + ". " + s));

    process.exit(bad ? 1 : 0);
  });
});
req.on("error", e => { console.error("request error:", e.message); process.exit(6); });
req.on("timeout", () => { console.error("timeout"); req.destroy(); process.exit(7); });
req.write(body);
req.end();
