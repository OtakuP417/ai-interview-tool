/* 本地验证：poster.js 的解析与版面生成
   用归档里真实存在的报告做输入，跑完把 HTML 写出来供人工/无头截图查看。 */
const fs = require('fs');
const path = require('path');
const poster = require('../cloudfunctions/interview-proxy/poster');

const ROOT = path.join(__dirname, '..');
const raw = fs.readFileSync(path.join(__dirname, 'tmp', 'r9_raw.md'), 'utf8');

let fail = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  ✓ ' + name);
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

console.log('\n[1] parseReport：六节都要取到');
const sec = poster.parseReport(raw);
poster.SECTION_TITLES.slice(0, 6).forEach(t => {
  ok('节「' + t + '」非空', !!sec[t], JSON.stringify(sec[t] || '').slice(0, 60));
});
ok('背景节不含复述标题', !sec['背景与挑战'].startsWith('背景与挑战'), sec['背景与挑战'].slice(0, 30));
ok('核心做法不含复述标题', !sec['核心做法'].startsWith('核心做法'), sec['核心做法'].slice(0, 30));
ok('老数据（无海报摘要）不报错', sec['海报摘要'] === '', JSON.stringify(sec['海报摘要']));

console.log('\n[2] normalizeTitle：非标准标题要能归位');
ok('「新人注意事项」→ 新人容易踩的坑', poster.normalizeTitle('新人注意事项') === '新人容易踩的坑');
ok('「新人常踩的坑」→ 新人容易踩的坑', poster.normalizeTitle('新人常踩的坑') === '新人容易踩的坑');
ok('「避坑提示」→ 新人容易踩的坑', poster.normalizeTitle('避坑提示') === '新人容易踩的坑');
ok('「可复制的经验点」→ 归位', poster.normalizeTitle('可复制的经验点') === '可复制的经验点');
ok('普通正文不算标题', poster.normalizeTitle('客户因朋友有资金需求') === null);
ok('带编号与井号也能识', poster.normalizeTitle('6. 新人容易踩的坑') === '新人容易踩的坑');
ok('带 markdown 强调也能识', poster.normalizeTitle('**新人注意事项**') === '新人容易踩的坑');

console.log('\n[3] 标题别名节也能取到正文');
const aliasRaw = raw.replace('新人容易踩的坑', '新人注意事项');
const secA = poster.parseReport(aliasRaw);
ok('别名标题节正文非空', secA['新人容易踩的坑'].length > 30, String(secA['新人容易踩的坑'].length));
ok('别名标题行没混进正文', !secA['新人容易踩的坑'].startsWith('新人注意事项'));

console.log('\n[4] buildLayout：截断上限与取值');
const meta = {
  name: 'EXAMPLE001', position: '咨询顾问', um: 'EXAMPLE007',
  city: '西安市', topic: '老客户转介绍',
  owner: 'example007', ownerOrg: '西安第一咨询中心', date: '2026-09-24',
};
const L = poster.buildLayout(raw, meta);
ok('背景非空', L.bg.length > 0);
ok('核心做法 5 条（原文 5 条，上限 5）', L.steps.length === 5, L.steps.length);
ok('核心做法每条 ≤72 宽', L.steps.every(s => s.length <= 73));
ok('结果非空', L.res.length > 0);
ok('避坑 3 条', L.pits.length === 3, L.pits.length);
ok('避坑每条 ≤66 宽', L.pits.every(p => p.length <= 67), L.pits.map(p=>p.length).join(','));

console.log('\n[5] clip：中英混排宽度计算');
ok('中文 5 字内不截断', poster.clip('五字以内', 5) === '五字以内');
ok('超长加省略号', poster.clip('超出上限的内容', 4).endsWith('…'));
ok('英文按 0.55 计（10 字符只需 5.5 宽）', !poster.clip('abcdefghij', 6).endsWith('…'), poster.clip('abcdefghij', 6));

console.log('\n[6] HTML 输出结构完整（老数据 → 降级六节版式）');
const html = poster.renderPoster(raw, meta);
ok('老数据走六节版式', poster.pickLayout(raw, meta) === 'six', poster.pickLayout(raw, meta));
ok('含 DOCTYPE', html.startsWith('<!DOCTYPE html>'));
ok('含 6 个章节标题中的多数', poster.SECTION_TITLES.filter(t => html.includes(t)).length >= 5,
   poster.SECTION_TITLES.filter(t => html.includes(t)).join(','));
ok('含案例经验萃取徽标', html.includes('案例经验萃取'));
ok('含姓名', html.includes('EXAMPLE001'));
ok('含主题', html.includes('老客户转介绍'));
ok('没有 XSS 未转义（尖括号被转义）', !/<script/i.test(html));
// 后线对接人 meta.owner 是 UM 形态（归档数据填错）→ 必须整段隐藏
ok('后线对接人为 UM 形态时整段隐藏', !html.includes('后线对接'),
   'owner=' + meta.owner);

