/* 验证「管理端 AI 辅助修改报告」（2026-10-10 新增）：
   需求：除了手工改正文，还能用一句话让 AI 改 —— 「把结果节的 30% 改成 32%」
   「补一句这客户是老客户转介绍」，然后据此重新出报告。
   硬约束：**只按指令落地，不许自行添加内容、不许幻觉**。

   这组断言守的就是那条硬约束怎么被代码保证的：

   ① 模型永远不输出全文，只输出补丁（{sec, op, before, after}）
      —— 没被点到的段落由前端原样保留，「顺手改写别处」不可能发生
   ② before 必须在原文里逐字定位得到（indexOf），定位不到就停用那一条
      —— 不让模型对「改哪里」的叙述直接生效
   ③ 每条改动必须写出对应哪条指令（why），写不出的进 unclear 不进 ops
   ④ ai_edit 分支**只生成补丁、绝不写库**：落地一律复用 update 的
      report_rev / report_orig 留痕链路，不给 AI 改过的正文开暗道
   ⑤ 前端应用改动后不直接保存，而是填进「编辑报告正文」的文本框
   ⑥ 应用前再校验一次分隔符 ≥5（防把整节删掉）

   全部为源码级 + 纯函数级断言，不连库、不调模型。 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FN = fs.readFileSync(path.join(ROOT, 'cloudfunctions/interview-proxy/index.js'), 'utf8');
const ADM = fs.readFileSync(path.join(ROOT, 'web/admin.html'), 'utf8');
const MOD = require(path.join(ROOT, 'cloudfunctions/interview-proxy/ai-editor.js'));

let fail = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  ✓ ' + name);
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}

/* 把 ai_edit 分支整段切出来，断言只看这一段，避免误命中 update 分支 */
const aiStart = FN.indexOf('action === "ai_edit"');
const aiEnd = FN.indexOf('sendJson(res, 400, { error: "unknown_action" })');
const AIB = FN.slice(aiStart, aiEnd);

/* 管理端 AI 面板整段 */
const adStart = ADM.indexOf('/* ─── AI 辅助修改报告正文');
const adEnd = ADM.indexOf("/** 展开/收起「模型原文」对照");
const ADP = ADM.slice(adStart, adEnd);

console.log('[1] 服务端：补丁生成器');
ok('ai-editor.js 已就位并被 index.js 引用',
   /require\("\.\/ai-editor"\)/.test(FN) && typeof MOD.editReport === 'function');
ok('导出齐全（editReport / normalizeOps / normalizeSections / 提示词构造）',
   typeof MOD.editReport === 'function' && typeof MOD.normalizeOps === 'function' &&
   typeof MOD.normalizeSections === 'function' && typeof MOD.buildPatchPrompt === 'function' &&
   typeof MOD.buildSectionPrompt === 'function');

/* 三条铁律必须落在提示词里，且措辞要是「硬话」——
   这类模型的默认行为就是顺手润色，软性措辞压不住 */
const P = MOD.buildPatchPrompt(['甲节正文', '乙节正文', '丙节正文'], '把第 2 节的 X 改成 Y', []);
ok('铁律：不许动没点到的内容', /其余内容一个字都不许动/.test(P));
ok('铁律：不许新增用户没提供的事实', /不许新增用户没有提供的事实/.test(P));
ok('铁律：before 必须逐字原句（系统会拿它精确定位）', /逐字原句/.test(P) && /精确定位/.test(P));
ok('铁律：对不上指令的改动要写进 unclear，不许猜着改', /写进 unclear/.test(P) && /宁可空手而归/.test(P));
ok('输出格式要求：只输出 JSON、禁止 markdown 围栏', /只输出一个 JSON 对象/.test(P) && /代码块围栏/.test(P));
ok('op 只有 replace / insert_after / delete 三种', /"replace"/.test(P) && /"insert_after"/.test(P) && /"delete"/.test(P));
ok('报告正文按节带序号给出（模型要能指到第几节）', /【第 1 节 · 背景与挑战】/.test(P) && /【第 3 节/.test(P));

/* 重写模式：只能碰被点名的节 */
const PS = MOD.buildSectionPrompt(['甲节', '乙节', '丙节', '丁节'], [2, 4], '补充：客户是 2023 年老客户', []);
ok('重写模式只把被点名的节给模型', /【第 2 节/.test(PS) && /【第 4 节/.test(PS) && !/【第 1 节/.test(PS) && !/【第 3 节/.test(PS));
ok('重写模式明说其余节不许出现在输出里', /其余节一个字都不许出现在输出里/.test(PS));
ok('两条提示词都带完整铁律', /其余内容一个字都不许动/.test(PS) && /不许新增用户没有提供的事实/.test(PS));

