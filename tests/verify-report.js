/* 报告渲染层 + 素材门槛 回归测试
   跑法（在项目根目录）：
   NODE_PATH=C:/Users/Furina/.workbuddy/binaries/node/workspace/node_modules \
     C:/Users/Furina/.workbuddy/binaries/node/versions/22.22.2-3/node.exe tests/verify-report.js

   覆盖：
   ① stripSectionHeading —— 章节标题不再残留（历史 bug：第2-6节标题重复）
   ② renderStructured   —— 「做法 / 具体怎么做」渲染成层级，不再是一坨文本
   ③ assessInterview    —— 用四份真实报告的素材量校准门槛
   ④ collectReportIssues—— 素材偏薄 / 末条未回答 / 膨胀比过高都能报出来
   ⑤ 归档 transcript 与轮次口径一致
*/
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
/* ⚠️ 必须指向 web/index.html —— 根目录的 index.html 是遗留旧副本，
   曾导致本套件长期在测过期页面。不要再改回 'index.html'。 */
const html = fs.readFileSync(path.join(ROOT, 'web', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; fails.push(name + (extra ? '  →  ' + extra : '')); }
}
function eq(name, got, want) {
  ok(name, got === want, 'got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want));
}

/* ─── 建一个可用的页面环境 ─── */
function makeDom() {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://example.test/',
    pretendToBeVisual: true,
  });
  const w = dom.window;
  w.fetch = () => Promise.reject(new Error('no network in test'));
  return dom;
}

const dom = makeDom();
const w = dom.window;

const stripSectionHeading = w.eval('stripSectionHeading');
const splitLines = w.eval('splitLines');
const looksStructured = w.eval('looksStructured');
const renderStructured = w.eval('renderStructured');
const renderPlain = w.eval('renderPlain');
const assessInterview = w.eval('assessInterview');
const collectReportIssues = w.eval('collectReportIssues');
const renderReport = w.eval('renderReport');
const countRounds = w.eval('countRounds');
const GATE = w.eval('GATE');
const SYSTEM_PROMPT = w.eval('SYSTEM_PROMPT');
const REPORT_PROMPT = w.eval('REPORT_PROMPT');
const SECTION_TITLES = w.eval('SECTION_TITLES');

/* ═══ ① 章节标题剥离 ═══ */
console.log('\n① stripSectionHeading');

// 历史 bug 的原始形态：库内正文第 2 段起带前导空行
const buggy = '\n\n核心做法\n1. 先翻名单\n2. 再打电话';
eq('前导空行 + 标题被完整剥离', stripSectionHeading(buggy, '核心做法'), '1. 先翻名单\n2. 再打电话');

eq('无前导空行也能剥离',
   stripSectionHeading('核心做法\n1. abc', '核心做法'), '1. abc');
eq('标题带冒号',
   stripSectionHeading('结果：成交了', '结果'), '成交了');
eq('带 markdown 井号',
   stripSectionHeading('## 结果\n成交', '结果'), '成交');
eq('带编号前缀',
   stripSectionHeading('\n2. 可复制的经验点\n做法：A', '可复制的经验点'), '做法：A');
eq('标题被【】包住',
   stripSectionHeading('【新人容易踩的坑】\n1. 别急着推', '新人容易踩的坑'), '1. 别急着推');
// 关键：标题只在正文里出现过一次，中段不能误删
eq('不在开头的同名文字保留',
   stripSectionHeading('正文里提到核心做法这个词', '核心做法'), '正文里提到核心做法这个词');
eq('空文本返回空', stripSectionHeading('', '结果'), '');
eq('纯标题返回空', stripSectionHeading('\n\n结果\n', '结果'), '');

/* ═══ ② 结构化渲染 ═══ */
console.log('② renderStructured');

const good = [
  '做法：客户成交后按时间节奏做关系维护。',
  '具体怎么做：',
  '- 频次/时机：放款后第3天发到账提醒',
  '- 话术/方法："哥，款到了记得查一下"',
  '- 载体/工具：微信私聊，不群发',
  '- 对方没反应时怎么办：两次不回就停1-2个月',
].join('\n');

ok('识别为结构化', looksStructured(splitLines(good)));

const gHtml = renderStructured(good);
// 「做法：」这个前缀被摘掉当作卡片头，正文只留做法本身
eq('做法句作为卡片头（前缀已摘除）',
   /<div class="exp-lead">客户成交后按时间节奏做关系维护。<\/div>/.test(gHtml), true);
ok('渲染成 exp-item 卡片', gHtml.includes('class="exp-item"'));
eq('键值对数量（4 组步骤）',
   (gHtml.match(/exp-step/g) || []).length, 4);
ok('频次作为标签渲染', gHtml.includes('>频次/时机<'));
ok('「具体怎么做：」这行本身不显示', !gHtml.includes('具体怎么做：<'));

