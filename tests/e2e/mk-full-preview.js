/* 生成完整报告长图的本地预览页（供无头 Edge 截图做视觉校验）。
   用真实归档报告，新旧两种格式各一份。 */
const fs = require('fs');
const path = require('path');
const poster = require(path.join(__dirname, '..', '..', 'cloudfunctions', 'interview-proxy', 'poster.js'));

const FX = path.join(__dirname, '..', 'fixtures');
const META = {
  name: '李示例', position: '咨询顾问', um: 'lishili001', city: '安康市',
  topic: '孤儿单盘活经验', owner: '赵示例', ownerOrg: '咸阳安康营业部',
  code: 'IV-2026-0007', date: '2026-09-24',
};

function wrap(markup, title) {
  // 窗口宽给 1100（无头 Edge 实际视口比 --window-size 大约 18px），
  // 页面本体仍是 1080，截图后再裁掉右侧多余部分。
  return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">'
    + '<title>' + title + '</title>'
    + '<style>html,body{margin:0;padding:0;background:#fff}</style>'
    + '</head><body>' + markup + '</body></html>';
}

const cases = [
  ['report-new.md', 'full-preview-new.html', '新格式报告（含海报摘要节）'],
  ['report-old.md', 'full-preview-old.html', '旧格式报告（末节为「新人注意事项」）'],
];

cases.forEach(function (c) {
  const raw = fs.readFileSync(path.join(FX, c[0]), 'utf8');
  const html = poster.renderFullMarkup(raw, META);
  fs.writeFileSync(path.join(__dirname, c[1]), wrap(html, c[2]));
  console.log('写出 ' + c[1] + '  markup=' + html.length + ' 字节');
});
