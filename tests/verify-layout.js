/* ─────────────────────────────────────────────────────────────
   一图流经验卡 —— 版式自检（无浏览器）

   为什么需要它：本机 Edge 的 headless 截图在本环境会被静默终止
   （exit 0 但无产物），无法靠截图做视觉回归。所以把"版面是否会溢出 /
   是否留大片空白"折算成可计算的数字。

   自检三件事：
     1) 不溢出：各固定区块最低高度之和 ≤ 画布高度 905
     2) 不留空：卡片吃掉剩余高度后，卡高落在"不空也不挤"的区间
     3) 装得下：卡内两段文字（做法 + 示例）按字号与列宽折算的行数，
        其总高度不超过卡内可用高度

   用法：node tests/verify-layout.js
   ───────────────────────────────────────────────────────────── */
const E = require("../tools/poster-pingan");

const H = E.H;
const W = E.W;
const PAD_V = 34 + 26;          // .page 上下内边距
const PAD_H = 46 * 2;           // .page 左右内边距
const GAP = 13;                 // 卡片/行间距
const ACTS_MT = 22;             // .acts 上外边距

/* 各固定区块高度估算（按 CSS 写死的字号/行高/内边距折算） */
function fixedBlocks(d, actCount) {
  const hp = E.planHeights(actCount);
  const tight = hp.rows > 1;      // 两行时上方区块收紧，给卡片让位

  // 页眉：badge(font14 + pad5*2 + 边框) ≈ 28
  const hd = 28;

  // 钩子：字号×行高1.24（长标题折 2 行）+ sub 行 + margin + padding
  const hookLen = String(d.hook || "").length + String(d.hookNum || "").length;
  const hookFs = E.hookFontSize(hookLen);
  const hookLines = hookLen > 26 ? 2 : 1;
  const hookGap = hp.giveUpWhenSingleRow ? 34 : (tight ? 14 : 20);
  const hookPadTop = hp.giveUpWhenSingleRow ? 10 : 0;
  const hookBlock = hookGap + hookPadTop + hookFs * 1.24 * hookLines + 13 + 16 * 1.4;

  // 成果带：padding + 数字 + 间距 + 说明
  const resPadY = hp.giveUpWhenSingleRow ? 22 : (tight ? 11 : 13);
  const resGap = hp.giveUpWhenSingleRow ? 34 : (tight ? 14 : 22);
  const results = resGap + resPadY * 2 + 33 + 5 + 17;

  // 底部双栏：padding 15*2 + 标题行 21 + 间距 6 + 正文 2 行
  const foot = 20 + (15 + 21 + 6 + 14.5 * 1.66 * 2 + 15);

  // 品牌条：margin 16 + 边框 1 + padding-top 12 + 行 18
  const brandbar = 16 + 1 + 12 + 18;

  return { hd, hookBlock, results, foot, brandbar };
}

/* 卡片内文字折行数：中文按字号算字宽，英文按 0.55 */
function textWidth(s, fs) {
  let w = 0;
  for (const ch of String(s || "")) {
    w += /[\x00-\xff]/.test(ch) ? fs * 0.55 : fs;
  }
  return w;
}
function lines(s, fs, availW) {
  return Math.max(1, Math.ceil(textWidth(s, fs) / availW));
}

function check(actCount, sample) {
  const d = sample || E.SAMPLE_9;
  const plan = E.planActions(actCount);
  const hp = E.planHeights(actCount);
  const rows = plan.rows.length;

  const f = fixedBlocks(d, actCount);
  const used = f.hd + f.hookBlock + f.results + f.foot + f.brandbar + PAD_V;
  const actsArea = H - used;

  const contentW = W - PAD_H - 7;                 // 减左竖条 7px
  const cardW = (contentW - GAP * (plan.cols - 1)) / plan.cols;
  const cardInnerW = cardW - 16 * 2;              // 卡片左右 padding

  const inner = actsArea - (ACTS_MT + GAP * (rows - 1));
  const cardH = inner / rows;
  const effH = Math.min(cardH, hp.cardMaxH);
  const slackAll = Math.max(0, inner - hp.cardMaxH * rows);

  /* 单行时余量被上方区块吸收（标题/成果带加高、间距放宽），
     自检里按经验值扣除约 80px 的"呼吸感预算"，
     剩余部分才是在动作区里看得见的空白。 */
  const absorbed = rows === 1 ? 80 : 0;
  const slack = Math.max(0, slackAll - absorbed);

  // 卡内文字高度：徽标 30 + 间距 13 + 标题 + 做法(≤2行) + 示例(≤3行)
  const twoRow = rows > 1;
  const colCount = plan.cols;
  let titleSize, descSize, exSize;
  if (twoRow) { titleSize = 20; descSize = 13.5; exSize = 12.5; }
  else if (colCount <= 3) { titleSize = 25; descSize = 15.5; exSize = 14; }
  else { titleSize = 23; descSize = 15; exSize = 13.5; }

  const act = d.actions && d.actions[0] ? d.actions[0] : { t: "标题", d: "做法描述", x: "示例" };
  const tLines = lines(act.t, titleSize, cardInnerW);
  const dLines = lines(act.d, descSize, cardInnerW);
  const xLines = act.x ? lines(act.x, exSize, cardInnerW) : 0;

  const textH =
    30 + 13 +                                  // 序号徽标
    tLines * titleSize * 1.2 + 8 +
    dLines * descSize * 1.7 +
    (act.x ? 10 + 9 + xLines * exSize * 1.62 : 0);

  return {
    actCount, cols: plan.cols, rows, actsArea, cardW, cardInnerW,
    cardH, effH, slack, cap: hp.cardMaxH,
    textH, padNeed: 18 * 2,
    fits: textH + 18 * 2 <= effH + 1,
    tLines, dLines, xLines,
  };
}

