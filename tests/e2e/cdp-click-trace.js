const puppeteer = require('puppeteer-core');
const { spawn } = require('child_process');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9335;
const URL = process.argv[2];
const PROFILE = 'C:/Users/Furina/AppData/Local/Temp/edge-cdp-t-' + Date.now();
const child = spawn(EDGE, ['--headless=old','--disable-gpu','--no-first-run','--remote-debugging-port='+PORT,'--user-data-dir='+PROFILE,'--window-size=420,900','about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  for (let i = 0; i < 30; i++) { try { const r = await fetch('http://127.0.0.1:'+PORT+'/json/version'); if (r.ok) break; } catch(e){} await sleep(300); }
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:'+PORT, defaultViewport: { width: 420, height: 900 } });
  const page = await browser.newPage();
  const logs = [];
  page.on('console', m => logs.push('[console.' + m.type() + '] ' + m.text().slice(0, 200)));
  page.on('pageerror', e => logs.push('[pageerror] ' + e.message.slice(0, 200)));
  page.on('requestfailed', r => logs.push('[reqfailed] ' + r.url().slice(0, 100) + ' :: ' + (r.failure() ? r.failure().errorText : '?')));
  page.on('response', r => { if (/\/api\//.test(r.url())) logs.push('[api-resp] ' + r.status() + ' ' + r.url().slice(0, 100)); });
  page.on('framenavigated', f => logs.push('[nav] ' + f.url().slice(0, 110)));
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(1500);
  await page.evaluate(() => { const b = document.getElementById('submitBtn'); if (b) b.click(); });
  /* 轮询 30 秒，观察 title/url 变化 */
  for (let i = 0; i < 30; i++) {
    const st = await page.evaluate(() => ({ t: document.title, h: location.href.slice(0, 110), hasRes: !!document.getElementById('v') && document.getElementById('v').textContent }));
    if (i % 3 === 0 || /RESULT/.test(st.t)) console.log(i + 's title=' + st.t + ' | v=' + (st.hasRes || '-').slice(0, 70) + ' | ' + st.h.slice(0, 80));
    if (/RESULT/.test(st.t)) break;
    await sleep(1000);
  }
  console.log('--- 日志 ---');
  logs.slice(0, 40).forEach(l => console.log(l));
  await browser.disconnect();
  child.kill();
})().catch(e => { console.log('FATAL: ' + e.message); try { child.kill(); } catch(x){} process.exit(1); });
