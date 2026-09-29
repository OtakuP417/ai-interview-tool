/**
 * 报告节标题归一（normalizeReport）行为回归测试
 *
 * 背景：2026-09-29 专家评审发现「同一批报告出现两种节标题写法」——
 *       模型偶尔把「## 核心做法」写成「核心动作」「避坑指南」，
 *       而 renderReport / sectionMap / assessCoverage 都是按固定下标取值的，
 *       标题一偏就会取空 → 报告页显示「本节内容未获取到」，
 *       覆盖度体检也会误报「这一块还是空的」。
 *
 * 本测试不校验源码字符串（那由 verify-interview-prompt [17] 做），
 * 而是把真实的 normalizeReport / normalizeSectionTitle 抽出来跑，
 * 校验它的实际行为：改标题行、不动正文、认不出来就原样返回。
 *
 * 硬约束（写错了会毁掉归档数据）：
 *   1. 只允许改每节的第一行；正文一个字都不能动。
 *   2. 认不出来的标题必须原样保留，不能瞎猜成别的节。
 *   3. 分隔符 ---SECTION--- 的数量与顺序必须完全不变。
 *   4. 幂等：跑两次和跑一次结果一样。
 *
 * 用法：node tests/verify-normalize.js
 */
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (extra ? '  → ' + extra : '')); }
}

const INDEX = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');

/* ── 三件套提取工具：抄自 verify-admin-coverage.js，勿凭记忆重写 ──
   （注释里的花括号、正则字面量里的括号都会让朴素配平跑偏） */
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
  grab(INDEX, 'const SECTION_TITLES = ['),
  grab(INDEX, 'const SECTION_ALIASES = ['),
  grab(INDEX, 'const SEP_LINE_RE ='),
  grab(INDEX, 'const SEP_SECTION_RE ='),
  grab(INDEX, 'function normalizeSectionTitle(line)'),
  grab(INDEX, 'function repairSectionSeparators(raw)'),
  grab(INDEX, 'function normalizeReport(raw)'),
  'module.exports = { normalizeReport, normalizeSectionTitle, repairSectionSeparators, SECTION_TITLES, SECTION_ALIASES };',
].join('\n');
const mod = { exports: {} };
new Function('module', 'exports', code)(mod, mod.exports);
const { normalizeReport, normalizeSectionTitle, repairSectionSeparators, SECTION_TITLES, SECTION_ALIASES } = mod.exports;

const SEP = '---SECTION---';
/* 注意：真实 report_md 里分隔符两侧通常带换行，所以每节开头会有一个前导 \n。
   切分后要跳过前导空白行再取标题，否则断言会盯着空字符串。 */
function partsOf(raw) { return String(raw).split(SEP); }
function headOf(part) {
  const lines = String(part).split('\n');
  for (const l of lines) { if (l.trim()) return l.trim(); }
  return '';
}

console.log('\n[1] 提取成功且接口完整');
{
  ok(typeof normalizeReport === 'function', 'normalizeReport 是一个函数');
  ok(typeof normalizeSectionTitle === 'function', 'normalizeSectionTitle 是一个函数');
  ok(SECTION_TITLES.length === 7, '标准标题 7 个', SECTION_TITLES.join(' / '));
  ok(SECTION_ALIASES.length === 7, '别名表 7 组');
}

console.log('\n[2] 标准标题：原样通过（不能被别名表改坏）');
{
  SECTION_TITLES.forEach(t => {
    ok(normalizeSectionTitle(t) === t, '标准标题「' + t + '」原样返回');
  });
  ok(normalizeSectionTitle('**核心做法**') === '核心做法', '剥离 ** 粗体装饰');
  ok(normalizeSectionTitle('## 核心做法') === '核心做法', '剥离 ## markdown 标题');
  ok(normalizeSectionTitle('###  关键判断与取舍  ') === '关键判断与取舍', '多空格 + 多井号也能剥');
  ok(normalizeSectionTitle('【结果】') === '结果', '剥离【】装饰');
  ok(normalizeSectionTitle('1. 核心做法') === '核心做法', '剥离阿拉伯数字序号');
  ok(normalizeSectionTitle('三、核心做法') === '核心做法', '剥离中文序号');
  ok(normalizeSectionTitle('核心做法：') === '核心做法', '剥离尾部冒号');
  ok(normalizeSectionTitle('第二十节 核心做法') === '核心做法', '剥离「第X节」');
}

