const { sendReportMail, buildMessage } = require('../../cloudfunctions/interview-proxy/mailer.js');

process.env.SMTP_USER = 'demo.inbox@example.com';
process.env.SMTP_PASS = 'saaphnqipjkzcagi';
process.env.MAIL_TO   = 'demo.sender@example.com';

(async () => {
  // 先做一次组装自检（不发信也能验证 MIME 结构）
  const msg = buildMessage({
    from: 'demo.inbox@example.com', fromName: '访谈报告',
    to: ['demo.sender@example.com'],
    subject: '【张示例】房抵二押签约',
    text: '这是一封通道测试邮件。\n收到即说明 QQ邮箱 → 工作邮箱 的自动发信链路可用。\n\n（本邮件由访谈工具自动发送）',
    attachments: [{
      filename: '测试附件.txt',
      contentType: 'text/plain; charset=UTF-8',
      content: Buffer.from('附件内容测试\n第二行', 'utf8'),
    }],
  });
  console.log('=== MIME 结构自检 ===');
  console.log('总长度:', msg.length, '字节');
  console.log('Subject 行:', msg.split('\r\n').find(l => l.startsWith('Subject:')));
  console.log('To 行:', msg.split('\r\n').find(l => l.startsWith('To:')));
  console.log('附件段数:', (msg.match(/Content-Disposition: attachment/g) || []).length);
  console.log('CRLF 行数:', msg.split('\r\n').length);

  console.log('\n=== 实际发信 ===');
  try {
    const r = await sendReportMail({
      subject: '【测试】访谈报告自动发送通道验证',
      text: '你好：\n\n这是访谈工具自动发信功能的通道测试。\n'
          + '如果你收到这封邮件，说明「QQ邮箱 → demo.sender@example.com」的链路已经打通，\n'
          + '接下来只要接上归档流程，每份报告归档后就会自动发到这里。\n\n'
          + '（此邮件为技术验证，无需回复）',
      attachments: [{
        filename: '通道测试.txt',
        contentType: 'text/plain; charset=UTF-8',
        content: Buffer.from('附件读取正常。', 'utf8'),
      }],
    });
    console.log('发送结果:', JSON.stringify(r, null, 1));
  } catch (e) {
    console.log('发送失败:', e.message);
  }
})();
