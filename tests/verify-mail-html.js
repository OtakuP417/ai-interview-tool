/* 本地验证 /api/mail 服务端渲染的邮件 HTML（renderPosterEmail）
   与 mailer 的完整消息拼装，不实际发信 */
const fs = require('fs');
const path = require('path');
const { buildMessage } = require('../cloudfunctions/interview-proxy/mailer');
const poster = require('../cloudfunctions/interview-proxy/poster');

const raw = fs.readFileSync(path.join(__dirname, 'tmp', 'r9_raw.md'), 'utf8');
const meta = {
  name: 'EXAMPLE001', position: '咨询顾问', um: 'EXAMPLE007',
  city: '西安市', topic: '老客户转介绍',
  owner: 'example007', ownerOrg: '西安第一咨询中心', date: '2026-09-24',
};

let fail = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  ✓ ' + name);
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

const emailHtml = poster.renderPosterEmail(raw, meta);
const full = buildMessage({
  from: 'demo.inbox@example.com',
  fromName: '访谈报告',
  to: ['demo.sender@example.com'],
  subject: '访谈报告【example007】老客户转介绍',
  text: '案例经验报告\n横版报告图见附件，可直接用于早会投屏。',
  html: emailHtml,
});

console.log('[1] 邮件 HTML 内容完整性');
ok('六节标题全在（或别名）',
   ['背景与挑战','核心做法','关键判断','结果','可复制的经验点','新人容易踩的坑']
     .every(t => emailHtml.includes(t)));
ok('含姓名/主题/城市', ['EXAMPLE001','老客户转介绍','西安市'].every(t => emailHtml.includes(t)));
ok('含 UM', emailHtml.includes('UM EXAMPLE007'));
ok('后线对接为 UM 形态时隐藏（owner 填错不外印）',
   !emailHtml.includes('后线对接'),
   'owner=example007 是 UM 形态');
ok('含 5 条核心做法序号', (emailHtml.match(/class="step-n"/g) || []).length === 5);
ok('含 3 条避坑', (emailHtml.match(/class="pit"/g) || []).length === 3);
ok('无未转义 <script', !/<script/i.test(emailHtml));

console.log('\n[2] 完整 MIME 消息');
ok('text/html 部分存在', full.includes('text/html; charset=UTF-8'));
ok('multipart/alternative 存在', full.includes('multipart/alternative'));
const b64 = full.split('Content-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n\r\n')[0].replace(/\r\n/g, '');
const decoded = Buffer.from(b64, 'base64').toString('utf8');
ok('base64 解码后是海报 HTML', decoded.includes('iv-page') && decoded.includes('老客户转介绍'));
ok('邮件总大小合理（<200KB）', full.length < 200000, full.length);

fs.writeFileSync(path.join(__dirname, 'tmp', 'mail-body-preview.html'),
  '<!DOCTYPE html><html><head><meta charset="utf-8"><title>邮件正文预览</title></head><body>' + emailHtml + '</body></html>');
console.log('\n产物：tests/tmp/mail-body-preview.html（可直接打开看邮件正文效果）');
console.log('\n' + (fail ? '✗ ' + fail + ' 项失败' : '✓ 全部通过'));
process.exit(fail ? 1 : 0);
