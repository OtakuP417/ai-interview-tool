/* 验证「管理端搜索 AI 主题与标签」（2026-09-30 新增）：
   ① 前端存在独立的搜索框，且与「关键词」框语义分离（不共用一个输入）
   ② 搜索范围严格限定在 ai_topic + tags —— 不得把 topic(顾问原文)/姓名/UM 也搜进来
   ③ 服务端只对「维度:取值」形式的片段走 tags=cs.（数组包含，走 GIN 索引）
   ④ 半截词（无冒号）不传服务端，避免 cs 精确匹配拿不到结果
   ⑤ 本地过滤覆盖 ai_topic 与 tags 两处，任一中即命中
   ⑥ 命中标记：主题命中出 badge、标签命中出高亮 chip
   ⑦ 高亮先转义再替换（防 XSS）
   ⑧ 清空按钮 / 重置按钮回到未搜索态
   ⑨ 版本号已 bump
   全部为源码级断言，不连库、不调 LLM。 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ADM = fs.readFileSync(path.join(ROOT, 'web/admin.html'), 'utf8');

let fail = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  ✓ ' + name);
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}

console.log('[1] 搜索框存在且与关键词分离');
ok('有独立的 AI 搜索输入框 #f-ai', /id="f-ai"/.test(ADM));
ok('标签文案点明搜索范围是「AI 主题与标签」', /搜索 AI 主题与标签/.test(ADM));
ok('原「关键词」框保留且未被复用',
   /id="f-q"/.test(ADM) && /关键词（主题 \/ 被访谈人 \/ UM 号 \/ 后线对接人）/.test(ADM));
ok('两个框是不同的 DOM 节点（没有合并成一个）',
   /id="f-q"/.test(ADM) && /id="f-ai"/.test(ADM) && ADM.indexOf('id="f-q"') !== ADM.indexOf('id="f-ai"'));
ok('placeholder 给出可照抄的示例', /老客户转介绍 \/ 棱镜 \/ 长期关系保温/.test(ADM));
ok('有搜索图标与清空按钮', /search-icon/.test(ADM) && /id="f-ai-clear"/.test(ADM));
ok('有输入提示行', /id="f-ai-hint"/.test(ADM));

console.log('\n[2] ★ 搜索范围严格限定（不得越界搜到顾问手填原文）');
ok('本地过滤只读 r.tags 与 r.ai_topic',
   /const tags = Array\.isArray\(row\.tags\) \? row\.tags : \[\]/.test(ADM) &&
   /const topics = row\.ai_topic \? \[row\.ai_topic\] : \[\]/.test(ADM));
/* 把 matchAiNote 整段切出来，确认里面没出现其他字段 */
const mStart = ADM.indexOf('function matchAiNote');
const mEnd = ADM.indexOf('function markHit');
const MATCH = ADM.slice(mStart, mEnd);
ok('matchAiNote 函数存在', mStart > 0 && mEnd > mStart);
ok('★ matchAiNote 内不出现 topic（顾问原文）',
   !/\brow\.topic\b/.test(MATCH));
ok('★ matchAiNote 内不出现 interviewee_name / um / backend_owner',
   !/interviewee_name/.test(MATCH) && !/interviewee_um/.test(MATCH) && !/backend_owner/.test(MATCH));
ok('★ matchAiNote 内不出现 report_md（不应搜全文）', !/report_md/.test(MATCH));
ok('★ 搜索词不写进 payload.q（避免命中姓名/UM 等原有字段）',
   !/payload\.q\s*=\s*[^;]*f-ai/.test(ADM));
ok('payload.q 仍只来自 #f-q', /q:\s*document\.getElementById\('f-q'\)\.value\.trim\(\)/.test(ADM));

