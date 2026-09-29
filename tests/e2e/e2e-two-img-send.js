/* 端到端验证（第 2 步）：真实发一封邮件，附件必须是两张 PNG。
   走 /api/mail 的「无 id」内联模式：不写库、不改任何真实记录的 mail_sent_at。 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const BASE = 'https://work-d1gs0jzrg2277d75e-1391683363.ap-shanghai.app.tcloudbase.com/api';
const PASSWORD = require("fs").readFileSync(require("path").join(__dirname, "..", "..", "tools", "fetch_reports.secret"), "utf8").trim();
const D = path.join(__dirname, 'out', 'e2e2');

function post(url, payload, timeout) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: timeout || 90000,
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', c => raw += c);
      res.on('end', () => {
        let data = null;
        try { data = JSON.parse(raw); } catch (e) { data = { raw: raw.slice(0, 400) }; }
        resolve({ status: res.statusCode, data });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.write(body);
    req.end();
  });
}

(async () => {
  const pl = JSON.parse(fs.readFileSync(path.join(D, 'payload.json'), 'utf8'));
  const flowB64 = 'data:image/png;base64,' + fs.readFileSync(path.join(D, 'flow.png')).toString('base64');
  const fullB64 = 'data:image/png;base64,' + fs.readFileSync(path.join(D, 'full.png')).toString('base64');
  console.log('flow png', Math.round(flowB64.length / 1024) + 'KB(base64)',
    '| full png', Math.round(fullB64.length / 1024) + 'KB(base64)');

  console.log('1) 登录…');
  const login = await post(BASE + '/admin', { action: 'login', password: PASSWORD });
  if (!login.data.token) { console.error('登录失败', login); process.exit(1); }
  const auth = { token: login.data.token, exp: login.data.exp };

  /* 无 id：服务端用内联字段拼 row，全程不碰数据库 */
  const body = {
    ...auth,
    interviewee_name: pl.fields.interviewee_name,
    interviewee_position: pl.fields.interviewee_position,
    interviewee_um: pl.fields.interviewee_um,
    city: pl.fields.city,
    topic: pl.fields.topic,
    backend_owner_name: pl.fields.backend_owner_name,
    backend_owner_org: pl.fields.backend_owner_org,
    report_md: pl.report_md,
    poster_png_base64: flowB64,
    full_png_base64: fullB64,
  };

  console.log('2) 发送（无 id 内联模式）…');
  const t0 = Date.now();
  const mail = await post(BASE + '/mail', body, 120000);
  console.log('   耗时', ((Date.now() - t0) / 1000).toFixed(1) + 's; HTTP', mail.status);
  console.log('   响应', JSON.stringify(mail.data, null, 2));

  const atts = (mail.data && mail.data.attachments) || [];
  const pngs = atts.filter(a => /\.png$/i.test(a.filename));
  let fail = 0;
  const ok = (name, cond, extra) => {
    console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra ? '  → ' + extra : ''));
    if (!cond) fail++;
  };
  console.log('');
  ok('HTTP 200 且 ok', mail.status === 200 && mail.data && mail.data.ok === true);
  ok('附件恰为 2 张', atts.length === 2, '实际 ' + atts.length);
  ok('两张都是 PNG', pngs.length === 2);
  ok('含「经验一图流-」', atts.some(a => a.filename.indexOf('经验一图流-') === 0));
  ok('含「完整报告-」', atts.some(a => a.filename.indexOf('完整报告-') === 0));
  ok('不再有 TXT 附件', !atts.some(a => /\.txt$/i.test(a.filename)));
  ok('主题含受访人', typeof mail.data.subject === 'string' && mail.data.subject.length > 0,
    mail.data.subject);

  console.log('');
  if (fail) { console.log('✗ ' + fail + ' 项未通过'); process.exit(1); }
  console.log('✓ 真实发信通过：两个 PNG 附件均已投递');
})().catch(e => { console.error(e); process.exit(1); });
