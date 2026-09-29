/* ─────────────────────────────────────────────────────────────
   一图流经验卡（平安橙 · 浅色版）—— 1610×905

   ── 设计说明 ──
   1) 浅色底（白 + 极浅暖灰），专为投影仪/打印设计。
      深底在会议室投影上普遍偏暗，文字边缘发糊，浅底更稳。
   2) 平安橙 #EA5504 作视觉主轴：标题数字、序号徽章、成果数字、
      左侧竖条、页眉徽标。橙色面积控制在 15% 以内——铺大色块会变成
      促销广告感，深色文字 + 少量橙才是"内部精品"气质。
   3) 版式"内容自适应"：要点数量不是固定的。
      5–7 条核心做法会自动选择 5 栏 / 6 栏 / 4+3 两行；
      只有 3 条时还会把卡片做宽、字号做大。
      不变的只有：配色、角标、页眉页脚、卡片样式。
   4) 纵向留白的处理：剩余高度不能全给动作卡——6 条以内单行时会把卡片
      拉到 400px 以上，卡里只有百来字，看着就是"空"。
      所以按要点数量分档：
        · 要点少（3–4 条）→ 卡片加高但仍设上限，余量给上方标题区
          与成果带，让这三块一起分担，页面才"稳"；
        · 要点多（5–6 条）→ 卡片撑满剩余高度（此时每卡内容够，不显空）；
        · 要点很多（7+ 条）→ 自动拆两行，卡片高度天然回落。
      卡片内容一律垂直居中，短描述时不会顶部对齐留下一截空白。
   ───────────────────────────────────────────────────────────── */

const W = 1610;
const H = 905;

const BG      = '#FFFFFF';
const BG_SOFT = '#FBF8F5';   // 极浅暖灰，卡片底
const BG_TINT = '#FFF6EF';   // 橙色淡染，用于成果带/判断框
const LINE    = '#EFE6DE';   // 描边
const LINE_2  = '#E3D5C9';   // 强调描边
const TXT     = '#2A211B';   // 主文字（暖黑，不用纯黑）
const TXT_2   = '#7A6555';   // 次要文字
const TXT_3   = '#A08E7E';   // 三级文字

const ORANGE  = '#EA5504';
const ORANGE_L= '#FF8A3D';
const ORANGE_D= '#B8430A';   // 橙色文字压深，保证浅底可读性

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* 按显示宽度截断：中文算 1，英文/数字算 0.55 */
function clip(s, max) {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  let w = 0, out = '';
  for (const ch of t) {
    const cw = /[\x00-\xff]/.test(ch) ? 0.55 : 1;
    if (w + cw > max) return out + '…';
    w += cw; out += ch;
  }
  return out;
}

/* ─────────────────────────────────────────────
   版式决策：按要点数量选排布
   返回 { cols, rows: [[slice], [slice]] }

   ★ 条数 → 列数的映射刻意比"刚好塞下"少一列：
     5 条时用 4 列（而非 5）、6 条时用 5 列（而非 6），
     余下 1 条放到第二行（配合下方两行排布）。
     原因：卡片宽一点，才能装下"做法 + 示例"两段文字，
     否则每张卡只能写十来个字，经验内容会显得很单薄。
   ───────────────────────────────────────────── */
function planActions(n) {
  if (n <= 0) return { cols: 1, rows: [[]] };
  if (n <= 3) return { cols: n, rows: [range(n)] };          // 1–3 条：单行，字最大
  if (n === 4) return { cols: 4, rows: [range(4)] };          // 4 条：单行 4 列
  if (n <= 6) return { cols: 3, rows: splitRows(n, 3) };       // 5–6 条：3+2 / 3+3，卡片宽
  const cols = Math.min(Math.ceil(n / 2), 4);                  // 7+ 条：两行，每行 ≤4
  return { cols, rows: splitRows(n, cols) };
}
function range(n, from) {
  const a = [];
  for (let i = from || 0; i < n; i++) a.push(i);
  return a;
}
/* 把 n 条尽量平均地拆成两行，每行不超过 cols */
function splitRows(n, cols) {
  const rows = [];
  let i = 0;
  while (i < n) {
    const left = n - i;
    const remainRows = Math.ceil(left / cols);
    // 平均分配：当前行取 ceil(剩余/剩余行数)，保证最后一行不会太空
    const take = Math.ceil(left / remainRows);
    rows.push(range(i + take, i));
    i += take;
  }
  return rows;
}

