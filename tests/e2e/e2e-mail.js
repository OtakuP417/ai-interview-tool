/* 端到端验证 /api/mail：
   1. 登录管理端拿 token
   2. 调 /api/mail 传 id=9，让服务端从 PG 读报告 → 排版 → 发邮件
   预期：收件箱（demo.sender@example.com）收到主题为「访谈报告【example007】老客户转介绍」的邮件 */
const https = require('https');

const ADMIN_URL = 'https://work-d1gs0jzrg2277d75e-1391683363.ap-shanghai.app.tcloudbase.com/api/admin';
const MAIL_URL = 'https://work-d1gs0jzrg2277d75e-1391683363.ap-shanghai.app.tcloudbase.com/api/mail';
const PASSWORD = require("fs").readFileSync(require("path").join(__dirname, "..", "..", "tools", "fetch_reports.secret"), "utf8").trim();

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

(async () => {
  console.log('1) 管理端登录…');
  const login = await post(ADMIN_URL, { action: 'login', password: PASSWORD });
  if (!login.data.token) { console.error('登录失败', login); process.exit(1); }
  console.log('   token ok, exp =', new Date(login.data.exp).toLocaleString('zh-CN'));

  console.log('2) 调 /api/mail 发送归档 #9 …');
  const t0 = Date.now();
  const mail = await post(MAIL_URL, {
    token: login.data.token,
    exp: login.data.exp,
    id: 9,
  });
  console.log('   耗时', ((Date.now() - t0) / 1000).toFixed(1), 's');
  console.log('   HTTP', mail.status);
  console.log('   响应', JSON.stringify(mail.data, null, 2));

  if (mail.status === 200 && mail.data.ok) {
    console.log('\n✓ 邮件已投递。主题：' + mail.data.subject);
    console.log('  收件：' + mail.data.to.join(', '));
    console.log('  服务器回执：' + mail.data.response);
  } else {
    console.log('\n✗ 发送失败');
    process.exit(1);
  }
})().catch(e => { console.error(e); process.exit(1); });
