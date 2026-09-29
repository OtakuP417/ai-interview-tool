/* 端到端验证（第 1 步）：只读地从线上取一份真实报告，
   分别按 kind=flow / kind=full 拉两套 markup，落成独立 HTML 供无头截图。
   全程只读 DB，不写入、不发信。 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const BASE = 'https://work-d1gs0jzrg2277d75e-1391683363.ap-shanghai.app.tcloudbase.com/api';
const PASSWORD = require("fs").readFileSync(require("path").join(__dirname, "..", "..", "tools", "fetch_reports.secret"), "utf8").trim();
const OUT = path.join(__dirname, 'out', 'e2e2');
const WITH_SUMMARY = process.argv.indexOf('--any') < 0; // 默认只挑有「海报摘要」的记录

function post(url, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 60000,
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', c => raw += c);
      res.on('end', () => {
        let data = null;
        try { data = JSON.parse(raw); } catch (e) { data = { raw: raw.slice(0, 300) }; }
        resolve({ status: res.statusCode, data });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.write(body);
    req.end();
  });
}

function standalone(markup, css) {
  return '<!DOCTYPE html>\n<html lang="zh-CN"><head><meta charset="UTF-8">'
    + '<style>html,body { margin:0; padding:0; background:#fff; }</style>'
    + String(css || '') + '</head>\n<body>\n' + markup + '\n</body></html>';
}

function metaOf(row) {
  const y = row.created_at ? String(row.created_at).slice(0, 4) : String(new Date().getFullYear());
  return {
    name: row.interviewee_name || '—',
    position: row.interviewee_position || '',
    um: row.interviewee_um || '',
    city: row.city || '',
    topic: row.topic || '',
    owner: row.backend_owner_name || '',
    ownerOrg: row.backend_owner_org || '',
    code: 'IV-' + y + '-' + String(row.id).padStart(4, '0'),
    date: row.created_at ? String(row.created_at).slice(0, 10) : new Date().toISOString().slice(0, 10),
  };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  console.log('1) 登录…');
  const login = await post(BASE + '/admin', { action: 'login', password: PASSWORD });
  if (!login.data.token) { console.error('登录失败', login); process.exit(1); }
  const auth = { token: login.data.token, exp: login.data.exp };

  console.log('2) 找一份可用的真实报告…');
  const list = await post(BASE + '/admin', { ...auth, action: 'list', page: 1, pageSize: 50 });
  const rows = (list.data.rows || []).filter(r => r.report_md !== false);
  let chosen = null;
  for (const r of rows) {
    const d = await post(BASE + '/admin', { ...auth, action: 'detail', id: r.id });
    const md = (d.data && d.data.row && d.data.row.report_md) || '';
    if (!md) continue;
    const hasSum = md.indexOf('海报摘要') >= 0;
    if (WITH_SUMMARY && !hasSum) continue;
    if (!chosen || md.length > chosen.md.length) { chosen = { row: d.data.row, md }; }
    if (!WITH_SUMMARY) break;
  }
  if (!chosen) { console.error('没找到可用报告'); process.exit(1); }
  const row = chosen.row;
  const meta = metaOf(row);
  console.log('   选中 #' + row.id + ' ' + meta.name + '｜' + meta.topic
    + '｜' + chosen.md.length + ' 字｜含海报摘要=' + (chosen.md.indexOf('海报摘要') >= 0));

  console.log('3) 拉两套 markup…');
  const got = {};
  for (const kind of ['flow', 'full']) {
    const p = await post(BASE + '/poster', { report_md: chosen.md, meta, kind });
    if (p.status !== 200 || !p.data || !p.data.ok) {
      console.error(kind + ' 渲染失败', p.status, JSON.stringify(p.data).slice(0, 200));
      process.exit(1);
    }
    console.log('   ' + kind + ': kind=' + p.data.kind + ' w=' + p.data.w + ' h=' + p.data.h
      + ' markup=' + p.data.html.length + ' css=' + (p.data.css || '').length);
    got[kind] = p.data;
    fs.writeFileSync(path.join(OUT, kind + '.html'), standalone(p.data.html, p.data.css), 'utf8');
  }

  /* 发给第 2 步用：字段 + 正文全部内联，走 /api/mail 的「无 id」模式，不碰任何真实记录 */
  fs.writeFileSync(path.join(OUT, 'payload.json'), JSON.stringify({
    id: row.id, meta,
    fields: {
      interviewee_name: row.interviewee_name || '',
      interviewee_position: row.interviewee_position || '',
      interviewee_um: row.interviewee_um || '',
      city: row.city || '',
      topic: row.topic || '',
      backend_owner_name: row.backend_owner_name || '',
      backend_owner_org: row.backend_owner_org || '',
    },
    report_md: chosen.md,
    flow: { w: got.flow.w, h: got.flow.h },
    full: { w: got.full.w, h: got.full.h },
  }, null, 2), 'utf8');

  console.log('4) 已写出 ' + OUT + '\\{flow,full}.html + payload.json');
})().catch(e => { console.error(e); process.exit(1); });
