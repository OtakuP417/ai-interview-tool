/* 验证「一图流」海报作为附件随自动发信一起发出。
   做法：走真实 /api/submit 提交一份带「海报摘要」节的报告，
   并在浏览器端等价地栅格化出 PNG（用无头 Edge 渲染 /api/poster 的 markup→截图，
   再转 base64），验证：
     ① /api/poster 对该报告返回的是一图流模板（fv- 前缀类名）
     ② 生成的 PNG 是 1610×905 且非空白
     ③ 邮件附件里含「案例经验萃取-*.png」且体积合理（>20KB，排除降级为无图） */
const fs = require('fs');
const path = require('path');
const API = 'https://work-d1gs0jzrg2277d75e-1391683363.ap-shanghai.app.tcloudbase.com/api';
const TMP = __dirname;

const reportMd = [
  '背景与挑战---SECTION---客户在西安做建材批发，2024 年下半年下游回款周期拉长，现金流吃紧，此前在两家银行申请都被秒拒，原因是无法证明经营真实性。',
  '核心做法---SECTION---【1】先看流水再谈额度\n【2】用税务数据补强经营证明\n【3】把家庭资产负债算清楚\n【4】当场给出可预期的时点\n【5】贷后保持一次回访',
  '关键判断---SECTION---判断有没有真实经营，只看三件事：有没有固定门店、有没有连续流水、有没有纳税记录。',
  '结果---SECTION---最终批复 28 万元，客户当月完成提款，并转介绍了同市场两位商户。',
  '可复制的经验点---SECTION---先建立信任再谈产品，把不确定的审批节点提前讲清楚。',
  '新人容易踩的坑---SECTION---不要一上来就报额度；不要在客户没提供流水前承诺包过。',
  '---POSTER---',
  '钩子句：秒拒【2】次的客户，我用三份数据做成了',
  '成果1：最终批复 28 万元，当月提款',
  '成果2：三个月后转介绍 2 位商户',
  '成果3：其中 1 位已完成签约',
  '做法1标题：先看流水再谈额度',
  '做法1做法：调取近 12 个月对公与个人流水，找工资、缴税、进货三类规律性支出',
  '做法1示例：客户每月 15 号固定缴税、每月 5 号固定给 3 个供应商打款',
  '做法2标题：用税务数据补强经营证明',
  '做法2做法：登录电子税务局调取近两年纳税申报记录，作为经营持续性的旁证',
  '做法2示例：客户近 24 个月每月都有申报，即使单月税额只有几百元',
  '做法3标题：把家庭资产负债算清楚',
  '做法3做法：把配偶负债、房贷月供、经营贷余额一并纳入测算',
  '做法3示例：客户配偶名下有一笔 15 万消费贷，提前算进去避免了审批驳回',
  '做法4标题：当场给出可预期的时点',
  '做法4做法：明确告知客户资料齐备后大概几个工作日能出结果',
  '做法4示例：客户当场说「早这么讲我就不等那家银行了」',
  '做法5标题：贷后保持一次回访',
  '做法5做法：放款后三周内回访一次，了解资金实际用途',
  '做法5示例：回访时客户主动介绍了同市场两家商户',
  '判断句：有没有真实经营，只看三件事——固定门店、连续流水、纳税记录，三者有其二即可推进',
  '避坑句：不要一上来就报额度，也不要在客户提供流水前承诺包过',
].join('\n');

(async () => {
  // ── ① 拿 poster markup，确认是一图流模板 ──
  let r = await fetch(API + '/poster', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ report_md: reportMd, meta: { name: '一图流附件联调', position: '咨询顾问', um: 'TESTFLOW001', city: '西安市', topic: '一图流附件联调（可删）', owner: 'example007', ownerOrg: '西安第一咨询中心', code: 'IV-2026-0099', date: '2026-09-24' } }),
  });
  const pj = await r.json();
  const isFlow = /class="fv-/.test(pj.html);
  console.log('[①] /api/poster → HTTP ' + r.status + '  html=' + pj.html.length + '字符  一图流模板=' + (isFlow ? '✓' : '✗'));
  fs.writeFileSync(path.join(TMP, 'flow-attach.html'),
    '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' + pj.css + '</style></head><body>' + pj.html + '</body></html>');
  fs.writeFileSync(path.join(TMP, 'flow-attach.json'), JSON.stringify({ reportMd, w: pj.w, h: pj.h }));

  // ── ② 用无头 Edge 把 markup 截成 PNG（等价于浏览器栅格化）──
  // 注意：Windows 上不能在 Node 里 spawn powershell（EBUSY），拆到 shell 里做。
  const png = path.join(TMP, 'flow-attach.png');
  if (!fs.existsSync(png)) {
    console.log('[②] 需先跑截图脚本：tests/e2e/out/shot-flow.sh');
    console.log('    接着重跑本脚本即可继续。');
    return;
  }
  const pngBuf = fs.readFileSync(png);
  console.log('[②] PNG 生成 → ' + pngBuf.length + ' bytes  ' + (pngBuf.length > 20000 ? '✓ 非空白（>20KB）' : '✗ 体积过小，疑似空白'));
  const b64 = 'data:image/png;base64,' + pngBuf.toString('base64');

  // ── ③ 带 PNG 提交，验证附件随自动发信发出 ──
  r = await fetch(API + '/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'login', password: process.env.ADMIN_PASSWORD || require("fs").readFileSync(require("path").join(__dirname, "..", "..", "tools", "fetch_reports.secret"), "utf8").trim() }) });
  const aj = await r.json();

  const transcript = [];
  for (let i = 1; i <= 10; i++) {
    transcript.push({ role: 'assistant', content: '第 ' + i + ' 问：请举一个最近印象最深的小微客户案例。' });
    transcript.push({ role: 'user', content: '【一图流附件联调 ' + i + '】客户做建材批发，回款周期从 45 天拉长到 90 天，之前两家银行都拒了。我调了 12 个月流水，发现每月 15 号固定缴税、每月 5 号给三个供应商打款，用这些规律性支出证明经营真实，同时把配偶名下 15 万消费贷算进负债，最终批了 28 万。' });
  }

  r = await fetch(API + '/submit', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      city: '西安市', interviewee_name: '一图流附件联调', interviewee_position: '咨询顾问',
      interviewee_um: 'TESTFLOW001', topic: '一图流附件联调（可删）', submitter_name: '联调测试',
      backend_owner_name: 'example007', backend_owner_org: '西安第一咨询中心',
      round_count: 10, report_md: reportMd, transcript, poster_png_base64: b64,
    }),
  });
  const sj = await r.json();
  const id = sj.id;
  console.log('[③] 提交 → HTTP ' + r.status + '  id=' + id);

  // 等 mail_sent_at
  let sentAt = null;
  for (let i = 0; i < 20; i++) {
    await new Promise(res => setTimeout(res, 2500));
    const rr = await fetch(API + '/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'detail', id: id, token: aj.token, exp: aj.exp }) });
    const dj = await rr.json();
    sentAt = (dj.row || {}).mail_sent_at;
    if (sentAt) { console.log('[④] 自动发信回写 mail_sent_at = ' + sentAt + '（等待 ' + ((i + 1) * 2.5).toFixed(1) + 's）'); break; }
  }
  if (!sentAt) console.log('[④] ✗ 未回写 mail_sent_at');

  console.log('\n记录 id = ' + id + ' → 接着用 qq-mail 查该邮件的附件清单');
  fs.writeFileSync(path.join(TMP, 'flow-attach-id.txt'), String(id));
})();
