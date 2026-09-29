/* ─────────────────────────────────────────────────────────────
   横版报告图生成器（1610×905 ≈ 16:9）

   用途：把归档报告排成一张适合早会投屏的图。
   设计约束（都是为「投到会议屏上后排也看得清」服务的）：
     · 固定 16:9，不随内容伸缩——投屏时正好铺满，不会上下留黑边
     · 正文字号 ≥13px（在 1610 宽画布上约等于 PPT 的 22pt）
     · 三栏结构：左=背景/结果，中=核心做法（主栏，最宽），右=经验点
     · 底部通栏放「新人避坑」，用红调区分
     · 内容超长时自动降级：截断并加省略号，宁可少写不缩字号
   ───────────────────────────────────────────────────────────── */

const W = 1610;
const H = 905;

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* 按字符宽度截断（中文算 1，英文/数字算 0.55），超出加省略号 */
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

/* 把编号列表切成条目 */
function splitItems(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .split(/\n+/)
    .map(s => s.replace(/^\s*\d+[.、）)]\s*/, '').trim())
    .filter(Boolean);
}

/* 从报告原文解析出六节 */
function parseReport(raw) {
  const titles = ['背景与挑战', '核心做法', '关键判断与取舍', '结果', '可复制的经验点', '新人容易踩的坑'];
  const parts = String(raw || '').split('---SECTION---');
  const sec = {};
  titles.forEach((t, i) => {
    let v = String(parts[i] || '').trim();
    // 去掉正文开头复述的标题
    v = v.replace(/^\s*(?:#{1,6}\s*)?(?:\d+[.、）)]\s*)?/, '');
    const e = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    v = v.replace(new RegExp('^' + e + '[】*_]*\\s*[:：]?\\s*\\n?'), '');
    sec[t] = v.trim();
  });
  return sec;
}

/* 经验点：抽「做法」句 + 前三组方法 */
function parseExpPoints(text) {
  const lines = String(text || '').split('\n').map(s => s.trim()).filter(Boolean);
  const items = [];
  let cur = null;
  lines.forEach(l => {
    const m = l.match(/^\s*(?:\*{0,2}|【)?\s*做法\s*(?:\*{0,2}|】)?\s*[:：]\s*(.+)$/);
    if (m) { cur = { lead: m[1].trim(), steps: [] }; items.push(cur); return; }
    if (/^\s*(?:\*{0,2}|【)?\s*(具体怎么做|具体做法|怎么做)\s*(?:\*{0,2}|】)?\s*[:：]?\s*$/.test(l)) return;
    if (!cur) { cur = { lead: '', steps: [] }; items.push(cur); }
    const sm = l.match(/^\s*[-*•\d.、）)]*\s*([^:：]{1,14})[:：]\s*(.+)$/);
    if (sm) cur.steps.push({ k: sm[1].replace(/^[-*•\s]+/, ''), v: sm[2].trim() });
    else if (l) cur.steps.push({ k: '', v: l });
  });
  return items.filter(it => it.lead || it.steps.length);
}

/* ─── 版面拼装 ─── */

function renderPoster(raw, meta) {
  const s = parseReport(raw);
  const exp = parseExpPoints(s['可复制的经验点']);

  // 截断上限按「列宽 ÷ 字号」估的，宁可留两行也不在半句处掐断
  const bg    = clip(s['背景与挑战'], 132);

  // 判断/结果取前两条完整条目，不做字符截断（条目本身通常一两行）
  const judge = splitItems(s['关键判断与取舍']).slice(0, 2).map(x => clip(x, 96));
  const res   = splitItems(s['结果']).slice(0, 2).map(x => clip(x, 96));

  // 核心做法：主栏最多 5 条
  const steps = splitItems(s['核心做法']).slice(0, 5).map(x => clip(x, 72));

  // 经验点：最多 2 条，各带 3 组方法
  const exps = exp.slice(0, 2).map(it => ({
    lead: clip(it.lead, 42),
    steps: it.steps.slice(0, 3).map(st => ({
      k: clip(st.k, 9),
      v: clip(st.v, 46),
    })),
  }));

  // 避坑：最多 3 条
  const pits = splitItems(s['新人容易踩的坑']).slice(0, 3).map(x => clip(x, 66));

  const today = meta.date || '';
  const ownerTxt = [meta.owner, meta.ownerOrg].filter(Boolean).join(' · ');

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<title>${esc(meta.name)} · ${esc(meta.topic)}</title>
<style>
  @page { size: ${W}px ${H}px; margin: 0; }
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:${W}px; height:${H}px; overflow:hidden; }
  body {
    font-family: -apple-system, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif;
    background:#eef1f6; color:#16202e;
    display:flex; align-items:center; justify-content:center;
  }
  .page {
    width:${W}px; height:${H}px; background:#fff;
    display:flex; flex-direction:column;
    padding:26px 30px 22px;
  }

  /* ── 页眉 ── */
  .hd { display:flex; align-items:flex-start; gap:16px; padding-bottom:14px;
        border-bottom:2.5px solid #1d4ed8; margin-bottom:16px; }
  .hd-l { flex:1; min-width:0; }
  .hd-title { font-size:27px; font-weight:600; letter-spacing:-0.3px; line-height:1.2; }
  .hd-sub { font-size:14.5px; color:#5b6b80; margin-top:7px; }
  .hd-sub b { color:#1d4ed8; font-weight:600; }
  .hd-r { text-align:right; flex-shrink:0; }
  .hd-badge {
    display:inline-block; background:#1d4ed8; color:#fff;
    font-size:13px; font-weight:500; padding:4px 11px; border-radius:5px;
  }
  .hd-date { font-size:12.5px; color:#8394a8; margin-top:7px; }
  .hd-owner { font-size:12.5px; color:#5b6b80; margin-top:3px; }

  /* ── 三栏主体 ── */
  .cols { flex:1; display:grid; grid-template-columns:340px 1fr 386px;
          gap:15px; min-height:0; }
  .col { display:flex; flex-direction:column; gap:13px; min-height:0; }

  .card { background:#f6f8fb; border-radius:11px; padding:14px 15px;
          border-left:3.5px solid #b9c6d8; }
  .card.blue { border-left-color:#1d4ed8; background:#f2f6ff; }
  .card.green { border-left-color:#0d8a5f; background:#f1faf6; }
  .card.amber { border-left-color:#c2820c; background:#fffaf0; }
  .card.red { border-left-color:#c0392b; background:#fef5f4; }

  .card-h { font-size:14px; font-weight:600; color:#3c4a5e;
            display:flex; align-items:center; gap:6px; margin-bottom:9px;
            letter-spacing:0.2px; }
  .card-h .dot { width:7px; height:7px; border-radius:50%; background:#b9c6d8; flex-shrink:0; }
  .card.blue .card-h { color:#1d4ed8; } .card.blue .card-h .dot { background:#1d4ed8; }
  .card.green .card-h { color:#0d8a5f; } .card.green .card-h .dot { background:#0d8a5f; }
  .card.amber .card-h { color:#a06a06; } .card.amber .card-h .dot { background:#c2820c; }
  .card.red .card-h { color:#c0392b; } .card.red .card-h .dot { background:#c0392b; }

  .card-t { font-size:13.5px; line-height:1.7; color:#28374a; }

  /* ── 核心做法 ── */
  .step { display:flex; gap:9px; margin-bottom:10px; }
  .step:last-child { margin-bottom:0; }
  .step-n {
    flex-shrink:0; width:21px; height:21px; border-radius:50%;
    background:#1d4ed8; color:#fff; font-size:12px; font-weight:600;
    display:flex; align-items:center; justify-content:center; margin-top:2px;
  }
  .step-t { font-size:14px; line-height:1.62; color:#22303f; }

  /* ── 经验点 ── */
  .exp { background:#fff; border:1px solid #d8e2f0; border-radius:9px;
         padding:11px 12px; margin-bottom:9px; }
  .exp:last-child { margin-bottom:0; }
  .exp-lead { font-size:13.5px; font-weight:600; color:#16202e;
              line-height:1.5; margin-bottom:8px;
              padding-left:9px; border-left:3px solid #0d8a5f; }
  .exp-row { display:flex; gap:6px; margin-bottom:4px; font-size:12.5px; line-height:1.55; }
  .exp-row:last-child { margin-bottom:0; }
  .exp-k { flex-shrink:0; color:#0d8a5f; font-weight:500;
           background:#e7f6ef; border-radius:3px; padding:0 5px;
           font-size:11.5px; line-height:1.7; white-space:nowrap; }
  .exp-v { color:#3c4a5e; }

  /* ── 避坑（底部通栏）── */
  .pit-wrap { margin-top:13px; background:#fef5f4; border-radius:11px;
              padding:13px 16px; border-left:3.5px solid #c0392b; }
  .pit-h { font-size:14px; font-weight:600; color:#c0392b; margin-bottom:8px;
           display:flex; align-items:center; gap:6px; }
  .pit-h .dot { width:7px; height:7px; border-radius:50%; background:#c0392b; }
  .pit-list { display:flex; gap:18px; }
  .pit { flex:1; font-size:13px; line-height:1.6; color:#4a2c28;
         padding-left:14px; position:relative; }
  .pit::before { content:'!'; position:absolute; left:0; top:1px;
                 width:11px; height:11px; border-radius:50%; background:#e8b4ae;
                 color:#8a2a1e; font-size:8.5px; font-weight:700;
                 display:flex; align-items:center; justify-content:center; }
</style></head>
<body>
<div class="page">

  <div class="hd">
    <div class="hd-l">
      <div class="hd-title">${esc(clip(meta.topic, 30))}</div>
      <div class="hd-sub">
        <b>${esc(meta.name)}</b>${meta.position ? '　' + esc(meta.position) : ''}${
          meta.city ? '　·　' + esc(meta.city) : ''
        }${meta.um ? '　·　UM ' + esc(meta.um) : ''}
      </div>
    </div>
    <div class="hd-r">
      <div class="hd-badge">案例经验萃取</div>
      ${today ? '<div class="hd-date">' + esc(today) + '</div>' : ''}
      ${ownerTxt ? '<div class="hd-owner">后线对接：' + esc(clip(ownerTxt, 22)) + '</div>' : ''}
    </div>
  </div>

  <div class="cols">

    <div class="col">
      <div class="card blue" style="flex:1.15">
        <div class="card-h"><span class="dot"></span>背景与挑战</div>
        <div class="card-t">${esc(bg) || '—'}</div>
      </div>
      ${judge.length ? `<div class="card amber" style="flex:1">
        <div class="card-h"><span class="dot"></span>关键判断</div>
        <div class="card-t">${judge.map(j => `<div style="margin-bottom:6px">${esc(j)}</div>`).join('')}</div>
      </div>` : ''}
      <div class="card green" style="flex:${judge.length ? 0.85 : 1.4}">
        <div class="card-h"><span class="dot"></span>结果</div>
        <div class="card-t">${res.map(r => `<div style="margin-bottom:6px">${esc(r)}</div>`).join('') || '—'}</div>
      </div>
    </div>

    <div class="col">
      <div class="card" style="flex:1; border-left-color:#1d4ed8; background:#fff;">
        <div class="card-h" style="color:#1d4ed8">
          <span class="dot" style="background:#1d4ed8"></span>核心做法
        </div>
        <div>
          ${steps.map((t, i) => `<div class="step">
            <span class="step-n">${i + 1}</span><span class="step-t">${esc(t)}</span>
          </div>`).join('') || '<div class="card-t">—</div>'}
        </div>
      </div>
    </div>

    <div class="col">
      <div class="card green" style="flex:1; background:#fff;">
        <div class="card-h"><span class="dot"></span>可复制的经验点</div>
        <div>
          ${exps.map(it => `<div class="exp">
            ${it.lead ? `<div class="exp-lead">${esc(it.lead)}</div>` : ''}
            ${it.steps.map(st => `<div class="exp-row">
              ${st.k ? `<span class="exp-k">${esc(st.k)}</span>` : ''}
              <span class="exp-v">${esc(st.v)}</span>
            </div>`).join('')}
          </div>`).join('') || '<div class="card-t">—</div>'}
        </div>
      </div>
    </div>

  </div>

  ${pits.length ? `<div class="pit-wrap">
    <div class="pit-h"><span class="dot"></span>新人容易踩的坑</div>
    <div class="pit-list">
      ${pits.map(t => `<div class="pit">${esc(t)}</div>`).join('')}
    </div>
  </div>` : ''}

</div>
</body></html>`;
}

module.exports = { renderPoster, parseReport, parseExpPoints, clip, W, H };
