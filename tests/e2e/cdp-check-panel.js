/* 用 CDP 连接 msedge，打开线上 index-check.html，自动点「语音自检」并读回面板每行文本。
   目的：在桌面环境跑 T0/A/B/T1-T5，与手机结果对比。 */
const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9451;
const PROFILE = path.join(__dirname, 'out', 'edge-cdp-check-- + Date.now());
const URL = process.argv[2] || 'https://work-d1gs0jzrg2277d75e-1391683363.tcloudbaseapp.com/index-check.html';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const args = [
    '--headless=old', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + PROFILE,
    '--window-size=430,900',
    'about:blank'
  ];
  const child = spawn(EDGE, args, { detached: false, stdio: 'ignore' });
  await sleep(2500);

  let browser;
  try {
    browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:' + PORT, defaultViewport: { width: 430, height: 900 } });
  } catch (e) {
    console.log('CONNECT_FAIL: ' + e.message);
    try { child.kill(); } catch (_) {}
    process.exit(1);
  }

  const page = await browser.newPage();
  const logs = [];
  page.on('console', m => logs.push('[console] ' + m.type() + ' ' + m.text()));
  page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
  page.on('requestfailed', r => logs.push('[reqfail] ' + r.url().slice(0, 90) + ' :: ' + (r.failure() && r.failure().errorText)));

  try {
    await page.goto(URL + '?t=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (e) {
    console.log('GOTO_FAIL: ' + e.message);
  }
  await sleep(2500);

  const info = await page.evaluate(() => ({
    title: document.title,
    origin: location.origin,
    href: location.href,
    hasRunBtn: !!document.querySelector('#run'),
    hasCheckBtn: !!document.querySelector('#vc-run'),
    bodyLen: document.body ? document.body.innerText.length : -1,
    bodyHead: document.body ? document.body.innerText.slice(0, 300) : ''
  }));
  console.log('=== PAGE INFO ===');
  console.log(JSON.stringify(info, null, 2));

  // 找自检按钮：可能是 #vc-run 或含「自检」文本
  const clicked = await page.evaluate(() => {
    const cands = Array.from(document.querySelectorAll('button,div,span,a'));
    const b = cands.find(el => /语音自检|自检|开始诊断|开始自检/.test(el.innerText || '') && el.offsetParent !== null);
    if (b) { b.click(); return b.innerText.slice(0, 40) || b.id || '(no-text)'; }
    const byId = document.querySelector('#vc-run') || document.querySelector('#run');
    if (byId) { byId.click(); return '#' + byId.id; }
    return null;
  });
  console.log('=== CLICKED: ' + clicked + ' ===');

  await sleep(15000); // 等 T0→A→B→T1→T2→T3(录音授权会失败)→T5

  const panel = await page.evaluate(() => {
    // 尝试多个可能的容器
    const ids = ['#vc-panel', '#panel', '#out', '#log', '#result'];
    for (const id of ids) {
      const el = document.querySelector(id);
      if (el && el.innerText.trim()) return { which: id, text: el.innerText };
    }
    // 兜底：找出包含 T0/T1 字样的最近容器
    const all = Array.from(document.querySelectorAll('div,pre,section'));
    const hit = all.filter(el => /T0 |T1 |A 写死URL/.test(el.innerText || ''))
      .sort((a, b) => (a.innerText.length - b.innerText.length))[0];
    return hit ? { which: 'fallback:' + (hit.id || hit.className || 'div'), text: hit.innerText } : null;
  });

  console.log('\n=== PANEL ===');
  console.log(panel ? panel.text : '(面板未找到)');

  console.log('\n=== LOGS ===');
  console.log(logs.slice(-40).join('\n') || '(无)');

  const shot = path.join(__dirname, 'out', 'cdp-check-panel.png');
  try { await page.screenshot({ path: shot, fullPage: true }); console.log('\nSHOT: ' + shot); } catch (e) { console.log('SHOT_FAIL ' + e.message); }

  await browser.disconnect();
  try { child.kill(); } catch (_) {}
  process.exit(0);
})();
