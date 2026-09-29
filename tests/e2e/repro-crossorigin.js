/* 真实浏览器里复现跨域请求，抓浏览器原始报错
   用 puppeteer-core 起 headless Edge，加载线上页面，在页面上下文执行 fetch 到 /api/asr */
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');

const EDGE_PATHS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const CHROME_PATHS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
];
function findBrowser() {
  for (const p of EDGE_PATHS.concat(CHROME_PATHS)) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

(async function () {
  const exe = findBrowser();
  if (!exe) { console.log('NO_BROWSER'); return; }
  console.log('使用浏览器: ' + exe);

  const browser = await puppeteer.launch({
    executablePath: exe,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');

  const logs = [];
  page.on('console', m => logs.push('[console.' + m.type() + '] ' + m.text()));
  page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
  page.on('requestfailed', r => logs.push('[reqfailed] ' + r.url() + ' :: ' + (r.failure() ? r.failure().errorText : '?')));
  page.on('response', r => {
    const u = r.url();
    if (/\/api\//.test(u)) logs.push('[response] ' + r.status() + ' ' + u);
  });

  console.log('\n--- 加载线上页面 ---');
  try {
    await page.goto('https://interview-work-d1gs0jzrg2277d75e.webapps.tcloudbase.com/index.html?t=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (e) {
    console.log('goto 异常: ' + e.message);
  }
  console.log('页面标题: ' + (await page.title()));

  /* 模拟浏览器真实跨域 POST：1KB 假音频，只要拿到浏览器的原始错误即可 */
  console.log('\n--- 页面上下文内发起 /api/asr 跨域 POST ---');
  const result = await page.evaluate(async function () {
    const API_BASE = 'https://work-d1gs0jzrg2277d75e-1391683363.ap-shanghai.app.tcloudbase.com/api';
    const b64 = 'A'.repeat(153 * 1024);
    const t = Date.now();
    try {
      const r = await fetch(API_BASE + '/asr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio_base64: b64, format: 'wav', duration_ms: 4000, sample_rate: 16000 }),
      });
      const txt = await r.text();
      return { ok: true, status: r.status, ms: Date.now() - t, body: txt.slice(0, 200) };
    } catch (e) {
      return { ok: false, name: e.name, message: e.message, ms: Date.now() - t, cause: e.cause ? String(e.cause) : null };
    }
  });
  console.log(JSON.stringify(result, null, 2));

  /* 再试一次小体积，对比 */
  const result2 = await page.evaluate(async function () {
    const API_BASE = 'https://work-d1gs0jzrg2277d75e-1391683363.ap-shanghai.app.tcloudbase.com/api';
    const t = Date.now();
    try {
      const r = await fetch(API_BASE + '/asr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio_base64: 'AAAA', format: 'wav' }),
      });
      const txt = await r.text();
      return { ok: true, status: r.status, ms: Date.now() - t, body: txt.slice(0, 200) };
    } catch (e) {
      return { ok: false, name: e.name, message: e.message, ms: Date.now() - t, cause: e.cause ? String(e.cause) : null };
    }
  });
  console.log('小体积对比: ' + JSON.stringify(result2));

  console.log('\n--- 浏览器日志 ---');
  logs.forEach(l => console.log(l));

  await browser.close();
})().catch(e => { console.log('FATAL: ' + e.message); process.exit(1); });
