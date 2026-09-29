/* 用 puppeteer 连接手动的 headless Edge（CDP connect 模式，绕开 launch 失败问题）
   自动点掉 CloudBase 提示页，然后跑 diag-auto 的三项测试，报告结果 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9333;
const URL = process.argv[2] || 'https://interview-work-d1gs0jzrg2277d75e.webapps.tcloudbase.com/diag-auto.html';
const PROFILE = process.argv[3] || ('C:/Users/Furina/AppData/Local/Temp/edge-cdp-' + Date.now());

const { spawn } = require('child_process');
const child = spawn(EDGE, [
  '--headless=old',
  '--disable-gpu',
  '--no-first-run',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE,
  '--window-size=420,900',
  'about:blank',
], { stdio: 'ignore' });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async function () {
  /* 等 CDP 端口起来 */
  let ok = false;
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/version');
      if (r.ok) { ok = true; break; }
    } catch (e) {}
    await sleep(300);
  }
  if (!ok) { console.log('CDP-FAIL'); child.kill(); return; }

  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:' + PORT,
    defaultViewport: { width: 420, height: 900 },
  });
  const page = await browser.newPage();
  const logs = [];
  page.on('console', m => logs.push('[console] ' + m.text()));
  page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
  page.on('requestfailed', r => logs.push('[reqfailed] ' + r.url().slice(0, 90) + ' :: ' + (r.failure() ? r.failure().errorText : '?')));

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(1500);

  /* 点掉 CloudBase 体验版提示页（按钮是 BUTTON#submitBtn） */
  const clicked = await page.evaluate(function () {
    const b = document.getElementById('submitBtn');
    if (b) { b.click(); return 'submitBtn'; }
    return null;
  });
  console.log('提示页按钮: ' + (clicked ? '已点击「' + clicked + '」' : '未找到（可能无需确认）'));
  await sleep(2500);

  /* 等自动测试完成（diag-auto 会写 title） */
  let title = '';
  for (let i = 0; i < 40; i++) {
    title = await page.title();
    if (/RESULT:/.test(title)) break;
    await sleep(500);
  }
  console.log('TITLE: ' + title);

  /* 顺便抓页面可见文本 */
  const text = await page.evaluate(function () { return document.body.innerText.slice(0, 1200); });
  console.log('--- 页面内容 ---');
  console.log(text);

  console.log('--- 浏览器日志 ---');
  logs.slice(0, 30).forEach(l => console.log(l));

  await browser.disconnect();
  child.kill();
})().catch(function (e) { console.log('FATAL: ' + e.message); try { child.kill(); } catch (x) {} process.exit(1); });
