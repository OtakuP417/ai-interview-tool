/**
 * poster.js — 横版报告图（16:9）版面生成
 *
 * 用途：把归档报告排成一张适合早会投屏的图，随邮件发给后线对接人。
 *
 * 为什么是「生成 HTML 而不是直接生成 PNG」：
 *   云函数是零依赖环境（只靠 Node 内置模块），没有 canvas / sharp 之类
 *   的图像库，也没有无头浏览器。所以服务端只负责把 HTML 排好，
 *   真正截图交给调用端：前端在浏览器里用一个隐藏 iframe 排版、
 *   再用 SVG foreignObject 转成 PNG 上传。这样服务端永远不发图，
 *   只发 HTML 片段，邮件里也就不会出现"图片裂开"的情况。
 *
 * 设计约束（都为「投到会议屏上后排也看得清」服务）：
 *   · 固定 16:9 画布，不随内容伸缩——投屏正好铺满，不留黑边
 *   · 正文字号 ≥13px（在 1610 宽画布上约等于 PPT 的 22pt）
 *   · 三栏：左=背景/判断/结果，中=核心做法（主栏最宽），右=可复制经验点
 *   · 底部通栏放「新人避坑」，用红调区分
 *   · 超长内容自动截断加省略号，宁可少写不缩字号
 */

const W = 1610;
const H = 905;

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* 按字符宽度截断（中文算 1，英文/数字算 0.55），超出加省略号 */
function clip(s, max) {
  const t = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  let w = 0;
  let out = "";
  for (const ch of t) {
    const cw = /[\x00-\xff]/.test(ch) ? 0.55 : 1;
    if (w + cw > max) return out + "…";
    w += cw;
    out += ch;
  }
  return out;
}

/* 把编号列表切成条目 */
function splitItems(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .split(/\n+/)
    .map((s) => s.replace(/^\s*\d+[.、）)]\s*/, "").trim())
    .filter(Boolean);
}

