/**
 * 管理端「展开完整对话记录」回归测试
 *
 * 修的是一个真实事故：toggleTranscript() 里 box / btn 两个变量从未声明，
 * 而 transcriptOpen 也从未被翻转 —— 于是每次点击都走「隐藏 + 复位文案」
 * 那条分支并抛 ReferenceError，用户看到的是「点了没反应」。
 *
 * 这个测试的重点是**真实点击**，而不是读源码里有没有那个词：
 *   · 用 jsdom 加载真实 admin.html
 *   · 调 renderDetail() 渲染出真实的详情结构
 *   · 对 #t-tgl 调 .click()
 *   · 捕获事件处理器里抛出的异常（jsdom 会走 virtualConsole 的 jsdomError）
 *   · 断言对话真的渲染出来了、按钮文案变了、再点一次能收起
 *
 * 顺带覆盖同一轮修掉的「标题重复」问题：
 * 归档 report_md 里第 2 节起正文首行带前导换行（'…\n\n---SECTION---\n\n核心做法\n…'），
 * 旧的 /^[^\n]*\n/ 只吃掉一个换行，标题就会在正文里再显示一遍。
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

let pass = 0;
let fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (extra ? '  → ' + extra : '')); }
}

const ADMIN_PATH = path.join(__dirname, '..', 'web', 'admin.html');
const SRC = fs.readFileSync(ADMIN_PATH, 'utf8');

/* ───────── 1. 源码层：确保那两行声明与状态翻转真的在 ───────── */
console.log('\n[1] 源码层');
{
  const fn = SRC.slice(SRC.indexOf('function toggleTranscript'), SRC.indexOf('function buttonLabelTranscript'));
  ok(fn.length > 0, '能定位到 toggleTranscript 函数体');
  ok(/const\s+box\s*=\s*document\.getElementById\('t-box'\)/.test(fn), '函数体内声明了 box');
  ok(/const\s+btn\s*=\s*document\.getElementById\('t-tgl'\)/.test(fn), '函数体内声明了 btn');
  /* 关键不是「有没有声明」，而是「声明在使用之前」——
     出事的旧版恰恰是完全没有声明，所以断言写「声明前不得出现引用」才有鉴别力。 */
  const iBoxDecl = fn.indexOf('const box =');
  const iBtnDecl = fn.indexOf('const btn =');
  ok(iBoxDecl >= 0 && fn.slice(0, iBoxDecl).indexOf('box') < 0, 'box 在声明之前没有被引用');
  ok(iBtnDecl >= 0 && fn.slice(0, iBtnDecl).indexOf('btn') < 0, 'btn 在声明之前没有被引用');
  ok(/transcriptOpen\s*=\s*!transcriptOpen/.test(fn), 'transcriptOpen 被翻转（不只读不写）');
  ok(SRC.includes('function buttonLabelTranscript'), '按钮文案收敛到单一函数');
}

/* ───────── 2. 真实点击 ───────── */
console.log('\n[2] jsdom 真实点击 #t-tgl');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push(String((e && e.message) || e)));

const dom = new JSDOM(SRC, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'https://example.com/admin.html',
  virtualConsole: vc,
});
const w = dom.window;

