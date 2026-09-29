const puppeteer = require('puppeteer-core');
const { spawn } = require('child_process');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9334;
const URL = process.argv[2];
const PROFILE = 'C:/Users/Furina/AppData/Local/Temp/edge-cdp-i-' + Date.now();
const child = spawn(EDGE, ['--headless=old','--disable-gpu','--no-first-run','--remote-debugging-port='+PORT,'--user-data-dir='+PROFILE,'--window-size=420,900','about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  for (let i = 0; i < 30; i++) { try { const r = await fetch('http://127.0.0.1:'+PORT+'/json/version'); if (r.ok) break; } catch(e){} await sleep(300); }
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:'+PORT, defaultViewport: { width: 420, height: 900 } });
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(1500);
  const info = await page.evaluate(() => {
    const iframes = document.querySelectorAll('iframe').length;
    const hits = [];
    const walk = (el, path) => {
      for (const c of el.childNodes) {
        if (c.nodeType === 3 && c.textContent && c.textContent.includes('确定访问')) hits.push(path + ' > textNode');
        else if (c.nodeType === 1) walk(c, path + ' > ' + c.tagName + (c.id ? '#'+c.id : '') + (c.className && typeof c.className === 'string' ? '.'+c.className.split(' ').join('.') : ''));
      }
    };
    walk(document.body, 'body');
    return { iframes, hits, bodyLen: document.body.innerHTML.length };
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.disconnect();
  child.kill();
})().catch(e => { console.log('FATAL: ' + e.message); try { child.kill(); } catch(x){} process.exit(1); });
