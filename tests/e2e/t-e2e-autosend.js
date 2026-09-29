/* 真实端到端：走 /api/submit 提交一份访谈 → 服务端应异步自动发信
   然后轮询 /api/admin list 看 mail_sent_at 是否被回写。 */
const API = 'https://work-d1gs0jzrg2277d75e-1391683363.ap-shanghai.app.tcloudbase.com/api';

const reportMd = [
  '背景与挑战---SECTION---【本次为自动发信联调测试】客户在西安做建材批发，2024 年下半年下游回款周期从 45 天拉长到 90 天，流动资金被压住，此前在两家银行申请都被秒拒，主要原因是无法证明经营真实性。',
  '核心做法---SECTION---【1】先看流水再谈额度\n先让客户把近 12 个月的对公与个人流水打出来，找出发放工资、缴税、固定进货三类规律性支出，用"这三个动作每月都在发生"来反推经营真实性，再谈额度。\n【2】用税务数据补强经营证明\n登录电子税务局调取近两年纳税申报记录，即使金额不大，连续申报本身就是经营持续性的证据。\n【3】把家庭资产负债算清楚\n把配偶负债、房贷月供、经营性贷款余额一并纳入，避免审批时才发现共同借款人负债超标。\n【4】当场给出可预期的时点\n明确告知客户资料齐备后大概几个工作日能出结果，把不确定的审批节点提前讲清楚。\n【5】贷后保持一次回访\n放款后三周内回访一次，了解资金实际用途，为后续转介绍留出触点。',
  '关键判断---SECTION---判断这位客户有没有真实经营，只看三件事：有没有固定门店或仓库、有没有连续 12 个月以上的流水、有没有纳税申报记录。三者有其二即可继续推进，仅有一条就要慎重。',
  '结果---SECTION---最终批复 28 万元，客户当月完成提款，并在三个月后主动转介绍了同市场的两位商户，其中一位已完成签约。',
  '可复制的经验点---SECTION---先建立信任再谈产品；用第三方数据（流水、税务）替代客户自述；把审批节奏透明化，降低客户焦虑。',
  '新人容易踩的坑---SECTION---不要一上来就报额度；不要在客户没提供流水前承诺包过；不要忽略共同借款人的存量负债；不要把客户的行业随口归入禁入清单，要按现行清单逐条核对。',
  '海报摘要---SECTION---钩子句：秒拒两次的客户，我用三份数据做成了\n成果1：最终批复 28 万元，当月提款\n成果2：三个月后转介绍 2 位商户，1 位已签约\n做法1标题：先看流水再谈额度\n做法1做法：调取近 12 个月对公与个人流水，找工资、缴税、进货三类规律性支出\n做法1示例：客户每月 15 号固定缴税、每月 5 号固定给 3 个供应商打款\n做法2标题：用税务数据补强经营证明\n做法2做法：登录电子税务局调取近两年纳税申报记录，作为经营持续性的旁证\n做法2示例：客户近 24 个月每月都有申报，即使单月税额只有几百元\n做法3标题：把家庭资产负债算清楚\n做法3做法：把配偶负债、房贷月供、经营贷余额一并纳入测算\n做法3示例：客户配偶名下有一笔 15 万消费贷，提前算进去避免了审批驳回\n判断句：有没有真实经营，只看三件事——固定门店、连续流水、纳税记录，三者有其二即可推进\n避坑句：不要一上来就报额度，也不要在客户提供流水前承诺包过',
].join('---SECTION---');

const transcript = [];
for (let i = 1; i <= 10; i++) {
  transcript.push({ role: 'assistant', content: '第 ' + i + ' 问：请说一个你最近印象最深的小微客户案例，当时的难点是什么？' });
  transcript.push({ role: 'user', content: '【联调测试回答 ' + i + '】这位客户在西安做建材批发，2024 年下半年下游回款变慢，现金流紧张，之前在两家银行申请都被拒了。我先是让他把近 12 个月的流水打出来，发现每月 15 号固定缴税、每月 5 号固定给三个供应商打款，这些规律性支出能证明经营是真实的，于是我带着这些材料重新递交，同时把配偶名下的 15 万消费贷也算进负债，最终批复了 28 万。' });
}

(async () => {
  // 1) 先拿管理端 token 以便后续查询
  let r = await fetch(API + '/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'login', password: process.env.ADMIN_PASSWORD || require("fs").readFileSync(require("path").join(__dirname, "..", "..", "tools", "fetch_reports.secret"), "utf8").trim() }) });
  const aj = await r.json();
  const auth = { token: aj.token, exp: aj.exp };

  // 2) 提交（模拟真实前端：带海报 PNG 字段，这里用一个极小 PNG 代替，只为验证链路透传）
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const payload = {
    city: '西安市',
    interviewee_name: '联调测试客户A',
    interviewee_position: '咨询顾问',
    interviewee_um: 'TESTAUTO001',
    topic: '自动发信联调测试（可删除）',
    submitter_name: '联调测试',
    backend_owner_name: 'example007',
    backend_owner_org: '西安第一咨询中心',
    round_count: 10,
    report_md: reportMd,
    transcript: transcript,
    poster_png_base64: tinyPng,
  };
  r = await fetch(API + '/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const sj = await r.json().catch(() => ({}));
  console.log('[提交] HTTP ' + r.status + '  ' + JSON.stringify(sj));
  const newId = sj.id;
  if (!newId) { console.log('未拿到 id，终止'); return; }

  // 3) 轮询 mail_sent_at（自动发信是 fire-and-forget，需要等）
  const t0 = Date.now();
  for (let i = 0; i < 24; i++) {
    await new Promise(res => setTimeout(res, 2500));
    const rr = await fetch(API + '/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'detail', id: newId, ...auth }) });
    const dj = await rr.json().catch(() => ({}));
    const row = dj.row || {};
    const waited = ((Date.now() - t0) / 1000).toFixed(1);
    if (row.mail_sent_at) {
      console.log('[自动发信] ✓ 第 ' + (i + 1) + ' 次轮询（等待 ' + waited + 's）mail_sent_at = ' + row.mail_sent_at);
      break;
    }
    if (i % 3 === 0) console.log('  …等待中 ' + waited + 's  mail_sent_at=' + (row.mail_sent_at || 'null'));
    if (i === 23) console.log('[自动发信] ✗ 60s 内未回写 mail_sent_at（可能发信失败或超时）');
  }

  // 4) 幂等验证：再手动发一次（带 skip_if_sent），应返回 skipped
  r = await fetch(API + '/mail', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: newId, skip_if_sent: true, ...auth }) });
  const mj = await r.json().catch(() => ({}));
  console.log('[幂等 skip_if_sent] HTTP ' + r.status + '  ' + JSON.stringify(mj).slice(0, 200));

  console.log('\n测试记录 id = ' + newId + '（可在管理页删除）');
})();