console.log('\n[6b] 后线对接人为真实姓名时正常显示');
const metaNamed = Object.assign({}, meta, { owner: '刘龙刚', ownerOrg: '咸阳安康营业部' });
ok('真实姓名时显示后线对接', poster.renderPoster(raw, metaNamed).includes('后线对接'));
ok('显示的是人名而非 UM', poster.renderPoster(raw, metaNamed).includes('刘龙刚'));

console.log('\n[7] 邮件版 HTML');
const emailHtml = poster.renderPosterEmail(raw, meta);
ok('邮件版也含版式', emailHtml.includes('iv-page'));
ok('邮件版含 style', emailHtml.includes('<style>'));
ok('邮件版不含 DOCTYPE（要能嵌进行内）', !emailHtml.includes('<!DOCTYPE'));

fs.writeFileSync(path.join(__dirname, 'tmp', 'poster-r9.html'), html);
fs.writeFileSync(path.join(__dirname, 'tmp', 'poster-email-r9.html'),
  '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' + emailHtml + '</body></html>');

/* ─────────────────────────────────────────────────────────────
   [8] 一图流版式（新报告带「海报摘要」节）
   ───────────────────────────────────────────────────────────── */
console.log('\n[8] 一图流：解析海报摘要');
const flowRaw = raw + '\n---SECTION---\n海报摘要\n' + [
  '钩子句：额度不大的老客户，也能转介绍出【100万】',
  '成果1：100万|成功放款',
  '成果2：老客户|客户来源 · 主动转介绍',
  '成果3：靠谱 专业|客户对顾问的评价',
  '做法1标题：节日送小礼',
  '做法1做法：端午、过年送公司小礼品，借上门机会宣导产品政策',
  '做法1示例：不空手上门，礼品随身带着，聊完近况顺口提一句政策',
  '做法2标题：日常点赞',
  '做法2做法：持续给客户朋友圈点赞评论，保持存在感，不推销',
  '做法2示例：看到客户发经营动态就点个赞，逢节日私发一句问候',
  '做法3标题：请客户拉群',
  '做法3做法：关系熟了以后请老客户帮忙拉群，接触身边的潜在资源',
  '做法3示例：话术："哥，你身边有做生意的朋友要资金，拉个群我帮看看"',
  '判断句：维护老客户不能只靠一次性成交，要长期经营关系。',
  '避坑句：别只在有业务需求时才联系，平时没互动关键时刻想不起你。',
].join('\n');

const S = poster.parsePosterSummary(flowRaw);
ok('摘要解析成功', !!S);
ok('钩子句解析', S.hook.includes('额度不大的老客户'), S.hook);
ok('钩子数字单独提出', S.hookNum === '100万', S.hookNum);
ok('成果 3 格', S.results.length === 3, S.results.length);
ok('成果按 | 拆成键值', S.results[0].k === '100万' && S.results[0].v === '成功放款',
   JSON.stringify(S.results[0]));
ok('做法 3 条', S.actions.length === 3, S.actions.length);
ok('每条做法三段齐全', S.actions.every(a => a.t && a.d && a.x));
ok('判断句/避坑句解析', !!S.judge && !!S.pit);
ok('无摘要节时返回 null', poster.parsePosterSummary(raw) === null);

console.log('\n[9] 一图流：版式与降级');
const flowHtml = poster.renderPoster(flowRaw, meta);
ok('新数据走一图流版式', poster.pickLayout(flowRaw, meta) === 'flow', poster.pickLayout(flowRaw, meta));
ok('含一图流根类 fv-page', flowHtml.includes('fv-page'));
ok('含页眉徽标「经验萃取」', flowHtml.includes('经验萃取'));
ok('品牌条左为「陕分业务营销部训练室」', flowHtml.includes('陕分业务营销部训练室'));
ok('品牌条右为「实战经验一图流」', flowHtml.includes('实战经验一图流'));
ok('含钩子数字高亮', flowHtml.includes('100万'));
ok('做法卡带「例」标', flowHtml.includes('fv-q') && flowHtml.includes('例'));
ok('一图流不含六节版式的 iv-page', !flowHtml.includes('iv-page'));
ok('UM 形态 owner 在一图流里也隐藏', !flowHtml.includes('后线对接'));
ok('主题出现在副题位', flowHtml.includes('老客户转介绍'));
ok('一图流无 XSS 未转义', !/<script/i.test(flowHtml));

const flowEmail = poster.renderPosterEmail(flowRaw, meta);
ok('邮件版也走一图流', flowEmail.includes('fv-page') && !flowEmail.includes('iv-page'));
ok('邮件版一图流不含 DOCTYPE', !flowEmail.includes('<!DOCTYPE'));

fs.writeFileSync(path.join(__dirname, 'tmp', 'poster-flow.html'), flowHtml);
console.log('\n产物：tests/tmp/poster-r9.html / poster-email-r9.html / poster-flow.html');

process.exit(fail ? 1 : 0);

console.log('\n' + (fail ? '✗ ' + fail + ' 项失败' : '✓ 全部通过'));
process.exit(fail ? 1 : 0);
