/**
 * 完整报告长图（详细版）自检
 *
 * 需求：「报告全文增加图片版本，一图流是简略版，还要有一个详细版本的。
 *       最后的附件是两个图片。」
 *
 * 这个模板与一图流最关键的三点差别，也是这个测试要守住的：
 *   ① **不截断** —— 一图流每个字段都有 clip 上限，长图必须一字不丢
 *   ② **高度不定死** —— 画布宽 1080 固定，高由内容决定（浏览器量出来再栅格化）
 *   ③ **CSS 必须限定作用域** —— 长图要先插进真实 DOM 量高度，
 *      全局 `* { margin:0 }` 重置会把管理页自己的排版一起毁掉
 *
 * 夹具用两份真实报告：
 *   fixtures/report-new.md  新格式（7 节，含给一图流用的「海报摘要」）
 *   fixtures/report-old.md  旧格式（6 节，末节标题是「新人注意事项」）
 */
const fs = require('fs');
const path = require('path');
const poster = require(path.join(__dirname, '..', 'cloudfunctions', 'interview-proxy', 'poster.js'));

let pass = 0;
let fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (extra ? '  → ' + extra : '')); }
}

const FX = path.join(__dirname, 'fixtures');
const RAW_NEW = fs.readFileSync(path.join(FX, 'report-new.md'), 'utf8');
const RAW_OLD = fs.readFileSync(path.join(FX, 'report-old.md'), 'utf8');

const META = {
  name: '李示例', position: '咨询顾问', um: 'lishili001', city: '安康市',
  topic: '孤儿单盘活经验', owner: '刘龙刚', ownerOrg: '咸阳安康营业部',
  code: 'IV-2026-0007', date: '2026-09-24',
};
const META_UM_OWNER = Object.assign({}, META, { owner: 'example007', ownerOrg: '' });

/* 把渲染结果还原成「读图时看到的纯文字」，用于比对内容是否一字不丢 */
function plainOf(html) {
  return String(html)
    .replace(/<style>[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/\s+/g, '');
}

/* 取一行的「实质片段」：先剥掉列表序号与「做法：」标签（渲染时它们变成独立的
   span，冒号和「.」不会出现在读图看到的纯文字里），再按中文冒号切开取最长一段。
   这样既能验证内容确实在图上，又不会因为排版把标点搬走而误报。 */
function longestChunk(line) {
  const stripped = String(line)
    .replace(/^\s*(?:\d{1,2}\s*[.、）)]|[-*•])\s*/, '')
    .replace(/^\s*做法\s*[:：]\s*/, '')
    .trim();
  const parts = stripped.split(/[:：]/).map(s => s.trim()).filter(Boolean);
  if (!parts.length) return '';
  return parts.sort((a, b) => b.length - a.length)[0];
}

/* 报告原文里所有值得核对的实质片段（排除只给机器看的「海报摘要」节） */
function fragmentsOf(raw) {
  const sec = poster.parseReport(raw);
  const out = [];
  poster.SECTION_TITLES.forEach(function (t) {
    if (t === poster.POSTER_SECTION) return;      // 内部数据，不印在详细版上
    String(sec[t] || '').split('\n').forEach(function (line, i) {
      const l = line.trim();
      if (!l) return;
      if (i === 0 && poster.normalizeTitle(l)) return;   // 首行是标题，会被单独渲染
      const chunk = longestChunk(l);
      if (chunk.length >= 6) out.push(chunk);
    });
  });
  return Array.from(new Set(out));
}