// 多条经验点
const two = [
  '做法：第一条做法。',
  '具体怎么做：',
  '- 频次：每周一次',
  '做法：第二条做法。',
  '具体怎么做：',
  '- 话术：先问周转',
].join('\n');
const tHtml = renderStructured(two);
eq('两条各自成卡片', (tHtml.match(/class="exp-item"/g) || []).length, 2);

// 退化情形：模型没按格式写
const plain = '在客户成交后，可以定期维护，长期积累信任。';
ok('非结构化文本不被误判', !looksStructured(splitLines(plain)));
const pHtml = renderStructured(plain);
ok('非结构化也能渲染出内容', pHtml.includes('定期维护') && pHtml.includes('exp-item'));

// 中文冒号
const cn = '做法：中文冒号测试。\n具体怎么做：\n- 频次：每月一次\n- 话术：先自报家门';
const cHtml = renderStructured(cn);
eq('中文冒号同样成键值', (cHtml.match(/exp-step/g) || []).length, 2);

// 有的模型把步骤写成「1. xxx」而不是「- 键：值」
const listy = '做法：测试列表式。\n具体怎么做：\n1. 每周五翻一遍名单\n2. 挑出满三天的客户';
const lHtml = renderStructured(listy);
ok('编号列表式步骤也能渲染', lHtml.includes('exp-step'));
ok('列表式内容没丢', lHtml.includes('每周五翻一遍名单'));

// 半角分号分隔的键值行（一行塞了多组）
const semi = '做法：测试分号。\n频次：每周一次；话术：先问周转；载体：微信';
const sHtml = renderStructured(semi);
ok('分号分隔的多个键值被拆开', (sHtml.match(/exp-step/g) || []).length >= 3);

// 值内部自带分号时不能被拆成两条（真实模型输出里很常见）
const inVal = '做法：测试值内分号。\n具体怎么做：\n- 载体/工具：微信私聊\n- 对方没反应时怎么办：两次不回就停1-2个月；节日再发一次';
const ivHtml = renderStructured(inVal);
eq('值内的分号不拆条', (ivHtml.match(/exp-step/g) || []).length, 2);
ok('值内分号内容完整保留', ivHtml.includes('两次不回就停1-2个月；节日再发一次'));

