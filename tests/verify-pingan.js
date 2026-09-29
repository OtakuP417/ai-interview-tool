/* ─────────────────────────────────────────────────────────────
   一图流经验卡 —— DOM 结构自检（jsdom，无浏览器）

   验证渲染出的 HTML 真的含有所需的元素与数量，
   避免"CSS 算对了但 HTML 没渲染出来"这类问题。

   用法：node tests/verify-pingan.js
   （需 NODE_PATH 指向 jsdom 所在 node_modules）
   ───────────────────────────────────────────────────────────── */
const path = require("path");
const { JSDOM } = require("jsdom");
const E = require("../tools/poster-pingan");

let pass = 0, fail = 0;
function t(name, ok, extra) {
  if (ok) { pass++; console.log("  ok   " + name + (extra ? "  → " + extra : "")); }
  else { fail++; console.log("  FAIL " + name + (extra ? "  → " + extra : "")); }
}

function domOf(sample) {
  const html = E.renderPingan("", sample);
  return new JSDOM(html).window.document;
}

console.log("\n=== DOM 自检：5 条版本（3+2 两行） ===\n");
{
  const d = domOf(E.SAMPLE_9);
  const acts = d.querySelectorAll(".act");
  t("动作卡数量 = 5", acts.length === 5, String(acts.length));
  t("拆两行（2 个 .act-row）", d.querySelectorAll(".act-row").length === 2);
  t("第一行 3 张 / 第二行 2 张",
    d.querySelectorAll(".act-row")[0].querySelectorAll(".act").length === 3 &&
    d.querySelectorAll(".act-row")[1].querySelectorAll(".act").length === 2);
  t(".acts 垂直居中样式存在", /justify-content:center/.test(htmlOf(E.SAMPLE_9)));
  t("成果带 3 格", d.querySelectorAll(".res").length === 3);
  t("底部双栏齐备", d.querySelectorAll(".fbox.judge").length === 1 && d.querySelectorAll(".fbox.pit").length === 1);

  // 页眉
  const badge = d.querySelector(".badge");
  t("页眉徽标为「经验萃取」", badge && badge.textContent === "经验萃取", badge && badge.textContent);
  const code = d.querySelector(".code");
  t("档案编号存在且含 IV-", code && /IV-\d{4}-\d{4}/.test(code.textContent), code && code.textContent);

  // 品牌条
  const bn = d.querySelector(".brandbar .b-name");
  t("品牌条左侧 = 陕分业务营销部训练室", bn && bn.textContent === "陕分业务营销部训练室", bn && bn.textContent);
  const br = d.querySelector(".brandbar .b-r");
  t("品牌条右侧 = 实战经验一图流", br && br.textContent === "实战经验一图流", br && br.textContent);

  // 序号连续
  const nums = [...d.querySelectorAll(".act-n")].map(x => x.textContent.trim());
  t("动作卡序号 1..5 连续", nums.join(",") === "1,2,3,4,5", nums.join(","));

  // 卡片两段式内容
  t("每张卡都有做法描述 .act-d", d.querySelectorAll(".act-d").length === 5);
  t("每张卡都有示例 .act-x", d.querySelectorAll(".act-x").length === 5);
  const firstX = d.querySelector(".act-x").textContent;
  t("示例块带「例」标记", /例/.test(firstX), firstX.slice(0, 24));

  // 内容厚度：每张卡 = 做法 + 示例，应显著厚于旧版（旧版只有一段 17 字）
  const cards = [...d.querySelectorAll(".act")];
  const perCard = cards.map(c => {
    const dd = c.querySelector(".act-d") ? c.querySelector(".act-d").textContent.length : 0;
    const xx = c.querySelector(".act-x") ? c.querySelector(".act-x").textContent.length : 0;
    return dd + xx;
  });
  const avg = perCard.reduce((a, b) => a + b, 0) / perCard.length;
  t("每卡文字量平均 ≥50 字（旧版仅 17 字）", avg >= 50, "均值 " + avg.toFixed(0) + " 字");
  t("做法描述平均 ≥25 字", cards.every(c => c.querySelector(".act-d").textContent.length >= 25),
    "最短 " + Math.min(...cards.map(c => c.querySelector(".act-d").textContent.length)) + " 字");
  t("描述未被截断（无省略号）", ![].concat(
    [...d.querySelectorAll(".act-d")].map(x => x.textContent),
    [...d.querySelectorAll(".act-x")].map(x => x.textContent)
  ).some(s => s.includes("…")));

  t("HTML 不含深色底 #1a1a1a 之类", !/#1a1a1a|#111|#000000/i.test(htmlOf(E.SAMPLE_9)));
}

function htmlOf(s) { return E.renderPingan("", s); }

console.log("\n=== DOM 自检：7 条版本（两行自适应） ===\n");
{
  const d = domOf(E.SAMPLE_7);
  const acts = d.querySelectorAll(".act");
  t("动作卡数量 = 7", acts.length === 7, String(acts.length));
  t("拆两行（2 个 .act-row）", d.querySelectorAll(".act-row").length === 2, String(d.querySelectorAll(".act-row").length));
  t("第一行 4 张", d.querySelectorAll(".act-row")[0].querySelectorAll(".act").length === 4);
  t("第二行 3 张", d.querySelectorAll(".act-row")[1].querySelectorAll(".act").length === 3);
  t("两行版每张卡也带示例", d.querySelectorAll(".act-x").length === 7);

  const nums = [...d.querySelectorAll(".act-n")].map(x => x.textContent.trim());
  t("序号连续 1..7", nums.join(",") === "1,2,3,4,5,6,7", nums.join(","));
}

console.log("\n=== 内容适应性：极端数量 ===\n");
{
  // 3 条：应为 3 列单行、字最大，卡片封顶 300px
  const d3 = domOf(Object.assign({}, E.SAMPLE_9, { actions: E.SAMPLE_9.actions.slice(0, 3) }));
  t("3 条 → 3 列单行", d3.querySelectorAll(".act-row").length === 1 &&
    d3.querySelectorAll(".act").length === 3);
  t("3 条 → 卡片封顶 300px 生效", /max-height:\s*300px/.test(htmlOf(Object.assign({}, E.SAMPLE_9, { actions: E.SAMPLE_9.actions.slice(0, 3) }))));

  // 8 条：两行各 4
  const eight = E.SAMPLE_7.actions.concat([{ t: '复查', d: '定期回访确认客户需求变化' }]);
  const d8 = domOf(Object.assign({}, E.SAMPLE_7, { actions: eight }));
  const rows8 = d8.querySelectorAll(".act-row");
  t("8 条 → 两行", rows8.length === 2);
  t("8 条 → 4+4", rows8[0].querySelectorAll(".act").length === 4 && rows8[1].querySelectorAll(".act").length === 4);
}

console.log("\n=== 字段来源：被访谈人 ≠ 后线对接人 ===\n");
{
  // #7 李示例：后线对接人必须是 刘龙刚，绝不能是被访谈人的 UM
  const d7 = domOf(E.SAMPLE_7);
  const sub7 = [...d7.querySelectorAll(".sub")].map(x => x.textContent).join("");
  t("7 条版后线对接显示 刘龙刚", /刘龙刚/.test(sub7), sub7.slice(0, 60));
  t("7 条版后线对接不含 lishili001", !/lishili001/i.test(sub7));
  t("7 条版后线对接带组织 咸阳安康营业部", /咸阳安康营业部/.test(sub7));

  const hd7 = d7.querySelector(".hd-r").textContent;
  t("7 条版页眉显示被访谈人 李示例", /李示例/.test(hd7), hd7.trim());

  // #9：后线对接人字段本身是 UM 形态（归档数据有误），必须整段隐藏，
  // 且绝不能编造人名（曾误把 #5 的被访谈人"李娟"填进来）
  const d9 = domOf(E.SAMPLE_9);
  const sub9 = [...d9.querySelectorAll(".sub")].map(x => x.textContent).join("");
  t("9 条版后线对接整段隐藏（源字段是 UM）", !/后线对接/.test(sub9), sub9.slice(0, 60));
  t("9 条版不得出现编造的人名 李娟", !/李娟/.test(htmlOf(E.SAMPLE_9)));
  t("9 条版不得出现李娟的 UM EXAMPLE002", !/EXAMPLE002/i.test(htmlOf(E.SAMPLE_9)));
  t("9 条版页眉显示被访谈人标识 EXAMPLE001", /EXAMPLE001/.test(d9.querySelector(".hd-r").textContent),
    d9.querySelector(".hd-r").textContent.trim());
  t("9 条版页眉不出现两个 UM 并列",
    !/EXAMPLE001（EXAMPLE007）/.test(d9.querySelector(".hd-r").textContent));

  // 兜底：owner 长得像 UM 时必须整段隐藏，而不是把错的人印上去
  const bad = E.renderPingan("", Object.assign({}, E.SAMPLE_7, { owner: "lishili001", ownerOrg: "安康咨询中心" }));
  t("owner 疑似 UM 时整段隐藏", !/后线对接/.test(bad));

  // 只有姓名、没有组织时也要正常显示
  const noOrg = E.renderPingan("", Object.assign({}, E.SAMPLE_7, { owner: "刘龙刚", ownerOrg: "" }));
  t("无组织时只显示姓名", /后线对接/.test(noOrg) && /刘龙刚/.test(noOrg));
}

console.log("\n=== 转义安全 ===\n");
{
  const danger = Object.assign({}, E.SAMPLE_9, {
    hook: '<script>alert(1)</script>',
    judge: '"quoted" & <b>bold</b>',
  });
  const html = E.renderPingan("", danger);
  t("钩子标题中的 <script> 被转义", !/<script>alert/.test(html));
  t("判断句中的引号/& 被转义", /&quot;quoted&quot; &amp;/.test(html));
}

console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===\n`);
process.exit(fail === 0 ? 0 : 1);