/* ───────── 1. 结构 ───────── */
console.log('\n[1] 结构');
const HTML_NEW = poster.renderFullMarkup(RAW_NEW, META);
const HTML_OLD = poster.renderFullMarkup(RAW_OLD, META);
{
  ok(HTML_NEW.includes('经验萃取 · 完整报告'), '页眉有「完整报告」徽标');
  ok(HTML_NEW.includes('IV-2026-0007'), '页眉展示档案编号');
  ok(HTML_NEW.includes('孤儿单盘活经验'), '展示案例主题');
  ok(HTML_NEW.includes('李示例') && HTML_NEW.includes('lishili001'), '展示被访谈人与 UM');
  ok(HTML_NEW.includes('刘龙刚') && HTML_NEW.includes('咸阳安康营业部'), '展示后线对接人');
  ok(HTML_NEW.includes('陕分业务营销部训练室'), '页脚有品牌条');
  ok(HTML_NEW.includes('脱敏'), '页脚有脱敏声明');

  const secs = (HTML_NEW.match(/class="rpt-sec"/g) || []).length;
  ok(secs === 6, '六个章节（海报摘要不算）', String(secs));
  const missingOrd = [1, 2, 3, 4, 5, 6].filter(i => !HTML_NEW.includes('class="rpt-sec-n">' + i + '<'));
  ok(missingOrd.length === 0, '章节序号 1-6 齐全', missingOrd.join(','));
  ['背景与挑战', '核心做法', '关键判断与取舍', '结果', '可复制的经验点', '新人容易踩的坑']
    .forEach(t => ok(HTML_NEW.includes(t), '含章节「' + t + '」'));

  ok(!HTML_NEW.includes('海报摘要'), '不印「海报摘要」节（那是给一图流用的内部数据）');
  ok(!/<script/i.test(HTML_NEW), '不含脚本');
}

/* ───────── 2. 不截断 ───────── */
console.log('\n[2] 不截断（与一图流的根本差别）');
{
  const plainNew = plainOf(HTML_NEW);
  const fragsNew = fragmentsOf(RAW_NEW);
  const missingNew = fragsNew.filter(f => !plainNew.includes(f.replace(/\s+/g, '')));
  ok(fragsNew.length >= 12, '从新格式报告里取到足够多的实质片段', String(fragsNew.length));
  ok(missingNew.length === 0, '新格式报告每一条实质内容都在图上', missingNew.slice(0, 3).join(' / '));

  const plainOld = plainOf(HTML_OLD);
  const fragsOld = fragmentsOf(RAW_OLD);
  const missingOld = fragsOld.filter(f => !plainOld.includes(f.replace(/\s+/g, '')));
  ok(fragsOld.length >= 10, '从旧格式报告里取到足够多的实质片段', String(fragsOld.length));
  ok(missingOld.length === 0, '旧格式报告每一条实质内容都在图上', missingOld.slice(0, 3).join(' / '));

  /* 一图流会截断，长图不能 —— 用同一个 meta 对比，证明两者确实不同 */
  const flow = poster.renderFlowMarkup(RAW_NEW, META);
  if (flow) {
    const clipped = poster.clip(RAW_NEW.replace(/\s+/g, ''), 60);
    ok(clipped.endsWith('…'), '对照组：clip() 确实会加省略号（说明第 2 组断言有意义）');
  }
  ok(!plainOf(HTML_NEW).includes('…'), '长图上没有被省略号截断的内容');

  /* 最长的一段也要在 */
  const longest = fragsNew.concat(fragsOld).sort((a, b) => b.length - a.length)[0];
  ok(plainNew.includes(longest) || plainOld.includes(longest), '最长片段完整保留', longest.slice(0, 24) + '…');
}

/* ───────── 3. 高度不定死 ───────── */
console.log('\n[3] 高度由内容决定');
{
  const css = HTML_NEW.slice(HTML_NEW.indexOf('<style>') + 7, HTML_NEW.indexOf('</style>'));
  const rootRule = (css.match(/\.rpt-page\s*\{[^}]*\}/) || [''])[0];
  ok(rootRule.length > 0, '能取到 .rpt-page 主规则');
  ok(!/(?<!line-)height\s*:/.test(rootRule), '.rpt-page 主规则里没有定高', rootRule.replace(/\s+/g, ' ').slice(0, 90));
  ok(!/overflow\s*:\s*hidden/.test(rootRule), '.rpt-page 没有 overflow:hidden（否则量高度会被夹住）');
  ok(/width\s*:\s*1080px/.test(rootRule), '.rpt-page 定宽 1080px');

  /* 排版必须自足：量高度的宿主页面（管理页 body 14px）和 SVG 上下文（默认 16px）
     继承到的字号不同，量出来的高度就会对不上。基准必须在模板里定死。 */
  ok(/font-size\s*:\s*17\.5px/.test(rootRule) && /line-height\s*:\s*1\.85/.test(rootRule),
    '.rpt-page 自带基准字号与行高（不依赖宿主页面的继承）');
  ok(poster.FULL_W === 1080, 'FULL_W 常量 = 1080');
  ok(!/position\s*:\s*fixed/.test(css), '没有 position:fixed（离屏量高度时会失效）');
}