/**
 * 六节标题的容错写法。
 * 模型偶尔不写"新人容易踩的坑"，写成"新人注意事项""避坑提示"之类，
 * 直接按序号取会把这一节整段丢掉——投到屏幕上前排一片空白很扎眼。
 * 所以先按 ---SECTION--- 按序号取，取到后如果开头是「非标准标题行」，
 * 就把那一行剥掉；剥不掉也保留，宁可在图上多一行字也不能丢整节。
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

const TITLE_ALIASES = [
  [
    /^(?:(?:新人|新员工|新顾问|新同事)?(?:容易|常|爱)(?:踩|犯|走)的?坑|(?:新人|新员工|新顾问|新同事)?(?:注意事项|注意点|避坑提示|避坑|易错点|常见错误|易犯错误))$/,
    "新人容易踩的坑",
  ],
  [/^(?:可复制|可借鉴|可复用)的?(?:经验|经验点|做法)$/, "可复制的经验点"],
  [/^(?:关键)?(?:判断|判断点|判断与取舍|关键判断与取舍|决策)$/, "关键判断与取舍"],
  [/^(?:背景|背景与挑战|背景介绍|挑战)$/, "背景与挑战"],
  [/^(?:核心做法|主要做法|关键做法|做法)$/, "核心做法"],
  [/^(?:结果|成果|成效|效果)$/, "结果"],
];

/* 把一行文字映到标准标题名；不是标题则返回 null */
function normalizeTitle(line) {
  const t = String(line || "")
    .replace(/^\s*(?:#{1,6}\s*)/, "")
    .replace(/^\s*\d+[.、）)]\s*/, "")
    .replace(/[\s*_【】]/g, "")
    .trim();
  if (!t) return null;
  for (let i = 0; i < TITLE_ALIASES.length; i++) {
    if (TITLE_ALIASES[i][0].test(t)) return TITLE_ALIASES[i][1];
  }
  return null;
}

/* 从报告原文解析出六节 */
function parseReport(raw) {
  const parts = String(raw || "").split("---SECTION---");
  const sec = {};
  SECTION_TITLES.forEach((t, i) => {
    let v = String(parts[i] || "").replace(/\r/g, "").replace(/^\s+/, "");
    // 正文首行通常复述了标题，剥掉
    const firstLine = v.split("\n")[0] || "";
    const norm = normalizeTitle(firstLine);
    if (norm) v = v.slice(firstLine.length).replace(/^\s+/, "");
    else v = v.replace(/^\s*(?:#{1,6}\s*)?(?:\d+[.、）)]\s*)?/, "");
    sec[t] = v.trim();
  });
  return sec;
}

/* 经验点：抽「做法」句 + 方法组 */
const EXP_LEAD_RE = /^(?:\*{0,2}|【)?\s*做法\s*(?:\*{0,2}|】)?\s*[:：]\s*(.+)$/;
const EXP_SUBH_RE = /^(?:\*{0,2}|【)?\s*(?:具体怎么做|具体做法|怎么做)\s*(?:\*{0,2}|】)?\s*[:：]?\s*$/;

function parseExpPoints(text) {
  const lines = String(text || "").split("\n").map((s) => s.trim()).filter(Boolean);
  const items = [];
  let cur = null;
  lines.forEach((l) => {
    const m = l.match(EXP_LEAD_RE);
    if (m) {
      cur = { lead: m[1].trim(), steps: [] };
      items.push(cur);
      return;
    }
    if (EXP_SUBH_RE.test(l)) return;
    if (!cur) {
      cur = { lead: "", steps: [] };
      items.push(cur);
    }
    const sm = l.match(/^\s*[-*•\d.、）)]*\s*([^:：]{1,14})[:：]\s*(.+)$/);
    if (sm) cur.steps.push({ k: sm[1].replace(/^[-*•\s]+/, ""), v: sm[2].trim() });
    else cur.steps.push({ k: "", v: l });
  });
  return items.filter((it) => it.lead || it.steps.length);
}

/* ─────────────── 一图流摘要解析 ───────────────

   报告末尾的「海报摘要」节由 REPORT_PROMPT 生成，是结构化键值行：
     钩子句：额度不大的老客户，也能转介绍出【100万】
     成果1：100万|成功放款
     成果2：老客户|客户来源 · 主动转介绍
     做法1标题：节日送小礼
     做法1做法：端午、过年送公司小礼品，借上门机会宣导产品政策
     做法1示例：不空手上门，礼品随身带着，聊完近况顺口提一句政策
     判断句：……
     避坑句：……
   解析失败时返回 null，调用方降级回六节版式。 */

const POSTER_SECTION = "海报摘要";

function parsePosterSummary(raw) {
  const s = parseReport(raw);
  const text = s[POSTER_SECTION];
  if (!text) return null;                    // 老数据没有这一节 → 降级

  const lines = String(text).split("\n").map((x) => x.trim()).filter(Boolean);
  const kv = {};
  const acts = [];

  lines.forEach((line) => {
    // 去掉可能的 markdown 装饰：**、- 、行首序号。
    // 注意：不能动行内的【】——钩子句用它标注要高亮的数字。
    const l = line.replace(/^\s*(?:[-*•]|\d+[.、）)])\s*/, "")
                  .replace(/\*{1,2}/g, "")
                  .replace(/^(?:【|\[)\s*(?=[^】\]]*[:：])/, "")   // 仅剥"【键】"式的包裹
                  .trim();
    const m = l.match(/^([^:：]{2,12})[:：]\s*(.+)$/);
    if (!m) return;
    const key = m[1].trim();
    const val = m[2].trim();

    const am = key.match(/^做法\s*(\d+)\s*(标题|做法|示例)$/);
    if (am) {
      const idx = parseInt(am[1], 10) - 1;
      const field = am[2];
      if (!acts[idx]) acts[idx] = { t: "", d: "", x: "" };
      if (field === "标题") acts[idx].t = val;
      else if (field === "做法") acts[idx].d = val;
      else acts[idx].x = val;
      return;
    }
    kv[key] = val;
  });

  const results = [];
  for (let i = 1; i <= 4; i++) {
    const v = kv["成果" + i];
    if (!v) continue;
    const sp = v.split("|");
    results.push({ k: (sp[0] || "").trim(), v: (sp[1] || "").trim() });
  }

  const cleanActs = acts.filter((a) => a && a.t && a.d);

  // 钩子句里的【数字】拆成交错的文本/数字段（hookParts），
  // 数字在原位以高亮样式渲染（而不是统一挪到句尾——
  // 模型生成的钩子句数字可能出现在句中，如"靠【7】步跟进"）。
  // hook / hookNum 两个字段保留，供长度估算与旧断言使用。
  const hookRaw = kv["钩子句"] || "";
  const hookMatch = hookRaw.match(/【([^】]+)】/);
  const hookNum = hookMatch ? hookMatch[1].trim() : "";
  const hook = hookRaw.replace(/【[^】]*】/g, " ").replace(/\s+/g, " ").trim();

  const hookParts = [];
  const numRe = /【([^】]+)】/g;
  let nm;
  let lastIdx = 0;
  while ((nm = numRe.exec(hookRaw))) {
    const before = hookRaw.slice(lastIdx, nm.index);
    if (before.trim()) hookParts.push({ t: "text", s: before.replace(/\s+/g, " ").trim() });
    hookParts.push({ t: "num", s: nm[1].trim() });
    lastIdx = nm.index + nm[0].length;
  }
  const tail = hookRaw.slice(lastIdx);
  if (tail.trim()) hookParts.push({ t: "text", s: tail.replace(/\s+/g, " ").trim() });

  // 关键字段缺失太多就不算成功，交给调用方降级
  if (!hook || !cleanActs.length) return null;

  return {
    hook: hook || "",
    hookNum: hookNum,
    hookParts: hookParts,
    results: results.slice(0, 3),
    actions: cleanActs.slice(0, 8),
    judge: kv["判断句"] || "",
    pit: kv["避坑句"] || "",
  };
}

function buildLayout(raw, meta) {
  const s = parseReport(raw);
  const exp = parseExpPoints(s["可复制的经验点"]);

  const bg = clip(s["背景与挑战"], 132);
  const judge = splitItems(s["关键判断与取舍"]).slice(0, 2).map((x) => clip(x, 96));
  const res = splitItems(s["结果"]).slice(0, 2).map((x) => clip(x, 96));
  const steps = splitItems(s["核心做法"]).slice(0, 5).map((x) => clip(x, 72));
  const exps = exp.slice(0, 2).map((it) => ({
    lead: clip(it.lead, 42),
    steps: it.steps.slice(0, 3).map((st) => ({ k: clip(st.k, 9), v: clip(st.v, 46) })),
  }));
  const pits = splitItems(s["新人容易踩的坑"]).slice(0, 3).map((x) => clip(x, 66));

  return { bg, judge, res, steps, exps, pits };
}

const POSTER_CSS = `
  * { margin:0; padding:0; box-sizing:border-box; }
  .iv-page {
    width:${W}px; height:${H}px; background:#fff; color:#16202e;
    font-family:-apple-system,"PingFang SC","Microsoft YaHei","Segoe UI",sans-serif;
    display:flex; flex-direction:column; padding:26px 30px 22px;
    overflow:hidden;
  }
  .iv-page .hd { display:flex; align-items:flex-start; gap:16px; padding-bottom:14px;
        border-bottom:2.5px solid #1d4ed8; margin-bottom:16px; }
  .iv-page .hd-l { flex:1; min-width:0; }
  .iv-page .hd-title { font-size:27px; font-weight:600; letter-spacing:-0.3px; line-height:1.2; }
  .iv-page .hd-sub { font-size:14.5px; color:#5b6b80; margin-top:7px; }
  .iv-page .hd-sub b { color:#1d4ed8; font-weight:600; }
  .iv-page .hd-r { text-align:right; flex-shrink:0; }
  .iv-page .hd-badge { display:inline-block; background:#1d4ed8; color:#fff;
    font-size:13px; font-weight:500; padding:4px 11px; border-radius:5px; }
  .iv-page .hd-date { font-size:12.5px; color:#8394a8; margin-top:7px; }
  .iv-page .hd-owner { font-size:12.5px; color:#5b6b80; margin-top:3px; }

  .iv-page .cols { flex:1; display:flex; gap:15px; min-height:0; }
  .iv-page .col { display:flex; flex-direction:column; gap:13px; min-height:0; }
  .iv-page .col-l { width:340px; flex-shrink:0; }
  .iv-page .col-m { flex:1; min-width:0; }
  .iv-page .col-r { width:386px; flex-shrink:0; }

  .iv-page .card { background:#f6f8fb; border-radius:11px; padding:14px 15px;
          border-left:3.5px solid #b9c6d8; overflow:hidden; }
  .iv-page .card.blue { border-left-color:#1d4ed8; background:#f2f6ff; }
  .iv-page .card.green { border-left-color:#0d8a5f; background:#f1faf6; }
  .iv-page .card.amber { border-left-color:#c2820c; background:#fffaf0; }
  .iv-page .card.red { border-left-color:#c0392b; background:#fef5f4; }

  .iv-page .card-h { font-size:14px; font-weight:600; color:#3c4a5e;
            display:flex; align-items:center; gap:6px; margin-bottom:9px; letter-spacing:0.2px; }
  .iv-page .card-h .dot { width:7px; height:7px; border-radius:50%; background:#b9c6d8; flex-shrink:0; }
  .iv-page .card.blue .card-h { color:#1d4ed8; } .iv-page .card.blue .card-h .dot { background:#1d4ed8; }
  .iv-page .card.green .card-h { color:#0d8a5f; } .iv-page .card.green .card-h .dot { background:#0d8a5f; }
  .iv-page .card.amber .card-h { color:#a06a06; } .iv-page .card.amber .card-h .dot { background:#c2820c; }
  .iv-page .card.red .card-h { color:#c0392b; } .iv-page .card.red .card-h .dot { background:#c0392b; }
  .iv-page .card-t { font-size:13.5px; line-height:1.7; color:#28374a; }

  .iv-page .step { display:flex; gap:9px; margin-bottom:10px; }
  .iv-page .step:last-child { margin-bottom:0; }
  .iv-page .step-n { flex-shrink:0; width:21px; height:21px; border-radius:50%;
    background:#1d4ed8; color:#fff; font-size:12px; font-weight:600;
    display:flex; align-items:center; justify-content:center; margin-top:2px; }
  .iv-page .step-t { font-size:14px; line-height:1.62; color:#22303f; }

  .iv-page .exp { background:#fff; border:1px solid #d8e2f0; border-radius:9px;
         padding:11px 12px; margin-bottom:9px; }
  .iv-page .exp:last-child { margin-bottom:0; }
  .iv-page .exp-lead { font-size:13.5px; font-weight:600; color:#16202e;
              line-height:1.5; margin-bottom:8px; padding-left:9px; border-left:3px solid #0d8a5f; }
  .iv-page .exp-row { display:flex; gap:6px; margin-bottom:4px; font-size:12.5px; line-height:1.55; }
  .iv-page .exp-row:last-child { margin-bottom:0; }
  .iv-page .exp-k { flex-shrink:0; color:#0d8a5f; font-weight:500;
           background:#e7f6ef; border-radius:3px; padding:0 5px;
           font-size:11.5px; line-height:1.7; white-space:nowrap; }
  .iv-page .exp-v { color:#3c4a5e; }

  .iv-page .pit-wrap { margin-top:13px; background:#fef5f4; border-radius:11px;
              padding:13px 16px; border-left:3.5px solid #c0392b; }
  .iv-page .pit-h { font-size:14px; font-weight:600; color:#c0392b; margin-bottom:8px;
           display:flex; align-items:center; gap:6px; }
  .iv-page .pit-h .dot { width:7px; height:7px; border-radius:50%; background:#c0392b; }
  .iv-page .pit-list { display:flex; gap:18px; }
  .iv-page .pit { flex:1; font-size:13px; line-height:1.6; color:#4a2c28;
         padding-left:14px; position:relative; }
  .iv-page .pit::before { content:'!'; position:absolute; left:0; top:1px;
                 width:11px; height:11px; border-radius:50%; background:#e8b4ae;
                 color:#8a2a1e; font-size:8.5px; font-weight:700;
                 display:flex; align-items:center; justify-content:center; }
`;

const POSTER_MARKUP_ID = "iv-poster-root";

/* ═══════════════════════════════════════════════════════════════
   一图流经验卡（浅色 · 平安橙）
   ───────────────────────────────────────────────────────────────
   数据来源：报告末尾「海报摘要」节（parsePosterSummary）。
   缺摘要（老数据）→ 返回空串，调用方自动降级回六节版式。

   版式要点（与 tools/poster-pingan.js 的样本一致）：
     · 浅色底 + 橙色仅作锚点（徽标/序号/数字/竖条），面积 <15%
     · 卡片两段式：做法提要 + 「例」标示例
     · 排布自适应：1-3 条单行 / 4 条单行 4 列 / 5-6 条 3 列两行 /
       7+ 条 4 列两行；末行按本行张数铺满，不留空格
     · 每卡高度封顶 + 动作区垂直居中，避免短内容被拉成空盒子
     · 两个「人」的字段严格分离（被访谈人 ≠ 后线对接人），
       后线对接人若是 UM 形态则整段隐藏，绝不显示错的人
   ═══════════════════════════════════════════════════════════════ */

const FLOW = {
  BG: "#FFFFFF",
  BG_SOFT: "#FBF8F5",
  BG_TINT: "#FFF6EF",
  LINE: "#EFE6DE",
  LINE_2: "#E3D5C9",
  TXT: "#2A211B",
  TXT_2: "#7A6555",
  TXT_3: "#A08E7E",
  ORANGE: "#EA5504",
  ORANGE_L: "#FF8A3D",
  ORANGE_D: "#B8430A",
};

/* 排布：条数 → 列数 + 行分布 */
function flowRange(n, from) {
  const a = [];
  for (let i = from || 0; i < n; i++) a.push(i);
  return a;
}
function flowSplitRows(n, cols) {
  const rows = [];
  let i = 0;
  while (i < n) {
    const left = n - i;
    const remain = Math.ceil(left / cols);
    const take = Math.ceil(left / remain);
    rows.push(flowRange(i + take, i));
    i += take;
  }
  return rows;
}
function flowPlanActions(n) {
  if (n <= 0) return { cols: 1, rows: [[]] };
  if (n <= 3) return { cols: n, rows: [flowRange(n)] };
  if (n === 4) return { cols: 4, rows: [flowRange(4)] };
  if (n <= 6) return { cols: 3, rows: flowSplitRows(n, 3) };
  const cols = Math.min(Math.ceil(n / 2), 4);
  return { cols, rows: flowSplitRows(n, cols) };
}
function flowPlanHeights(n) {
  const rows = flowPlanActions(n).rows.length;
  return {
    cardMaxH: rows > 1 ? 236 : 300,
    rows,
    giveUpWhenSingleRow: rows === 1,
  };
}
function flowHookFontSize(len) {
  if (len <= 12) return 56;
  if (len <= 17) return 50;
  if (len <= 23) return 44;
  return 39;
}
function flowDescLimit(cols, twoRow) {
  if (twoRow) return cols <= 3 ? 52 : 42;
  return cols <= 3 ? 72 : 56;
}
function flowExLimit(cols, twoRow) {
  if (twoRow) return cols <= 3 ? 56 : 46;
  return cols <= 3 ? 76 : 62;
}

/* 后线对接人文本：UM 形态一律隐藏（宁可少一行，不印错的人） */
function flowOwnerText(meta) {
  const looksLikeUm = (s) => /^[A-Za-z][A-Za-z0-9_]*$/.test(String(s || "").trim());
  const name = String((meta && meta.owner) || "").trim();
  const org = String((meta && meta.ownerOrg) || "").trim();
  if (!name || looksLikeUm(name)) return "";
  return org ? name + " · " + org : name;
}
/* 被访谈人文本：姓名 + 可选 UM 括注（姓名本身是 UM 时不重复显示） */
function flowPersonText(meta) {
  const name = String((meta && meta.name) || "").trim();
  const um = String((meta && meta.um) || "").trim();
  if (!name) return "";
  if (um && um.toUpperCase() !== name.toUpperCase() && !/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
    return name + "（" + um + "）";
  }
  return name;
}

function renderFlowMarkup(raw, meta) {
  const S = parsePosterSummary(raw);
  if (!S) return "";                       // 无摘要 → 调用方降级

  const acts = S.actions || [];
  const plan = flowPlanActions(acts.length);
  const hp = flowPlanHeights(acts.length);
  const twoRow = plan.rows.length > 1;
  const colCount = plan.cols;

  let titleSize, descSize, exSize;
  if (twoRow) { titleSize = 20; descSize = 13.5; exSize = 12.5; }
  else if (colCount <= 3) { titleSize = 25; descSize = 15.5; exSize = 14; }
  else { titleSize = 23; descSize = 15; exSize = 13.5; }

  const dLim = flowDescLimit(colCount, twoRow);
  const xLim = flowExLimit(colCount, twoRow);

  const breathe = hp.giveUpWhenSingleRow;
  const tight = hp.rows > 1;
  const hookGap = breathe ? 34 : (tight ? 14 : 20);
  const resGap = breathe ? 34 : (tight ? 14 : 22);
  const resPadY = breathe ? 22 : (tight ? 11 : 13);
  const hookPadTop = breathe ? 10 : 0;

  const hookLen = S.hookParts
    ? S.hookParts.reduce((n, p) => n + String(p.s || "").length, 0)
    : String(S.hook || "").length + String(S.hookNum || "").length;
  const hookSize = flowHookFontSize(hookLen);
  const personTxt = flowPersonText(meta);
  const ownerTxt = flowOwnerText(meta);
  const code = String((meta && meta.code) || "").trim();
  const date = String((meta && meta.date) || "").trim();
  const city = String((meta && meta.city) || "").trim();

  const cardHtml = (a, i) => `
      <div class="fv-act">
        <div class="fv-act-n">${i + 1}</div>
        <div class="fv-act-t">${esc(clip(a.t, 12))}</div>
        <div class="fv-act-d">${esc(clip(a.d, dLim))}</div>
        ${a.x ? '<div class="fv-act-x"><span class="fv-q">例</span>' + esc(clip(a.x, xLim)) + "</div>" : ""}
      </div>`;

  const rowHtml = plan.rows
    .map(
      (r) =>
        `<div class="fv-act-row" style="grid-template-columns:repeat(${r.length},1fr)">${
          r.map((i) => (acts[i] ? cardHtml(acts[i], i) : "")).join("")
        }</div>`
    )
    .join("");

  const results = (S.results || [])
    .map(
      (r) => `
      <div class="fv-res">
        <div class="fv-res-k">${esc(clip(r.k, 12))}</div>
        <div class="fv-res-v">${esc(clip(r.v, 20))}</div>
      </div>`
    )
    .join("");

  return `<style>
  /* 一图流自带样式重置：不注入 POSTER_CSS（那是六节版的），
     缺了 box-sizing 会让 1610px + 左右 padding 变成 1702px 溢出画布 */
  * { margin:0; padding:0; box-sizing:border-box; }
  .fv-page {
    width:${W}px; height:${H}px; position:relative; overflow:hidden;
    background:
      radial-gradient(105% 78% at 96% -8%, ${FLOW.BG_TINT} 0%, rgba(255,246,239,.55) 34%, ${FLOW.BG} 62%),
      ${FLOW.BG};
    font-family:-apple-system,"PingFang SC","Microsoft YaHei","Segoe UI",sans-serif;
    color:${FLOW.TXT};
    display:flex; flex-direction:column;
    padding:34px 46px 26px;
  }
  .fv-page::before {
    content:''; position:absolute; left:0; top:0; bottom:0; width:7px;
    background:linear-gradient(180deg,${FLOW.ORANGE} 0%,${FLOW.ORANGE_L} 55%,${FLOW.ORANGE} 100%);
  }
  .fv-hd { display:flex; align-items:center; justify-content:space-between; flex-shrink:0; gap:20px; }
  .fv-hd-l { display:flex; align-items:center; gap:10px; flex-shrink:0; }
  .fv-badge {
    background:${FLOW.ORANGE}; color:#fff; font-size:14px; font-weight:500;
    padding:5px 13px; border-radius:5px; letter-spacing:.3px; line-height:1;
  }
  .fv-code {
    font-size:14px; font-weight:500; color:${FLOW.ORANGE_D};
    background:${FLOW.BG_TINT}; border:1px solid ${FLOW.LINE_2};
    padding:4px 11px; border-radius:5px; letter-spacing:.5px; line-height:1;
  }
  .fv-hd-r { font-size:14px; color:${FLOW.TXT_2}; flex-shrink:1; min-width:0;
             overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .fv-hd-r b { color:${FLOW.TXT}; font-weight:500; }

  .fv-hook { margin-top:${hookGap}px; padding-top:${hookPadTop}px; flex-shrink:0; }
  .fv-hook-l1 {
    font-size:${hookSize}px; line-height:1.24; font-weight:500;
    letter-spacing:-0.4px; color:${FLOW.TXT};
  }
  .fv-hook-num {
    color:${FLOW.ORANGE}; font-weight:500; position:relative; padding:0 3px;
  }
  .fv-hook-num::after {
    content:''; position:absolute; left:0; right:0; bottom:6px; height:10px;
    background:rgba(234,85,4,.16); z-index:-1; border-radius:2px;
  }
  .fv-sub { margin-top:13px; font-size:16px; color:${FLOW.TXT_2}; }
  .fv-sub .fv-sep {
    display:inline-block; width:4px; height:4px; border-radius:50%;
    background:${FLOW.LINE_2}; margin:0 9px; vertical-align:middle;
  }
  .fv-sub b { color:${FLOW.ORANGE_D}; font-weight:500; }

  .fv-results {
    display:grid; grid-template-columns:repeat(${Math.max((S.results || []).length, 1)},1fr);
    gap:13px; margin-top:${resGap}px; flex-shrink:0;
  }
  .fv-res {
    background:${FLOW.BG_TINT}; border:1px solid ${FLOW.LINE_2};
    border-radius:11px; padding:${resPadY}px 20px;
  }
  .fv-res-k { font-size:${breathe ? 30 : 26}px; font-weight:500; color:${FLOW.ORANGE}; letter-spacing:.2px; }
  .fv-res-v { font-size:14px; color:${FLOW.TXT_2}; margin-top:5px; letter-spacing:.2px; }

  .fv-acts {
    margin-top:22px; display:flex; flex-direction:column; gap:13px;
    flex:1; min-height:0; justify-content:center;
  }
  .fv-act-row { display:grid; gap:13px; min-height:0; }
  .fv-act {
    background:${FLOW.BG_SOFT}; border:1px solid ${FLOW.LINE}; border-radius:11px;
    padding:18px 16px; position:relative; overflow:hidden;
    display:flex; flex-direction:column; justify-content:center;
    max-height:${hp.cardMaxH}px;
  }
  .fv-act::after {
    content:''; position:absolute; left:16px; right:16px; top:0; height:2.5px;
    background:linear-gradient(90deg,${FLOW.ORANGE},rgba(234,85,4,0)); border-radius:2px;
  }
  .fv-act-n {
    width:30px; height:30px; border-radius:8px;
    background:${FLOW.ORANGE}; color:#fff;
    font-size:16px; font-weight:500;
    display:flex; align-items:center; justify-content:center;
    margin-bottom:13px; flex-shrink:0;
  }
  .fv-act-t { font-size:${titleSize}px; font-weight:500; color:${FLOW.TXT}; letter-spacing:.2px; }
  .fv-act-d { font-size:${descSize}px; line-height:1.7; color:${FLOW.TXT_2}; margin-top:8px; }
  .fv-act-x {
    font-size:${exSize}px; line-height:1.62; color:#6B5646;
    margin-top:10px; padding-top:9px; border-top:1px dashed ${FLOW.LINE_2};
  }
  .fv-q {
    display:inline-block; font-size:${exSize - 1.5}px; color:${FLOW.ORANGE_D};
    border:1px solid ${FLOW.LINE_2}; background:${FLOW.BG_TINT};
    border-radius:3px; padding:0 4px; margin-right:5px;
    vertical-align:1px; font-weight:500;
  }

  .fv-foot { display:grid; grid-template-columns:1.35fr 1fr; gap:13px; margin-top:20px; flex-shrink:0; }
  .fv-fbox { border-radius:11px; padding:15px 19px; }
  .fv-fbox .fv-fh {
    font-size:14.5px; font-weight:500; margin-bottom:6px;
    display:flex; align-items:center; gap:7px;
  }
  .fv-fbox .fv-fh .fv-mark { width:13px; height:3px; border-radius:2px; }
  .fv-fbox .fv-ft { font-size:14.5px; line-height:1.66; }
  .fv-fbox.judge { background:${FLOW.BG_TINT}; border:1px solid ${FLOW.LINE_2}; }
  .fv-fbox.judge .fv-fh { color:${FLOW.ORANGE_D}; }
  .fv-fbox.judge .fv-fh .fv-mark { background:${FLOW.ORANGE}; }
  .fv-fbox.judge .fv-ft { color:#463127; }
  .fv-fbox.pit { background:${FLOW.BG_SOFT}; border:1px solid ${FLOW.LINE}; }
  .fv-fbox.pit .fv-fh { color:#8A5A3A; }
  .fv-fbox.pit .fv-fh .fv-mark { background:#C79570; }
  .fv-fbox.pit .fv-ft { color:${FLOW.TXT_2}; }

  .fv-brandbar {
    margin-top:16px; padding-top:12px; border-top:1px solid ${FLOW.LINE};
    display:flex; align-items:center; justify-content:space-between;
    font-size:13.5px; color:${FLOW.TXT_3}; flex-shrink:0;
  }
  .fv-brandbar .fv-b-l { display:flex; align-items:center; gap:9px; }
  .fv-brandbar .fv-b-dot { width:7px; height:7px; border-radius:50%; background:${FLOW.ORANGE}; }
  .fv-brandbar .fv-b-name { color:${FLOW.TXT_2}; font-weight:500; letter-spacing:.3px; }
  .fv-brandbar .fv-b-r { color:${FLOW.ORANGE_D}; font-weight:500; letter-spacing:.3px; }
</style>
<div class="fv-page">

  <div class="fv-hd">
    <div class="fv-hd-l">
      <span class="fv-badge">经验萃取</span>
      ${code ? '<span class="fv-code">' + esc(code) + "</span>" : ""}
    </div>
    <div class="fv-hd-r"><b>${esc(clip(personTxt, 24))}</b>${
      city ? " · " + esc(city) : ""
    }${date ? " · " + esc(date) : ""}</div>
  </div>

  <div class="fv-hook">
    <div class="fv-hook-l1">${
      S.hookParts && S.hookParts.length
        ? S.hookParts
            .map(function (p) {
              return p.t === "num"
                ? '<span class="fv-hook-num">' + esc(p.s) + "</span>"
                : esc(p.s);
            })
            .join("")
        : esc(S.hook) +
          (S.hookNum ? '<span class="fv-hook-num">' + esc(S.hookNum) + "</span>" : "")
    }</div>
    <div class="fv-sub">${esc(clip(meta && meta.topic, 26))}${
      ownerTxt ? '<span class="fv-sep"></span>后线对接 <b>' + esc(ownerTxt) + "</b>" : ""
    }</div>
  </div>

  <div class="fv-results">${results}</div>

  <div class="fv-acts">${rowHtml}</div>

  <div class="fv-foot">
    ${
      S.judge
        ? `<div class="fv-fbox judge">
      <div class="fv-fh"><span class="fv-mark"></span>关键判断</div>
      <div class="fv-ft">${esc(clip(S.judge, 110))}</div>
    </div>`
        : ""
    }
    ${
      S.pit
        ? `<div class="fv-fbox pit">
      <div class="fv-fh"><span class="fv-mark"></span>最容易踩的坑</div>
      <div class="fv-ft">${esc(clip(S.pit, 96))}</div>
    </div>`
        : ""
    }
  </div>

  <div class="fv-brandbar">
    <div class="fv-b-l"><span class="fv-b-dot"></span><span class="fv-b-name">陕分业务营销部训练室</span></div>
    <div class="fv-b-r">实战经验一图流</div>
  </div>

</div>`;
}

/* 六节版式（旧版，保留作为降级路径）：
   只产出「页」的 markup，不含 html/head/body —— 方便前端塞进任意容器 */
function renderSixSectionMarkup(raw, meta) {
  const L = buildLayout(raw, meta);
  const ownerTxt = flowOwnerText(meta);

  return `<div class="iv-page">
  <div class="hd">
    <div class="hd-l">
      <div class="hd-title">${esc(clip(meta.topic, 30))}</div>
      <div class="hd-sub"><b>${esc(meta.name)}</b>${
        meta.position ? "　" + esc(meta.position) : ""
      }${meta.city ? "　·　" + esc(meta.city) : ""}${
        meta.um ? "　·　UM " + esc(meta.um) : ""
      }</div>
    </div>
    <div class="hd-r">
      <div class="hd-badge">案例经验萃取</div>
      ${meta.date ? '<div class="hd-date">' + esc(meta.date) + "</div>" : ""}
      ${
        ownerTxt
          ? '<div class="hd-owner">后线对接：' + esc(clip(ownerTxt, 22)) + "</div>"
          : ""
      }
    </div>
  </div>

  <div class="cols">

    <div class="col col-l">
      <div class="card blue" style="flex:1.15">
        <div class="card-h"><span class="dot"></span>背景与挑战</div>
        <div class="card-t">${esc(L.bg) || "—"}</div>
      </div>
      ${
        L.judge.length
          ? `<div class="card amber" style="flex:1">
        <div class="card-h"><span class="dot"></span>关键判断</div>
        <div class="card-t">${L.judge
          .map((j) => '<div style="margin-bottom:6px">' + esc(j) + "</div>")
          .join("")}</div>
      </div>`
          : ""
      }
      <div class="card green" style="flex:${L.judge.length ? 0.85 : 1.4}">
        <div class="card-h"><span class="dot"></span>结果</div>
        <div class="card-t">${
          L.res.map((r) => '<div style="margin-bottom:6px">' + esc(r) + "</div>").join("") ||
          "—"
        }</div>
      </div>
    </div>

    <div class="col col-m">
      <div class="card" style="flex:1; border-left-color:#1d4ed8; background:#fff;">
        <div class="card-h" style="color:#1d4ed8">
          <span class="dot" style="background:#1d4ed8"></span>核心做法
        </div>
        <div>
          ${
            L.steps
              .map(
                (t, i) => `<div class="step">
            <span class="step-n">${i + 1}</span><span class="step-t">${esc(t)}</span>
          </div>`
              )
              .join("") || '<div class="card-t">—</div>'
          }
        </div>
      </div>
    </div>

    <div class="col col-r">
      <div class="card green" style="flex:1; background:#fff;">
        <div class="card-h"><span class="dot"></span>可复制的经验点</div>
        <div>
          ${
            L.exps
              .map(
                (it) => `<div class="exp">
            ${it.lead ? '<div class="exp-lead">' + esc(it.lead) + "</div>" : ""}
            ${it.steps
              .map(
                (st) => `<div class="exp-row">
              ${st.k ? '<span class="exp-k">' + esc(st.k) + "</span>" : ""}
              <span class="exp-v">${esc(st.v)}</span>
            </div>`
              )
              .join("")}
          </div>`
              )
              .join("") || '<div class="card-t">—</div>'
          }
        </div>
      </div>
    </div>

  </div>

  ${
    L.pits.length
      ? `<div class="pit-wrap">
    <div class="pit-h"><span class="dot"></span>新人容易踩的坑</div>
    <div class="pit-list">
      ${L.pits.map((t) => '<div class="pit">' + esc(t) + "</div>").join("")}
    </div>
  </div>`
      : ""
  }

</div>`;
}

/* ═══════════════════════════════════════════════════════════════
   完整报告长图（详细版）
   ───────────────────────────────────────────────────────────────
   与一图流的定位区分：
     · renderFlowMarkup  = 简略版。16:9 固定画布，每卡截断，
                           用途是早会投屏讲一页。
     · renderFullMarkup  = 详细版。竖版长图，**全文不截断**，
                           用途是存档、转发、事后照着做。

   两个实现要点（都不是随便选的）：

   1) **高度由内容决定，这里不设 height。**
      画布宽度固定 1080px，高度交给浏览器量出来再栅格化
      （见 index.html / admin.html 的 measureMarkupHeight）。
      服务端估高会随字号、换行、标点漂移，估短了就裁掉最后一段。

   2) **CSS 重置必须限定在 .rpt-page 作用域内。**
      旧的六节版与一图流模板用的是全局 `* { margin:0; padding:0 }`。
      那种写法只在「拼成 SVG 字符串再渲染」的路径里安全；而长图要
      先插进真实 DOM 量高度，一旦带全局重置，会把管理页自己的排版
      一起清掉。所以这里所有选择器都挂 .rpt-page 前缀。
   ═══════════════════════════════════════════════════════════════ */

const FULL_W = 1080;

/* 编号行 / 项目符号行 */
const RPT_LIST_RE = /^\s*(?:(\d{1,2})\s*[.、）)]|[-*•])\s*(.+)$/;
/* 「具体怎么做：」这类小标题行（新格式的二级结构） */
const RPT_SUB_RE = /^(?:\*{0,2}|【)?\s*(?:具体怎么做|具体做法|怎么做)\s*(?:\*{0,2}|】)?\s*[:：]?\s*$/;
/* 「做法：…」引导行 */
const RPT_LEAD_RE = /^(?:\*{0,2}|【)?\s*做法\s*(?:\*{0,2}|】)?\s*[:：]\s*(.+)$/;
/* 行内「键：值」 */
const RPT_KV_RE = /^([^:：]{2,12})[:：]\s*(.+)$/;

