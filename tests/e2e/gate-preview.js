/* 门槛面板预览：模拟「3 轮就点生成报告」的真实状态，导出静态页供截图。 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.test/', pretendToBeVisual: true });
const w = dom.window;

// 3 轮、每轮 ~30 字 —— 王示例式的薄素材
w.eval('state.messages.push(' +
  '{role:"user",content:"最近也没啥特别的，就是正常维护客户"},' +
  '{role:"assistant",content:"那具体是怎么维护的呢？"},' +
  '{role:"user",content:"就是微信上问候一下，逢年过节发个祝福"},' +
  '{role:"assistant",content:"发完之后客户一般什么反应？"},' +
  '{role:"user",content:"有的回有的不回吧，也没太注意"}' +
')');
w.eval('endAndReport')();

const gate = w.document.getElementById('report-content').innerHTML;
const meta = w.document.getElementById('report-meta').innerHTML;

const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
const page = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">'
  + '<meta name="viewport" content="width=device-width,initial-scale=1.0">'
  + '<title>门槛面板预览</title><style>' + style
  + 'body{background:var(--bg);padding:24px;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;}'
  + '.report-body{max-width:780px;margin:0 auto;}</style></head>'
  + '<body><div class="report-body">'
  + '<h2 style="font-size:17px;font-weight:500;margin-bottom:16px;">生成报告前的门槛面板 · 预览</h2>'
  + '<div class="report-meta">' + meta + '</div>'
  + gate
  + '</div></body></html>';
fs.writeFileSync(path.join(__dirname, 'out', 'gate.html'), page, 'utf8');
console.log('gate.html 已生成');
console.log('面板文字：', w.document.getElementById('report-content').textContent.replace(/\s+/g, ' ').slice(0, 200));