/* ─────────────────────────────────────────────
   纵向配平：卡片高度上限 + 是否需要把余量交还上方区块

   卡片现在装两段文字（做法 + 示例），比旧版高，所以：
     · 单行（1–4 条）→ 卡片可到 300px，余量交还标题区与成果带；
     · 两行（5 条以上）→ 每行卡片约 200px，天然填满，不再补白。
   ───────────────────────────────────────────── */
function planHeights(n) {
  const rows = planActions(n).rows.length;

  const capOneRow = 300;
  // 两行：每张卡要装"标题 + 做法 2 行 + 示例 2 行"≈200px，
  // 加上卡片内上下 padding 36px，给到 236px 才不挤。
  const capTwoRow = 236;

  return {
    cardMaxH: rows > 1 ? capTwoRow : capOneRow,
    rows,
    giveUpWhenSingleRow: rows === 1,
  };
}

/* ── 卡片内两段文字的截断长度 ──
   d（做法）：一行提要，2 行以内
   x（示例/原话）：可照搬的细节，2–3 行
   列越少卡越宽，能装的字越多。 */
function descLimitFor(cols, twoRow) {
  if (twoRow) return cols <= 3 ? 52 : 42;
  if (cols <= 3) return 72;
  return 56;   // 4 列
}
function exampleLimitFor(cols, twoRow) {
  if (twoRow) return cols <= 3 ? 56 : 46;
  if (cols <= 3) return 76;
  return 62;
}

/* 标题字号按长度自适应：短句放大更有气势，长句收小避免折行难看 */
function hookFontSize(len) {
  if (len <= 12) return 56;
  if (len <= 17) return 50;
  if (len <= 23) return 44;
  return 39;
}

/* ─────────────────────────────────────────────
   样本数据（取自归档 #9 / #7，用于过样式）
   ───────────────────────────────────────────── */
const SAMPLE_9 = {
  issue: '第 9 期',
  code: 'IV-2026-0009',
  date: '2026-09-24',
  hook: '额度不大的老客户，也能转介绍出',
  hookNum: '100 万',
  results: [
    { k: '100 万', v: '成功放款' },
    { k: '老客户', v: '客户来源 · 主动转介绍' },
    { k: '靠谱 专业', v: '客户对顾问的评价' },
  ],
  sub: '5 个动作，把"沉睡客户"变成转介绍来源',
  /* 被访谈人：本条归档的 interviewee_name 位填的就是 UM 号（EXAMPLE001），
     interviewee_um 另存 EXAMPLE007。两个都是 UM 形态、非真实姓名，
     姓名待补 —— 这里如实照录，不做美化。 */
  person: 'EXAMPLE001',
  personUm: '',
  city: '西安',
  actions: [
    {
      t: '节日送小礼',
      d: '端午、过年送公司小礼品或自购水果，借上门机会自然宣导产品政策',
      x: '不空手上门，礼品随身带着，聊完近况顺口提一句政策',
    },
    {
      t: '日常点赞',
      d: '持续给客户朋友圈点赞、评论，保持存在感和好感度，不推销',
      x: '看到客户发经营动态就点个赞，逢节日私发一句问候',
    },
    {
      t: '请客户拉群',
      d: '关系熟了以后，请老客户帮忙把自己的熟人拉个群，接触潜在资源',
      x: '话术："哥，你身边有做生意的朋友要资金，拉个群我帮看看"',
    },
    {
      t: '摸清用款节奏',
      d: '聊天中了解客户所在行业的淡旺季和资金紧张时段，为精准跟进打基础',
      x: '记下客户行业每年哪几个月最缺钱，到点前一两周先联系',
    },
    {
      t: '立专业人设',
      d: '日常沟通展现专业和靠谱，让客户在朋友有需求时第一时间想到你',
      x: '政策变化主动告知，客户问到的事当场给准信儿，不糊弄',
    },
  ],
  judge: '维护老客户不能只靠一次性成交。本次客户此前额度并不大，但正因为平时持续维护，朋友有需求时第一时间想到他。选"轻量高频"的日常互动，而非只在有业务时才联系。',
  pit: '别只在有业务需求时才联系客户，平时缺乏互动，关键时刻客户想不起你；也别忽视小额度客户——本次 100 万转介绍就来自一位此前额度不大的老客户。',
  /* 后线对接人：取 backend_owner_name（+ backend_owner_org）。
     ★ 本条归档数据本身有问题：backend_owner_name = "example007"，
       与被访谈人的 interviewee_um 是同一个串，显然填错。
       真实后线对接人姓名未知 —— 不知道就不写，交由渲染兜底自动隐藏，
       绝不编一个名字顶上（编造的人名会随海报发给一线，性质更严重）。 */
  owner: 'example007',
  ownerOrg: '西安第一咨询中心',
};