/* 只有这些键才值得标出来（与 web/index.html 的 METHOD_KEY_RE 同一张表）。
   不能见冒号就标 —— 详细版是给人通读的全文，把任意冒号前的短语
   都染成橙色只会让人以为那是重点。 */
const RPT_METHOD_KEY_RE = /^(?:对方没反应时怎么办|频次|时机|周期|话术|方法|载体|工具|渠道|对方反应|客户反应|注意|要点|条件|判断|标准|备注|示例)(?:\/(?:时机|方法|工具|周期|反应|怎么办|途径|事项|依据))*\s*[:：]/;

/* 行内「键：值」把方法键标出来，其余原样输出 */
function rptInline(s) {
  const t = String(s);
  const m = t.match(RPT_KV_RE);
  if (!m || !RPT_METHOD_KEY_RE.test(t)) return esc(t);
  return '<span class="rpt-k">' + esc(m[1]) + "</span>" + esc(m[2]);
}

/**
 * 通用正文渲染：不截断。
 *   编号行 / 项目符号行 → 一条一条列出来
 *   「具体怎么做：」      → 二级小标题
 *   「做法：…」          → 也算一条（新格式没有行首序号）
 *   其余连续行            → 合成一个段落（段内软换行保留）
 */
function rptBody(text) {
  const out = [];
  let para = [];
  const flush = function () {
    if (!para.length) return;
    /* <br/> 必须自闭合：这段 markup 会被前端拼进 SVG foreignObject，
       那里按 XML 解析 —— 裸 <br> 直接让整张 SVG 报错（img.onerror），
       完整长图出不来，邮件就少一张附件（HTML 里 <br/> 与 <br> 等价，两边都合法）。 */
    out.push('<p class="rpt-p">' + para.join("<br/>") + "</p>");
    para = [];
  };

  String(text || "").replace(/\r/g, "").split("\n").forEach(function (raw) {
    const line = raw.trim();
    if (!line) { flush(); return; }

    if (RPT_SUB_RE.test(line)) {
      flush();
      out.push('<div class="rpt-sub">具体怎么做</div>');
      return;
    }

    const lm = line.match(RPT_LIST_RE);
    if (lm) {
      flush();
      const num = lm[1] || "";
      out.push(
        '<div class="rpt-li">' +
        '<span class="rpt-li-n' + (num ? "" : " bare") + '">' + esc(num) + "</span>" +
        '<div class="rpt-li-t">' + rptInline(lm[2]) + "</div>" +
        "</div>"
      );
      return;
    }

    const em = line.match(RPT_LEAD_RE);
    if (em) {
      flush();
      out.push(
        '<div class="rpt-li"><span class="rpt-li-n bare"></span>' +
        '<div class="rpt-li-t"><span class="rpt-lead">做法</span>' + esc(em[1]) + "</div></div>"
      );
      return;
    }

    para.push(rptInline(line));
  });
  flush();

  return out.join("") || '<p class="rpt-p rpt-empty">（本节内容为空）</p>';
}