console.log('[2] 服务端：补丁规整（宁缺毋滥）');
const good = { sec: 2, op: 'replace', before: '转化率 30%', after: '转化率 32%', why: '对应指令 1' };
ok('合法补丁保留', MOD.normalizeOps({ ops: [good] }, 7).length === 1);
ok('正文原样切段，不补齐也不截断',
   MOD.splitSections('a---SECTION---b').length === 2 &&
   MOD.splitSections('a---SECTION---b---SECTION---c---SECTION---d---SECTION---e---SECTION---f---SECTION---g').length === 7);

const drop = function (o, name) {
  const n = MOD.normalizeOps({ ops: [o] }, 7).length;
  ok(name, n === 0, '仍保留了 ' + n + ' 条');
};
drop({ sec: 2, op: 'rewrite_all', before: 'x', after: 'y' }, '丢掉非法 op（不许自造 op 类型）');
drop({ sec: 0, op: 'replace', before: 'x', after: 'y' }, '丢掉节序号越界（0）');
drop({ sec: 9, op: 'replace', before: 'x', after: 'y' }, '丢掉节序号越界（超过节数）');
drop({ sec: 2, op: 'replace', before: '', after: 'y' }, '丢掉没有锚点 before 的补丁（无法定位）');
drop({ sec: 2, op: 'replace', before: 'x', after: 'x' }, '丢掉「改了个寂寞」的补丁');
drop({ sec: 2, op: 'replace', before: '   ', after: 'y' }, '丢掉只有空白的锚点');

const dup = MOD.normalizeOps({ ops: [good, Object.assign({}, good, { after: '转化率 35%' })] }, 7);
ok('同一节同一锚点只取第一条（防二次替换把正文改乱）', dup.length === 1 && dup[0].after === '转化率 32%');

ok('delete 的 after 归零成空串', MOD.normalizeOps({ ops: [{ sec: 1, op: 'delete', before: 'x', after: 'y' }] }, 7)[0].after === '');
ok('insert_after 不受「before===after」这条规则误伤',
   MOD.normalizeOps({ ops: [{ sec: 1, op: 'insert_after', before: 'x', after: 'x' }] }, 7).length === 1);

const many = MOD.normalizeOps({ ops: new Array(80).fill(0).map((_, i) => ({
  sec: 1, op: 'replace', before: '锚点' + i, after: '新' + i,
})) }, 7);
ok('补丁条数有上限（防一次刷爆正文）', many.length <= 40 && many.length > 0, '得到 ' + many.length);

/* 重写模式：模型给了没点名的节，也不收 */
const secs = MOD.normalizeSections({ sections: [
  { sec: 2, body: '重写后的二节' },
  { sec: 1, body: '模型顺手重写的一节' },
  { sec: 4, body: '' },
] }, [2], 7);
ok('重写模式：没点名的节一律丢弃', secs.length === 1 && secs[0].sec === 2);
ok('重写模式：空正文丢弃', MOD.normalizeSections({ sections: [{ sec: 2, body: '   ' }] }, [2], 7).length === 0);

