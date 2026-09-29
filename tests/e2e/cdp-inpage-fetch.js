/* 在提示页环境里直接执行 fetch 测试（与正式页同源同环境）
   加测：1KB/153KB/288KB 三档 fetch + XHR 对照 + 完整错误堆栈 */
const puppeteer = require('puppeteer-core');
const { spawn } = require('child_process');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9337;
const URL = process.argv[2];
const PROFILE = 'C:/Users/Furina/AppData/Local/Temp/edge-cdp-e-' + Date.now();
const child = spawn(EDGE, ['--headless=old','--disable-gpu','--no-first-run','--remote-debugging-port='+PORT,'--user-data-dir='+PROFILE,'--window-size=420,900','about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

function b64(n) { const C = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let s = ''; for (let i = 0; i < n; i++) s += C[i & 63]; return s; }

(async () => {
  for (let i = 0; i < 30; i++) { try { const r = await fetch('http://127.0.0.1:'+PORT+'/json/version'); if (r.ok) break; } catch(e){} await sleep(300); }
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:'+PORT, defaultViewport: { width: 420, height: 900 } });
  const page = await browser.newPage();
  const logs = [];
  page.on('console', m => logs.push('[console] ' + m.text().slice(0, 250)));
  page.on('requestfailed', r => logs.push('[reqfailed] ' + r.url().slice(0, 100) + ' :: ' + (r.failure() ? r.failure().errorText : '?')));
  page.on('response', r => { if (/\/api\//.test(r.url())) logs.push('[api-resp] ' + r.status() + ' ' + r.url().slice(0, 90)); });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(1000);
  console.log('页面 title: ' + (await page.title()) + '（提示页无妨，JS 环境同源等价）');

  const result = await page.evaluate(async function () {
    const API = 'https://work-d1gs0jzrg2277d75e-1391683363.ap-shanghai.app.tcloudbase.com/api';
    function b64(n) { const C = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let s = ''; for (let i = 0; i < n; i++) s += C[i & 63]; return s; }
    const out = [];
    async function tf(label, bodyStr) {
      const t = Date.now();
      try {
        const r = await fetch(API + '/asr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: bodyStr });
        const tx = await r.text();
        out.push(label + ' -> HTTP ' + r.status + ' ' + (Date.now() - t) + 'ms ' + tx.slice(0, 60));
        return true;
      } catch (e) {
        out.push(label + ' -> FAIL ' + e.name + ' ' + (Date.now() - t) + 'ms msg=' + e.message + ' stack1=' + String(e.stack || '').split('\n')[1]);
        return false;
      }
    }
    const r1 = await tf('[fetch 1KB  ]', JSON.stringify({ audio_base64: b64(1024), format: 'wav' }));
    const r2 = await tf('[fetch 153KB]', JSON.stringify({ audio_base64: b64(153 * 1024), format: 'wav' }));
    const r3 = await tf('[fetch 288KB]', JSON.stringify({ audio_base64: b64(288 * 1024), format: 'wav' }));
    /* XHR 对照 */
    const xhr = await new Promise(function (resolve) {
      const t = Date.now();
      try {
        const x = new XMLHttpRequest();
        x.open('POST', API + '/asr', true);
        x.setRequestHeader('Content-Type', 'application/json');
        x.onload = function () { resolve('[xhr   153KB] -> HTTP ' + x.status + ' ' + (Date.now() - t) + 'ms ' + String(x.responseText).slice(0, 60)); };
        x.onerror = function () { resolve('[xhr   153KB] -> XHR ERROR ' + (Date.now() - t) + 'ms'); };
        x.send(JSON.stringify({ audio_base64: b64(153 * 1024), format: 'wav' }));
      } catch (e) { resolve('[xhr   153KB] -> XHR THROW ' + e.name + ' ' + e.message); }
    });
    out.push(xhr);
    /* 正式页同款：带 AbortController signal */
    const sig = await new Promise(function (resolve) {
      const t = Date.now();
      const ctl = new AbortController();
      const timer = setTimeout(function () { ctl.abort(); }, 45000);
      fetch(API + '/asr', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio_base64: b64(288 * 1024), format: 'wav', duration_ms: 7000, sample_rate: 16000 }),
        signal: ctl.signal,
      }).then(function (r) { clearTimeout(timer); return r.text().then(function (tx) { resolve('[fetch 288KB+signal 正式页同款] -> HTTP ' + r.status + ' ' + (Date.now() - t) + 'ms ' + tx.slice(0, 60)); }); })
        .catch(function (e) { clearTimeout(timer); resolve('[fetch 288KB+signal 正式页同款] -> FAIL ' + e.name + ' ' + (Date.now() - t) + 'ms ' + e.message); });
    });
    out.push(sig);
    return { r1: r1, r2: r2, r3: r3, lines: out };
  });

  console.log('--- 结果 ---');
  result.lines.forEach(l => console.log(l));
  console.log('--- 网络日志 ---');
  logs.slice(0, 20).forEach(l => console.log(l));
  await browser.disconnect();
  child.kill();
})().catch(e => { console.log('FATAL: ' + e.message); try { child.kill(); } catch(x){} process.exit(1); });
