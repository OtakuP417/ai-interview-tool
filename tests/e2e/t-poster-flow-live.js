/* 用带「海报摘要」的报告验证线上 /api/poster 走一图流模板 */
const fs = require('fs');
const API = 'https://work-d1gs0jzrg2277d75e-1391683363.ap-shanghai.app.tcloudbase.com/api';

const reportMd = [
  '背景与挑战---SECTION---客户在西安做建材批发，2024 年下半年下游回款周期拉长，现金流吃紧，此前在两家银行申请都被秒拒。',
  '核心做法---SECTION---【1】先看流水再谈额度\n【2】用税务数据补强经营证明\n【3】把家庭资产负债算清楚\n【4】当场给出可预期的时点\n【5】贷后保持一次回访',
  '关键判断---SECTION---判断这位客户有没有真实经营，只看三件事：有没有固定门店、有没有连续流水、有没有纳税记录。',
  '结果---SECTION---最终批复 28 万元，客户当月完成提款，并在三个月后转介绍了同市场的两位商户。',
  '可复制的经验点---SECTION---先建立信任再谈产品，把不确定的审批节点提前讲清楚。',
  '新人容易踩的坑---SECTION---不要一上来就报额度；不要在客户没提供流水前承诺包过；不要忽略共同借款人的负债。',
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
  '做法4示例：客户当场说「你们要是早这么讲我就不等那家银行了」',
  '做法5标题：贷后保持一次回访',
  '做法5做法：放款后三周内回访一次，了解资金实际用途',
  '做法5示例：回访时客户主动介绍了同市场两家商户',
  '判断句：有没有真实经营，只看三件事——固定门店、连续流水、纳税记录，三者有其二即可推进',
  '避坑句：不要一上来就报额度，也不要在客户提供流水前承诺包过',
].join('\n');

(async () => {
  const r = await fetch(API + '/poster', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ report_md: reportMd, meta: {
      name: '赵小明', position: '咨询顾问', um: 'ZHAOXM001', city: '西安市',
      topic: '小微企业主续贷提额', owner: '赵示例', ownerOrg: '咸阳安康营业部',
      code: 'IV-2026-0013', date: '2026-09-24' } }),
  });
  const pj = await r.json();
  console.log('HTTP ' + r.status + '  html=' + pj.html.length + '字符');
  const checks = [
    ['一图流模板 (iv-flow)', /iv-flow|flow-hook|flow-act/.test(pj.html)],
    ['钩子句数字内联', pj.html.includes('秒拒') && pj.html.includes('2')],
    ['做法5条', (pj.html.match(/flow-act/g) || []).length >= 5 || (pj.html.match(/act-n/g) || []).length >= 5],
    ['示例「例」标', pj.html.includes('例')],
    ['后线对接显示', pj.html.includes('赵示例')],
  ];
  for (const [n, ok] of checks) console.log((ok ? '  ✓ ' : '  ✗ ') + n);
  fs.writeFileSync(path.join(__dirname, 'out', 'poster-live-flow.html'),
    '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' + pj.css + '</style></head><body>' + pj.html + '</body></html>');
  console.log('已写 tests/e2e/out/poster-live-flow.html');
})();
