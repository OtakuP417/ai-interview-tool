/* 用真实产出的报告 + 报告页真实渲染逻辑，生成可截图的预览页。
   关键：必须补齐函数区间的完整切片，否则 exp-item 结构化渲染会漏。 */
const fs=require('fs');
const jsdom=require('jsdom');
const html=fs.readFileSync('web/index.html','utf8');
const report=fs.readFileSync('tests/e2e/out/p01-report.md','utf8');

const styleM=html.match(/<style>([\s\S]*?)<\/style>/);
const style=styleM?styleM[1]:'';
const dom=new jsdom.JSDOM('<!doctype html><html><head><style>'+style+'</style></head><body>'
  +'<div id="report-content"></div><div id="report-meta"></div></body></html>',{runScripts:'outside-only'});
const w=dom.window;

// 从 SECTION_TITLES 常量一路切到 copyReport 之前：包含 normalize 系列、
// SUBHEAD_RE/METHOD_KEY_RE/STEP_RE、splitLines/looksStructured/renderStructured/
// renderPlain/stripSectionHeading/renderReport —— 一个都不能少。
const a=html.indexOf('const SECTION_TITLES = [');
const b=html.indexOf('function copyReport(');
let seg=html.slice(a,b);
// 补一个 escHtml（renderStructured 会用到），并屏蔽 onload 里的 APP_BUILD 报错
w.eval('function escHtml(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}\n' + seg);
const normalized=w.eval('normalizeReport')(report);
w.eval('renderReport')(normalized);

const secs=w.document.querySelectorAll('.report-section');
console.log('sections rendered:', secs.length);
console.log('exp-item cards:', w.document.querySelectorAll('.exp-item').length);
console.log('exp-step rows:', w.document.querySelectorAll('.exp-step').length);
console.log('k chips:', w.document.querySelectorAll('.exp-step .k').length);
const chips=[...w.document.querySelectorAll('.exp-step .k')].map(e=>e.textContent.trim());
console.log('chips:', JSON.stringify(chips));

const out='<!doctype html><html><head><meta charset="utf-8"><style>'+style
  +'\nbody{padding:18px;background:#eef0f3;}\n.rpt-wrap{max-width:940px;margin:0 auto;background:#fff;padding:22px;border-radius:10px;}\n</style></head><body>'
  +'<div class="rpt-wrap">'+w.document.getElementById('report-content').innerHTML+'</div></body></html>';
fs.writeFileSync('tests/e2e/out/p01-render.html', out, 'utf-8');
console.log('已写 tests/e2e/out/p01-render.html');
