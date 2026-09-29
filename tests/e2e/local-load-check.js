/* 用 jsdom 加载本地页面，捕获启动期的 JS 错误 + 检查全局污染。
   ★ 注意 jsdom 的两个已知行为，别把它当成页面 bug：
     ① runScripts:'dangerously' 下顶层 const/let 不挂到 window（typeof 为 undefined）；
     ② jsdom 未实现 fetch（返回 undefined）。
   诊断页（index-check/diag/diag-auto）已下线，线上 404；本地仍可加载。 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const files = ['web/index.html', 'web/admin.html', 'web/index-check.html'];
for (const f of files) {
  const full = path.join(__dirname, '..', '..', f);
  if (!fs.existsSync(full)) { console.log('=== ' + f + ' => 不存在，跳过'); continue; }
  const html = fs.readFileSync(full, 'utf8');
  const errs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errs.push('[jsdomError] ' + (e.message || e)));
  vc.on('error', (...a) => errs.push('[console.error] ' + a.map(String).join(' ').slice(0, 200)));
  let dom;
  try {
    dom = new JSDOM(html, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      virtualConsole: vc,
      url: 'https://work-d1gs0jzrg2277d75e-1391683363.tcloudbaseapp.com/' + path.basename(f)
    });
  } catch (e) {
    console.log('=== ' + f + ' => CONSTRUCT_THROW ' + e.message);
    continue;
  }
  const w = dom.window;
  const src = html;
  const out = {
    file: f,
    // ★ 顶层 const 不挂 window，改用正则从源码里核对（这才是有效判据）
    hasAPI_ORIGIN: /const API_ORIGIN = /.test(src),
    hasApiUrlFn: /function apiUrl\(path\) \{/.test(src),
    apiUrlCallSites: (src.match(/apiUrl\('/g) || []).length,
    hasLegacyAPIBASE: /const API_BASE = /.test(src),
    hasPROXY: typeof w.PROXY_URL,
    errCount: errs.length
  };
  console.log('=== ' + f + ' ===');
  console.log(JSON.stringify(out, null, 2));
  if (errs.length) { console.log('  ERRORS:'); errs.slice(0, 12).forEach(x => console.log('   ' + x)); }
  dom.window.close();
}