/* 章节标题：以报告原文首行为准做别名归一，取不到就用标准名 */
function rptSectionTitle(canonical, body) {
  const first = String(body || "").split("\n")[0] || "";
  return normalizeTitle(first) || canonical;
}

function renderFullMarkup(raw, meta) {
  const m = meta || {};
  const sec = parseReport(raw);

  const personTxt = flowPersonText(m);
  const ownerTxt = flowOwnerText(m);
  const code = String(m.code || "").trim();
  const date = String(m.date || "").trim();
  const city = String(m.city || "").trim();
  const position = String(m.position || "").trim();
  const um = String(m.um || "").trim();

  /* 六节全文。「海报摘要」是给一图流用的内部数据（键值行），
     在给人读的详细版里只会显得莫名其妙，所以排除。 */
  let n = 0;
  const sections = SECTION_TITLES.filter(function (t) {
    return t !== POSTER_SECTION;
  }).map(function (canonical) {
    n += 1;
    const body = sec[canonical] || "";
    const title = rptSectionTitle(canonical, body);
    return '<section class="rpt-sec">' +
      '<div class="rpt-sec-h">' +
      '<span class="rpt-sec-n">' + n + "</span>" +
      '<span class="rpt-sec-t">' + esc(title) + "</span>" +
      "</div>" +
      '<div class="rpt-sec-b">' + rptBody(body) + "</div>" +
      "</section>";
  }).join("");

  const metaBits = [];
  if (personTxt) metaBits.push("<b>" + esc(personTxt) + "</b>");
  if (position) metaBits.push(esc(position));
  if (city) metaBits.push(esc(city));
  if (um && !personTxt.toUpperCase().includes(um.toUpperCase())) metaBits.push("UM " + esc(um));

  return `<style>
  .rpt-page, .rpt-page *, .rpt-page *::before, .rpt-page *::after {
    box-sizing:border-box; margin:0; padding:0;
  }
  .rpt-page {
    width:${FULL_W}px; background:${FLOW.BG}; color:${FLOW.TXT};
    font-family:-apple-system,"PingFang SC","Microsoft YaHei","Segoe UI",sans-serif;
    /* 排版必须完全自足：这张图会先插进管理页真实 DOM 量高度（那里 body 是
       14px/1.6），再进 SVG foreignObject 渲染（那里没有 body，默认 16px/normal）。
       两边继承到的字号一旦不同，量出来的高度就和实际渲染对不上，可能裁掉末行。
       所以这里把基准字号/行高定死，下面每个带字的元素也都显式给值。 */
    font-size:17.5px; line-height:1.85;
    position:relative;
  }
  /* 顶部橙条：与一图流同一套视觉语言 */
  .rpt-page .rpt-band {
    height:9px;
    background:linear-gradient(90deg,${FLOW.ORANGE} 0%,${FLOW.ORANGE_L} 62%,${FLOW.ORANGE} 100%);
  }
  .rpt-page .rpt-head { padding:38px 56px 26px; }
  .rpt-page .rpt-head-top {
    display:flex; align-items:center; justify-content:space-between; gap:18px;
    margin-bottom:22px;
  }
  .rpt-page .rpt-hd-l { display:flex; align-items:center; gap:10px; }
  .rpt-page .rpt-badge {
    background:${FLOW.ORANGE}; color:#fff; font-size:15px; font-weight:500;
    padding:5px 13px; border-radius:5px; letter-spacing:.3px; line-height:1;
  }
  .rpt-page .rpt-code {
    font-size:14.5px; font-weight:500; color:${FLOW.ORANGE_D};
    background:${FLOW.BG_TINT}; border:1px solid ${FLOW.LINE_2};
    padding:4px 11px; border-radius:5px; letter-spacing:.5px; line-height:1;
  }
  .rpt-page .rpt-hd-r { font-size:14.5px; color:${FLOW.TXT_3}; flex-shrink:0; }

  .rpt-page .rpt-title {
    font-size:40px; line-height:1.3; font-weight:500;
    letter-spacing:-0.5px; color:${FLOW.TXT};
  }
  .rpt-page .rpt-meta {
    margin-top:16px; font-size:17px; color:${FLOW.TXT_2}; line-height:1.6;
  }
  .rpt-page .rpt-meta b { color:${FLOW.TXT}; font-weight:500; }
  .rpt-page .rpt-meta .rpt-sep {
    display:inline-block; width:4px; height:4px; border-radius:50%;
    background:${FLOW.LINE_2}; margin:0 11px; vertical-align:middle;
  }
  .rpt-page .rpt-owner {
    margin-top:9px; font-size:15.5px; color:${FLOW.TXT_3};
  }
  .rpt-page .rpt-owner b { color:${FLOW.ORANGE_D}; font-weight:500; }
  .rpt-page .rpt-rule {
    margin:26px 56px 0; height:1px; background:${FLOW.LINE};
  }

  .rpt-page .rpt-body { padding:6px 56px 0; }
  .rpt-page .rpt-sec { padding-top:30px; }
  .rpt-page .rpt-sec-h {
    display:flex; align-items:center; gap:12px; padding-bottom:11px;
    border-bottom:2px solid ${FLOW.BG_TINT}; margin-bottom:16px;
  }
  .rpt-page .rpt-sec-n {
    width:30px; height:30px; border-radius:8px; flex-shrink:0;
    background:${FLOW.ORANGE}; color:#fff; font-size:16px; font-weight:500;
    display:flex; align-items:center; justify-content:center; line-height:1;
  }
  .rpt-page .rpt-sec-t { font-size:24px; font-weight:500; color:${FLOW.TXT}; letter-spacing:.2px; }

  .rpt-page .rpt-p { font-size:17.5px; line-height:1.9; color:#3D3129; margin-bottom:10px; }
  .rpt-page .rpt-p:last-child { margin-bottom:0; }
  .rpt-page .rpt-empty { color:${FLOW.TXT_3}; }

  .rpt-page .rpt-li { display:flex; gap:12px; margin-bottom:13px; }
  .rpt-page .rpt-li:last-child { margin-bottom:0; }
  .rpt-page .rpt-li-n {
    flex-shrink:0; width:25px; height:25px; border-radius:50%;
    background:${FLOW.BG_TINT}; border:1px solid ${FLOW.LINE_2};
    color:${FLOW.ORANGE_D}; font-size:13.5px; font-weight:500;
    display:flex; align-items:center; justify-content:center; margin-top:4px; line-height:1;
  }
  .rpt-page .rpt-li-n.bare { width:9px; height:9px; border:0; margin-top:12px;
    background:${FLOW.ORANGE_L}; }
  .rpt-page .rpt-li-t { flex:1; min-width:0; font-size:17.5px; line-height:1.85; color:#3D3129; }
  .rpt-page .rpt-sub {
    font-size:15px; font-weight:500; color:${FLOW.ORANGE_D};
    margin:14px 0 9px 37px; letter-spacing:.3px;
  }
  .rpt-page .rpt-sub + .rpt-li { margin-top:0; }
  .rpt-page .rpt-k {
    display:inline-block; color:${FLOW.ORANGE_D}; font-weight:500;
    background:${FLOW.BG_TINT}; border:1px solid ${FLOW.LINE_2};
    border-radius:4px; padding:0 6px; margin-right:7px;
    font-size:15.5px; line-height:1.75;
  }
  .rpt-page .rpt-lead {
    display:inline-block; color:${FLOW.ORANGE_D}; font-weight:500;
    background:${FLOW.BG_TINT}; border:1px solid ${FLOW.LINE_2};
    border-radius:4px; padding:0 6px; margin-right:8px;
    font-size:15.5px; line-height:1.75;
  }

  .rpt-page .rpt-foot {
    margin:40px 56px 0; padding:20px 0 34px;
    border-top:1px solid ${FLOW.LINE};
    display:flex; align-items:flex-end; justify-content:space-between; gap:20px;
  }
  .rpt-page .rpt-foot-l { font-size:14px; color:${FLOW.TXT_3}; line-height:1.7; }
  .rpt-page .rpt-foot-r {
    flex-shrink:0; text-align:right; font-size:14px; color:${FLOW.TXT_3};
  }
  .rpt-page .rpt-foot-r .rpt-b-name {
    display:block; color:${FLOW.TXT_2}; font-weight:500; letter-spacing:.3px;
    margin-bottom:5px;
  }
  .rpt-page .rpt-foot-r .rpt-b-tag { color:${FLOW.ORANGE_D}; font-weight:500; letter-spacing:.3px; }
</style>
<div class="rpt-page">
  <div class="rpt-band"></div>

  <div class="rpt-head">
    <div class="rpt-head-top">
      <div class="rpt-hd-l">
        <span class="rpt-badge">经验萃取 · 完整报告</span>
        ${code ? '<span class="rpt-code">' + esc(code) + "</span>" : ""}
      </div>
      <div class="rpt-hd-r">${date ? esc(date) : ""}</div>
    </div>

    <div class="rpt-title">${esc(m.topic || "案例经验报告")}</div>

    <div class="rpt-meta">${metaBits.join('<span class="rpt-sep"></span>')}</div>
    ${
      ownerTxt
        ? '<div class="rpt-owner">后线对接 <b>' + esc(ownerTxt) + "</b></div>"
        : ""
    }
  </div>

  <div class="rpt-rule"></div>

  <div class="rpt-body">${sections}</div>

  <div class="rpt-foot">
    <div class="rpt-foot-l">本报告由 AI 案例访谈助手根据访谈对话整理，已做个人信息脱敏处理。</div>
    <div class="rpt-foot-r">
      <span class="rpt-b-name">陕分业务营销部训练室</span>
      <span class="rpt-b-tag">实战经验完整版</span>
    </div>
  </div>
</div>`;
}

