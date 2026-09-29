/* 渲染预览：把一份样例报告喂给 renderReport，把渲染结果导出成
   ① 文本树（rendered.txt）② 可直接在浏览器打开的静态页（preview.html）
   用来人工确认排版是否可读。 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.test/', pretendToBeVisual: true });
const w = dom.window;

const sample = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'sample-report.json'), 'utf8'));
const raw = sample.sections.join('\n---SECTION---\n');

w.eval('renderReport')(raw);

// 素材充足 → 不该有任何提示条
const msgs = [];
for (let i = 0; i < 14; i++) {
  msgs.push({ role: 'assistant', content: '问题？' });
  msgs.push({ role: 'user', content: '字'.repeat(70) });
}
const issues = w.eval('collectReportIssues')(msgs, raw);
w.eval('renderAlert')(issues);

/* ① 文本树，便于在终端里核对层级 */
const c = w.document.getElementById('report-content');
const out = [];
c.querySelectorAll('.report-section').forEach(sec => {
  out.push('━━ ' + sec.querySelector('h3').textContent + ' ' + '━'.repeat(30));
  const leads = sec.querySelectorAll('.exp-lead');
  if (leads.length) {
    sec.querySelectorAll('.exp-item').forEach(item => {
      const lead = item.querySelector('.exp-lead');
      out.push('  ▸ ' + (lead ? lead.textContent : '(无做法句)'));
      item.querySelectorAll('.exp-step').forEach(st => {
        const k = st.querySelector('.k'), v = st.querySelector('.v');
        out.push('      ' + (k ? '[' + k.textContent + '] ' : '') + (v ? v.textContent : ''));
      });
    });
  } else {
    sec.querySelectorAll('.content .ln').forEach(ln => out.push('    ' + ln.textContent));
  }
  out.push('');
});
const tree = out.join('\n');
fs.writeFileSync(path.join(__dirname, 'out', 'rendered.txt'), tree, 'utf8');

/* ② 独立静态页：把页内 <style> 与渲染结果拼起来，双击即可看真实效果 */
const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
const page = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">'
  + '<meta name="viewport" content="width=device-width,initial-scale=1.0">'
  + '<title>报告渲染预览</title><style>' + style
  + 'body{background:var(--bg);padding:24px;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;}'
  + '.report-body{max-width:780px;margin:0 auto;}</style></head>'
  + '<body><div class="report-body">'
  + '<h2 style="font-size:17px;font-weight:500;margin-bottom:16px;">案例经验报告 · 渲染预览</h2>'
  + w.document.getElementById('report-alerts').outerHTML
  + c.outerHTML
  + '</div></body></html>';
fs.writeFileSync(path.join(__dirname, 'out', 'preview.html'), page, 'utf8');

console.log(tree);
console.log('=== 提示条 ===');
console.log(w.document.getElementById('report-alerts').textContent || '（无）');
console.log('\n预览页已生成：tests/e2e/out/preview.html');