function run() {
  let pass = 0, fail = 0;
  const t = (name, ok, extra) => {
    if (ok) { pass++; console.log("  ok   " + name + (extra ? "  → " + extra : "")); }
    else { fail++; console.log("  FAIL " + name + (extra ? "  → " + extra : "")); }
  };

  console.log("\n=== 版式自检：排布与高度 ===\n");

  const cases = [3, 4, 5, 6, 7, 8];
  const rep = [];
  for (const n of cases) {
    const r = check(n, n >= 7 ? E.SAMPLE_7 : E.SAMPLE_9);
    rep.push(r);
    console.log(
      `  ${n} 条 → ${r.cols} 列 ×${r.rows} 行 | 卡宽 ${r.cardW.toFixed(0)}px | ` +
      `卡高 ${r.effH.toFixed(0)}px | 文字需 ${r.textH.toFixed(0)}px ` +
      `(标题${r.tLines}行/做法${r.dLines}行/示例${r.xLines}行)`
    );
  }

  console.log("");
  for (const r of rep) {
    t(`${r.actCount} 条动作区高度为正`, r.actsArea > 0, r.actsArea.toFixed(0) + "px");
    t(`${r.actCount} 条卡高 150–310px`, r.effH >= 150 && r.effH <= 310, r.effH.toFixed(0) + "px");
    t(`${r.actCount} 条卡内文字装得下`, r.fits,
      `需 ${(r.textH + r.padNeed).toFixed(0)} / 有 ${r.effH.toFixed(0)}px`);
  }

  console.log("");
  for (const r of rep) {
    t(`${r.actCount} 条卡宽够写两段文字`, r.cardInnerW >= 200, r.cardInnerW.toFixed(0) + "px");
    t(`${r.actCount} 条动作区残留空白 ≤60px`, r.slack <= 60, r.slack.toFixed(0) + "px");
  }

  // 排布规则
  console.log("");
  const expect = { 3: "3", 4: "4", 5: "3+2", 6: "3+3", 7: "4+3", 8: "4+4" };
  for (const n of cases) {
    const p = E.planActions(n);
    const got = p.rows.map(r => r.length).join("+");
    t(`${n} 条排布 = ${expect[n]}`, got === expect[n], got);
  }
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    const p = E.planActions(n);
    const total = p.rows.reduce((a, r) => a + r.length, 0);
    t(`${n} 条卡片总数正确`, total === n, `${total}`);
  }

  // 字号单调性
  console.log("");
  const sizes = [10, 14, 20, 30].map(E.hookFontSize);
  t("标题字号随长度单调不增", sizes[0] >= sizes[1] && sizes[1] >= sizes[2] && sizes[2] >= sizes[3], sizes.join(" → "));

  // 示例缺失时不影响
  console.log("");
  const noX = E.planActions(5);
  const r5 = check(5, Object.assign({}, E.SAMPLE_9, {
    actions: E.SAMPLE_9.actions.map(a => ({ t: a.t, d: a.d })),
  }));
  t("示例缺失时文字仍装得下", r5.fits, `需 ${(r5.textH + r5.padNeed).toFixed(0)} / 有 ${r5.effH.toFixed(0)}px`);

  console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===\n`);
  return fail === 0;
}

if (require.main === module) {
  process.exit(run() ? 0 : 1);
}
module.exports = { run, check };