/* ── 版式调度：优先一图流，数据不全时降级回六节版式 ──
   一图流需要报告末尾的「海报摘要」节（新报告才有）。
   老报告没有这一节 → renderFlowMarkup 返回空串 → 自动走六节版式，
   保证存量数据与邮件发送链路完全不受影响。

   kind 参数（三选一，空 = 自动）：
     flow  简略一图流（固定 16:9 画布）
     six   旧六节版式（固定 16:9 画布，一图流缺数据时的降级路径）
     full  完整报告长图（宽度固定，高度由内容决定 —— 见 renderFullMarkup） */

const KIND_FLOW = "flow";
const KIND_SIX = "six";
const KIND_FULL = "full";

/* 别名容错：调用方写 full / report / detail 都认，避免拼错就静默降级 */
function normalizeKind(kind) {
  const v = String(kind == null ? "" : kind).trim().toLowerCase();
  if (v === KIND_FULL || v === "report" || v === "detail" || v === "long") return KIND_FULL;
  if (v === KIND_SIX || v === "legacy") return KIND_SIX;
  if (v === KIND_FLOW || v === "simple" || v === "brief") return KIND_FLOW;
  return "";
}

/* 最终会走哪条版式（空 kind 时按数据自动判） */
function resolveKind(raw, meta, kind) {
  const k = normalizeKind(kind);
  if (k) return k;
  return renderFlowMarkup(raw, meta || {}) ? KIND_FLOW : KIND_SIX;
}

