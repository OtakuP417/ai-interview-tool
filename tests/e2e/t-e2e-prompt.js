/* 端到端验证：新提示词 → 线上 /api/chat → parsePosterSummary → renderFlowMarkup */
const fs = require("fs");
const path = require("path");
const http = require("http");

// 1. 从 index.html 抽取 REPORT_PROMPT 模板并实例化
const html = fs.readFileSync("web/index.html", "utf-8");
const m = html.match(/const REPORT_PROMPT = \(n, p, t\) => `([\s\S]*?)`;/);
if (!m) { console.error("REPORT_PROMPT not found"); process.exit(1); }
const REPORT_PROMPT = (n, p, t) => m[1].replace(/\$\{n\}/g, n).replace(/\$\{p\}/g, p).replace(/\$\{t\}/g, t);

// 2. 模拟一段真实访谈对话（基于李示例孤儿单案例的口吻）
const DIALOGUE = [
  { role: "system", content: "你是一名业务训练岗的访谈助手，正在对咨询顾问做经验访谈。围绕案例主题逐层追问，每次问一个问题，追问具体动作和原话。" },
  { role: "user", content: "你好李示例，今天想跟你聊聊孤儿单盘活这个案例。先说说这个客户一开始是什么情况？" },
  { role: "assistant", content: "这个单子在我名下放了半年多，客户之前自己进件过一次没过，没额度。我拿到手先做的不是打电话，是打开系统看他上次的申请记录，看卡在哪：是资质缺还是征信问题。看完发现征信没问题，就是当时政策不匹配，这种情况就有得做。" },
  { role: "user", content: "然后你怎么跟他建立联系的？客户隔了这么久。" },
  { role: "assistant", content: "我先加他微信，通过之后在系统里做好备注，写上聊到哪一步了。然后每个月固定联系一次，平时不发产品广告。关键是公司一出新政策，我马上想到他——上次他就是因为政策不符，现在政策变了就是机会。" },
  { role: "user", content: "客户主动来咨询的时候，你怎么推进的？中间有没有遇到阻力？" },
  { role: "assistant", content: "有。他来问的时候我先核实三件事：有没有当前逾期、有没有涉诉、还款能力怎么样。没问题我就约当面进件，先不谈利息——提前说利息他可能连面都不见。审批通过之后，我拿还款计划表一条一条给他看，他说'利息好高，是不是高利贷'，我就讲公司是正规持牌的，再结合他做餐饮的生意，问资金用多久、什么时候回款，帮他算提前结清的账：用半年提前结清只还多少本金。他算了账就接受了。" },
  { role: "user", content: "最后结果怎么样？" },
  { role: "assistant", content: "从他说'利息好高用不起'到最后放款，就谈了半个多小时。这单让我最大的体会是别轻易放弃任何客户，电话能打通、有咨询意向就有机会。" },
];

const messages = [
  ...DIALOGUE,
  { role: "user", content: REPORT_PROMPT("李示例", "咨询顾问", "孤儿单盘活经验") },
];

// 3. 调线上 /api/chat
const body = JSON.stringify({
  model: "deepseek-v4-flash",
  messages: messages,
  stream: false,
  max_tokens: 4600,
});
const req = http.request(
  {
    hostname: "work-d1gs0jzrg2277d75e-1391683363.ap-shanghai.app.tcloudbase.com",
    path: "/api/chat",
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    timeout: 120000,
  },
  function (res) {
    let data = "";
    res.on("data", (c) => (data += c));
    res.on("end", function () {
      try {
        const j = JSON.parse(data);
        const ch = j.choices && j.choices[0] ? j.choices[0] : {};
        console.log("finish_reason:", ch.finish_reason);
        console.log("usage:", JSON.stringify(j.usage || {}));
        if (ch.message && ch.message.reasoning_content) {
          console.log("reasoning_tokens:", (j.usage||{}).completion_tokens_details ? JSON.stringify(j.usage.completion_tokens_details) : "n/a");
          console.log("reasoning_len:", String(ch.message.reasoning_content).length);
        }
        const content = (ch.message && ch.message.content) || "";
        fs.writeFileSync("tests/e2e/out/e2e-report.md", content, "utf-8");
        console.log("=== chat ok, report length:", content.length, "===");
        const hasPoster = content.includes("海报摘要");
        console.log("contains 海报摘要:", hasPoster);
        if (!hasPoster) {
          console.log("--- full output ---");
          console.log(content);
          process.exit(2);
        }
        // 4. 用云函数同款解析器验证
        const poster = require(path.resolve("cloudfunctions/interview-proxy/poster.js"));
        const meta = { name: "李示例", position: "咨询顾问", um: "lishili001", city: "安康市", topic: "孤儿单盘活经验", owner: "赵示例", ownerOrg: "咸阳安康营业部", code: "IV-2026-TEST", date: "2026-09-24" };
        const parsed = poster.parsePosterSummary(content);
        if (!parsed) { console.error("!!! parsePosterSummary returned null"); console.log(content.slice(-800)); process.exit(3); }
        console.log("hook:", parsed.hook, "| num:", parsed.hookNum);
        console.log("hookParts:", JSON.stringify(parsed.hookParts));
        console.log("results:", JSON.stringify(parsed.results));
        console.log("acts:", parsed.actions.length, "| first:", JSON.stringify(parsed.actions[0]));
        console.log("judge:", parsed.judge);
        console.log("pit:", parsed.pit);
        // 5. 渲染
        const fm = poster.renderFlowMarkup(content, meta);
        if (fm) {
          fs.writeFileSync("tests/e2e/out/e2e-flow.html", fm, "utf-8");
          console.log("flow markup written, len:", fm.length);
        } else {
          console.error("!!! renderFlowMarkup returned null");
          process.exit(4);
        }
      } catch (e) {
        console.error("parse error:", e.message, "| raw head:", data.slice(0, 300));
        process.exit(5);
      }
    });
  }
);
req.on("error", (e) => { console.error("request error:", e.message); process.exit(6); });
req.on("timeout", () => { console.error("timeout"); req.destroy(); process.exit(7); });
req.write(body);
req.end();
