/**
 * 主题聚焦自检（2026-10-10）
 *
 * 事故背景：把全库 13 份访谈逐轮拆开看，主题只在开场白出现一次，之后就全程
 * 让位给通用的八步框架（背景→做法→结果→决策→可复制→坑→收尾）。后果：
 *   ① 主题里的量化目标 0 次被追问 —— 「转化率高」「占一半」「占比45%」三份都没问到
 *      "这个数怎么来的、跟谁比、靠什么支撑"；
 *   ② 报告端出现自相矛盾 —— #16 结果节写"访谈中未提供量化结果"，同一份的背景节
 *      又写"法人进件占她业务的一半"；#18 结果节干脆自己标注"（本次访谈主题中给出的数字）"；
 *   ③ 主题写得含糊时系统零兜底 —— #18 主题「受薪客群」被 AI 说成「寿星客群」再变
 *      「星客群」，#19「转化率高」被补成"这次转化率高的案例"就开聊了。
 *
 * 所以这一套断言守的是「主题必须是访谈的主线」，不是"提过一句"。
 * 另附本次一起做的稳定性修复：未完成访谈不许出报告、回复质量兜底。
 * 兜底判据在 2026-10-10 全库回扫 198 轮后收窄：只拦空回复 / 实质问题 >= 3 /
 * 半句话 / "（接着问）"类排版标记（原「问号 >1」会误拦 56% 的正常轮次）。
 */
const fs = require('fs');
const path = require('path');

let pass = 0;
let fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (extra ? '  → ' + extra : '')); }
}

const web = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
const srv = fs.readFileSync(
  path.join(__dirname, '..', 'cloudfunctions', 'interview-proxy', 'index.js'), 'utf8');

console.log('\n[1] SYSTEM_PROMPT：主题是主线，不是开场寒暄');
{
  ok(/【这次访谈要回答什么 · 主线】/.test(web), '有「这次访谈要回答什么 · 主线」专章');
  ok(/【开场必须先确认主题 · 不许自己替对方解释】/.test(web), '有「开场必须先确认主题」专章');
  ok(/【每一轮都要能挂回主题】/.test(web), '有「每一轮都要能挂回主题」专章');
  ok(/【主题里带数字或结论时，必须问出它的来路】/.test(web), '有「主题里的数字必须问来路」专章');

  // 开场确认的要求必须落到实处：原样引用 + 不许改写
  ok(/原样引用主题里的词/.test(web), '要求复述主题时原样引用主题里的词');
  ok(/不许替换同音字、近义词/.test(web), '明令禁止替换同音字/近义词（#18「受薪→寿星」的教训）');
  ok(/以他的说法为准/.test(web), '对方纠正后以对方说法为准');

  // 模型自拆子问题（P3 的主路，取代硬编码关键词表）
  ok(/拆成 2-3 个"必须问出来的子问题"/.test(web), '要求开场前把主题拆成 2-3 个必答子问题');
  ok(/检查表，不是"按顺序完成的任务"/.test(web), '明确八步框架是检查表而非任务清单');

  // 回归主题的节奏是可自查的，不是"尽量"
  ok(/每 3-4 轮必须有一次提问把话题拉回主题/.test(web), '规定每 3-4 轮必须拉回主题一次');
  ok(/每聊 5 轮问自己一次/.test(web), '给出"每 5 轮自查相关轮数"的节奏');

  // 主题里的数字 = 必答项
  ok(/本次访谈的必答项/.test(web), '主题里的数字/成果声明被定为必答项');
  ok(/怎么算出来的、从哪儿统计的/.test(web), '必答项第一条：数字的算法与来源');
  ok(/跟谁比（团队平均 \/ 他自己平时 \/ 同条件同事）/.test(web), '必答项第二条：参照系');

  // 主线引用的是真实主题变量，不是写死的示例
  ok(/本次主题是「\$\{t\}」/.test(web), '主线章节引用真实主题变量 ${t}');

  /* 位置：必须在【角色定位】之后、【一轮只问一个问题】之前（保证模型先读到主线）。
     ★ 用 lastIndexOf：TOPIC_FOCUS 的注释里也引用了这个章节名，那是"说明"不是"正文"，
     取第一次出现会误判成注释的位置。 */
  const iPos = web.indexOf('【角色定位】');
  const iMain = web.lastIndexOf('【这次访谈要回答什么 · 主线】');
  const iOne = web.indexOf('【一轮只问一个问题 · 硬规则，最常被违反的一条】');
  ok(iPos >= 0 && iMain > iPos && iMain < iOne, '主线章节位于【角色定位】与【一轮只问一个问题】之间');
}

