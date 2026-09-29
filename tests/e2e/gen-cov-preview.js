/* 从 web/admin.html 抽真实函数，生成渲染预览页（grab 实现与 verify-admin-coverage.js 保持一致） */
const fs = require('fs');
const path = require('path');

const ADMIN = fs.readFileSync(path.resolve(__dirname, '../../web/admin.html'), 'utf-8');

/* ↓↓ 与 tests/verify-admin-coverage.js 完全一致的抽取三件套 ↓↓ */
function stripComments(s) {
  let out = "", p = 0;
  while (p < s.length) {
    if (s[p] === '/' && s[p + 1] === '*') {
      const e = s.indexOf('*/', p + 2); const stop = e < 0 ? s.length : e + 2;
      out += ' '.repeat(stop - p); p = stop;
    } else if (s[p] === '/' && s[p + 1] === '/') {
      const e = s.indexOf('\n', p); const stop = e < 0 ? s.length : e;
      out += ' '.repeat(stop - p); p = stop;
    } else if (s[p] === '"' || s[p] === "'" || s[p] === '`') {
      const q = s[p]; let stop = p + 1;
      while (stop < s.length && s[stop] !== q) { if (s[stop] === '\\') stop++; stop++; }
      stop = Math.min(stop + 1, s.length);
      out += s.slice(p, stop); p = stop;
    } else { out += s[p]; p++; }
  }
  return out;
}
function maskRegex(s) {
  let out = "", p = 0;
  const canEnd = ch => ch === undefined || /[A-Za-z0-9_$\)\]\}'"`.]/.test(ch);
  while (p < s.length) {
    if (s[p] === '/' && !canEnd(s.slice(0, p).replace(/\s+$/, '').slice(-1))) {
      let stop = p + 1, inClass = false, closed = false;
      while (stop < s.length) {
        const c = s[stop];
        if (c === '\\') { stop += 2; continue; }
        if (c === '\n') break;
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) { closed = true; break; }
        stop++;
      }
      const s2 = Math.min(stop + 1, s.length);
      if (closed) { out += ' '.repeat(s2 - p); p = s2; } else { out += s[p]; p++; }
    } else { out += s[p]; p++; }
  }
  return out;
}
function grab(src, marker) {
  const i = src.indexOf(marker);
  if (i < 0) throw new Error('not found: ' + marker);
  const rest = src.slice(i);
  const nl = rest.indexOf('\n');
  const head = nl < 0 ? rest : rest.slice(0, nl);
  if (head.indexOf('function') < 0 && /;\s*$/.test(head)) return head;
  const body = stripComments(rest);
  const mask = maskRegex(body);
  let start = 0;
  if (head.indexOf('function') >= 0) { start = mask.indexOf('{'); if (start < 0) return body; }
  const headMask = maskRegex(stripComments(head));
  const openBrace = /[([{]\s*$/.test(headMask) ? headMask.match(/[([{]\s*$/)[0].trim() : '';
  const open = openBrace || (head.indexOf('function') >= 0 ? '{' : '(');
  const close = { '{': '}', '[': ']', '(': ')' }[open];
  let depth = 0, seen = false;
  for (let p = start; p < mask.length; p++) {
    const ch = mask[p];
    if (ch === open) { depth++; seen = true; }
    else if (ch === close) {
      depth--;
      if (seen && depth === 0) { const e = body.indexOf('\n', p); return body.slice(0, e < 0 ? body.length : e); }
    }
  }
  return body;
}
/* ↑↑ 抽取三件套结束 ↑↑ */

const FNSRC = [
  grab(ADMIN, 'function esc(s)'),
  grab(ADMIN, 'const COV_DIMS = ['),
  grab(ADMIN, 'const COV_METHOD_RE ='),
  grab(ADMIN, 'function covSectionMap(raw)'),
  grab(ADMIN, 'function covSubstantive(text)'),
  grab(ADMIN, 'function assessCoverageAdmin(raw, transcript)'),
  grab(ADMIN, 'function renderCovBar(row)'),
].join('\n');

/* 本地冒烟：先在 Node 里跑一遍，语法错立刻暴露，不用等浏览器 */
const mod = { exports: {} };
new Function('module', 'exports', FNSRC + '\nmodule.exports = { assessCoverageAdmin, renderCovBar };')(mod, mod.exports);
if (typeof mod.exports.renderCovBar !== 'function') throw new Error('renderCovBar 导出失败');
const smoke = mod.exports.renderCovBar({ report_md: '背景与挑战\n测试。\n---SECTION---\n结果\n放款 5 万。', transcript: '[]' });
if (!/cov-bar/.test(smoke)) throw new Error('renderCovBar 冒烟失败');
console.log('Node 冒烟通过：', smoke.slice(0, 80) + '…');

/* 抽整块覆盖度 CSS：从注释起到 .cov-chip.gap 规则结束（多行规则不能按行过滤） */
const cssStart = ADMIN.indexOf('/* 覆盖度体检条');
if (cssStart < 0) throw new Error('cov css comment not found');
const gapIdx = ADMIN.indexOf('.cov-chip.gap', cssStart);
const cssEnd = ADMIN.indexOf('}', gapIdx);
const CSS = ADMIN.slice(cssStart, cssEnd + 1);

const CASES = [
  {
    label: '① 六维齐全 + 原话充足 → 绿（可采纳）',
    row: {
      report_md: [
        '背景与挑战\n客户在本地做建材生意，旺季资金周转紧张，是营业部老客户转介绍来的。',
        '核心做法\n先看流水再谈额度，每周固定跟进一次，把还款节奏和经营周期对上。',
        '关键判断与取舍\n判断依据是他近半年的回款周期，宁愿额度放小一点也要留出缓冲。',
        '结果\n最终放款 26 万，客户三个月内没有出现逾期，还转介绍了两位同行。',
        '新人容易踩的坑\n不要一上来就谈利息，先把客户的实际用款节奏问清楚。',
      ].join('\n---SECTION---\n'),
      transcript: [
        { role: 'user', content: '我这边客户是做建材的，旺季缺资金'.repeat(20) },
        { role: 'assistant', content: '明白' },
        { role: 'user', content: '我每周跟进一次，用微信先问回款'.repeat(30) },
      ],
    },
  },
  {
    label: '② 结构齐但原话极少（#8 王示例型）→ 黄（不够用）',
    row: {
      report_md: [
        '背景与挑战\n客户是建材市场个体户，老客户转介绍来的。',
        '核心做法\n先查流水再做方案，隔天回访一次。',
        '关键判断与取舍\n以回款周期为准，额度留出缓冲。',
        '结果\n放款 26 万，三个月无逾期。',
        '新人容易踩的坑\n不要一上来就谈利息，先问用款节奏。',
      ].join('\n---SECTION---\n'),
      transcript: [
        { role: 'user', content: '我用微信每周跟进一次' },
        { role: 'assistant', content: '好的' },
        { role: 'user', content: '就这样' },
      ],
    },
  },
  {
    label: '③ 缺必备维「结果与数据」→ 黄（点名缺口）',
    row: {
      report_md: [
        '背景与挑战\n客户是餐饮个体户，老客户转介绍来的，店里生意稳定。',
        '核心做法\n每周一次电话回访，微信保持联系，用名单系统筛客户。',
        '关键判断与取舍\n根据客户回款周期判断入户时机，避开月底。',
        '新人容易踩的坑\n不要只聊产品，先搞清楚客户真实的用款场景。',
      ].join('\n---SECTION---\n'),
      transcript: [
        { role: 'user', content: '我每次都是先电话联系客户，再微信跟进'.repeat(30) },
      ],
    },
  },
];

const js = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>覆盖度体检 — 渲染预览</title>
<style>
  :root {
    --surface: #f5f6f8;
    --surface-alt: #fff;
    --border: #e3e5ea;
    --text: #1f2329;
    --text-muted: #6b7280;
    --radius: 10px;
    --warning-light: #fdf3e0;
    --warning-text: #8a5a12;
  }
  body { font-family: -apple-system, "Microsoft YaHei", sans-serif; background: #fff; color: var(--text); padding: 22px; margin: 0; }
  h2 { font-size: 15px; margin: 0 0 4px; }
  .sub { font-size: 12px; color: var(--text-muted); margin-bottom: 18px; }
  .case { margin-bottom: 16px; padding: 14px 16px; border: 1px solid var(--border); border-radius: 10px; background: #fff; }
  .case-label { font-size: 12px; color: var(--text-muted); margin-bottom: 8px; }
  pre.err { color: #c0392b; white-space: pre-wrap; font-size: 11px; }
</style>
<style id="covcss"></style>
</head>
<body>
  <h2>管理端「覆盖度体检」渲染预览</h2>
  <div class="sub">用真实函数 assessCoverageAdmin + renderCovBar 渲染，检查颜色与文案是否符合预期</div>
  <div id="host"></div>
  <script>
    window.onerror = function (msg, src2, line, col, err) {
      var d = document.createElement('pre');
      d.className = 'err';
      d.textContent = 'ERROR: ' + msg + ' @' + line + ':' + col + (err && err.stack ? '\\n' + err.stack : '');
      document.body.appendChild(d);
    };
    var CASES = ${js(CASES)};
    var FNSRC = ${js(FNSRC)};
    var CSS = ${js(CSS)};
    document.getElementById('covcss').textContent = CSS;
    try {
      var mod = { exports: {} };
      new Function('module', 'exports', FNSRC + '\\nmodule.exports = { assessCoverageAdmin, renderCovBar };')(mod, mod.exports);
      var renderCovBar = mod.exports.renderCovBar;
      var host = document.getElementById('host');
      CASES.forEach(function (c) {
        var d = document.createElement('div');
        d.className = 'case';
        d.innerHTML = '<div class="case-label">' + c.label + '</div>' + renderCovBar(c.row);
        host.appendChild(d);
      });
    } catch (e) {
      window.onerror(String(e && e.message || e), 'inline', 0, 0, e);
    }
  </script>
</body>
</html>
`;

fs.writeFileSync(path.resolve(__dirname, 'cov-preview.html'), html);
console.log('OK 注入完成  fnsrc=' + FNSRC.length + '  css=' + CSS.length + '  cases=' + CASES.length);
