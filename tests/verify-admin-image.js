/**
 * 管理端「生成图片并下载」回归测试
 *
 * 需求：管理端查看案例时，可以根据想要分享的案例生成图片并下载，
 *       可选「简略一图流」和「完整报告」。
 *
 * 这里的关键是把交互真的跑一遍：
 *   · 点「生成图片」→ 面板展开、两个选项都在
 *   · 点「完整报告」→（stub 掉取版式与栅格化两个耗时环节）
 *                     预览图出现、下载链接带上文件名、按钮状态复原
 *   · 生成失败     → 给出错误提示；按钮不解锁就卡死是这类面板最常见的坑
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

const SRC = fs.readFileSync(path.join(__dirname, '..', 'web', 'admin.html'), 'utf8');

/* ───────── 1. 源码层 ───────── */
console.log('\n[1] 源码层');
{
  ok(/function toggleImgPanel\(/.test(SRC), 'toggleImgPanel 存在');
  ok(/async function genImage\(/.test(SRC), 'genImage 存在');
  ok(/function safeImageName\(/.test(SRC), 'safeImageName 存在（下载文件名合法性处理）');
  ok(/function measureMarkupHeight\(/.test(SRC), 'measureMarkupHeight 存在（长图高度实测）');
  ok(/async function rasterizeAuto\(/.test(SRC), 'rasterizeAuto 存在');
  ok(/MAX_FULL_PNG_H/.test(SRC), '长图高度有兜底上限');
  ok(/'flow'[\s\S]{0,80}简略一图流[\s\S]{0,200}'full'[\s\S]{0,80}完整报告/.test(SRC),
    '两个可选版式：简略一图流 + 完整报告');
  ok(/onclick="toggleImgPanel\(\)"/.test(SRC), '详情操作行有「生成图片」按钮');
  ok(/<div id="img-box" style="display:none">/.test(SRC), '详情里挂了图片面板容器');
  ok(/id="img-prev"/.test(SRC) && /id="img-dl"/.test(SRC), '面板含预览图与下载链接');
  ok(/dl\.setAttribute\('download'/.test(SRC), '下载链接带 download 属性与文件名');
  ok(/b\.disabled\s*=\s*!!busy/.test(SRC), '生成期间按钮禁用（防止重复点击）');
  ok(/长按预览图/.test(SRC), '面板提示了手机端长按保存的替代方案');
}

/* ───────── 2. 真实交互 ───────── */
async function interaction() {
  console.log('\n[2] jsdom 真实点击');
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
  const doc = w.document;

  const row = {
    id: 7, created_at: '2026-09-24T09:10:00+08:00', status: '已采纳',
    city: '安康市', interviewee_name: '李示例', interviewee_position: '咨询顾问',
    interviewee_um: 'lishili001', topic: '孤儿单盘活经验',
    backend_owner_name: '刘龙刚', backend_owner_org: '咸阳安康营业部',
    round_count: 11, mail_sent_at: null,
    report_md: '背景与挑战\n客户此前进件未获额度。\n---SECTION---\n核心做法\n1. 先看记录。',
    transcript: [{ role: 'assistant', content: '你好' }],
  };

  w.eval('auth = { token: "x", exp: ' + (Date.now() + 3600000) + ' };');
  w.eval('Element.prototype.scrollIntoView = function () {};');
  w.eval('detailRow = ' + JSON.stringify(row) + '; currentId = ' + row.id + ';');
  w.eval('renderDetail(detailRow);');

  const imgBtn = Array.from(doc.querySelectorAll('#d-body button'))
    .find(b => b.textContent.trim() === '生成图片');
  ok(!!imgBtn, '「生成图片」按钮渲染出来了');

  imgBtn.click();
  const box = doc.getElementById('img-box');
  ok(box.style.display === 'block', '点击后面板展开');
  ok(!!doc.getElementById('img-btn-flow'), '「简略一图流」选项在');
  ok(!!doc.getElementById('img-btn-full'), '「完整报告」选项在');
  ok((doc.getElementById('img-btn-full').textContent || '').includes('完整报告'), '完整报告选项文案正确');

  /* stub 掉两个耗时环节：取版式（走网络）与栅格化（走 canvas，jsdom 没有） */
  const FAKE_PNG = 'data:image/png;base64,AAAA';
  w.eval('fetchPosterHtml = async function (id, kind) { window.__asked = kind; return { kind: kind, html: "<div>x</div>", css: "", w: 1080, h: null }; };');
  w.eval('rasterizeAuto = async function () { return "' + FAKE_PNG + '"; };');

  errors.length = 0;
  await w.eval('genImage("full")');

  ok(errors.length === 0, '生成过程未抛异常', errors.join(' | '));
  ok(w.__asked === 'full', '按所选版式去取版式数据', String(w.__asked));
  ok(doc.getElementById('img-result').style.display === 'block', '生成后显示结果区');
  ok(doc.getElementById('img-prev').getAttribute('src') === FAKE_PNG, '预览图 src 指向生成的 PNG');
  ok(doc.getElementById('img-dl').getAttribute('download') === '完整报告-李示例-20260924.png',
    '下载文件名正确', doc.getElementById('img-dl').getAttribute('download'));
  ok(doc.getElementById('img-dl').getAttribute('href') === FAKE_PNG, '下载链接指向 PNG 数据');
  ok((doc.getElementById('img-msg').textContent || '') === '已生成', '给出成功提示',
    doc.getElementById('img-msg').textContent);
  ok((doc.getElementById('img-size').textContent || '').includes('完整报告'), '结果区标注了版式类型');
  ok(!doc.getElementById('img-btn-full').disabled, '生成完成后按钮恢复可点');

  /* 再生成另一种版式，确认状态切换正常 */
  await w.eval('genImage("flow")');
  ok(w.__asked === 'flow', '可以再生成另一种版式');
  ok(doc.getElementById('img-dl').getAttribute('download') === '经验一图流-李示例-20260924.png',
    '文件名随版式变化', doc.getElementById('img-dl').getAttribute('download'));

  /* 收起再展开：面板重建，不留上一次的旧结果 */
  imgBtn.click();
  ok(box.style.display === 'none', '再点一次可收起面板');
  imgBtn.click();
  ok(doc.getElementById('img-result').style.display === 'none', '重新展开时不残留上一次的结果');

  /* ───────── 3. 失败路径 ───────── */
  console.log('\n[3] 失败路径');
  errors.length = 0;
  w.eval('fetchPosterHtml = async function () { throw new Error("empty_report"); };');
  await w.eval('genImage("full")');
  ok(errors.length === 0, '失败也不抛未捕获异常', errors.join(' | '));
  ok((doc.getElementById('img-msg').textContent || '').includes('生成失败'), '给出失败提示',
    doc.getElementById('img-msg').textContent);
  ok(doc.getElementById('img-result').style.display === 'none', '失败时不显示旧结果');
  ok(!doc.getElementById('img-btn-full').disabled, '失败后按钮恢复可点（不会卡死）');

  /* ───────── 4. 文件名合法性 ───────── */
  console.log('\n[4] 文件名合法性');
  const evil = JSON.parse(JSON.stringify(row));
  evil.interviewee_name = '张三/李四:四*?<>|" ';
  evil.created_at = null;
  w.eval('detailRow = ' + JSON.stringify(evil) + ';');
  const name = w.eval('safeImageName("full")');
  ok(!/[\\/:*?"<>|\s]/.test(name), '非法字符全部被清掉', name);
  ok(name === '完整报告-张三李四四.png', '无日期时也能组成合法文件名', name);
}

interaction().then(function () {
  console.log('\n' + '─'.repeat(52));
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  process.exit(fail ? 1 : 0);
}).catch(function (e) {
  console.error('测试执行异常：', e);
  process.exit(1);
});