/**
 * 版式裁决 —— 单一出口，返回「真正渲染出来的版式」。
 *
 * 曾经的 bug：resolveKind 说 flow，renderPosterMarkup 里
 * `renderFlowMarkup(...) || renderSixSectionMarkup(...)` 却因缺「海报摘要」
 * 静默渲染成六节，而响应里的 kind 仍是 flow —— 调用方按 kind 判断就会错。
 * 现在把「渲染 + 回落」收到这里，kind 与实际产物永远一致。
 *
 * 显式指定 flow 但数据缺「海报摘要」时：不静默降级，返回 ok:false + 原因，
 * 让调用方自己决定（避免"我看着是一图流、其实是六节"的错觉）。
 */
function renderByKind(raw, meta, kind) {
  const k = resolveKind(raw, meta || {}, kind);
  if (k === KIND_FULL) return { kind: KIND_FULL, html: renderFullMarkup(raw, meta || {}) };
  if (k === KIND_SIX) return { kind: KIND_SIX, html: renderSixSectionMarkup(raw, meta || {}) };
  const flow = renderFlowMarkup(raw, meta || {});
  if (flow) return { kind: KIND_FLOW, html: flow };
  return { kind: KIND_FLOW, html: "", missing: "poster_summary" };
}

/* 当前会走哪条版式（自检与日志用，保留旧名字） */
function pickLayout(raw, meta) {
  return resolveKind(raw, meta, "");
}