console.log('\n[2] 访谈框架与结束判断：跟主题挂钩');
{
  ok(/1\. 破冰 \+ 确认主题（1-2轮）/.test(web), '框架第 1 步已改为「破冰 + 确认主题」');
  ok(/复述主题请对方确认或缩小范围/.test(web), '第 1 步写明要复述主题请对方确认');
  ok(/这是检查表，不是任务清单——主线永远是主题/.test(web), '框架开头点明主线永远是主题');
  ok(/主题提出的问题已经问出答案/.test(web), '结束判断新增「主题的问题已问出答案」一条');
}

console.log('\n[3] topicFocus：降级为加分项，主路交给模型自拆');
{
  ok(/不是主题聚焦的主路/.test(web), '注释里明确它不再是主题聚焦的主路');
  ok(/【补充挖掘提示/.test(web), '命中时以「补充挖掘提示」形式注入，措辞不抢主线');
  ok(/没命中是常态/.test(web), '未命中时直接返回空，不改动提问方向');
  // 词表演进的教训要留在代码里，避免后人又去扩表当主路
  ok(/13 份里只命中 1 次/.test(web), '记录实测命中率（13 份只命中 1 次）');
}

console.log('\n[4] REPORT_PROMPT：报告必须回答主题');
{
  ok(/【这份报告要回答的问题 · 先看这条】/.test(web), '有「这份报告要回答的问题」总则');
  ok(/能不能回答「\$\{t\}」/.test(web), '要求自检"读完能不能回答主题"');
  ok(/访谈未覆盖主题中的/.test(web), '答不上的部分要求明确标注"访谈未覆盖主题中的 XX"');
  ok(/访谈中未交代来源/.test(web), '主题里的数字若没问到来源，要求如实标注');
  ok(/不许把它当成已确认的结果直接写进「结果」节/.test(web), '禁止把主题数字当已确认结果写进结果节');

  // 主题要从文末提到开头 —— 两处位置都要对
  const iTopic = web.indexOf('【案例主题】${t}');
  const iRule = web.indexOf('【本书写总则 · 先看这条】');
  ok(iTopic >= 0, '报告提示词开头带【案例主题】${t}');
  ok(iTopic >= 0 && iRule >= 0 && iTopic < iRule, '【案例主题】排在【本书写总则】之前（不再埋在文末）');

  // 文末的旧写法必须删掉，否则主题在提示词里出现两次、权重互相稀释
  ok(!/访谈对象：\$\{n\}（\$\{p\}）\s*\n案例主题：\$\{t\}/.test(web), '文末重复的「访谈对象/案例主题」两行已删除');
}

console.log('\n[5] 填写端：把名词短语引导成一句话');
{
  ok(/在什么条件下 \+ 做了什么 \+ 得到什么结果/.test(web), '表单提示给出「条件+做法+结果」的写法结构');
  ok(/欠佳：转化率高/.test(web), 'placeholder 里给了反例（转化率高）');
  ok(/好例：电销名单挑女客户/.test(web), 'placeholder 里给了正例');
  ok(/点完最好再补上具体的对象和结果/.test(web), '说明方向按钮只是起头，需要补具体对象与结果');
}

