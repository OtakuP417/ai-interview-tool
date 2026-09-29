/**
 * 管理端「覆盖度体检」回归测试
 *
 * 背景：访谈页的 assessCoverage 是给填表人（顾问）自己看的；
 *       审核方在后台看不到任何覆盖度信息，只能靠读全文判断素材够不够。
 *       这里给管理端补一份同判据的覆盖度评估并渲染成体检条。
 *
 * 硬约束：两边判据必须一致，否则同一份报告在访谈页和后台结论不同。
 *         所以本测试同时校验「六维定义」「必备三维」「方法层信号」「字数软信号」
 *         在两份源码里是对齐的。
 */
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (extra ? '  → ' + extra : '')); }
}

const ADMIN = fs.readFileSync(path.join(__dirname, '..', 'web', 'admin.html'), 'utf8');
const INDEX = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');

/* 从源码抽一段：剥注释后按括号配平。正则字面量为配平抹掉，但返回原文。 */
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
  if (i < 0) { console.error('not found: ' + marker); process.exit(1); }
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

const code = [
  grab(ADMIN, 'const COV_DIMS = ['),
  grab(ADMIN, 'const COV_METHOD_RE ='),
  grab(ADMIN, 'function covSectionMap(raw)'),
  grab(ADMIN, 'function covSubstantive(text)'),
  grab(ADMIN, 'function assessCoverageAdmin(raw, transcript)'),
  grab(ADMIN, 'function renderCovBar(row)'),
  'function esc(s){return String(s==null?"":s);}',
  'module.exports = { assessCoverageAdmin, renderCovBar, COV_DIMS, COV_METHOD_RE };',
].join('\n');
const mod = { exports: {} };
new Function('module', 'exports', code)(mod, mod.exports);
const { assessCoverageAdmin, renderCovBar, COV_DIMS } = mod.exports;

function mkReport(sections) {
  return Object.keys(sections).map(t => t + '\n' + sections[t]).join('\n---SECTION---\n');
}
function mkTurns(answers) {
  const out = [{ role: 'system', content: 'SYS' }];
  answers.forEach(a => { out.push({ role: 'assistant', content: '提问？' }); out.push({ role: 'user', content: a }); });
  return out;
}
const FULL_REPORT = mkReport({
  '背景与挑战': '客户是经营五金批发的个体工商户，2024 年通过老客户介绍接触，当时需要 25 万周转。',
  '核心做法': '做法\n建立转介绍台账：每周五固定整理当周成交客户，逐一致电回访\n首次接触：先微信发送产品要点，三天后电话跟进\n对方没反应时怎么办：两次不回就换微信节日问候，不催贷款',
  '结果': '半年内通过转介绍新增放款 9 笔，累计 210 万，首逾率 0。',
  '关键判断与取舍': '额度低于 15 万的不主动推转介绍，先做存量盘活。',
  '新人容易踩的坑': '新人常在放款当天就开口要转介绍，客户容易被直接拒绝。',
});
const FULL_TALK = [
  '客户是五金批发的，老客户介绍来的，要 25 万周转。',
  '我每周五会整理一次当周成交的客户名单，然后一个一个打电话回访。',
  '第一次接触我先发微信，把产品要点发过去，三天后再打电话跟进。',
  '他不回我微信，我就隔几天发个节日问候，不催他贷款的事。',
  '半年新增了 9 笔转介绍，210 万，没有逾期。',
  '额度太小的客户我不会主动提转介绍，先做存量，不然客户觉得你在推销。',
];