/**
 * 组装「预览响应」—— /api/poster 与 /api/mail?want_html 共用，
 * 保证两条路径返回的字段口径完全一致。
 *
 * 返回 { ok, kind, html, css, w, h }，或 { ok:false, error:"poster_summary_missing" }
 *   kind  实际采用的版式（full 时 h 为 null，高度由浏览器量出来）
 *   css   只有六节版需要外部注入；一图流与长图都自带 <style>
 */
function buildPreviewPayload(raw, meta, kind) {
  const want = normalizeKind(kind);
  const out = renderByKind(raw, meta, want);

  /* 显式点名要一图流、但数据里确实没有「海报摘要」：
     不静默换成六节（调用方以为拿到一图流，实际版式完全不同），直接报清楚。 */
  if (want === KIND_FLOW && out.missing) {
    return { ok: false, error: "poster_summary_missing",
             detail: "该报告缺「海报摘要」节，无法生成简略一图流；可改用完整报告(kind=full)。" };
  }

  return {
    ok: true,
    kind: out.kind,
    html: out.html,
    css: out.kind === KIND_SIX ? POSTER_CSS : "",
    w: out.kind === KIND_FULL ? FULL_W : W,
    h: out.kind === KIND_FULL ? null : H,
  };
}

function renderPosterMarkup(raw, meta, kind) {
  return renderByKind(raw, meta, kind).html;
}