// 列表符号 + 编号混合
const mixed = '做法：混合。\n具体怎么做：\n1. 频次：每周一次\n2. 话术：先问好\n* 载体：微信';
const mHtml = renderStructured(mixed);
eq('编号与星号列表都能识别', (mHtml.match(/exp-step/g) || []).length, 3);
ok('列表符号没被带进标签', !/>[-*]\d?</.test(mHtml.replace(/class="[^"]*"/g, '')));

// 缺少「做法：」开头的小节：键值行不能被静默丢掉
const noLead = '频次/时机：每周一次\n话术/方法：先问好';
ok('缺做法行时被识别为结构化', looksStructured(splitLines(noLead)));
const nHtml = renderStructured(noLead);
eq('缺做法行时键值不丢失', (nHtml.match(/exp-step/g) || []).length, 2);

/* ═══ ③ renderPlain / escHtml ═══ */
console.log('③ renderPlain');
const pIn = '1. 第一条\n2. 第二条\n普通一行';
const pOut = renderPlain(pIn);
eq('逐行成 div', (pOut.match(/class="ln/g) || []).length, 3);
ok('编号行带 num 类', pOut.includes('ln num'));
ok('无编号行不带 num', pOut.includes('<div class="ln">普通一行</div>'));
ok('XSS 被转义', renderPlain('<img src=x onerror=alert(1)>').includes('&lt;img'));
ok('不再依赖 white-space:pre-wrap', !renderPlain('a\nb').includes('\\n'));

/* ═══ ④ 素材门槛：用四份真实报告校准 ═══ */
console.log('④ assessInterview（真实数据校准）');

// 四份已归档报告里，被访谈人真实发言的字数与条数
const CASES = [
  { name: '#8 王示例   ', rounds: 9,  chars: 56,  long: 0, want: false },
  { name: '#5 何示例  ', rounds: 11, chars: 358, long: 1, want: false },
  { name: '#6 吴示例 ', rounds: 12, chars: 736, long: 4, want: true  },
  { name: '#7 李示例   ', rounds: 13, chars: 855, long: 5, want: true  },
];
CASES.forEach(c => {
  const msgs = [];
  const base = Math.floor(c.chars / c.rounds);
  for (let i = 0; i < c.rounds; i++) {
    let len = base;
    if (i < c.long) len = Math.max(len, 70);
    msgs.push({ role: 'user', content: '字'.repeat(len) });
    msgs.push({ role: 'assistant', content: 'AI 的回复' });
  }
  const a = assessInterview(msgs);
  eq(c.name + ' 判定', a.ok, c.want);
});

// 内部消息不计入
const withInternal = [
  { role: 'system', content: 'x'.repeat(5000) },
  { role: 'user', content: '请开始这次访谈', internal: true },
  { role: 'user', content: '字'.repeat(420) },
  { role: 'user', content: '字'.repeat(80) },
  { role: 'user', content: '字'.repeat(80) },
  { role: 'user', content: '字'.repeat(80) },
  { role: 'user', content: '字'.repeat(80) },
  { role: 'user', content: '字'.repeat(80) },
  { role: 'user', content: '字'.repeat(80) },
  { role: 'user', content: '字'.repeat(80) },
];
const ai = assessInterview(withInternal);
eq('system 与 internal 不计入字数和轮次', ai.rounds, 8);
eq('累计字数只算被访谈人真实发言', ai.totalChars, 420 + 80 * 7);
ok('恰好达标时 ok=true', ai.ok, JSON.stringify(ai));

// 缺口描述要能指出差在哪
const thin = assessInterview([
  { role: 'user', content: '就那样吧' },
  { role: 'user', content: '还可以' },
]);
ok('轮次不足被指出', thin.gaps.some(g => g.includes('轮次')));
ok('字数不足被指出', thin.gaps.some(g => g.includes('字')));
ok('长回答不足被指出', thin.gaps.some(g => g.includes('细')));
eq('薄素材 ok=false', thin.ok, false);

/* ═══ ⑤ 报告问题提示 ═══ */
console.log('⑤ collectReportIssues');

// 王示例式：素材薄 + 末条未回答 + 膨胀
const zhouMsgs = [
  { role: 'assistant', content: '第一个问题？' },
  { role: 'user', content: '字'.repeat(56) },
  { role: 'assistant', content: '最后一个没被回答的问题？' },
];
const zi = collectReportIssues(zhouMsgs, '字'.repeat(788));
ok('素材薄被提示', zi.some(x => x.text.includes('素材偏薄') && x.level === 'warn'));
ok('末条未回答被提示', zi.some(x => x.text.includes('没有对应的回答') && x.level === 'info'));
ok('膨胀比过高被提示', zi.some(x => x.text.includes('倍')), JSON.stringify(zi.map(x => x.text)));

// 健康样例：不该有任何提示
const healthyMsgs = [];
for (let i = 0; i < 14; i++) {
  healthyMsgs.push({ role: 'assistant', content: '问题？' });
  healthyMsgs.push({ role: 'user', content: '字'.repeat(60) });
}
const hi = collectReportIssues(healthyMsgs, '字'.repeat(2000));
eq('健康访谈零提示', hi.length, 0);

// 轮次够但末条仍是 AI 提问 → 只应剩「未回答」一条
const truncMsgs = [];
for (let i = 0; i < 14; i++) {
  truncMsgs.push({ role: 'user', content: '字'.repeat(60) });
  truncMsgs.push({ role: 'assistant', content: '问题？' });
}
const ti = collectReportIssues(truncMsgs, '字'.repeat(200));
eq('仅剩「未回答」提示', ti.length, 1);
ok('且是 info 级', ti[0] && ti[0].level === 'info');
ok('提示文案不含 HTML', !/[<>]/.test(ti[0] ? ti[0].text : ''));

/* ═══ ⑥ renderReport 端到端 ═══ */
console.log('⑥ renderReport');

const rawReport = [
  '背景与挑战\n某客户是经营建材的小微企业主，需要一笔周转资金。',
  '核心做法\n1. 先翻上个月批款名单\n2. 逐个打电话问用款进度',
  '关键判断与取舍\n1. 客户嫌费率高时，先了解其他渠道的批款难度',
  '结果\n最终成交 30 万元。',
  '可复制的经验点\n' + good,
  '新人容易踩的坑\n1. 第一次打电话就推产品，容易一句"不用"被挂断。可以改成先问资金周转情况。',
  // 海报摘要节：新版模板必有的一节（供出图用，不在报告页展示正文）
  '海报摘要\n一句话钩子：翻上月批款名单，逐个问用款进度。\n关键数字：30 万元。',
].join('\n---SECTION---\n');

renderReport(rawReport);
const container = w.document.getElementById('report-content');
const secs = container.querySelectorAll('.report-section');
// 海报摘要为内部数据，不在报告页渲染，故可见节数 = SECTION_TITLES 去掉它
const VISIBLE_TITLES = SECTION_TITLES.filter(t => t !== '海报摘要');
eq('渲染出 ' + VISIBLE_TITLES.length + ' 节', secs.length, VISIBLE_TITLES.length);
eq('可见节标题正确',
   Array.from(secs).map(s => s.querySelector('h3').textContent).join('|'),
   VISIBLE_TITLES.join('|'));


// 每节正文里都不该再出现自己的标题（历史 bug）
let dupCount = 0;
secs.forEach((s, i) => {
  const body = s.querySelector('.content').textContent;
  if (body.trim().startsWith(VISIBLE_TITLES[i])) dupCount++;
});
eq('正文开头不再复述章节标题', dupCount, 0);

const expSec = secs[4];
ok('经验点渲染成卡片', expSec.querySelectorAll('.exp-item').length === 1);
ok('经验点带 key 标签', expSec.querySelectorAll('.exp-step .k').length === 4);
ok('做法句作为卡片标题', /exp-lead/.test(expSec.innerHTML));

const plainSec = secs[1];
eq('核心做法有两条编号行', plainSec.querySelectorAll('.ln.num').length, 2);

renderReport('背景与挑战\n只有一节');
const secs2 = container.querySelectorAll('.report-section');
eq('缺节时仍补齐 6 节', secs2.length, 6);
ok('缺节显示占位文案',
   secs2[2].textContent.includes('本节内容未获取到'));

renderReport('');
eq('空报告不抛错，节数仍为 6',
   container.querySelectorAll('.report-section').length, 6);

/* ═══ ⑦ 复制报告：结构化内容不丢 ═══ */
console.log('⑦ copyReport 文本');

renderReport(rawReport);
let copied = '';
Object.defineProperty(w.navigator, 'clipboard', {
  value: { writeText: (t) => { copied = t; return Promise.resolve(); } },
  configurable: true,
});
w.eval('copyReport()');
setTimeout(() => {
  ok('复制内容含访谈对象', copied.includes('访谈对象'));
  ok('复制内容含具体怎么做的方法', copied.includes('放款后第3天'));
  ok('复制内容含频次标签或值', copied.includes('频次'));
  ok('复制内容各节齐全',
     SECTION_TITLES.every(t => copied.includes(t)));
  ok('六节均未被压成一团', copied.split('\n').length > 20);
}, 0);

/* ═══ ⑧ 提示词内容断言（改动 J 落地） ═══ */
console.log('⑧ 提示词');

const sp = SYSTEM_PROMPT('张伟', '咨询顾问', '客户转介绍', '西安市', 'UM123');
ok('系统提示含「怎么做」专章', sp.includes('不只是"做了什么"'));
ok('系统提示含方法层五问', sp.includes('多久维护一次') && sp.includes('第一句话怎么说'));
ok('系统提示把维护当反例点出', sp.includes('这不是答案，这是标题'));
ok('系统提示要求新人避坑单独一轮', sp.includes('新人容易踩的坑'));
ok('系统提示要求收尾补问', sp.includes('还有没有什么是我没问到'));
ok('脱敏规则含小区楼盘名', sp.includes('楼盘名'));
ok('脱敏规则含金额泛化', sp.includes('月流水几十万'));
ok('主题命中时注入专属挖掘方向', sp.includes('让老客户愿意开口转介绍'));
ok('未命中主题时不注入',
   !SYSTEM_PROMPT('张伟', '咨询顾问', '随便聊聊', '西安市', 'UM1').includes('让老客户愿意开口转介绍'));

const rp = REPORT_PROMPT('张伟', '咨询顾问', '客户转介绍');
ok('报告提示含书写总则', rp.includes('照着做'));
ok('报告提示禁止只有动作名', rp.includes('一律不合格'));
ok('报告提示含反例', rp.includes('× 不合格'));
ok('报告提示含正例', rp.includes('√ 合格'));
ok('报告提示含四要素', rp.includes('频次/时机') && rp.includes('话术/方法')
                     && rp.includes('载体/工具') && rp.includes('对方没反应时怎么办'));
ok('报告提示要求引用原话', rp.includes('引号标出'));
ok('报告提示禁止编造', rp.includes('不要补充被访谈人没说的'));
ok('报告提示要求未展开时明说', rp.includes('访谈中未展开'));
ok('报告提示禁用态度类表述', rp.includes('要保持耐心'));
ok('报告提示含判定标准问句', rp.includes('明天就把动作做出来'));

eq('第六节标题已改名', SECTION_TITLES[5], '新人容易踩的坑');

/* ═══ ⑨ 归档口径 ═══ */
console.log('⑨ 归档口径');
eq('轮次口径排除 internal', countRounds([
  { role: 'system', content: 's' },
  { role: 'user', content: 'a', internal: true },
  { role: 'user', content: 'b' },
  { role: 'assistant', content: 'c' },
]), 1);

/* ═══ 汇总 ═══ */
console.log('\n' + '─'.repeat(56));
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
if (fail) {
  console.log('\n失败明细：');
  fails.forEach(f => console.log('  ✗ ' + f));
  process.exitCode = 1;
} else {
  console.log('全部通过 ✓');
}
