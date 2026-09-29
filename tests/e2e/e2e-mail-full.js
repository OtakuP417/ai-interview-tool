/* 端到端验证 /api/mail 完整两阶段流程：
   ① want_html=true 拿海报 HTML（服务端渲染）
   ② 用真实栅格化 PNG（raster-test 截图产物）作为附件发送
   同时验证 TXT 附件存在。 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const ADMIN_URL = 'https://work-d1gs0jzrg2277d75e-1391683363.ap-shanghai.app.tcloudbase.com/api/admin';
const MAIL_URL = 'https://work-d1gs0jzrg2277d75e-1391683363.ap-shanghai.app.tcloudbase.com/api/mail';
const PASSWORD = require("fs").readFileSync(require("path").join(__dirname, "..", "..", "tools", "fetch_reports.secret"), "utf8").trim();

function post(url, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 90000,
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
  const auth = { token: login.data.token, exp: login.data.exp };

  console.log('2) 阶段一：want_html=true 预览海报…');
  const prev = await post(MAIL_URL, { ...auth, id: 9, want_html: true });
  if (prev.status !== 200 || !prev.data.html) {
    console.error('预览失败', prev.status, JSON.stringify(prev.data).slice(0, 300));
    process.exit(1);
  }
  console.log('   html', prev.data.html.length, 'chars; css', prev.data.css.length,
    'chars; canvas', prev.data.w + 'x' + prev.data.h);
  if (!prev.data.html.includes('老客户转介绍')) { console.error('海报内容不对'); process.exit(1); }

  console.log('3) 阶段二：携带 PNG 附件发送…');
  // 用无头浏览器栅格化产物（与 admin 页 rasterizePoster 输出同类：1610×905 PNG 的 dataURL）
  const pngPath = path.join(__dirname, 'shots', 'poster-r9.png');
  const pngBase64 = 'data:image/png;base64,' + fs.readFileSync(pngPath).toString('base64');
  console.log('   png base64', pngBase64.length, 'chars');

  const t0 = Date.now();
  const mail = await post(MAIL_URL, { ...auth, id: 9, poster_png_base64: pngBase64 });
  console.log('   耗时', ((Date.now() - t0) / 1000).toFixed(1), 's; HTTP', mail.status);
  console.log('   响应', JSON.stringify(mail.data, null, 2));

  if (mail.status === 200 && mail.data.ok) {
    const atts = mail.data.attachments || [];
    console.log('\n✓ 邮件已投递：' + mail.data.subject);
    console.log('  收件：' + mail.data.to.join(', '));
    console.log('  附件：' + atts.map(a => a.filename + '（' + Math.round(a.size / 1024) + 'KB）').join('、'));
    if (atts.length < 2) { console.log('✗ 附件数量不对，应为 2（PNG + TXT）'); process.exit(1); }
    if (!atts.some(a => a.filename.endsWith('.png')) || !atts.some(a => a.filename.endsWith('.txt'))) {
      console.log('✗ 附件类型不齐'); process.exit(1);
    }
    console.log('\n✓ 全流程通过（海报 HTML 预览 → PNG 附件 → 发送）');
  } else {
    console.log('\n✗ 发送失败');
    process.exit(1);
  }
})().catch(e => { console.error(e); process.exit(1); });