console.log('\n[3] 服务端查询：只对精确标签走 cs');
ok('有 aiTerms 拆分函数', /function aiTerms/.test(ADM));
ok('空格分隔多词', /\.split\(\/\\s\+\//.test(ADM));
ok('中文全角冒号归一为英文冒号', /replace\(\/\[：\]\/g, ':'\)/.test(ADM));
ok('★ 只有含冒号的片段才进 payload.tags（走 cs 精确匹配）',
   /const exactTags = terms\.filter\(t => t\.indexOf\(':'\) > 0\)/.test(ADM));
ok('★ 半截词不传服务端（否则 cs 拿不到候选）',
   /if \(exactTags\.length\) payload\.tags = exactTags\.slice\(0, 8\)/.test(ADM));
ok('标签数量上限 8（与服务端 slice(0,8) 对齐）', /exactTags\.slice\(0, 8\)/.test(ADM));

console.log('\n[4] 本地过滤：主题 + 标签两处都参与');
ok('ai_topic 参与匹配', /topics\.some\(x => x\.toLowerCase\(\)\.indexOf\(lower\) >= 0\)/.test(ADM));
ok('tags 参与匹配（子串，不是全等）',
   /tags\.filter\(x => x\.toLowerCase\(\)\.indexOf\(lower\) >= 0\)/.test(ADM));
ok('大小写不敏感', /toLowerCase\(\)/.test(ADM) && /toLowerCase\(\)/.test(MATCH));
ok('命中结果去重', /\[\.\.\.new Set\(hitTags\)\]/.test(ADM) && /\[\.\.\.new Set\(hitTopics\)\]/.test(ADM));
ok('★ 多词是 AND 语义：任一词无落点即整条不匹配',
   /if \(!tagHit\.length && !topicHit\) return null/.test(ADM));
ok('★ 不是 OR 语义（旧写法：累计后判断总数）',
   !/if \(!hitTags\.length && !hitTopics\.length\) return null/.test(MATCH));
ok('每词都要先在主题里算出落点变量再判断', /const topicHit = topics\.some/.test(MATCH));
ok('提示文案说明多词是「同时满足」', /多个词用空格隔开，表示要同时满足/.test(ADM));
ok('已注明为何不用 OR（可回溯决策）', /多词是「同时满足」\(AND\)，不是「任一满足」\(OR\)/.test(ADM));

console.log('\n[5] 结果里的命中标记');
ok('有命中台账 aiHits', /let aiHits = Object\.create\(null\)/.test(ADM));
ok('主题命中出 badge', /hit-badge">主题命中/.test(ADM));
ok('标签命中用高亮 chip 展示', /hit-tags/.test(ADM) && /markHit\(t, terms\)/.test(ADM));
ok('标签过多时折叠', /note\.tags\.length > 4/.test(ADM));
ok('AI 归纳主题里的命中片段也高亮', /markHit\(r\.ai_topic, terms\)/.test(ADM));

console.log('\n[6] 安全性：先转义再高亮');
ok('★ markHit 先 esc 再 replace（防注入）',
   /let out = esc\(text\)/.test(ADM) && /out\.replace\(re, '<span class="hit-on">\$1<\/span>'\)/.test(ADM));
/* 用字符串判据而不是正则 —— 目标代码本身就是正则字面量，
   嵌套转义极易写错断言（本轮实测：断言比被测代码更难写对）。 */
const ESC_LINE = ADM.split('\n').find(l => l.indexOf('const re = new RegExp') >= 0) || '';
ok('★ 正则元字符已转义',
   ESC_LINE.indexOf('t.replace(/[.*+?^${}()|[\\]\\\\]/g') >= 0 &&
   ESC_LINE.indexOf("'\\\\$&'") >= 0,
   ESC_LINE.trim().slice(0, 90));
ok('★ 高亮用 replaceAll 语义（gi 全局）', /'gi'\)/.test(ESC_LINE));
ok('高亮结果未被再次 esc（避免标签被当文本转义）',
   !/esc\(markHit/.test(ADM));

console.log('\n[7] 交互闭环');
ok('输入即反馈（oninput）', /oninput="onAiInput\(\)"/.test(ADM));
ok('回车即查询', /if\(event\.key==='Enter'\)loadList\(\)/.test(ADM));
ok('onAiInput 控制清空按钮显隐', /f-ai-clear'\)\.hidden = !v/.test(ADM));
ok('★ 重置按钮会清空 AI 搜索框', /clearAiSearch\(false\)/.test(ADM) &&
   /function resetFilters[\s\S]{0,260}clearAiSearch\(false\)/.test(ADM));
ok('清空搜索后重新查询', /if \(reload !== false\) loadList\(\)/.test(ADM));
ok('无结果时给出明确文案',
   /AI 主题\/标签里没有匹配/.test(ADM));
ok('已按标签精确筛时在统计行说明', /已按标签精确筛/.test(ADM));

console.log('\n[8] 版本与样式');
ok('★ 版本号已 bump 到 v2026.10.12-b', /ADMIN_BUILD = 'v2026\.10\.12-b'/.test(ADM));
ok('搜索框样式已定义', /\.search-box/.test(ADM) && /\.search-clear/.test(ADM));
ok('命中高亮样式已定义', /\.hit-on/.test(ADM) && /\.hit-badge/.test(ADM));
ok('窄屏下筛选区会竖排（未破坏响应式）', /\.filters \{ flex-direction: column/.test(ADM));
ok('已注明为何不用服务端 ilike（可回溯决策）',
   /PostgREST 不支持对 text\[\] 列做 ilike/.test(ADM));

console.log('');
if (fail) { console.log('FAIL: ' + fail + ' 项未通过'); process.exit(1); }
console.log('全部通过');