console.log('\n[3] 别名命中：模型常见误写都要认出来');
{
  const cases = [
    ['案例背景', '背景与挑战'], ['事情背景', '背景与挑战'], ['背景', '背景与挑战'],
    ['核心动作', '核心做法'], ['他做了什么', '核心做法'], ['关键做法', '核心做法'],
    ['关键决策', '关键判断与取舍'], ['判断与取舍', '关键判断与取舍'], ['取舍', '关键判断与取舍'],
    ['成果', '结果'], ['效果', '结果'], ['结果与数据', '结果'], ['业绩结果', '结果'],
    ['可复制的经验', '可复制的经验点'], ['经验总结', '可复制的经验点'], ['经验点', '可复制的经验点'],
    ['避坑指南', '新人容易踩的坑'], ['新人避坑', '新人容易踩的坑'], ['常见误区', '新人容易踩的坑'],
    ['海报文案', '海报摘要'], ['摘要', '海报摘要'],
  ];
  cases.forEach(([alias, std]) => {
    ok(normalizeSectionTitle(alias) === std, '「' + alias + '」→「' + std + '」');
  });
}

console.log('\n[4] 认不出来就必须原样保留（不许瞎猜）');
{
  const unknown = ['客户画像', '团队协作', '后续动作', '关于风险', '我的一点感想', '附录'];
  unknown.forEach(t => {
    ok(normalizeSectionTitle(t) === '', '未知标题「' + t + '」返回空（交由调用方保留原文）');
  });
  ok(normalizeSectionTitle('') === '', '空字符串返回空');
  ok(normalizeSectionTitle('   ') === '', '纯空白返回空');
}

