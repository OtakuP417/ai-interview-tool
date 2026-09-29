/* 逐条判定：报告里有没有「海报摘要」节（决定海报走一图流还是降级六节版式），
   以及长访谈有没有"打转/重复提问"的上下文截断症状。 */
const fs = require('fs');
const API = 'https://work-d1gs0jzrg2277d75e-1391683363.ap-shanghai.app.tcloudbase.com/api';

// 旧版提示词要求用 ---POSTER--- / 海报摘要 标记；新版用「海报摘要」标题或 ---POSTER---
const hasPosterSummary = (md) => /海报摘要|---POSTER---|钩子句/.test(String(md || ''));

(async () => {
  let r = await fetch(API + '/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'login', password: process.env.ADMIN_PASSWORD || require("fs").readFileSync(require("path").join(__dirname, "..", "..", "tools", "fetch_reports.secret"), "utf8").trim() }) });
  const a = await r.json();
  const A = { token: a.token, exp: a.exp };

  r = await fetch(API + '/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ action: 'list', page: 1, pageSize: 200 }, A)) });
  const rows = (await r.json()).rows || [];
  rows.sort((x, y) => new Date(x.created_at) - new Date(y.created_at));

  const bj = (s) => s ? new Date(new Date(s).getTime() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' ') : '—';

  console.log('id  提交(北京)   轮次  海报摘要  报告字数  客户累计字数  最长AI提问重复  判读');
  console.log('-'.repeat(104));

  for (const x of rows) {
    const d = await fetch(API + '/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ action: 'detail', id: x.id }, A)) });
    const row = (await d.json()).row || {};
    const md = row.report_md || '';
    const turns = row.transcript || [];
    const userTxt = turns.filter(t => t.role === 'user').map(t => String(t.content)).join('');
    const aiTurns = turns.filter(t => t.role === 'assistant').map(t => String(t.content).replace(/\s+/g, ''));

    // 打转检测：相邻两条 AI 提问前 24 字相同，或出现完全相同的提问
    let repeat = 0;
    for (let i = 1; i < aiTurns.length; i++) {
      if (aiTurns[i] && aiTurns[i - 1] && aiTurns[i].slice(0, 24) === aiTurns[i - 1].slice(0, 24)) repeat++;
    }
    const uniqShort = aiTurns.filter(t => t.length < 30).length;
    const loopish = repeat > 0;

    const ps = hasPosterSummary(md);
    console.log(
      String(x.id).padEnd(4) +
      bj(x.created_at).padEnd(13) +
      String(x.round_count || 0).padEnd(6) +
      (ps ? ' 有    ' : ' 无 ←  ').padEnd(9) +
      String(md.replace(/---SECTION---/g, '').length).padEnd(10) +
      String(userTxt.length).padEnd(14) +
      (loopish ? String(repeat) + ' 处 ←  ' : ' 无    ').padEnd(16) +
      (ps ? '' : '海报降级六节版式')
    );
  }

  console.log('\n说明：');
  console.log('  「海报摘要 无」= 该报告生成时页面还没有一图流提示词 → 海报会用旧的六节版式（内容仍在，只是版式不同）');
  console.log('  「最长AI提问重复」>0 = 出现近似重复提问，是旧版上下文截断（.slice(0,40)）的典型症状');
})();