/* 7 条做法这一份，用来验证「拆两行」自适应 */
const SAMPLE_7 = {
  issue: '第 7 期',
  code: 'IV-2026-0007',
  date: '2026-09-22',
  hook: '沉睡的孤儿单，7 步重新盘活',
  hookNum: '',
  results: [
    { k: '9 单', v: '成功盘活' },
    { k: '3 个月', v: '平均盘活周期' },
    { k: '孤儿单', v: '客户来源 · 存量分配' },
  ],
  sub: '7 个动作，把"没人管的老客户"重新跑起来',
  person: '李示例',
  personUm: 'lishili001',
  city: '安康',
  actions: [
    {
      t: '先查底档',
      d: '孤儿单下发后第一时间打开看：上次申请记录、有没有额度、有无资质、是否符合进件要求',
      x: '把"能进件 / 需等待"先分个类，避免盲目打电话',
    },
    {
      t: '加微信备注',
      d: '主动加客户微信，在系统里做好备注，每月定期联系一次，一有新政策立刻发消息',
      x: '备注写清行业和上次未通过原因，下次联系不用重新问',
    },
    {
      t: '先核情况',
      d: '客户主动咨询时，先确认无当前逾期、无涉诉、有还款能力，再推进进件或约见面',
      x: '这三条不过关就先不做无用功，把精力留给能成的',
    },
    {
      t: '先见面进件',
      d: '确认符合产品要求后第一时间约见面进件，先申请通过，不提前谈利息',
      x: '提前说利息，客户可能连见面机会都不给',
    },
    {
      t: '算清成本',
      d: '审批通过后用还款计划表讲利息，被质疑高利贷时说明公司正规合规，结合行业聊资金用途',
      x: '强调可提前结清、用几个月算几个月利息',
    },
    {
      t: '帮客户算账',
      d: '帮客户算清用半年后提前结清只需还多少本金，逐步引导接受',
      x: '把"总利息"拆成"每月多少"，客户体感压力小很多',
    },
    {
      t: '趁热打铁',
      d: '客户不再反感时立刻推动做决定，不拖延，避免客户反复犹豫错过窗口',
      x: '当天能定的不拖到第二天，话到点上就把单子往前推',
    },
  ],
  judge: '先见面进件、后谈利息——判断若提前说利息，客户可能连见面机会都不给。已审批的客户不轻易放弃，有真实用款需求就值得坚持跟进。',
  pit: '别提前跟客户强调利息，否则连见面机会都没有；也别轻易放弃任何客户，只要电话能联系上、有咨询意向，就第一时间加微信做备注。',
  /* 后线对接人取自 backend_owner_name / backend_owner_org，不是被访谈人的 UM */
  owner: '刘龙刚',
  ownerOrg: '咸阳安康营业部',
};

