/* 验证管理端编辑动作：先备份 #9 原值 → 改 → 读回确认 → 白名单拒绝测试 → 还原 */
const API = 'https://work-d1gs0jzrg2277d75e-1391683363.ap-shanghai.app.tcloudbase.com/api';

(async () => {
  let r = await fetch(API + '/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'login', password: process.env.ADMIN_PASSWORD || require("fs").readFileSync(require("path").join(__dirname, "..", "..", "tools", "fetch_reports.secret"), "utf8").trim() }) });
  const a = await r.json();
  const A = { token: a.token, exp: a.exp };
  const call = async (body) => {
    const res = await fetch(API + '/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({}, A, body)) });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };

  // 0) 备份 #9 原值
  let { data } = await call({ action: 'detail', id: 9 });
  const orig = {};
  ['interviewee_name','interviewee_position','interviewee_um','city','topic','backend_owner_name','backend_owner_org']
    .forEach(k => orig[k] = data.row[k]);
  console.log('[0] #9 原值备份:');
  Object.entries(orig).forEach(([k, v]) => console.log('      ' + k + ' = ' + JSON.stringify(v)));

  // 1) 无 token → 401
  let res = await fetch(API + '/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update', id: 9, fields: { city: '西安市' } }) });
  console.log('\n[1] update 无 token → HTTP ' + res.status + ' ' + JSON.stringify(await res.json()));

  // 2) 白名单外字段（report_md / mail_sent_at / round_count）必须被忽略
  ({ status: res.status, data } = await call({ action: 'update', id: 9, fields: { city: orig.city, report_md: 'HACKED', mail_sent_at: '1999-01-01', round_count: 999 } }));
  console.log('[2] 传白名单外字段 → HTTP ' + res.status + '  实际生效字段=' + JSON.stringify(Object.keys(data.fields || {})));
  const after = await call({ action: 'detail', id: 9 });
  console.log('    report_md 未被篡改: ' + (after.data.row.report_md && !after.data.row.report_md.includes('HACKED') ? '✓' : '✗')
    + '   mail_sent_at 未变: ' + (String(after.data.row.mail_sent_at) === String(data.row ? data.row.mail_sent_at : after.data.row.mail_sent_at) ? '✓' : '?')
    + '   round_count=' + after.data.row.round_count);

  // 3) 姓名清空 → 400
  ({ status: res.status, data } = await call({ action: 'update', id: 9, fields: { interviewee_name: '' } }));
  console.log('[3] 姓名置空 → HTTP ' + res.status + ' ' + JSON.stringify(data));

  // 4) 缺 id → 400
  ({ status: res.status, data } = await call({ action: 'update', fields: { city: '西安市' } }));
  console.log('[4] 缺 id → HTTP ' + res.status + ' ' + JSON.stringify(data));

  // 5) 无任何可编辑字段 → 400
  ({ status: res.status, data } = await call({ action: 'update', id: 9, fields: { foo: 'bar' } }));
  console.log('[5] 无可编辑字段 → HTTP ' + res.status + ' ' + JSON.stringify(data));

  // 6) 正常改（临时值）→ 200，读回确认 + subjectHint
  ({ status: res.status, data } = await call({ action: 'update', id: 9, fields: Object.assign({}, orig, { interviewee_name: '联调临时名', backend_owner_name: '联调临时对接人', backend_owner_org: '西安第一咨询中心' }) }));
  console.log('[6] 正常更新 → HTTP ' + res.status + '  subjectHint=' + JSON.stringify(data.subjectHint));
  const chk = await call({ action: 'detail', id: 9 });
  console.log('    读回: name=' + chk.data.row.interviewee_name + '  owner=' + chk.data.row.backend_owner_name + '  org=' + chk.data.row.backend_owner_org
    + '  → ' + (chk.data.row.interviewee_name === '联调临时名' && chk.data.row.backend_owner_name === '联调临时对接人' ? '✓ 已落库' : '✗ 未生效'));

  // 7) 列表接口也同步（编辑后列表要能看到新值）
  const lst = await call({ action: 'list', page: 1, pageSize: 200 });
  const row9 = (lst.data.rows || []).find(x => x.id === 9);
  console.log('[7] 列表同步: name=' + (row9 && row9.interviewee_name) + '  owner=' + (row9 && row9.backend_owner_name) + '  → ' + (row9 && row9.interviewee_name === '联调临时名' ? '✓' : '✗'));

  // 8) 还原
  ({ status: res.status } = await call({ action: 'update', id: 9, fields: orig }));
  const back = await call({ action: 'detail', id: 9 });
  const same = Object.keys(orig).every(k => String(back.data.row[k] || '') === String(orig[k] || ''));
  console.log('\n[8] 还原 #9 → HTTP ' + res.status + '  ' + (same ? '✓ 各字段已回到原值' : '✗ 有字段未还原'));
  Object.entries(orig).forEach(([k, v]) => console.log('      ' + k + ' = ' + JSON.stringify(back.data.row[k]) + (String(back.data.row[k] || '') === String(v || '') ? '' : '   ✗ 应为 ' + JSON.stringify(v))));
})();
