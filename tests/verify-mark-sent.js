/**
 * 管理端「标记为已发送」按钮的行为验证（2026-09-30 新增）
 *
 * 这个功能的风险点是**语义**:它必须只补记状态、绝不能真的再发一封邮件。
 * 所以这里不做源码词面断言,而是用 jsdom 加载真实 admin.html:
 *   · 渲染一条未发送记录 → 按钮出现
 *   · 真实点击 → 断言发出的 payload 是 {action:'mark_sent', id},且没有打到 /api/mail
 *   · 选「取消」时不发任何请求(防误标)
 *   · 渲染一条已发送记录 → 按钮消失、发送按钮变「重新发送」
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

let pass = 0;
let fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (extra ? '  → ' + extra : '')); }
}

const SRC = fs.readFileSync(path.join(__dirname, '..', 'web', 'admin.html'), 'utf8');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push(String((e && e.message) || e)));

const dom = new JSDOM(SRC, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'https://example.com/admin.html',
  virtualConsole: vc,
});
const w = dom.window;

w.eval('auth = { token: "x", exp: ' + (Date.now() + 3600000) + ' };');
w.eval('Element.prototype.scrollIntoView = function () {};');
w.eval('currentRows = [];');

function mkRow(sentAt) {
  return {
    id: 9, created_at: '2026-09-24T10:03:11+08:00', status: '已退回',
    city: '西安市', interviewee_name: '李示例', interviewee_position: '咨询顾问',
    interviewee_um: 'LISHILI001', topic: '老客户转介绍',
    ai_topic: '靠节日点赞轻维护老客户促转介绍',
    tags: ['获客方式:老客户转介绍'],
    backend_owner_name: '王示例', backend_owner_org: '西安第一咨询中心',
    round_count: 5, mail_sent_at: sentAt,
    report_md: '背景与挑战\n客户是存量老客户。\n'
      + '---SECTION---\n核心做法\n1. 节日送礼。\n'
      + '---SECTION---\n关键判断与取舍\n1. 长期维护而非临时联系。\n'
      + '---SECTION---\n结果\n放款 100 万。\n'
      + '---SECTION---\n可复制的经验点\n在额度不大时也要坚持维护。\n'
      + '---SECTION---\n新人注意事项\n不要只在有业务时才联系。',
    transcript: [{ role: 'assistant', content: '你好' }],
  };
}

function render(row) {
  w.eval('detailRow = ' + JSON.stringify(row) + '; currentId = ' + row.id + ';');
  w.eval('document.getElementById("drawer").style.display = "flex";');
  w.eval('renderDetail(detailRow);');
}

/* 捕获所有 fetch 调用（页面 api() 与 sendMail() 都走 fetch） */
let calls = [];
w.fetch = function (url, opt) {
  let body = null;
  try { body = opt && opt.body ? JSON.parse(opt.body) : null; } catch (e) { body = null; }
  calls.push({ url: String(url), body: body });
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ ok: true, id: 9, mail_sent_at: '2026-09-30T03:15:27.164Z' }),
  });
};

(async () => {
  console.log('[1] 未发送态：按钮出现');
  render(mkRow(null));
  {
    const doc = w.document;
    const btns = Array.from(doc.querySelectorAll('#d-body .actions button'));
    const labels = btns.map(b => (b.textContent || '').trim());
    const mark = btns.find(b => (b.textContent || '').indexOf('标记为已发送') >= 0);
    ok(!!mark, '出现「标记为已发送」按钮', labels.join(' | '));
    ok(labels.indexOf('发送邮件') >= 0, '主按钮文案为「发送邮件」', labels.join(' | '));
    ok(labels.indexOf('重新发送') < 0, '未发送态不显示「重新发送」');
    ok(!!mark && /邮箱里手工发出/.test(mark.getAttribute('title') || ''), '按钮 title 说明了适用场景');
  }

  console.log('\n[2] 点击「取消」→ 不发任何请求（防误标）');
  {
    calls = [];
    w.confirm = () => false;
    const mark = Array.from(w.document.querySelectorAll('#d-body .actions button'))
      .find(b => (b.textContent || '').indexOf('标记为已发送') >= 0);
    mark.click();
    await new Promise(r => setTimeout(r, 60));
    ok(calls.length === 0, '取消后未发出任何请求', JSON.stringify(calls.map(c => c.url)));
  }

  console.log('\n[3] 确认 → 只补状态、不发信');
  {
    calls = [];
    w.confirm = () => true;
    errors.length = 0;
    const mark = Array.from(w.document.querySelectorAll('#d-body .actions button'))
      .find(b => (b.textContent || '').indexOf('标记为已发送') >= 0);
    mark.click();
    await new Promise(r => setTimeout(r, 120));

    ok(errors.length === 0, '点击未抛异常', errors.join(' | '));
    ok(calls.length === 1, '恰好发出 1 个请求', '实际 ' + calls.length);
    const c = calls[0] || {};
    ok(/\/api\/admin$/.test(c.url || ''), '请求打到 /api/admin', c.url);
    ok(!!c.body && c.body.action === 'mark_sent', 'action 是 mark_sent', JSON.stringify(c.body));
    ok(!!c.body && c.body.id === 9, '带上记录 id');
    ok((c.url || '').indexOf('/api/mail') < 0, '★ 没有打到发信接口 /api/mail');
    ok(!/poster_png_base64|full_png_base64/.test(JSON.stringify(c.body || {})),
       '★ payload 里不含出图数据（没有走发信链路）');
    /* ★ jsdom 坑：页面里的 detailRow 是脚本作用域的 let，不是 window 属性，
       直接读 w.detailRow 永远是 undefined —— 必须走 eval 才看得见。 */
    const backfilled = w.eval('detailRow && detailRow.mail_sent_at');
    ok(!!backfilled, '本地记录已回写发送时间', String(backfilled));
  }

  console.log('\n[4] 已发送态：按钮消失、主按钮变「重新发送」');
  {
    calls = [];
    render(mkRow('2026-09-24T18:30:00+08:00'));
    const btns = Array.from(w.document.querySelectorAll('#d-body .actions button'));
    const labels = btns.map(b => (b.textContent || '').trim());
    ok(labels.indexOf('标记为已发送') < 0, '已发送态不再显示补记按钮', labels.join(' | '));
    ok(labels.indexOf('重新发送') >= 0, '主按钮文案变为「重新发送」', labels.join(' | '));
    ok(/已发送/.test(w.document.getElementById('d-body').textContent || ''), '详情里显示「已发送」标记');
  }

  console.log('');
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  if (fail) { console.log('FAIL'); process.exit(1); }
  console.log('全部通过');
})();