function renderPingan(raw, meta) {
  const d = Object.assign({}, SAMPLE_9, meta || {});

  const acts = d.actions || [];
  const plan = planActions(acts.length);
  const hplan = planHeights(acts.length);

  /* 单行且要点不多时的余量分配：
     1) 描述文字放宽截断长度——卡片区有富余，说明内容装得太少，
        先让内容变多（3 行描述），这是最有价值的用法；
     2) 卡片高度给到 290px，内容在卡内垂直居中，显得舒展；
     3) 剩余高度由动作区内部上下均分（justify-content:center），
        形成与成果带/底部框对称的章节间距，不堆在一处。 */
  /* 卡片封顶后的余量分配：
     · 单行 1–4 条：余量给上方区块做呼吸感（标题区/成果带加高、间距放宽）；
     · 两行 5 条以上：空间宝贵，要反过来——把上方区块收紧，
       把高度让给卡片，否则卡里两段文字装不下。 */
  const breathe = hplan.giveUpWhenSingleRow;
  const tight = hplan.rows > 1;          // 两行：上方收紧
  const hookGap = breathe ? 34 : (tight ? 14 : 20);
  const resGap = breathe ? 34 : (tight ? 14 : 22);
  const resPadY = breathe ? 22 : (tight ? 11 : 13);
  const hookPadTop = breathe ? 10 : 0;

  /* 单行时按列数收窄字号，列越少字越大；两行时固定用中号 */
  const twoRow = plan.rows.length > 1;
  const colCount = plan.cols;
  let titleSize, descSize, exSize;
  if (twoRow) { titleSize = 20; descSize = 13.5; exSize = 12.5; }
  else if (colCount <= 3) { titleSize = 25; descSize = 15.5; exSize = 14; }
  else { titleSize = 23; descSize = 15; exSize = 13.5; }

  const descLimit = descLimitFor(colCount, twoRow);
  const exLimit = exampleLimitFor(colCount, twoRow);

  /* ── 两个「人」的字段不能混 ──
     被访谈人 = interviewee_name（+ interviewee_um）
     后线对接人 = backend_owner_name（+ backend_owner_org）
     前者是受访的咨询顾问，后者是该条经验的对接责任人，是两个不同的人。

     实际数据里两种字段都出现过"填成 UM 号"的情况（如 #9 的
     interviewee_name 与 backend_owner_name 都是 UM 形态），所以这里统一兜底：
       · 后线对接人看起来是 UM 号 → 整段隐藏（宁可少一行字，
         也不能把错的人、或一个 UM 串印在图上发给一线）；
       · 被访谈人看起来是 UM 号 → 去掉重复的括注，只显示一次，
         避免出现"EXAMPLE001（EXAMPLE007）"这种把两个 UM 并列的怪样子。 */
  const looksLikeUm = (s) => /^[A-Za-z][A-Za-z0-9_]*$/.test(String(s || "").trim());
  const ownerName = String(d.owner || "").trim();
  const ownerOrg = String(d.ownerOrg || "").trim();
  const ownerTxt = (!ownerName || looksLikeUm(ownerName))
    ? ""
    : (ownerOrg ? ownerName + " · " + ownerOrg : ownerName);

  /* 被访谈人：姓名 + 可选 UM 括注；若姓名位本身是 UM，则只显示一次 */
  const personName = String(d.person || "").trim();
  const personUm = String(d.personUm || "").trim();
  const personTxt = !personName
    ? ""
    : (personUm && personUm.toUpperCase() !== personName.toUpperCase()
        ? personName + "（" + personUm + "）"
        : personName);

  /* 卡片三段式：序号+标题 → 做法提要 → 可照搬的示例/原话。
     示例缺失时自动收起（不占位、不留空行），保证少内容的卡不难看。 */
  const cardHtml = (a, i) => `
      <div class="act">
        <div class="act-n">${i + 1}</div>
        <div class="act-t">${esc(clip(a.t, 12))}</div>
        <div class="act-d">${esc(clip(a.d, descLimit))}</div>
        ${a.x ? '<div class="act-x"><span class="q">例</span>' + esc(clip(a.x, exLimit)) + '</div>' : ''}
      </div>`;

  /* 每行独立定列数：末行卡片少时用本行张数定列，避免右侧空格；
     两行列数不一致会让卡片宽度不同，但 3+2 / 4+3 的差异在视觉上可接受，
     比留一个空格子好看。 */
  const rowHtml = plan.rows.map(r =>
    `<div class="act-row" style="grid-template-columns:repeat(${r.length},1fr)">${
      r.map(i => cardHtml(acts[i], i)).join('')
    }</div>`
  ).join('');

  const results = (d.results || []).map(r => `
      <div class="res">
        <div class="res-k">${esc(clip(r.k, 12))}</div>
        <div class="res-v">${esc(clip(r.v, 20))}</div>
      </div>`).join('');

  const hookLen = String(d.hook || '').length + String(d.hookNum || '').length;
  const hookSize = hookFontSize(hookLen);

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<style>
  @page { size: ${W}px ${H}px; margin: 0; }
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:${W}px; height:${H}px; overflow:hidden; background:#fff; }

  .page {
    width:${W}px; height:${H}px; position:relative; overflow:hidden;
    background:
      radial-gradient(105% 78% at 96% -8%, ${BG_TINT} 0%, rgba(255,246,239,.55) 34%, ${BG} 62%),
      ${BG};
    font-family:-apple-system,"PingFang SC","Microsoft YaHei","Segoe UI",sans-serif;
    color:${TXT};
    display:flex; flex-direction:column;
    padding:34px 46px 26px;
  }
  /* 左侧橙色竖条：品牌色的"锚"，比铺大色块克制 */
  .page::before {
    content:''; position:absolute; left:0; top:0; bottom:0; width:7px;
    background:linear-gradient(180deg,${ORANGE} 0%,${ORANGE_L} 55%,${ORANGE} 100%);
  }

  /* ── 页眉 ── */
  .hd { display:flex; align-items:center; justify-content:space-between; flex-shrink:0; }
  .hd-l { display:flex; align-items:center; gap:10px; }
  .badge {
    background:${ORANGE}; color:#fff; font-size:14px; font-weight:500;
    padding:5px 13px; border-radius:5px; letter-spacing:.3px;
  }
  .code {
    font-size:14px; font-weight:500; color:${ORANGE_D};
    background:${BG_TINT}; border:1px solid ${LINE_2};
    padding:4px 11px; border-radius:5px; letter-spacing:.5px;
  }
  .hd-r { font-size:14px; color:${TXT_2}; }
  .hd-r b { color:${TXT}; font-weight:500; }

  /* ── 钩子标题 ── */
  .hook { margin-top:${hookGap}px; padding-top:${hookPadTop}px; flex-shrink:0; }
  .hook-l1 {
    font-size:${hookSize}px; line-height:1.24; font-weight:500;
    letter-spacing:-0.4px; color:${TXT};
  }
  .hook-num {
    color:${ORANGE}; font-weight:500; position:relative; padding:0 3px;
  }
  .hook-num::after {
    content:''; position:absolute; left:0; right:0; bottom:6px; height:10px;
    background:rgba(234,85,4,.16); z-index:-1; border-radius:2px;
  }
  .sub { margin-top:13px; font-size:16px; color:${TXT_2}; }
  .sub .sep {
    display:inline-block; width:4px; height:4px; border-radius:50%;
    background:${LINE_2}; margin:0 9px; vertical-align:middle;
  }
  .sub b { color:${ORANGE_D}; font-weight:500; }

  /* ── 成果带 ── */
  .results {
    display:grid; grid-template-columns:repeat(${Math.max((d.results || []).length, 1)},1fr);
    gap:13px; margin-top:${resGap}px; flex-shrink:0;
  }
  .res {
    background:${BG_TINT}; border:1px solid ${LINE_2};
    border-radius:11px; padding:${resPadY}px 20px;
  }
  .res-k { font-size:${breathe ? 30 : 26}px; font-weight:500; color:${ORANGE}; letter-spacing:.2px; }
  .res-v { font-size:14px; color:${TXT_2}; margin-top:5px; letter-spacing:.2px; }

  /* ── 动作卡（自适应行数）
        这里是页面上唯一吃剩余高度的区域（flex:1）。
        行在区域内垂直居中：卡片封顶后的余量平均分成上下两段，
        与成果带、底部判断框形成对称的章节间距，不会有"坠在一边"的空洞。 ── */
  .acts {
    margin-top:22px; display:flex; flex-direction:column; gap:13px;
    flex:1; min-height:0; justify-content:center;
  }
  .act-row { display:grid; gap:13px; min-height:0; }
  .act {
    background:${BG_SOFT}; border:1px solid ${LINE}; border-radius:11px;
    padding:18px 16px; position:relative; overflow:hidden;
    display:flex; flex-direction:column; justify-content:center;
    max-height:${hplan.cardMaxH}px;
  }
  .act::after {
    content:''; position:absolute; left:16px; right:16px; top:0; height:2.5px;
    background:linear-gradient(90deg,${ORANGE},rgba(234,85,4,0)); border-radius:2px;
  }
  .act-n {
    width:30px; height:30px; border-radius:8px;
    background:${ORANGE}; color:#fff;
    font-size:16px; font-weight:500;
    display:flex; align-items:center; justify-content:center;
    margin-bottom:13px; flex-shrink:0;
  }
  .act-t { font-size:${titleSize}px; font-weight:500; color:${TXT}; letter-spacing:.2px; }
  .act-d { font-size:${descSize}px; line-height:1.7; color:${TXT_2}; margin-top:8px; }
  /* 示例/原话：底色略深一档，与上面的做法提要区分开 */
  .act-x {
    font-size:${exSize}px; line-height:1.62; color:#6B5646;
    margin-top:10px; padding-top:9px; border-top:1px dashed ${LINE_2};
  }
  .act-x .q {
    display:inline-block; font-size:${exSize - 1.5}px; color:${ORANGE_D};
    border:1px solid ${LINE_2}; background:${BG_TINT};
    border-radius:3px; padding:0 4px; margin-right:5px;
    vertical-align:1px; font-weight:500;
  }

  /* ── 底部双栏：判断 + 避坑 ── */
  .foot { display:grid; grid-template-columns:1.35fr 1fr; gap:13px; margin-top:20px; flex-shrink:0; }
  .fbox { border-radius:11px; padding:15px 19px; }
  .fbox .fh {
    font-size:14.5px; font-weight:500; margin-bottom:6px;
    display:flex; align-items:center; gap:7px;
  }
  .fbox .fh .mark { width:13px; height:3px; border-radius:2px; }
  .fbox .ft { font-size:14.5px; line-height:1.66; }
  .fbox.judge { background:${BG_TINT}; border:1px solid ${LINE_2}; }
  .fbox.judge .fh { color:${ORANGE_D}; }
  .fbox.judge .fh .mark { background:${ORANGE}; }
  .fbox.judge .ft { color:#463127; }
  .fbox.pit { background:${BG_SOFT}; border:1px solid ${LINE}; }
  .fbox.pit .fh { color:#8A5A3A; }
  .fbox.pit .fh .mark { background:#C79570; }
  .fbox.pit .ft { color:${TXT_2}; }

  /* ── 品牌条 ── */
  .brandbar {
    margin-top:16px; padding-top:12px; border-top:1px solid ${LINE};
    display:flex; align-items:center; justify-content:space-between;
    font-size:13.5px; color:${TXT_3}; flex-shrink:0;
  }
  .brandbar .b-l { display:flex; align-items:center; gap:9px; }
  .brandbar .b-dot { width:7px; height:7px; border-radius:50%; background:${ORANGE}; }
  .brandbar .b-name { color:${TXT_2}; font-weight:500; letter-spacing:.3px; }
  .brandbar .b-r { color:${ORANGE_D}; font-weight:500; letter-spacing:.3px; }
</style></head>
<body>
<div class="page">

  <div class="hd">
    <div class="hd-l">
      <span class="badge">经验萃取</span>
      <span class="code">${esc(d.code)}</span>
    </div>
    <div class="hd-r"><b>${esc(personTxt)}</b> · ${esc(d.city)} · ${esc(d.date)}</div>
  </div>

  <div class="hook">
    <div class="hook-l1">${esc(d.hook)}<span class="hook-num">${esc(d.hookNum)}</span></div>
    <div class="sub">${esc(d.sub)}${ownerTxt ? '<span class="sep"></span>后线对接 <b>' + esc(ownerTxt) + '</b>' : ''}</div>
  </div>

  <div class="results">${results}</div>

  <div class="acts">${rowHtml}</div>

  <div class="foot">
    <div class="fbox judge">
      <div class="fh"><span class="mark"></span>关键判断</div>
      <div class="ft">${esc(clip(d.judge, 110))}</div>
    </div>
    <div class="fbox pit">
      <div class="fh"><span class="mark"></span>最容易踩的坑</div>
      <div class="ft">${esc(clip(d.pit, 96))}</div>
    </div>
  </div>

  <div class="brandbar">
    <div class="b-l"><span class="b-dot"></span><span class="b-name">陕分业务营销部训练室</span></div>
    <div class="b-r">实战经验一图流</div>
  </div>

</div>
</body></html>`;
}

module.exports = {
  renderPingan, planActions, planHeights, descLimitFor, exampleLimitFor,
  hookFontSize, SAMPLE_9, SAMPLE_7, W, H,
};
