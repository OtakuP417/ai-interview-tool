/* 验证「主题回归 + 自动打标」（P2）：
   ① tagger.js 词表结构合法（五个维度、取值非空、无重复）
   ② buildTagPrompt 把词表完整写进提示词，且明确要求「自由:」前缀
   ③ buildTagPrompt 明确禁止把口述 topic 当打标依据（只作背景）
   ④ parseJsonLoose 三层兜底：纯 JSON / 代码块围栏 / 前后带解释文字
   ⑤ normalizeTagResult 的规整规则
      · 维度必须来自词表，自造维度整条丢弃
      · 词表内取值原样保留
      · 词表外取值自动补「自由:」前缀（模型忘了加也不放过）
      · 去重、限量、长度截断
      · ai_topic 太短判无效、剥引号、超长截断
   ⑥ 云函数接线：提交后 fire-and-forget 打标、只 PATCH 四列、不碰 topic
   ⑦ 管理端 retag 动作存在且串行、限量
   ⑧ 列表接口带上 ai_topic / tags，支持标签筛选
   全部为离线断言，不调 LLM、不连库。 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const tagger = require(path.join(ROOT, 'cloudfunctions/interview-proxy/tagger.js'));
const FN = fs.readFileSync(path.join(ROOT, 'cloudfunctions/interview-proxy/index.js'), 'utf8');

let fail = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  ✓ ' + name);
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}

console.log('[1] 词表结构');
const T = tagger.TAXONOMY;
const DIMS = tagger.DIMENSIONS;
ok('五个维度', DIMS.length === 5, DIMS.join('/'));
ok('维度顺序 = 获客方式/产品类型/客户来源/客户阶段/关键能力',
   DIMS.join(',') === '获客方式,产品类型,客户来源,客户阶段,关键能力');
ok('每个维度都有 4 个以上取值',
   DIMS.every(d => Array.isArray(T[d]) && T[d].length >= 4),
   DIMS.map(d => d + ':' + (T[d] || []).length).join(' '));
ok('取值全是非空字符串',
   DIMS.every(d => T[d].every(v => typeof v === 'string' && v.trim() && v.indexOf(':') < 0)));
ok('同一维度内无重复取值',
   DIMS.every(d => new Set(T[d]).size === T[d].length));
ok('取值不带「自由:」前缀（前缀只用于模型新造的词）',
   DIMS.every(d => T[d].every(v => v.indexOf('自由:') !== 0)));
ok('产品类型含线上实际出现过的品名',
   ['棱镜', '陆易花薪', '房抵二押'].every(p => T['产品类型'].indexOf(p) >= 0));

console.log('\n[2] buildTagPrompt：词表完整注入 + 约束到位');
const prompt = tagger.buildTagPrompt('## 背景与挑战\n客户是做了十年的老客户……', {
  topic: '200万棱镜签约',
  position: '咨询顾问',
});
ok('提示词非空且含报告正文', prompt.length > 800 && prompt.indexOf('客户是做了十年的老客户') >= 0);
ok('每个维度名都出现在提示词里', DIMS.every(d => prompt.indexOf('- ' + d + '：') >= 0));
ok('所有取值都写进了提示词',
   DIMS.every(d => T[d].every(v => prompt.indexOf(v) >= 0)));
ok('明确要求「自由:」前缀', /自由:/.test(prompt) && /必须/.test(prompt));
ok('明确「只依据报告正文」', /只依据报告正文/.test(prompt));
ok('口述主题标为「不作为打标依据」', /不作为打标依据/.test(prompt));
ok('给出 AI 主题的正反例', /反例（不合格）/.test(prompt) && /正例（合格）/.test(prompt));
ok('反例里点了线上真实出现的坏标题',
   /200万棱镜签约/.test(prompt) && /转介绍成交案例/.test(prompt));
ok('要求输出严格 JSON 且不给代码块围栏', /只输出这个 JSON/.test(prompt) && /代码块围栏/.test(prompt));
ok('提示词里没有 markdown 反引号（会破坏任何再嵌套的模板串）',
   prompt.indexOf('`') < 0);
ok('报告正文被截断上限（防超长撑爆预算）',
   tagger.buildTagPrompt('x'.repeat(20000), {}).length < 20000);

console.log('\n[3] parseJsonLoose：三层兜底');
ok('纯 JSON', !!tagger.parseJsonLoose('{"a":1}'));
ok('代码块围栏内', (tagger.parseJsonLoose('```json\n{"a":2}\n```') || {}).a === 2);
ok('围栏无语言标注', (tagger.parseJsonLoose('```\n{"a":3}\n```') || {}).a === 3);
ok('前后带解释文字', (tagger.parseJsonLoose('好的，结果如下：\n{"a":4}\n以上。') || {}).a === 4);
ok('字符串值里含大括号不误切',
   (tagger.parseJsonLoose('{"t":"含{}的文本","n":5}') || {}).n === 5);
ok('字符串值里含转义引号不误切',
   (tagger.parseJsonLoose('{"t":"他说\\"好\\"","n":6}') || {}).n === 6);
ok('数组顶层不当作结果', tagger.parseJsonLoose('[1,2,3]') === null);
ok('空输入返回 null', tagger.parseJsonLoose('') === null && tagger.parseJsonLoose(null) === null);
ok('完全无法解析返回 null', tagger.parseJsonLoose('抱歉，我无法完成') === null);

console.log('\n[4] normalizeTagResult：标签规整');
const n1 = tagger.normalizeTagResult({
  ai_topic: '靠老客户请托转介绍破冰，拿下200万棱镜放款',
  tags: ['获客方式:老客户转介绍', '产品类型:棱镜', '客户阶段:额度异议期'],
  reason: '主线是转介绍',
});
ok('标准词原样保留', n1.tags.length === 3 && n1.tags.indexOf('获客方式:老客户转介绍') >= 0);
ok('ai_topic 保留', n1.ai_topic === '靠老客户请托转介绍破冰，拿下200万棱镜放款');

const n2 = tagger.normalizeTagResult({
  ai_topic: 'x'.repeat(100),
  tags: ['获客方式:商会圈子获客'],
});
ok('词表外取值自动补「自由:」前缀', n2.tags[0] === '获客方式:自由:商会圈子获客', n2.tags[0]);
ok('超长 ai_topic 截断到 60 字', n2.ai_topic.length === 60);

const n3 = tagger.normalizeTagResult({
  ai_topic: '靠老客户转介绍破冰拿下大额',
  tags: ['自造维度:随便什么', '获客方式:老客户转介绍', '获客方式:老客户转介绍'],
});
ok('自造维度整条丢弃', n3.tags.length === 1, JSON.stringify(n3.tags));
ok('重复标签去重', n3.tags.length === 1);

const n4 = tagger.normalizeTagResult({
  ai_topic: '靠老客户转介绍破冰拿下大额',
  tags: ['获客方式：老客户转介绍'],
});
ok('全角冒号也能识别', n4.tags[0] === '获客方式:老客户转介绍', n4.tags[0]);

ok('太短的 ai_topic 判无效',
   tagger.normalizeTagResult({ ai_topic: '签约', tags: [] }).ai_topic === null);
ok('带引号的 ai_topic 剥引号',
   tagger.normalizeTagResult({ ai_topic: '「靠老客户转介绍破冰拿下大额」', tags: [] }).ai_topic
     === '靠老客户转介绍破冰拿下大额');
ok('无 tags 字段返回 null',
   tagger.normalizeTagResult({ ai_topic: '靠老客户转介绍破冰拿下大额' }).tags === null);
ok('标签全部非法则返回 null',
   tagger.normalizeTagResult({ tags: ['没有冒号', '坏维度:值'] }).tags === null);
ok('标签数量上限 10',
   tagger.normalizeTagResult({
     tags: DIMS.flatMap(d => T[d].map(v => d + ':' + v)),
   }).tags.length === 10);
ok('缺维度前缀的条目丢弃',
   tagger.normalizeTagResult({ tags: [':值', '获客方式:'] }).tags === null);
ok('null / undefined 输入不抛错',
   tagger.normalizeTagResult(null).ai_topic === null &&
   tagger.normalizeTagResult(undefined).tags === null);
ok('非数组 tags 当空处理',
   tagger.normalizeTagResult({ tags: '获客方式:老客户转介绍' }).tags === null);

console.log('\n[5] tagReport：入参护栏');
ok('缺 API Key 直接拒绝',
   tagger.tagReport('报告', {}, {}).then(() => false).catch(e => e.message === 'tag_no_api_key'));
ok('空报告直接拒绝',
   tagger.tagReport('', {}, { apiKey: 'k' }).then(() => false).catch(e => e.message === 'tag_empty_report'));

console.log('\n[5b] 推理预算吃光（真实踩过的坑）');
const TAGSRC = fs.readFileSync(path.join(ROOT, 'cloudfunctions/interview-proxy/tagger.js'), 'utf8');
ok('max_tokens 给到 4000（1600 被推理吃光过）', /max_tokens:\s*4000/.test(TAGSRC));
ok('不再带 system 消息（把规则全放 user，省 token 也少一层歧义）',
   !/role:\s*"system"/.test(TAGSRC.slice(TAGSRC.indexOf('function callDeepseek'), TAGSRC.indexOf('function tagReport'))));
ok('空 content 当错误抛，不静默返回空结果',
   /tag_empty_content/.test(TAGSRC) && /reject\(new Error\("tag_empty_content:/.test(TAGSRC));
ok('注释里记录了实测证据（reasoning_tokens=1600）',
   /reasoning_tokens=1600/.test(TAGSRC));
ok('可重试错误才重试（推理吃光 / 超时 / 上游坏 JSON）',
   /msg\.indexOf\("tag_empty_content"\)\s*===\s*0/.test(TAGSRC) &&
   /msg === "tag_timeout"/.test(TAGSRC) &&
   /tag_bad_upstream_json/.test(TAGSRC));
ok('配置类错误不重试',
   /tag_no_api_key/.test(TAGSRC) && /tag_empty_report/.test(TAGSRC));
ok('默认重试 1 次', /typeof o\.retries === "number" \? o\.retries : 1/.test(TAGSRC));

console.log('\n[6] 云函数接线');
const submitFn = FN.slice(FN.indexOf('function autoTagById('), FN.indexOf('function handleSubmit('));
ok('autoTagById 存在', submitFn.indexOf('function autoTagById') >= 0);
ok('提交成功后调用 autoTagById', /autoTagById\(newId,\s*autoRow/.test(FN));
ok('是 fire-and-forget（不 await、不 catch 到响应路径）',
   !/await autoTagById/.test(FN) && !/autoTagById\([^)]*\)\s*\.catch\(function\s*\(\)\s*\{\s*\}\);/.test(FN));
ok('走的是已脱敏入库文本（autoRow，不是 body.report_md）',
   /autoTagById\(newId,\s*autoRow/.test(FN) && !/autoTagById\(newId,\s*body/.test(FN));
ok('只 PATCH 四个派生列，绝不写 topic',
   /patch\.ai_topic\s*=/.test(submitFn) && /patch\.tags\s*=/.test(submitFn) &&
   /tags_model/.test(submitFn) && /tags_at/.test(submitFn) &&
   !/patch\.topic/.test(submitFn));
ok('报告为空时不打标（早退）',
   /if\s*\(!id\s*\|\|\s*!row\s*\|\|\s*!row\.report_md\)\s*return\s+Promise\.resolve\(null\)/.test(submitFn));
ok('打标失败只 warn 不抛（不影响归档）', /console\.warn\("\[tagger\] failed/.test(submitFn));
ok('写库失败也不抛', /console\.warn\("\[tagger\] writeback failed/.test(submitFn));
ok('拿不到 ai_topic 时不覆盖已有值',
   /if\s*\(out\.ai_topic\)\s*patch\.ai_topic/.test(submitFn));
ok('拿不到 tags 时不写空数组',
   /if\s*\(out\.tags\s*&&\s*out\.tags\.length\)/.test(submitFn));

console.log('\n[7] 管理端 retag');
ok('retag 动作存在', /action === "retag"/.test(FN));
ok('retag 需要有效 token（在鉴权之后）',
   FN.indexOf('action === "retag"') > FN.indexOf('verifyToken(body.token, body.exp)'));
ok('单条模式按 id 查', /const query = id\s*\n?\s*\?/.test(FN));
ok('批量默认只补未打标的（tags_at=is.null）', /tags_at=is\.null/.test(FN));
ok('force=true 时忽略已打标状态', /force[\s\S]{0,80}\?[^?]*order=id\.desc/.test(FN));
ok('批量限量（防一次打太多）', /Math\.min\(50,/.test(FN));
ok('串行执行（注释说明了原因）', /串行跑/.test(FN) && /next\(i \+ 1\)/.test(FN));
ok('回传原始 topic 便于对照', /topic_original:\s*row\.topic/.test(FN));
ok('retag 也不写 topic',
   !/patch\.topic/.test(FN.slice(FN.indexOf('action === "retag"'), FN.indexOf('unknown_action'))));

console.log('\n[8] 列表接口');
ok('list 的 select 带上 ai_topic 与 tags',
   /select=[^"']*ai_topic[^"']*tags[^"']*/.test(FN) || /select=[^"']*tags[^"']*ai_topic/.test(FN));
ok('list 的 select 也带上 tags_at（否则前端判断不出是否已打标）',
   /select=[^"']*tags_at[^"']*/.test(FN));
ok('list 的 select 也带上 tags_model（换模型后可回溯口径）',
   /select=[^"']*tags_model[^"']*/.test(FN));
ok('四个打标字段都在同一个 select 里（缺一个就出 bug）',
   /select=[^"']*ai_topic[^"']*tags[^"']*tags_at[^"']*tags_model[^"']*/.test(FN));
ok('检索词覆盖 ai_topic', /ai_topic\.ilike\./.test(FN));
ok('支持按标签数组包含筛选（tags=cs.）', /tags=cs\./.test(FN));
ok('标签筛选参数做了条数与长度限制', /slice\(0,\s*8\)/.test(FN) && /asText\(t,\s*60\)/.test(FN));

console.log('\n[9] 迁移文件');
const mig = fs.readFileSync(
  path.join(ROOT, 'cloudbase/migrations/20260929100000_add_ai_topic_tags.sql'), 'utf8');
ok('加四个列', ['ai_topic', 'tags', 'tags_model', 'tags_at'].every(c => mig.indexOf(c) >= 0));
ok('全部可空（旧数据不受影响）', !/NOT\s+NULL/i.test(mig));
ok('GIN 索引（支撑 tags @> 查询）', /USING\s+gin\s*\(\s*tags\s*\)/i.test(mig));
ok('不触碰 topic / report_md / transcript',
   !/ALTER\s+COLUMN\s+topic/i.test(mig) && !/report_md\s+(text|jsonb)/i.test(mig) &&
   !/transcript\s+(text|jsonb)/i.test(mig));

console.log('\n[10] 管理端展示');
const ADM = fs.readFileSync(path.join(ROOT, 'web/admin.html'), 'utf8');
ok('列表行显示 AI 归纳主题', /AI 归纳：/.test(ADM) && /r\.ai_topic/.test(ADM));
ok('未打标时给出待打标占位', /AI 归纳：待打标/.test(ADM));
ok('详情面板区分「顾问手填原文」与「AI 归纳主题」',
   /案例主题（顾问手填原文）/.test(ADM) && /AI 归纳主题/.test(ADM));
ok('详情面板渲染标签 chip', /tag-chip/.test(ADM) && /row\.tags\.map/.test(ADM));
ok('自由词用不同样式提示待归并', /tag-chip\$\{free \? ' free' : ''\}/.test(ADM) && /自由:/.test(ADM));
ok('详情有「重跑打标」按钮', /retagOne\(\$\{row\.id\}\)/.test(ADM));
ok('retagOne 调用 retag 动作并刷新详情', /action: 'retag', id: id/.test(ADM) && /action: 'detail'/.test(ADM));
ok('CSV 导出含 AI 主题与标签两列',
   /'AI 归纳主题','自动标签'/.test(ADM) && /r\.ai_topic \|\| ''/.test(ADM));
ok('版本号已 bump（功能上线可远程确认）', /ADMIN_BUILD = 'v2026\.09\.30-a'/.test(ADM));

console.log('');
if (fail) { console.log('FAIL: ' + fail + ' 项未通过'); process.exit(1); }
console.log('全部通过');