console.log('\n[5] normalizeReport：只改标题行，正文一字不动');
{
  const raw = [
    '## 案例背景',
    '客户是经营五金批发的个体工商户，2024 年通过老客户介绍接触，当时需要 25 万周转。',
    '第二行正文，含中文标点与 3 个数字。',
    SEP,
    '核心动作',
    '做法',
    '建立转介绍台账：每周五固定整理当周成交客户',
    SEP,
    '避坑指南',
    '新人常在放款当天就开口要转介绍。',
  ].join('\n');
  const out = normalizeReport(raw);
  const outParts = partsOf(out);
  ok(outParts.length === 3, '分隔符数量不变（3 节）', outParts.length + ' 节');
  ok(headOf(outParts[0]) === '背景与挑战', '第 1 节标题已归一到「背景与挑战」');
  ok(headOf(outParts[1]) === '核心做法', '第 2 节标题已归一到「核心做法」');
  ok(headOf(outParts[2]) === '新人容易踩的坑', '第 3 节标题已归一到「新人容易踩的坑」');
  /* 正文必须逐字保留 */
  ok(out.includes('客户是经营五金批发的个体工商户，2024 年通过老客户介绍接触，当时需要 25 万周转。'),
    '第 1 节正文逐字保留');
  ok(out.includes('第二行正文，含中文标点与 3 个数字。'), '第 1 节第二行保留');
  ok(out.includes('建立转介绍台账：每周五固定整理当周成交客户'), '第 2 节正文保留');
  ok(out.includes('新人常在放款当天就开口要转介绍。'), '第 3 节正文保留');
  /* 正文里若本来含 ---- 之类，不能被误判 */
  ok(!/##\s*案例背景/.test(out), '装饰符已被剥掉');
}

console.log('\n[6] 认不出的节标题：整节原样返回');
{
  const raw = ['客户画像', '他是个做了 8 年的老顾问。', SEP, '核心做法', '做法', '每周五整理名单'].join('\n');
  const out = normalizeReport(raw);
  const p = partsOf(out);
  ok(headOf(p[0]) === '客户画像', '未知标题保持原样');
  ok(headOf(p[1]) === '核心做法', '后面的标准标题不受影响');
  ok(out.includes('他是个做了 8 年的老顾问。'), '未知节正文也没被动过');
}

console.log('\n[7] 幂等性：跑两次 == 跑一次');
{
  const raw = ['##  案例背景', 'A', SEP, '成果', 'B', SEP, '避坑指南', 'C'].join('\n');
  const once = normalizeReport(raw);
  const twice = normalizeReport(once);
  ok(once === twice, 'normalizeReport 幂等');
  /* 归一后再取节，必须能被标准下标取到 */
  const p = partsOf(once);
  ok(headOf(p[0]) === '背景与挑战', '第 1 节可取');
  ok(headOf(p[1]) === '结果', '第 2 节可取');
  ok(headOf(p[2]) === '新人容易踩的坑', '第 3 节可取');
}

console.log('\n[8] 边界输入不崩');
{
  ok(normalizeReport('') === '', '空串原样返回');
  ok(normalizeReport(null) === '', 'null 返回空串');
  ok(normalizeReport(undefined) === '', 'undefined 返回空串');
  ok(normalizeReport('只有一行没有分隔符') === '只有一行没有分隔符', '无分隔符时原样返回');
  const leadBlank = '\n\n' + SEP + '\n核心做法\n做法\n内容';
  const out = normalizeReport(leadBlank);
  ok(partsOf(out).length === 2, '节首有空白行时仍能正确切分');
  ok(headOf(partsOf(out)[1]) === '核心做法', '跳过前导空白行后命中标题');
}

console.log('\n[9] 与 sectionMap 的取值约定对齐');
{
  /* sectionMap 会自己剥序号/井号/粗体，所以归一后的文本必须能被它取到。
     这里做一次端到端模拟：归一 → 按标准标题取值。 */
  const raw = ['背景', '背景正文内容足够长用来通过实质内容判断。', SEP,
    '核心动作', '做法：每周五整理名单', SEP,
    '成果', '半年新增 9 笔转介绍，210 万。', SEP,
    '关键决策', '额度太小不推转介绍。', SEP,
    '避坑指南', '新人常在放款当天就开口要转介绍。'].join('\n');
  const out = normalizeReport(raw);
  const secs = {};
  partsOf(out).forEach(part => {
    const lines = part.split('\n');
    /* 与生产代码 sectionMap 的约定一致：先跳过前导空白行，再取标题行 */
    let h = 0;
    while (h < lines.length && !lines[h].trim()) h++;
    const title = String(lines[h] || '')
      .replace(/^\s*(?:\d+[.、）)]\s*|#{1,6}\s*)/, '')
      .replace(/[*_【】]/g, '').replace(/[:：]\s*$/, '').trim();
    secs[title] = lines.slice(h + 1).join('\n').trim();
  });
  ['背景与挑战', '核心做法', '结果', '关键判断与取舍', '新人容易踩的坑'].forEach(t => {
    ok(secs[t] != null, '归一后能按标准标题取到「' + t + '」');
  });
  ok((secs['结果'] || '').includes('210 万'), '取到的结果节内容正确');
}

console.log('\n[10] 分隔符容错修复（2026-09-29 实测缺陷）');
{
  /* 实测：加了原话/参照系等更重的要求后，模型把 ---SECTION--- 写成裸 ---，
     整份报告被当成 1 节，第 2-7 节全空。这里固化成断言。 */
  const broken = ['背景与挑战', '背景正文。', '---', '核心做法', '做法：A', '---', '结果', '做了 210 万。'].join('\n');
  ok(repairSectionSeparators(broken) === broken.replace(/^---$/gm, '---SECTION---'),
    '裸 --- 被修成 ---SECTION---');
  const fixed = normalizeReport(broken);
  ok(partsOf(fixed).length === 3, '修复后正确切分为 3 节', partsOf(fixed).length + ' 节');
  ok(headOf(partsOf(fixed)[1]) === '核心做法', '第 2 节标题正确');
  ok((partsOf(fixed)[2] || '').includes('210 万'), '第 3 节正文保留');

  /* 各种分隔符变体 */
  ['---', '----', '****', '====', '———', '___'].forEach(sep => {
    const r = normalizeReport(['背景与挑战', 'A', sep, '结果', 'B'].join('\n'));
    ok(partsOf(r).length === 2, '分隔符变体「' + sep + '」被修复');
  });
  /* --- SECTION --- 这种带空格的也算 */
  const sp = normalizeReport(['背景与挑战', 'A', '--- SECTION ---', '结果', 'B'].join('\n'));
  ok(partsOf(sp).length === 2, '「--- SECTION ---」被修复');

  /* 关键：正文里的水平线不能误判 */
  const noFalse = ['背景与挑战', '他画了一条线：', '---', '然后接着说别的事，这一行不是标题。'].join('\n');
  const r2 = normalizeReport(noFalse);
  ok(partsOf(r2).length === 1, '分隔符后面不是节标题时，不误判（保持 1 节）');
  ok(r2.includes('然后接着说别的事'), '未误判时正文完整保留');

  /* 已经是标准输出时不许乱动 */
  const good = ['背景与挑战', 'A', '---SECTION---', '核心做法', 'B', '---SECTION---', '关键判断与取舍', 'C',
    '---SECTION---', '结果', 'D', '---SECTION---', '可复制的经验点', 'E', '---SECTION---', '新人容易踩的坑', 'F',
    '---SECTION---', '海报摘要', '钩子句：X'].join('\n');
  ok(repairSectionSeparators(good) === good, '已写满 6 个标准分隔符时原样不动（幂等保护）');

  /* 混合情况：一半标准一半裸 --- */
  const mix = ['背景与挑战', 'A', '---SECTION---', '核心做法', 'B', '---', '结果', 'C'].join('\n');
  const rm = normalizeReport(mix);
  ok(partsOf(rm).length === 3, '标准与裸分隔符混用也能正确切分', partsOf(rm).length + ' 节');
  ok(headOf(partsOf(rm)[1]) === '核心做法' && headOf(partsOf(rm)[2]) === '结果', '混用时两节标题都对');
}

console.log('\n' + '─'.repeat(52));
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
