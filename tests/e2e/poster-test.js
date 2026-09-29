/* 用真实归档报告生成横版图，供人工确认版式 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { renderPoster } = require('../../tools/poster.js');

const ROOT = path.resolve(__dirname, '../..');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const sample = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'sample-report.json'), 'utf8'));
const raw = sample.sections.join('\n---SECTION---\n');

const meta = {
  name: '李娟', position: '咨询顾问', city: '西安市', um: 'EXAMPLE002',
  topic: '房抵二押签约', date: '2026年9月24日',
  owner: '张示例', ownerOrg: '西安第二咨询中心',
};

const html = renderPoster(raw, meta);
const htmlPath = path.join(__dirname, 'out', 'poster.html');
fs.writeFileSync(htmlPath, html, 'utf8');
console.log('poster.html 已生成，', html.length, '字节');

const out = path.join(__dirname, 'shots', 'poster.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
try {
  execFileSync(EDGE, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--window-size=1610,905',
    '--screenshot=' + out,
    'file:///' + htmlPath.replace(/\\/g, '/'),
  ], { timeout: 60000, stdio: 'ignore' });
  console.log('截图完成:', out, fs.existsSync(out) ? fs.statSync(out).size + ' bytes' : 'MISSING');
} catch (e) {
  console.log('截图失败:', e.message);
}