console.log('[3] 服务端：入口参数校验');
const rejects = function (p, name) {
  return MOD.editReport(p).then(
    function () { ok(name, false, '竟然通过了'); },
    function (e) { ok(name, /^ai_edit_/.test(String(e && e.message))); }
  );
};
Promise.all([
  rejects({ reportMd: 'x', instruction: 'y' }, '缺 apiKey 直接拒绝'),
  rejects({ apiKey: 'k', instruction: 'y' }, '空报告拒绝'),
  rejects({ apiKey: 'k', reportMd: 'x' }, '空指令拒绝'),
  rejects({ apiKey: 'k', reportMd: 'x', instruction: 'y', mode: 'section', targets: [] },
          '重写模式没点名节 → 拒绝'),
]).then(function () {

console.log('[4] 服务端：ai_edit 只生成补丁，绝不写库');
ok('ai_edit 分支存在', aiStart > 0 && aiEnd > aiStart);
ok('★ 分支内没有任何写库调用（不出现 PATCH / POST）',
   !/pgRequest\(\s*"PATCH"/.test(AIB) && !/pgRequest\(\s*"POST"/.test(AIB) &&
   !/pgRequest\(\s*'PATCH'/.test(AIB) && !/pgRequest\(\s*'POST'/.test(AIB));
ok('★ 只读库：正文从库里取，不信前端传的 report_md',
   /pgRequest\("GET",\s*"id=eq\."\s*\+\s*id[^)]*select=report_md/.test(AIB));
ok('★ 分支落在 token 校验之后（不是无鉴权接口）',
   FN.indexOf('verifyToken(body.token, body.exp)') < aiStart);
ok('只接受 patch / section 两种模式，其余归 patch（不做计划外的事）',
   /asText\(body\.mode, 20\) === "section" \? "section" : "patch"/.test(AIB));
ok('指令有长度上限', /asText\(body\.instruction, 4000\)/.test(AIB));
ok('历史对话截断到最近 8 条（防撑爆补丁预算）', /body\.history\.slice\(-8\)/.test(AIB));
ok('「没有需要改的地方」当正常结果回 200（要让人看到这句话）',
   /ai_edit_no_change/.test(AIB) && /sendJson\(res, 200/.test(AIB));
ok('真正的失败（上游错/超时）才回 5xx', /error: "ai_edit_failed"/.test(AIB));

console.log('[5] 管理端：入口与面板');
ok('详情页有「AI 辅助修改」按钮', /onclick="openAiEdit\(\)"[^>]*>AI 辅助修改</.test(ADM));
ok('有独立的容器 #ai-box', /<div id="ai-box" style="display:none"><\/div>/.test(ADM));
ok('两种模式都给到：定点修改 / 按补充重写指定节',
   /定点修改/.test(ADP) && /按补充重写指定节/.test(ADP));
ok('重写模式先选要重写哪几节', /ai-secs-wrap/.test(ADP) && /aiSyncSecs/.test(ADP));
ok('模型给的改动逐条列出、可单独取消', /aiPick\(/.test(ADP) && /type="checkbox"/.test(ADP));
ok('每条改动带「依据：某条指令」', /依据：/.test(ADP) && /o\.why/.test(ADP));
ok('定位不到原句的改动会标红并停用',
   /原文里找不到这句/.test(ADP) && /disabled/.test(ADP) && /ok: hits > 0/.test(ADP));
ok('锚点在原文出现多次时给出提醒', /只会替换第一处/.test(ADP));
ok('模型没把握的地方单独列出来', /模型没把握/.test(ADP));

console.log('[6] 管理端：落地必须走原有的留痕链路');
ok('★ aiApply 不直接调保存接口', !/api\(\s*\{\s*action:\s*'update'/.test(ADP) && !/action: "update"/.test(ADP));
ok('★ 应用改动 = 填进 #rep-md 文本框，再由人点「保存正文」',
   /document\.getElementById\('rep-md'\)/.test(ADP) && /openReportEdit\(\)/.test(ADP) &&
   /ta\.value = md/.test(ADP));
ok('应用前再校验一次分隔符 ≥5（防把整节删掉）',
   /const secCount = \(md\.match\(\/---SECTION---\/g\) \|\| \[\]\)\.length/.test(ADP) &&
   /if \(secCount < 5\)/.test(ADP));
ok('应用前先在原文里逐字定位（indexOf），定位不到就跳过',
   /parts\[s\]\.indexOf\(o\.before\)/.test(ADP) && /at < 0/.test(ADP));
ok('三种 op 都有落地实现：replace / insert_after / delete / rewrite',
   /o\.op === 'delete'/.test(ADP) && /o\.op === 'insert_after'/.test(ADP) &&
   /o\.op === 'rewrite'/.test(ADP) && /parts\[s\]\.slice\(0, at\) \+ o\.after/.test(ADP));

console.log('[7] 管理端：状态卫生');
ok('换一条记录时清空 AI 对话历史（否则上一条的语境会串进来）',
   /ai\.history = \[\];/.test(ADM.slice(ADM.indexOf('async function openDetail'), ADM.indexOf('function closeDrawer'))));
ok('打开基础信息/正文编辑器时收起 AI 面板',
   /closeAiEdit\(\);/.test(ADM.slice(ADM.indexOf('function openEdit'), ADM.indexOf('async function saveEdit'))) &&
   /closeAiEdit\(\);/.test(ADM.slice(ADM.indexOf('function openReportEdit'), ADM.indexOf('function closeReportEdit'))));
ok('AI 面板内容全部经 esc() 转义（模型输出当不可信文本对待）', /esc\(trunc\(o\.before/.test(ADP) && /esc\(trunc\(o\.after/.test(ADP));
ok('版本号已 bump 到 v2026.10.12-c', /ADMIN_BUILD = 'v2026\.10\.12-c'/.test(ADM));

console.log(fail ? '\n✗ ' + fail + ' 项失败' : '\n✓ 全部通过');
process.exit(fail ? 1 : 0);
});
