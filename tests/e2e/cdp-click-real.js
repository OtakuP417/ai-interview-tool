const puppeteer = require('puppeteer-core');
const { spawn } = require('child_process');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9336;
const URL = process.argv[2];
const PROFILE = 'C:/Users/Furina/AppData/Local/Temp/edge-cdp-r-' + Date.now();
const child = spawn(EDGE, ['--headless=old','--disable-gpu','--no-first-run','--remote-debugging-port='+PORT,'--user-data-dir='+PROFILE,'--window-size=420,900','about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  for (let i = 0; i < 30; i++) { try { const r = await fetch('http://127.0.0.1:'+PORT+'/json/version'); if (r.ok) break; } catch(e){} await sleep(300); }
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:'+PORT, defaultViewport: { width: 420, height: 900 } });
  const page = await browser.newPage();
  const logs = [];
  page.on('console', m => logs.push('[console] ' + m.text().slice(0, 180)));
  page.on('pageerror', e => logs.push('[pageerror] ' + e.message.slice(0, 180)));
  page.on('requestfailed', r => logs.push('[reqfailed] ' + r.url().slice(0, 100) + ' :: ' + (r.failure() ? r.failure().errorText : '?')));
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(1500);
  try {
    await page.click('#submitBtn', { delay: 60 });
    console.log('已真实点击 #submitBtn');
  } catch (e) { console.log('click 失败: ' + e.message); }
  await sleep(2000);
  /* 若还在提示页则强制 reload（cookie 应已写入） */
  const st1 = await page.evaluate(() => document.title);
  console.log('点击后 title: ' + st1);
  if (/风险提醒|页面访问/.test(st1)) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    console.log('已 reload');
    await sleep(1500);
  }
  let title = '';
  for (let i = 0; i < 40; i++) {
    title = await page.title();
    if (/RESULT/.test(title)) break;
    await sleep(500);
  }
  console.log('FINAL TITLE: ' + title);
  const text = await page.evaluate(() => document.body.innerText.slice(0, 900));
  console.log('--- 页面 ---'); console.log(text);
  console.log('--- 日志 ---'); logs.slice(0, 25).forEach(l => console.log(l));
  await browser.disconnect();
  child.kill();
})().catch(e => { console.log('FATAL: ' + e.message); try { child.kill(); } catch(x){} process.exit(1); });