console.log('\n[1] 后台必须真的渲染覆盖度（原先完全没有）');
{
  ok(/function assessCoverageAdmin\(/.test(ADMIN), 'assessCoverageAdmin 已定义');
  ok(/function renderCovBar\(/.test(ADMIN), 'renderCovBar 已定义');
  ok(/const COV_DIMS = \[/.test(ADMIN), '六维定义存在');
  ok(/\$\{renderCovBar\(row\)\}/.test(ADMIN), '覆盖度条已插入详情页 renderDetail');
  ok(/\.cov-bar\s*\{/.test(ADMIN), 'cov-bar 样式已定义');
  ok(/\.cov-chip\s*\{/.test(ADMIN), 'cov-chip 样式已定义');
}

console.log('\n[2] 判据与访谈页对齐（同报告不能两边结论不同）');
{
  const idxDims = (INDEX.match(/const COVERAGE_DIMS = \[([\s\S]*?)\];/) || ['', ''])[1];
  const admDims = (ADMIN.match(/const COV_DIMS = \[([\s\S]*?)\];/) || ['', ''])[1];
  const keys = s => (s.match(/k:\s*'([a-z]+)'/g) || []).map(x => x.replace(/k:\s*'|'/g, ''));
  const a = keys(idxDims), b = keys(admDims);
  ok('两边六维键名与顺序一致', a.length === 6 && a.join(',') === b.join(','), a.join(',') + ' vs ' + b.join(','));
  ok('两边都有方法层信号词表', /COVERAGE_DIMS|COV_DIMS/.test(ADMIN));
  ok('两边结果节都用「无数字」软提示', /有内容但没数字，说服力偏弱/.test(INDEX) && /有内容但没数字，说服力偏弱/.test(ADMIN));
  ok('两边必备三维一致', /const required = \['background',\s*'action',\s*'result'\]/.test(INDEX) && /\['background',\s*'action',\s*'result'\]/.test(ADMIN));
}

console.log('\n[3] 六维齐备 + 原话充足 → 够用');
{
  const c = assessCoverageAdmin(FULL_REPORT, mkTurns(FULL_TALK));
  ok('valuable 为真', c.valuable === true, JSON.stringify(c.reasons));
  ok('覆盖 6/6', c.covered === 6, c.covered);
  const html = renderCovBar({ report_md: FULL_REPORT, transcript: mkTurns(FULL_TALK) });
  ok('渲染出 ok 态', /cov-bar ok/.test(html));
  ok('文案含「素材够用」', /素材够用/.test(html));
  ok('六个 chip 都在', (html.match(/cov-chip/g) || []).length >= 6);
}

console.log('\n[4] 结构齐但原话极少 → 不能判「够用」（#8 王示例型）');
{
  const thin = assessCoverageAdmin(FULL_REPORT, mkTurns(['老客户转介绍', '做地产的', '直接打', '没有', '可以']));
  ok('valuable 为假', thin.valuable === false);
  ok('structural 仍为真（结构确实齐）', thin.structural === true);
  ok('thin 标记为真', thin.thin === true);
  ok('原话字数被算出', thin.userChars === 17, thin.userChars);
  const html = renderCovBar({ report_md: FULL_REPORT, transcript: mkTurns(['老客户转介绍', '做地产的', '直接打', '没有', '可以']) });
  ok('渲染为 gap 态', /cov-bar gap/.test(html));
  ok('点明原话偏少', /原话偏少|原话仅/.test(html));
}

console.log('\n[5] 缺维度 → 点名缺口');
{
  const noResult = mkReport({
    '背景与挑战': '客户是五金批发的个体工商户，通过老客户介绍接触，需要二十五万周转。',
    '核心做法': '每周五整理名单，逐一电话回访，两天不回就发微信节日问候。',
  });
  const c = assessCoverageAdmin(noResult, mkTurns(FULL_TALK));
  ok('valuable 为假', c.valuable === false);
  ok('点名缺「结果与数据」', c.reasons.join('').indexOf('结果与数据') >= 0, JSON.stringify(c.reasons));
  const html = renderCovBar({ report_md: noResult, transcript: mkTurns(FULL_TALK) });
  ok('缺口写进体检条', /结果与数据/.test(html));
}

console.log('\n[6] 方法层两来源：报告写了但对话没支撑 → 仍算缺');
{
  const reportOnly = mkReport({
    '背景与挑战': '客户是五金批发的个体工商户，通过老客户介绍接触，需要二十五万周转。',
    '核心做法': '每周五整理名单，逐一电话回访，两天不回就发微信节日问候。',
    '结果': '半年内通过转介绍新增放款 9 笔，累计 210 万，首逾率 0。',
  });
  const c = assessCoverageAdmin(reportOnly, mkTurns(['客户是五金批发的，老客户介绍来的。', '就是服务做好一点。']));
  const m = c.dims.find(d => d.k === 'method');
  ok('方法层未通过', m.ok === false);
  ok('提示对话中未见支撑', m.note.indexOf('对话中未见支撑') >= 0, m.note);
}

console.log('\n[7] 结果无数字 → 软提示但不否决');
{
  const r = mkReport({
    '背景与挑战': '客户是五金批发的个体工商户，通过老客户介绍接触，需要二十五万周转。',
    '核心做法': '每周五整理名单，逐一电话回访，两天不回就发微信节日问候。',
    '结果': '客户顺利成交，全程未遇卡点，最关键的因素是老客户的信任背书。',
  });
  const c = assessCoverageAdmin(r, mkTurns(FULL_TALK));
  const d = c.dims.find(x => x.k === 'result');
  ok('定性结果仍算覆盖', d.ok === true);
  ok('note 点出没数字', d.note.indexOf('没数字') >= 0, d.note);
}

console.log('\n[8] 边界：空输入不抛异常');
{
  let threw = false, c;
  try { c = assessCoverageAdmin('', []); } catch (e) { threw = true; }
  ok('空报告+空对话不抛异常', threw === false);
  ok('valuable 为假', c && c.valuable === false);
  ok('六维结构完整', c && c.dims.length === 6, c && c.dims.length);
  c = assessCoverageAdmin(null, null);
  ok('null 输入不抛异常', c && c.dims.length === 6);
  const html = renderCovBar({ report_md: '', transcript: null });
  ok('renderCovBar 空数据也能渲染', typeof html === 'string' && html.length > 0);
}

console.log('\n[9] 节标题别名兜底（模型不照模板写）');
{
  const r = mkReport({
    '背景与挑战': '客户是五金批发的个体工商户，通过老客户介绍接触，需要二十五万周转。',
    '核心做法': '每周五整理名单，逐一电话回访，两天不回就发微信节日问候。',
    '结果与数据': '半年内通过转介绍新增放款 9 笔，累计 210 万，首逾率 0。',
  });
  const c = assessCoverageAdmin(r, mkTurns(FULL_TALK));
  ok('「结果与数据」命中别名「结果」', c.dims.find(d => d.k === 'result').ok === true);
}

console.log('\n' + '='.repeat(52));
console.log('  管理端覆盖度体检：通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('='.repeat(52));
process.exit(fail ? 1 : 0);