console.log('\n[6] 稳定性：未完成访谈不出报告 + 只拦真正影响访谈的回复');
{
  ok(/const MIN_REPORT_ROUNDS = 5;/.test(web), '前端定义报告硬闸 MIN_REPORT_ROUNDS = 5');
  ok(/rounds < MIN_REPORT_ROUNDS/.test(web), 'endAndReport 使用该硬闸（原阈值为 3，#17 就是这么漏出去的）');
  ok(!/countRounds\(state\.messages\) < 3/.test(web), '旧的「< 3 轮」阈值已移除');

  ok(/function replyLooksBad/.test(web), '有回复质量校验 replyLooksBad');
  ok(/function repairReply/.test(web), '有回复重写 repairReply');
  ok(/结尾无标点 = 半句话/.test(web), '校验规则含「半句话被掐断」');
  ok(/await repairReply\(msgs, full\)/.test(web), 'streamAI 在每轮结束后调用校验');
  ok(/push\.reset\(fixed\)/.test(web), '重写结果会替换已渲染的气泡');
  ok(/只重写一次，失败就保留原文/.test(web), '重写失败不阻断访谈');

  /* ★ 闸门判据必须能真跑，不能只看字面 —— 2026-10-10 收窄后新增。
     背景：原判据「问号 >1」全库回扫命中 56% 的轮次（111/198），其中绝大多数是
     "同一问题的两种问法"，被访谈人在这些轮次后答得更长（47 vs 44 字），属误拦。 */
  const gateSrc = web.slice(web.indexOf('const REPLY_MARKER_RE'), web.indexOf('async function endAndReport'));
  const gate = new Function(gateSrc + '\nreturn { bad: replyLooksBad, cnt: realQuestionCount };')();
  const bad = gate.bad, cnt = gate.cnt;

  ok(bad('') === true, '空回复判不合格');
  ok(bad('   ') === true, '纯空白判不合格');
  ok(bad('这个问题挺典型的，那您当时是怎么处理这种情况的？') === false, '正常单问放行');
  ok(bad('客户最后接受了，这单就成下来了。那这笔几十万在你们营业部，') === true,
    '半句话（结尾无标点）判不合格');

  /* 假阳性回归：这四条在原判据下全被误拦，收窄后必须放行 */
  ok(bad('那客户一般怎么回你？遇到说"不需要"的，你接下来会怎么说？') === false,
    '「同一问题的两种问法」放行（原判据误拦）');
  ok(bad('收到短信主动回的这些客户，是不是就直接能做成单子了？还是中间还得聊点别的？') === false,
    '「二选一被问号拆开」放行（原判据误拦）');
  ok(bad('好，那这两周一次的联系，一般是通过什么方式？微信还是电话？') === false,
    '含尾缀确认（"微信还是电话？"）放行（原判据误拦）');
  ok(cnt('那就是这样吗？') === 0, '尾缀式确认不计入实质问题数');

  /* 真该拦的：>=3 个实质问题、排版标记 */
  ok(bad('这二十天里您跟客户有没有保持联系？比如隔几天发个消息还是等着？具体是怎么跟的？') === true,
    '一轮堆 3 个实质问题判不合格');
  ok(bad('这个做法是你自己琢磨出来的？\n\n（接着问）那第三次跟进又是什么情况促成的？') === true,
    '「（接着问）」排版标记判不合格（原判据只能靠"有 2 个问号"侥幸拦下）');

  // 服务端最后一道闸：不管报告从哪条路径进来，轮次不够都不许入库
  ok(/interview_too_short/.test(srv), '服务端 submit 有 interview_too_short 闸');
  ok(/row\.round_count < 5/.test(srv), '服务端阈值与前端一致（< 5 拒绝）');
}

console.log('\n[7] 提示词模板串安全（反引号会直接终止模板串 → 整页语法错）');
{
  const sysStart = web.indexOf('const SYSTEM_PROMPT');
  const rptEnd = web.indexOf('const SECTION_TITLES');
  ok(sysStart >= 0 && rptEnd > sysStart, '能定位两段提示词的源码区间');
  const zone = web.slice(sysStart, rptEnd);
  // 两段模板串各自的首尾界定符，合计正好 4 个；多出来的就是正文里误写的反引号
  const ticks = (zone.match(/`/g) || []).length;
  ok(ticks === 4, '提示词正文里没有多余的反引号（只应有 4 个模板串界定符）', '实际 ' + ticks + ' 个');
  ok(!/(?<!·)\bTODO\b/.test(zone), '提示词里没有遗留占位符');
}

console.log('\n' + '─'.repeat(56));
console.log('主题聚焦自检：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
