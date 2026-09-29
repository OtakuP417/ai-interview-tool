/* 离线测试 mailer.js 的 buildMessage（不实际连接 SMTP）
   覆盖：纯文本 / 文本+HTML / 文本+HTML+附件 三种形态的 MIME 结构 */
const assert = require('assert');
const { buildMessage, encodeHeader } = require('../cloudfunctions/interview-proxy/mailer');

let fail = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  ✓ ' + name);
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

console.log('\n[1] 纯文本邮件');
const m1 = buildMessage({
  from: 'demo.inbox@example.com', fromName: '访谈报告', to: ['demo.sender@example.com'],
  subject: '访谈报告【张示例】房抵二押签约', text: '第一行\r\n第二行',
});
ok('From 带昵称 RFC2047', m1.includes('From: =?UTF-8?B?') && m1.includes('<demo.inbox@example.com>'));
ok('Subject 编码正确', m1.includes('Subject: =?UTF-8?B?'));
ok('plain 正文 base64', m1.includes('Content-Type: text/plain; charset=UTF-8'));
ok('无 HTML 部分', !m1.includes('text/html'));
// 验证 base64 正文可还原
const b64 = m1.split('Content-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n\r\n')[0].replace(/\r\n/g, '');
ok('正文可解码', Buffer.from(b64, 'base64').toString('utf8') === '第一行\r\n第二行');

console.log('\n[2] 文本 + HTML（multipart/alternative 嵌套在 mixed 里）');
const m2 = buildMessage({
  from: 'demo.inbox@example.com', to: ['a@lu.com'], cc: ['b@lu.com'],
  subject: '访谈报告【后线】主题', text: '这是兜底文本', html: '<div class="iv-page">海报</div>',
});
ok('含 mixed 外层', m2.includes('multipart/mixed'));
ok('含 alternative 内层', m2.includes('multipart/alternative'));
ok('含 text/plain 兜底', m2.includes('text/plain; charset=UTF-8'));
ok('含 text/html', m2.includes('text/html; charset=UTF-8'));
ok('Cc 头存在', m2.includes('Cc: b@lu.com'));
// HTML 正文可还原
const htmlPart = m2.split('Content-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n\r\n')[0].replace(/\r\n/g, '');
ok('HTML 正文可解码', Buffer.from(htmlPart, 'base64').toString('utf8').includes('iv-page'));
// boundary 配对检查
const outer = m2.match(/Content-Type: multipart\/mixed; boundary="([^"]+)"/)[1];
const inner = m2.match(/Content-Type: multipart\/alternative; boundary="([^"]+)"/)[1];
ok('外层 boundary 收尾', m2.trimEnd().endsWith('--' + outer + '--'));
ok('内层 boundary 收尾出现在外层收尾之前',
   m2.indexOf('--' + inner + '--') < m2.lastIndexOf('--' + outer + '--'));
ok('内层 begin/end 配对',
   (m2.match(new RegExp('--' + inner + '(?!--)', 'g')) || []).length === 2,
   (m2.match(new RegExp('--' + inner, 'g')) || []).length);

console.log('\n[3] 文本 + HTML + PNG 附件');
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const m3 = buildMessage({
  from: 'demo.inbox@example.com', to: ['a@lu.com'],
  subject: '访谈报告', text: '正文', html: '<div></div>',
  attachments: [{ filename: '案例经验萃取-李娟-20260924.png', contentType: 'image/png', content: png }],
});
ok('附件头 image/png', m3.includes('Content-Type: image/png'));
ok('附件名 RFC2047 编码', m3.includes('name="=?UTF-8?B?'));
ok('Disposition attachment', m3.includes('Content-Disposition: attachment'));
ok('附件 base64 每行 ≤76',
   m3.split('\r\n').filter(l => /^[A-Za-z0-9+/=]+$/.test(l) && l.length > 76).length === 0);
ok('PNG 数据可还原',
   m3.includes(Buffer.from(png).toString('base64').slice(0, 20)));

console.log('\n[4] 特殊字符与注入防护');
ok('主题含换行也不会注入额外头（foldHeader 未折行但 encodeHeader 压平了一切）',
   buildMessage({ from: 'a@qq.com', to: ['b@lu.com'], subject: '主题\r\nBcc: x@evil.com', text: 't' })
     .split('\r\n').filter(l => l.startsWith('Bcc:')).length === 0);

console.log('\n' + (fail ? '✗ ' + fail + ' 项失败' : '✓ 全部通过'));
process.exit(fail ? 1 : 0);
