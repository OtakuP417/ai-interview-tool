const path = require("path");
const poster = require(path.resolve("cloudfunctions/interview-proxy/poster.js"));

// 用真实 #7 的报告正文 + 手工按提示词格式补一个「海报摘要」节
const RAW = `
背景与挑战
孤儿单下发后，客户此前在系统进件未获额度、缺乏资质，但征信无问题。

---SECTION---

核心做法
1. 孤儿单下发后第一时间打开了解客户情况。
2. 主动添加客户微信，在系统做好备注，每月定期联系。
3. 客户主动咨询贷款时，先核实基本情况。
4. 确认符合产品要求后，第一时间约见面进件，先申请通过，不提前谈利息。
5. 审批通过后，用还款计划表让客户了解利息。
6. 强调可提前结清、用几个月算几个月利息。
7. 客户不再反感时趁热打铁，推动客户做决定，不拖延。

---SECTION---

关键判断与取舍
1. 先核实条件再进件：确认征信、涉诉、还款能力后推进。
2. 先见面进件、后谈利息。
3. 不轻易放弃已审批客户。

---SECTION---

结果
客户从最初表示"利息好高"到最终顺利放款转化。

---SECTION---

可复制的经验点
在孤儿单下发的情况下，可以第一时间查看历史申请记录和资质。
在客户长期未成交的情况下，可以每月定期联系、及时推送新政策。
在客户嫌利息高的情况下，可以先见面进件、再用还款计划表沟通。
在客户已审批通过的情况下，可以站在客户角度共情引导。

---SECTION---

新人注意事项
不要轻易放弃任何客户。
不要提前跟客户强调利息。
不要急于求成。

---SECTION---

海报摘要
钩子句：搁置半年的孤儿单，靠【7】步跟进重新放款
成果1：1单|从搁置到放款
成果2：6个月|持续维护周期
成果3：30分钟|关键沟通时长
做法1标题：先摸清底子
做法1做法：孤儿单下发就翻历史进件，看额度、资质、准入条件。
做法1示例：第一时间打开看上次为什么没批
做法2标题：月度保温
做法2做法：加上微信并系统备注，每月定期联系，新政策立刻推。
做法2示例：一有新政策马上发消息告知
做法3标题：先过后谈息
做法3做法：符合条件先约见面进件走通流程，通过后再谈钱。
做法3示例：提前说利息，客户连面都不见
做法4标题：算清用资账
做法4做法：用还款计划表讲清利息，结合行业问清资金用途和时长。
做法4示例：用半年提前结清只还多少本金
做法5标题：趁热打铁
做法5做法：客户不再反感时立刻推动做决定，不拖不给反复机会。
做法5示例：客户一犹豫这事就黄了
做法6标题：别轻易放
做法6做法：审批已过的客户有真实用款需求，值得持续跟进。
做法6示例：电话能接通就别判死刑
做法7标题：共情引导
做法7做法：站在客户角度讲清成本，把高利贷的担心讲透。
做法7示例：公司正规合规，账算给你看
判断句：判断客户有真实用款需求且审批已通过，值得坚持跟进。
避坑句：不要提前强调利息，否则可能连见面机会都没有。
`;

const meta = {
  name: "李示例",
  position: "咨询顾问",
  um: "lishili001",
  city: "安康市",
  topic: "孤儿单盘活经验",
  owner: "赵示例",
  ownerOrg: "咸阳安康营业部",
  code: "IV-2026-0007",
  date: "2026-09-24",
};

console.log("pickLayout:", poster.pickLayout(RAW, meta));
const parsed = poster.parsePosterSummary(RAW);
console.log("parsed:", parsed ? { hook: parsed.hook, hookNum: parsed.hookNum, results: parsed.results, acts: parsed.actions.length, judge: parsed.judge, pit: parsed.pit } : null);
const html = poster.renderPosterMarkup(RAW, meta);
console.log("is flow:", html.includes("fv-page"));
console.log("has 赵示例:", html.includes("赵示例"));
console.log("has lishili001:", html.includes("lishili001"));
console.log("hookNum leaked twice:", (html.match(/7/g)||[]).length > 30 ? "check" : "ok");
require("fs").writeFileSync("tests/e2e/out/prod-flow-live.html", html, "utf-8");
console.log("written tests/e2e/out/prod-flow-live.html len=", html.length);
