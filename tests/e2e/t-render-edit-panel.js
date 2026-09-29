/* 用真实 admin.html + 真实 #9 数据，在 jsdom 里渲染出「编辑基础信息」面板的静态 HTML，
   供无头截图做视觉确认。不依赖浏览器，不连网。 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '../../web/admin.html'), 'utf8');

const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/admin.html' });
const w = dom.window;

// 注掉需要网络的部分：给出假 token / 假 api
w.eval(`
  auth = { token: 'x', exp: Date.now() + 3600000 };
  currentRows = [];
  // jsdom 未实现 scrollIntoView
  Element.prototype.scrollIntoView = function () {};
`);

// 真实 #9 数据（含待修正的 UM 形态字段）
const row9 = {
  id: 9, created_at: '2026-09-24T09:10:00+08:00', status: '已采纳',
  city: '西安市', interviewee_name: 'ZHANGSHILI001', interviewee_position: '咨询顾问',
  interviewee_um: 'EXAMPLE007', topic: '老客户转介绍', submitter_name: '彭静',
  backend_owner_name: 'example007', backend_owner_org: '西安第一咨询中心',
  round_count: 5, mail_sent_at: null,
  report_md: '背景与挑战---SECTION---客户为老客户转介绍。\n核心做法---SECTION---1. 建档',
  transcript: [{ role: 'assistant', content: '你好' }, { role: 'user', content: '好的' }],
};

w.eval('detailRow = ' + JSON.stringify(row9) + ';');
w.eval(`
  document.getElementById('drawer').style.display = 'flex';
  document.getElementById('drawer-mask').style.display = 'block';
  currentId = 9;
  renderDetail(detailRow);
  openEdit();
`);

// 把面板里第一个输入框聚焦态模拟出来（截图更接近真实）
const out = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>编辑面板预览</title>'
  + '<style>' + html.split('<style>')[1].split('</style>')[0] + '</style>'
  + '<style>body{padding:0;min-height:auto} #drawer{position:static;width:100%;box-shadow:none;display:flex}</style>'
  + '</head><body>' + w.document.getElementById('drawer').outerHTML + '</body></html>';

fs.writeFileSync(path.join(__dirname, 'out', 'edit-panel-preview.html'), out);

// 顺手做几条断言
const box = w.document.getElementById('edit-box');
const inputs = w.document.querySelectorAll('.edit-input');
console.log('编辑面板存在: ' + (box && box.style.display === 'block' ? '✓' : '✗'));
console.log('输入框数量: ' + inputs.length + '（期望 7）');
console.log('按钮「编辑基础信息」存在: ' + (w.document.body.innerHTML.includes('编辑基础信息') ? '✓' : '✗'));
console.log('UM 形态提醒出现（被访谈人位）: ' + (w.document.body.innerHTML.match(/疑似工号/g) || []).length + ' 处（期望 2：姓名 + 后线对接）');
console.log('已写 tests/e2e/out/edit-panel-preview.html');