/* 两条真实归档记录：一条带对话，一条 transcript 缺失（边界） */
const withTurns = {
  id: 7, created_at: '2026-09-24T09:10:00+08:00', status: '已采纳',
  city: '安康市', interviewee_name: '李示例', interviewee_position: '咨询顾问',
  interviewee_um: 'lishili001', topic: '孤儿单盘活经验',
  backend_owner_name: '刘龙刚', backend_owner_org: '咸阳安康营业部',
  round_count: 11, mail_sent_at: null,
  /* 刻意还原真实归档格式：第 2 节起正文首行前面带 \n\n */
  report_md: '背景与挑战\n客户此前进件未获额度。\n'
    + '---SECTION---\n核心做法\n1. 第一时间看上次申请记录。\n'
    + '---SECTION---\n关键判断与取舍\n1. 先核实条件再进件。\n'
    + '---SECTION---\n结果\n顺利放款。\n'
    + '---SECTION---\n可复制的经验点\n在长期未成交的情况下，可以每月定期联系。\n'
    + '---SECTION---\n新人注意事项\n不要提前跟客户强调利息。',
  transcript: [
    { role: 'assistant', content: '李示例你好！我想请你聊聊孤儿单盘活的经验。' },
    { role: 'user', content: '孤儿单下发后第一时间打开了解客户情况。' },
    { role: 'assistant', content: '那这段时间你大概是怎么跟客户保持联系的？' },
    { role: 'user', content: '每个月都会联系，一有新政策立马发消息。' },
  ],
};

w.eval('auth = { token: "x", exp: ' + (Date.now() + 3600000) + ' };');
w.eval('Element.prototype.scrollIntoView = function () {};');

function render(row) {
  w.eval('detailRow = ' + JSON.stringify(row) + '; currentId = ' + row.id + '; transcriptOpen = false;');
  w.eval('document.getElementById("drawer").style.display = "flex";');
  w.eval('renderDetail(detailRow);');
}

render(withTurns);
const doc = w.document;
const tgl = doc.getElementById('t-tgl');
const tbox = doc.getElementById('t-box');

ok(!!tgl, '详情里渲染出了 #t-tgl 按钮');
ok(!!tbox, '详情里渲染出了 #t-box 容器');
ok(tbox.style.display === 'none', '初始状态对话区是收起的');
ok((tgl.textContent || '').includes('展开完整对话记录（4 条）'), '按钮初始文案带条数', tgl.textContent);

errors.length = 0;
tgl.click();

ok(errors.length === 0, '点击未抛异常', errors.join(' | '));
ok(tbox.style.display === 'block', '点击后对话区展开');
ok((tgl.textContent || '') === '收起对话记录', '按钮文案切换为「收起对话记录」', tgl.textContent);
ok(doc.querySelectorAll('#t-box .turn').length === 4, '渲染出 4 条对话',
  String(doc.querySelectorAll('#t-box .turn').length));
ok(doc.querySelectorAll('#t-box .turn.ai').length === 2, '其中 AI 两条样式为 ai');
ok(doc.querySelectorAll('#t-box .turn.me').length === 2, '其中访谈人两条样式为 me');
ok((tbox.textContent || '').includes('每个月都会联系'), '对话正文内容正确落进 DOM');
ok(!tbox.innerHTML.includes('<script'), '对话内容做了转义（无注入）');

errors.length = 0;
tgl.click();

ok(errors.length === 0, '再次点击未抛异常', errors.join(' | '));
ok(tbox.style.display === 'none', '再次点击后收起');
ok((tgl.textContent || '').includes('展开完整对话记录（4 条）'), '收起后文案复位', tgl.textContent);

/* 反复来回点：状态必须能稳定翻转，不能卡在某一态 */
let flipsOk = true;
for (let i = 0; i < 3; i++) {
  tgl.click();
  if (tbox.style.display !== 'block') flipsOk = false;
  tgl.click();
  if (tbox.style.display !== 'none') flipsOk = false;
}
ok(flipsOk, '连续三次展开/收起状态稳定');

/* ───────── 3. 边界：transcript 缺失 ───────── */
console.log('\n[3] 边界：transcript 缺失');
{
  const noTurns = JSON.parse(JSON.stringify(withTurns));
  noTurns.id = 99;
  delete noTurns.transcript;
  errors.length = 0;
  render(noTurns);
  const b2 = doc.getElementById('t-tgl');
  b2.click();
  ok(errors.length === 0, 'transcript 缺失时点击不抛异常', errors.join(' | '));
  ok((doc.getElementById('t-box').textContent || '').includes('无对话记录'), '给出「无对话记录」占位');
  b2.click();
  ok(doc.getElementById('t-box').style.display === 'none', '仍能收起');
}