/* ───────── 4. CSS 作用域（这条不满足就会毁掉承载页面） ───────── */
console.log('\n[4] CSS 限定作用域');
{
  const css = HTML_NEW
    .slice(HTML_NEW.indexOf('<style>') + 7, HTML_NEW.indexOf('</style>'))
    .replace(/\/\*[\s\S]*?\*\//g, '');

  const selectors = css
    .split('}')
    .map(block => block.split('{')[0].trim())
    .filter(s => s && !s.startsWith('@'))
    .flatMap(s => s.split(',').map(x => x.trim()))
    .filter(Boolean);

  ok(selectors.length > 10, '解析出足够多的选择器', String(selectors.length));
  const unscoped = selectors.filter(s => !/^\.rpt-page(\s|,|:|\.|$)/.test(s));
  ok(unscoped.length === 0, '所有选择器都挂在 .rpt-page 下', unscoped.slice(0, 4).join(' | '));
  ok(!/(^|[},\s])\*\s*\{/.test(css), '没有全局 * {} 重置');

  /* 对照组：旧的六节版式确实是全局重置 —— 所以长图不能照抄它 */
  ok(/^\s*\*\s*\{/m.test(poster.POSTER_CSS),
    '对照组：POSTER_CSS（六节版）用的是全局重置，证明第 4 组断言有必要');
}

/* ───────── 5. 新旧两种报告格式都要能读 ───────── */
console.log('\n[5] 新旧格式兼容');
{
  const plainOld = plainOf(HTML_OLD);
  ok(plainOld.includes('每月定期联系'), '旧格式的叙述句经验点整段保留');
  ok(HTML_OLD.includes('新人容易踩的坑'),
    '旧格式末节「新人注意事项」按别名归一到「新人容易踩的坑」');

  const plainNew = plainOf(HTML_NEW);
  ok(plainNew.includes('具体怎么做'), '新格式的「具体怎么做：」渲染成二级小标题');
  ok((HTML_NEW.match(/class="rpt-k"/g) || []).length > 0, '行内「键：值」的键有高亮标签');
  ok((HTML_NEW.match(/class="rpt-li"/g) || []).length >= 6, '编号行渲染成条目');

  /* 空小节不能崩，也不能印出 undefined */
  const empty = poster.renderFullMarkup('背景与挑战\n只有背景一句话。', META);
  ok(empty.includes('只有背景一句话'), '缺失章节时仍渲染已有内容');
  ok(empty.includes('（本节内容为空）'), '缺失章节给出占位');
  ok(!/undefined|null/.test(plainOf(empty)), '不出现 undefined / null');
  ok(poster.renderFullMarkup('', META).includes('rpt-page'), '空报告也不抛异常');
}

/* ───────── 6. 字段边界：UM 形态的后线对接人必须整段隐藏 ───────── */
console.log('\n[6] 后线对接人 UM 兜底');
{
  const h = poster.renderFullMarkup(RAW_NEW, META_UM_OWNER);
  ok(!h.includes('example007'), 'UM 形态的后线对接人不印在图上');
  ok(!h.includes('后线对接'), '整段隐藏（宁可少一行，不印错的人）');
  const h2 = poster.renderFullMarkup(RAW_NEW, META);
  ok(h2.includes('后线对接'), '正常姓名时照常显示');
}

/* ───────── 7. 转义安全 ───────── */
console.log('\n[7] 转义');
{
  const evil = '背景与挑战\n<script>alert(1)</script> 与 "引号" 和 <标签>\n'
    + '---SECTION---\n核心做法\n1. a & b < c > d\n'
    + '---SECTION---\n关键判断与取舍\nx\n---SECTION---\n结果\ny\n'
    + '---SECTION---\n可复制的经验点\nz\n---SECTION---\n新人容易踩的坑\nw';
  const h = poster.renderFullMarkup(evil, META);
  ok(!/<script/i.test(h), '报告里的 <script> 被转义');
  ok(!/<标签>/.test(h), '报告里的尖括号被转义');
  ok(h.includes('&lt;script&gt;'), '确实转成了实体');
  ok(plainOf(h).includes('a&b<c>d'), '转义后的内容读起来仍然正确');
}

/* ───────── 8. kind 调度 ───────── */
console.log('\n[8] kind 调度');
{
  ok(poster.normalizeKind('full') === 'full', "normalizeKind('full')");
  ok(poster.normalizeKind('report') === 'full', "别名 report → full");
  ok(poster.normalizeKind('FULL') === 'full', '大小写不敏感');
  ok(poster.normalizeKind('flow') === 'flow', "normalizeKind('flow')");
  ok(poster.normalizeKind('') === '', '空串 = 自动');
  ok(poster.normalizeKind('乱写') === '', '不认识的值 = 自动（不静默降级成别的）');

  ok(poster.resolveKind(RAW_OLD, META, '') === 'six', '旧数据不带海报摘要 → 自动走六节');
  ok(poster.resolveKind(RAW_NEW, META, '') === 'flow', '新数据带海报摘要 → 自动走一图流');
  ok(poster.resolveKind(RAW_OLD, META, 'full') === 'full', '显式 full 优先于自动判断');

  const mFull = poster.renderPosterMarkup(RAW_OLD, META, 'full');
  ok(mFull.includes('class="rpt-page"'), "kind=full → 返回长图 markup");
  const mSix = poster.renderPosterMarkup(RAW_OLD, META, 'six');
  ok(mSix.includes('iv-page'), 'kind=six → 返回六节 markup');
  const mFlow = poster.renderPosterMarkup(RAW_NEW, META, 'flow');
  ok(mFlow.includes('fv-page'), 'kind=flow → 返回一图流 markup');

  /* 显式要一图流但没有「海报摘要」：不能静默换成六节。
     曾经的问题：响应 kind 说 flow、实际渲染六节，调用方按 kind 判断就会错。
     现在 renderByKind 是唯一出口，且 buildPreviewPayload 明确回 ok:false。 */
  const rb = poster.renderByKind(RAW_OLD, META, 'flow');
  ok(rb.kind === 'flow' && rb.html === '' && rb.missing === 'poster_summary',
    'renderByKind：无摘要时 kind=flow 但 html 为空、标出 missing');
  const bpBlocked = poster.buildPreviewPayload(RAW_OLD, META, 'flow');
  ok(bpBlocked.ok === false && bpBlocked.error === 'poster_summary_missing',
    'buildPreviewPayload：无摘要 + 显式 flow → ok:false 不静默降级');
  ok(!bpBlocked.html, '被拒时不返回任何 markup（避免误用）');
  /* 反证：同一份数据自动选版式时，仍应正常给出六节，不受上面影响 */
  const bpAuto = poster.buildPreviewPayload(RAW_OLD, META, '');
  ok(bpAuto.ok === true && bpAuto.kind === 'six' && /iv-page/.test(bpAuto.html),
    '反证：不带 kind 时旧数据仍自动走六节且 ok:true');
  /* kind 必须与实际产物一致——这是上面那个 bug 的核心断言 */
  [['flow', RAW_NEW], ['six', RAW_OLD], ['full', RAW_OLD]].forEach(([k, raw]) => {
    const r = poster.renderByKind(raw, META, k);
    const marker = k === 'flow' ? 'fv-page' : (k === 'six' ? 'iv-page' : 'rpt-page');
    ok(r.kind === k && r.html.includes(marker),
      'kind 与产物一致：' + k + ' → ' + marker);
  });
  ok(poster.renderPosterMarkup(RAW_OLD, META, 'flow') === '',
    'renderPosterMarkup 在无摘要+flow 时返回空串（由调用方决定怎么办）');

  /* 独立整页版不能给 body 定高，否则量高度量到的是那个固定值 */
  const page = poster.renderPoster(RAW_NEW, META, 'full');
  ok(!/html,body\s*\{[^}]*height/.test(page), 'full 的整页 HTML 不给 body 定高');
  ok(poster.renderPoster(RAW_NEW, META, 'flow').includes('905px'), '一图流整页仍是 1610×905 定高');
  ok(poster.pickLayout(RAW_OLD, META) === 'six', 'pickLayout 旧名字仍然可用');
}

/* ───────── 9. 邮件正文版式不受影响 ───────── */
console.log('\n[9] 无回归：邮件正文与一图流');
{
  ok(poster.renderPosterEmail(RAW_NEW, META).includes('fv-page'), '邮件正文仍是海报版式（一图流）');
  ok(poster.renderPosterEmail(RAW_OLD, META).includes('iv-page'), '老数据邮件正文仍是六节版式');
  ok(poster.W === 1610 && poster.H === 905, '一图流/六节的画布尺寸未变');
  ok(poster.renderFlowMarkup(RAW_NEW, META).includes('fv-hook'), '一图流仍然正常渲染');
}

/* ───────── 10. SVG XML 安全（2026-10-09 线上事故回归） ───────── */
console.log('\n[10] SVG XML 安全：markup 要进 foreignObject，必须能过 XML 解析');
{
  /* 事故复盘：rptBody 的段内软换行用裸 <br> 拼接 → 前端把它拼进 SVG
     foreignObject（按 XML 解析）→ 整张 SVG 解析失败（img.onerror）→
     buildPosterPng('full') 静默降级为 null → 邮件只带一图流、没有完整报告。
     HTML 里 <br/> 与 <br> 完全等价，所以服务端模板一律写自闭合。 */
  const posterSrc = fs.readFileSync(
    path.join(__dirname, '..', 'cloudfunctions', 'interview-proxy', 'poster.js'), 'utf8');
  ok(!posterSrc.includes('join("<br>")'), 'poster.js 源码不再出现 join("<br>")（必须 <br/>）');

  /* 两份夹具 + 一段含软换行的长正文，渲染产物里不许有任何未自闭合的 br/hr */
  const softLine = '第一行做法说明\n第二行原话：『这么干的』（李示例）';
  const samples = [
    ['新格式全文', poster.buildPreviewPayload(RAW_NEW, META, 'full').html],
    ['旧格式全文', poster.buildPreviewPayload(RAW_OLD, META, 'full').html],
    ['一图流', poster.buildPreviewPayload(RAW_NEW, META, 'flow').html],
    ['六节', poster.buildPreviewPayload(RAW_NEW, META, 'six').html],
  ];
  const bareBr = /<br\s*(?<!\/)>/i;
  const bareHr = /<hr\s*(?<!\/)>/i;
  samples.forEach(function (it) {
    ok(!bareBr.test(it[1]), it[0] + ' markup 无未自闭合 <br>');
    ok(!bareHr.test(it[1]), it[0] + ' markup 无未自闭合 <hr>');
  });
  /* 正向确认：只要夹具渲染出了 <br/>，说明软换行路径真的被上面两条覆盖到 */
  const hasBr = samples.some(function (it) { return it[1].includes('<br/>'); });
  ok(hasBr, '夹具渲染产物中确实出现自闭合 <br/>（软换行路径被覆盖）');
}

/* ───────── 11. 报告截断防线（2026-10-10，id=19 事故回归） ───────── */
console.log('\n[11] 报告截断防线：残缺报告不允许静默归档');
{
  const web = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  const srv = fs.readFileSync(
    path.join(__dirname, '..', 'cloudfunctions', 'interview-proxy', 'index.js'), 'utf8');

  /* 前端 generateReport：截断自动重试（两档预算）+ 残缺时不写 state.reportRaw */
  ok(/finish_reason\s*===?\s*'length'/.test(web), '前端检测 finish_reason=length');
  ok(/attempt === 0 \? 8000 : 12000/.test(web), '截断自动重试且第二档预算 12000（16000 会让 v4-flash 返回空 content，禁止更高）');
  ok(!/max_tokens\s*[:=]\s*16000/.test(web), '报告生成不使用 16000 预算（超上限会拿到空报告）');
  ok(/secCount < 5/.test(web), '前端节数校验：<5 个分隔符视为残缺');
  ok(/报告生成不完整/.test(web) && /残缺报告进不了库|残缺报告进不了/.test(web),
    '残缺时明确报错且阻断归档');

  /* 服务端 submit：最后一道闸 */
  ok(srv.includes('report_sections_invalid'), 'submit 有 report_sections_invalid 归档闸');
  ok(/secCount < 5/.test(srv), 'submit 节数阈值与编辑护栏一致（<5 拒绝）');

  /* 对话流式预算：600 会被长对话的推理吃光 → 空回复（id=16 第 48 条实测） */
  ok(/max_tokens: 2000/.test(web), '对话流式 max_tokens 提到 2000（600 被推理吃光会输出空回复）');
}

console.log('\n' + '─'.repeat(52));
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
