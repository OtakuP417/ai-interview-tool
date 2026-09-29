const API = 'https://work-d1gs0jzrg2277d75e-1391683363.ap-shanghai.app.tcloudbase.com/api';

(async () => {
  const out = [];
  const log = (s) => { out.push(s); console.log(s); };

  // 1) /api/poster 无鉴权 + 空报告 → 400 empty_report
  let r = await fetch(API + '/poster', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  log('[1] /api/poster 空报告  → HTTP ' + r.status + '  ' + (await r.text()).slice(0, 120));

  // 2) /api/poster 带真实报告 → 200 ok + html + css + w/h
  const reportMd = [
    '背景与挑战---SECTION---客户做建材批发，2024 年下游回款周期拉长，现金流吃紧，此前在两家银行申请都被秒拒。',
    '核心做法---SECTION---【1】先看流水再谈额度\n【2】用税务数据补强经营证明\n【3】把家庭资产负债算清楚\n【4】当场给出可预期的时点\n【5】贷后保持一次回访',
    '关键判断---SECTION---判断这位客户有没有真实经营，只看三件事：有没有固定门店、有没有连续流水、有没有纳税记录。',
    '结果---SECTION---最终批复 28 万元，客户当月完成提款，并在三个月后转介绍了同市场的两位商户。',
    '可复制的经验点---SECTION---先建立信任再谈产品，把不确定的审批节点提前讲清楚。',
    '新人容易踩的坑---SECTION---不要一上来就报额度；不要在客户没提供流水前承诺包过；不要忽略共同借款人的负债。',
  ].join('---SECTION---');
  const meta = { name: '赵小明', position: '咨询顾问', um: 'ZHAOXM001', city: '西安市', topic: '小微企业主续贷提额', owner: 'example007', ownerOrg: '西安第一咨询中心', code: 'IV-2026-0001', date: '2026-09-24' };
  r = await fetch(API + '/poster', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ report_md: reportMd, meta }) });
  const pj = await r.json().catch(() => ({}));
  log('[2] /api/poster 正常渲染 → HTTP ' + r.status + '  ok=' + pj.ok + '  html=' + (pj.html ? pj.html.length + '字符' : '无') + '  css=' + (pj.css ? pj.css.length + '字符' : '无') + '  w=' + pj.w + ' h=' + pj.h);
  if (pj.html) {
    log('    HTML 含关键内容: ' + ['赵小明', '小微企业主续贷提额', '西安市', '背景与挑战', '新人容易踩的坑'].map(t => t + (pj.html.includes(t) ? '✓' : '✗')).join(' '));
    const fs = require('fs');
    fs.writeFileSync(path.join(__dirname, 'out', 'poster-live.html'), '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' + pj.css + '</style></head><body>' + pj.html + '</body></html>');
    log('    已写 tests/e2e/out/poster-live.html');
  }

  // 3) /api/mail 无鉴权 → 401
  r = await fetch(API + '/mail', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 1 }) });
  log('[3] /api/mail 无 token → HTTP ' + r.status + '  ' + (await r.text()).slice(0, 80));

  // 4) /api/admin 错误口令 → 应被拒
  r = await fetch(API + '/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'login', password: 'wrong-password' }) });
  log('[4] /api/admin 错误口令 → HTTP ' + r.status + '  ' + (await r.text()).slice(0, 80));

  // 5) /api/admin 正确口令 → 拿 token
  r = await fetch(API + '/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'login', password: process.env.ADMIN_PASSWORD || require("fs").readFileSync(require("path").join(__dirname, "..", "..", "tools", "fetch_reports.secret"), "utf8").trim() }) });
  const aj = await r.json().catch(() => ({}));
  log('[5] /api/admin 正确口令 → HTTP ' + r.status + '  token=' + (aj.token ? '已获取' : '无'));
  if (aj.token) {
    // 6) list 里是否带 mail_sent_at 字段
    r = await fetch(API + '/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'list', token: aj.token, exp: aj.exp, page: 1, pageSize: 5 }) });
    const lj = await r.json().catch(() => ({}));
    const rows = lj.rows || [];
    log('[6] /api/admin list → HTTP ' + r.status + '  共 ' + (lj.total != null ? lj.total : rows.length) + ' 条；前 ' + rows.length + ' 条:');
    rows.forEach(x => log('    #' + x.id + '  ' + (x.interviewee_name || '—') + '  『' + (x.topic || '') + '』  轮次=' + x.round_count + '  状态=' + x.status + '  邮件=' + (x.mail_sent_at ? new Date(x.mail_sent_at).toLocaleString('zh-CN') : '未发送')));
    log('    字段 mail_sent_at 存在: ' + (rows.length ? ('mail_sent_at' in rows[0] ? '✓' : '✗') : '无数据可验'));
  }
})();
