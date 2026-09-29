/* 验证「提交即自动发信」这条链路：
   ① 云函数 handleSubmit 插入成功后 fire-and-forget 调 sendReportMailById，且不 await
   ② sendReportMailById 支持 skipIfSent 幂等（mail_sent_at 已存在则跳过）
   ③ 发送成功后 PATCH 回写 mail_sent_at
   ④ 附件保留（海报 PNG + 报告全文 txt）
   ⑤ 前端访谈页在提交前生成海报图并带海报字段
   ⑥ 前端管理页展示发送状态、按钮文案随状态切换
   ⑦ 请求体上限护栏存在
   全部为静态/源码级断言，不发真实邮件、不连数据库。 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FN = fs.readFileSync(path.join(ROOT, 'cloudfunctions/interview-proxy/index.js'), 'utf8');
const IDX = fs.readFileSync(path.join(ROOT, 'web/index.html'), 'utf8');
const ADM = fs.readFileSync(path.join(ROOT, 'web/admin.html'), 'utf8');

let fail = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  ✓ ' + name);
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}

/* ── 工具：把源码里某个函数体切出来 ── */
function sliceFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) return '';
  let i = src.indexOf('{', start);
  if (i < 0) return '';
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  return src.slice(start);
}

console.log('[1] 云函数：共用发送入口');
const sendFn = sliceFn(FN, 'sendReportMailById');
ok('sendReportMailById 存在', !!sendFn);
ok('导出/可被 handleMail 与 handleSubmit 同时复用',
   (FN.match(/sendReportMailById\(/g) || []).length >= 2,
   '调用点数量 ' + (FN.match(/sendReportMailById\(/g) || []).length);
ok('skipIfSent 幂等分支存在', /skipIfSent/.test(sendFn) && /already_sent/.test(sendFn));
ok('空报告直接拒绝', /empty_report/.test(sendFn));
ok('成功后回写 mail_sent_at', /mail_sent_at:\s*sentAt/.test(sendFn.replace(/\s+/g, ' ').replace(/,\s*\}/g, ' }'))
   || /mail_sent_at/.test(sendFn));

console.log('\n[2] 附件：一图流 PNG + 完整报告 PNG（两张图）');
ok('一图流 PNG 附件', /image\/png/.test(sendFn) && /经验一图流-/.test(sendFn));
ok('完整报告 PNG 附件', /fullPngBase64/.test(sendFn) && /完整报告-/.test(sendFn));
ok('不再发 TXT 附件（需求：最后的附件是两个图片）',
   !/报告全文-/.test(sendFn) && !/text\/plain;/.test(sendFn));
ok('两张图入参都有长度上限',
   /asText\(o\.posterPngBase64,\s*\d+\)/.test(sendFn) &&
   /asText\(o\.fullPngBase64,\s*\d+\)/.test(sendFn));
ok('PNG 支持 dataURL 前缀剥离', /replace\(\/\^data:image\\\/png;base64,/.test(sendFn));
ok('附件只有 PNG 一种类型', (sendFn.match(/contentType/g) || []).length === 2);
ok('正文仍保留报告全文文字版（弥补去掉 TXT 附件）',
   /renderPosterEmail/.test(sendFn) && /buildPlainBody/.test(sendFn));

console.log('\n[3] 提交链路：插入成功即自动发信、且不阻塞响应');
const submitFn = sliceFn(FN, 'handleSubmit');
ok('handleSubmit 存在', !!submitFn);
ok('先回 200 再发信（sendJson 在 sendReportMailById 之前）', (() => {
  const a = submitFn.indexOf('sendJson(res, 200');
  const b = submitFn.indexOf('sendReportMailById(');
  return a >= 0 && b >= 0 && a < b;
})());
ok('未 await（fire-and-forget）', /sendReportMailById\([^)]*\)\s*\.catch\(/.test(submitFn.replace(/\s+/g, ' ')));
ok('自动发信带两张图的 base64 透传',
   /poster_png_base64/.test(submitFn) && /full_png_base64/.test(submitFn));
ok('新建行 mail_sent_at 显式置空（避免误判已发）',
   /mail_sent_at:\s*null/.test(submitFn.replace(/\s+/g, ' ')));
ok('异常被吞掉不外抛（不影响已返回的成功响应）',
   /\.catch\(function\s*\(\s*\)\s*\{\s*\}\s*\)/.test(submitFn.replace(/\s+/g, ' ')));

console.log('\n[4] 请求体大小护栏');
ok('MAX_BODY_BYTES 已定义', /const MAX_BODY_BYTES\s*=\s*\d+\s*\*\s*1024\s*\*\s*1024/.test(FN));
ok('readRawBody 超限即 reject body_too_large', /body_too_large/.test(FN));
ok('handleSubmit 区分 413', /tooBig\s*\?\s*413\s*:\s*400/.test(FN.replace(/\s+/g, ' ')));

console.log('\n[5] 管理页：发送状态可视化');
ok('列表行含邮件状态标记', /pill ok">已发送/.test(ADM) && /pill wait">未发送/.test(ADM));
ok('列表行展示发送时间', /fmtTime\(r\.mail_sent_at\)/.test(ADM));
ok('表头含「邮件」列', /<th class="hide-sm">邮件<\/th>/.test(ADM));
ok('按钮文案随状态切换', /mailed \? '重新发送' : '发送邮件'/.test(ADM));
ok('详情弹窗含 已发送/未发送 文案', /已发送/.test(ADM) && /未发送/.test(ADM));
ok('发送成功后同步刷新列表行', /listRow\.mail_sent_at\s*=\s*sentAt/.test(ADM.replace(/\s+/g, ' ')));
ok('CSV 导出含邮件发送时间列', /'邮件发送时间'/.test(ADM));

console.log('\n[6] 访谈页：提交前出两张图并随提交上传');
ok('posterPreviewUrl 存在', /function posterPreviewUrl\(/.test(IDX));
ok('rasterizePoster 存在', /function rasterizePoster\(/.test(IDX));
ok('buildPosterPng 存在', /function buildPosterPng\(/.test(IDX));
const submitArchiveFn = sliceFn(IDX, 'submitArchive');
ok('submitArchive 调用了 buildPosterPng', /buildPosterPng\(/.test(submitArchiveFn));
ok('提交体带上两张图的 base64',
   /poster_png_base64/.test(submitArchiveFn) && /full_png_base64/.test(submitArchiveFn));
ok('出图有等待提示', /生成图片/.test(submitArchiveFn));
ok('长图高度由浏览器实测（measureMarkupHeight）', /function measureMarkupHeight\(/.test(IDX));
ok('未知高度走 rasterizeAuto', /async function rasterizeAuto\(/.test(IDX));
ok('长图高度有兜底上限', /MAX_FULL_PNG_H/.test(IDX));
ok('出图失败降级不阻塞提交', (() => {
  const b = sliceFn(IDX, 'buildPosterPng');
  return /catch/.test(b) && /return null/.test(b.replace(/\s+/g, ' '));
})());

console.log('\n[7] 端点：/api/poster 与 /api/mail');
ok('handlePoster 存在且无需鉴权', /function handlePoster\(req, res\)/.test(FN) && !/need_auth/.test(sliceFn(FN, 'handlePoster')));
ok('/api/poster 已注册进路由', /\/api\/poster/.test(FN));
ok('handleMail 强制鉴权', (() => {
  const h = sliceFn(FN, 'handleMail');
  return /requireAuth|token/.test(h) && /unauthorized|401/.test(FN);
})());
ok('handleMail 支持 want_html 预览模式', /want_html/.test(sliceFn(FN, 'handleMail')));
ok('handleMail 支持 skip_if_sent', /skip_if_sent/.test(sliceFn(FN, 'handleMail')));
ok('管理列表 select 含 mail_sent_at', /mail_sent_at/.test(FN) && /select=/.test(FN));

console.log('\n[8] 邮件主题与正文保持不变（不因改动而回归）');
ok('主题构造仍在', /buildMailSubject\(/.test(FN));
ok('正文版式仍走 poster.renderPosterEmail', /renderPosterEmail\(/.test(FN));
ok('纯文本兜底仍在', /buildPlainBody\(/.test(FN) || /buildReportTxt\(/.test(FN));

console.log('\n' + (fail ? '✗ ' + fail + ' 项失败' : '✓ 全部通过（' + '）'));
process.exit(fail ? 1 : 0);