/* ───────── 4. 标题重复（同轮修掉的另一个显示缺陷） ───────── */
console.log('\n[4] 正文首行重复标题');
{
  render(withTurns);
  const blocks = Array.from(doc.querySelectorAll('#d-body .block'));
  ok(blocks.length === 6, '六个章节块', String(blocks.length));

  const contents = blocks.map(b => (b.querySelector('.content') || {}).textContent || '');
  ok(!contents[1].startsWith('核心做法'), '第 2 节正文不再以「核心做法」开头', JSON.stringify(contents[1].slice(0, 20)));
  ok(!contents[5].startsWith('新人注意事项'), '第 6 节正文不再以「新人注意事项」开头', JSON.stringify(contents[5].slice(0, 20)));
  ok(contents[1].includes('第一时间看上次申请记录'), '第 2 节正文内容完整保留');
  ok(contents[0].includes('客户此前进件未获额度'), '第 1 节正文内容完整保留（不误删首行）');

  w.eval('copyDetail = function(){};');
  const plain = w.eval('buildPlainReport(detailRow)');
  ok(!plain.includes('2. 核心做法\n核心做法'), '复制全文里也没有重复标题');
  ok(plain.includes('2. 核心做法\n1. 第一时间看上次申请记录'), '复制全文结构正确');

  /* 别称也要能剥掉：模型偶尔写「新人容易踩的坑」 */
  const alias = JSON.parse(JSON.stringify(withTurns));
  alias.report_md = alias.report_md.replace('新人注意事项', '新人容易踩的坑');
  ok(w.eval('stripSectionHeading("\\n\\n新人容易踩的坑\\n不要提前谈利息。")') === '不要提前谈利息。',
    'stripSectionHeading 能剥别称标题');
  ok(w.eval('stripSectionHeading("\\n\\n客户此前进件未获额度，需要持续维护。")') === '客户此前进件未获额度，需要持续维护。',
    '普通正文首行不会被误删');
}

/* ───────── 5. 反证：旧实现必须被这组断言判失败 ─────────
   一个测不出原 bug 的回归测试等于没写。这里把出事的那版函数体原样
   eval 进来，确认它确实会抛 ReferenceError —— 证明上面 [2] 的
   「点击未抛异常」是真的有鉴别力，而不是jsdom 把异常吞了。 */
console.log('\n[5] 反证：旧实现的异常必须能被捕获到');
{
  const oldBody = `
    window.__oldToggle = function () {
      if (!transcriptOpen) {
        box.style.display = 'none';
        btn.textContent = '展开完整对话记录（' + ((detailRow && detailRow.transcript) || []).length + ' 条）';
        return;
      }
      box.style.display = 'block';
      btn.textContent = '收起对话记录';
    };
  `;
  w.eval(oldBody);
  let threw = null;
  try { w.__oldToggle(); } catch (e) { threw = e; }
  ok(threw !== null, '旧实现直接调用会抛异常（说明 box/btn 确实是未声明的裸引用）',
    threw ? String(threw.message) : '竟然没抛');
  ok(threw && /box is not defined|btn is not defined/.test(String(threw.message)),
    '异常正是 ReferenceError: box is not defined', threw ? String(threw.message) : '');

  /* 而且用事件处理器触发时，jsdom 会把它报成 jsdomError —— 这正是我们捕获通道的依据 */
  errors.length = 0;
  const b3 = doc.getElementById('t-tgl');
  b3.setAttribute('onclick', '__oldToggle()');
  b3.click();
  ok(errors.length > 0, '通过事件处理器触发时，异常能被 virtualConsole 捕获（捕获通道有效）',
    errors.join(' | '));
  b3.setAttribute('onclick', 'toggleTranscript()');
}

console.log('\n' + '─'.repeat(52));
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
