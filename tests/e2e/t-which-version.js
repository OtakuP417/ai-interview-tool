/* 查清：同事们用的到底是新版还是旧版。
   判据：新版提交会 fire-and-forget 自动发信 → mail_sent_at 必被回写。
   若某条访谈走了新版，mail_sent_at 就不该是 NULL。 */
const API = 'https://work-d1gs0jzrg2277d75e-1391683363.ap-shanghai.app.tcloudbase.com/api';

const fmt = (s) => {
  if (!s) return '—';
  const d = new Date(s);
  const p = n => String(n).padStart(2, '0');
  // 转北京时间
  const bj = new Date(d.getTime() + 8 * 3600 * 1000);
  return bj.toISOString().slice(0, 16).replace('T', ' ') + ' (北京)';
};

(async () => {
  let r = await fetch(API + '/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'login', password: process.env.ADMIN_PASSWORD || require("fs").readFileSync(require("path").join(__dirname, "..", "..", "tools", "fetch_reports.secret"), "utf8").trim() }) });
  const a = await r.json();
  const A = { token: a.token, exp: a.exp };

  r = await fetch(API + '/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ action: 'list', page: 1, pageSize: 200 }, A)) });
  const lj = await r.json();
  const rows = lj.rows || [];

  console.log('共 ' + rows.length + ' 条访谈记录\n');
  console.log('id  提交时间(北京)        轮次  发信状态        被访谈人 / 主题');
  console.log('-' .repeat(96));

  // 按时间排序
  rows.sort((x, y) => new Date(x.created_at) - new Date(y.created_at));
  for (const x of rows) {
    const mailed = x.mail_sent_at ? '已发送 ' + fmt(x.mail_sent_at).slice(5, 16) : '未发送';
    console.log(
      String(x.id).padEnd(4) +
      fmt(x.created_at).padEnd(22) +
      String(x.round_count || 0).padEnd(6) +
      mailed.padEnd(16) +
      (x.interviewee_name || '—') + ' / ' + (x.topic || '').slice(0, 30)
    );
  }

  const mailedCount = rows.filter(x => x.mail_sent_at).length;
  console.log('\n自动发信成功条数: ' + mailedCount + ' / ' + rows.length);
  console.log('（若为 0，说明没有任何一条访谈是走新版提交的）');

  // 关键时间点对比
  console.log('\n关键时间点：');
  console.log('  根路径 admin.html 旧版写入: 2026-09-24 16:04 (北京)');
  console.log('  根路径 index.html 旧版写入: 2026-09-24 16:25 (北京)');
  console.log('  修复（根路径换新版）      : 2026-09-24 17:01 (北京)');
  console.log('  我的联调测试 #13/#14（走新版，已删）均成功自动发信');

  // 逐条看最后两轮对话，判断是否有"打转/重复提问"（旧版上下文截断的症状）
  console.log('\n各条访谈最后两条对话（看是否有重复提问）：');
  for (const x of rows) {
    const d = await fetch(API + '/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ action: 'detail', id: x.id }, A)) });
    const dj = await d.json();
    const turns = (dj.row && dj.row.transcript) || [];
    const aiTurns = turns.filter(t => t.role === 'assistant');
    const last2 = aiTurns.slice(-2).map(t => String(t.content).replace(/\s+/g, '').slice(0, 42));
    const dup = last2.length === 2 && last2[0].slice(0, 20) === last2[1].slice(0, 20);
    console.log('  #' + x.id + ' ' + (x.interviewee_name || '') + '（' + (x.round_count || 0) + '轮）' + (dup ? '  ⚠ 末两条AI提问高度相似' : ''));
  }
})();