/* 完整独立 HTML（本地预览 / 无头截图用） */
function renderPoster(raw, meta, kind) {
  const m = meta || {};
  const k = resolveKind(raw, m, kind);

  if (k === KIND_FULL) {
    /* 长图不能给 html/body 定高，否则量高度只会量到那个固定值 */
    return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<title>${esc(m.name)} · ${esc(m.topic)}</title>
<style>html,body { margin:0; padding:0; background:#fff; }</style>
</head>
<body>
${renderFullMarkup(raw, m)}
</body></html>`;
  }

  const out = renderByKind(raw, m, KIND_FLOW);   // 显式流程：无摘要时 out.html 为空
  const html = out.html || renderSixSectionMarkup(raw, m);
  const css = out.html ? "" : POSTER_CSS;        // 一图流自带 <style>，不重复注入
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<title>${esc(m.name)} · ${esc(m.topic)}</title>
<style>
  html,body { width:${W}px; height:${H}px; overflow:hidden; background:#fff; }
  ${css}
</style></head>
<body>
${html}
</body></html>`;
}

/**
 * 邮件里的 HTML 版海报：结构与整页版完全一致，只把固定宽高改成自适应。
 * 公司邮箱客户端大多能正常渲染内联 <style>；万一被剥离，
 * 退化为纯文本段落也仍然可读（见 mailer.js 的正文）。
 */
function renderPosterEmail(raw, meta) {
  const m = meta || {};
  const flow = renderFlowMarkup(raw, m);
  const body = flow || ('<style>' + POSTER_CSS + "</style>" + renderSixSectionMarkup(raw, m));
  return `<div style="background:#eef1f6;padding:0;margin:0">
<div style="width:${W}px;margin:0 auto;background:#fff">
${body}
</div>
</div>`;
}

module.exports = {
  renderPoster,
  renderPosterMarkup,
  renderPosterEmail,
  renderSixSectionMarkup,
  renderFlowMarkup,
  renderFullMarkup,
  rptBody,
  normalizeKind,
  resolveKind,
  renderByKind,
  buildPreviewPayload,
  pickLayout,
  buildLayout,
  parseReport,
  parseExpPoints,
  parsePosterSummary,
  normalizeTitle,
  clip,
  esc,
  POSTER_CSS,
  W,
  H,
  FULL_W,
  KIND_FLOW,
  KIND_SIX,
  KIND_FULL,
  SECTION_TITLES,
  POSTER_SECTION,
};
