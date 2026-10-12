/**
 * L1 条件注入 + L2 冲突消解 护栏（2026-10-12，v2026.10.12-c）
 *
 * 事故背景：扫 6 份归档 / 169 轮 AI 回复后发现 —— 凡「要求模型停下或退回」的规则
 * 执行率都是 0：
 *   ·「开场必须先确认主题」→ 已入库 6 份全部 0 执行（该规则 10-10 就加了）
 *   ·「对方答得很短时…绝对不能放过」→ 全库 52 次短答，AI 反应 0 次
 *     其中 #21 第 24/25/26 轮连续答 3/4/5 字，AI 仍用同一个句式模板逐个追问
 *   · #21 第 30 轮对方答「平的吧」——这 3 个字逐字写在提示词里并配了标准追问句，
 *     AI 直接跳过
 * 而「继续追问」类规则（问话术 / 问频次 / 问参照系）执行率 67–100%。
 *
 * 结论：执行率取决于「规则方向」和「有无代码接住」，不取决于提示词写得多好。
 * 所以把「什么时候该做」这个判断从模型搬到代码 —— 本套断言守这件事：
 *   [1] 注入判定算得对（真跑 interventions，不只看字面）
 *   [2] 注入不污染 state.messages（回放与归档都不该出现这些话）
 *   [3] L2 的四处自相矛盾已消除
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

/* 从页面里抽出 L1 那段函数（到 saveDraft 为止），真跑而不是只做字面断言。 */
const src = web.slice(web.indexOf('const SHORT_ANSWER_MAX'), web.indexOf('function saveDraft'));
const L1 = new Function(src + '\nreturn { interventions, withIntervention, shortStreak, isShortAnswer, topicMentioned, SHORT_ANSWER_MAX, SHORT_STREAK, SHORT_SWITCH_WAYS };')();

const TOPIC = '转化率高达14%，个体户放款4件，怎么经营个体户？';
const U = (t) => ({ role: 'user', content: t });
const A = (t) => ({ role: 'assistant', content: t });
const SYS = () => ({ role: 'system', content: '你是一名专业的案例访谈员…' });

console.log('\n[1] 注入判定真跑');
{
  /* 开场轮：还没开始问答（turns=0），必须要求复述主题 */
  const opener = [SYS(), { role: 'user', content: '请开始这次访谈，向被访谈人打招呼。', internal: true }];
  const t0 = L1.interventions(opener, TOPIC);
  ok(!!t0 && t0.indexOf('原样复述主题') >= 0, '开场轮注入「原样复述主题」');
  ok(!!t0 && t0.indexOf(TOPIC) >= 0, '注入内容里带了完整主题原文');
  ok(!!t0 && t0.indexOf('一个字都不要替他换说法') >= 0, '点明了「不许替他换说法」');
  ok(L1.shortStreak(opener) === 0, '开场轮不算短答（internal 不计入轮次）');

  /* #21 第 24–26 轮的翻版：连续三轮 3/4/5 字 —— 这是全库最典型的那一组 */
  const streak3 = [
    SYS(),
    { role: 'user', content: '请开始这次访谈', internal: true },
    A('马勇你好，咱们聊的是「转化率高达14%，个体户放款4件」，你看是不是这件事？'),
    U('主要是餐饮和建材这两类，都是小本生意，资金周转都比较急'),
    A('那这两类客户最难的地方是啥？'),
    U('都会说'),
    A('那见面时这几条你是怎么跟客户讲的，有没有一个固定说法？'),
    U('没有固定'),
    A('那这几条是客户问到了你才说，还是你主动就会提一句？'),
    U('根据情况，'),
  ];
  const t3 = L1.interventions(streak3, TOPIC);
  ok(L1.shortStreak(streak3) === 3, '连续三轮短答被正确计数 = 3');
  ok(!!t3 && t3.indexOf('换访谈形态') >= 0, '连续三轮短答 → 注入「换访谈形态」');
  ok(!!t3 && t3.indexOf('给一个猜测') >= 0, '注入的是「给一个猜测让他判断对错」这一种换法');
  ok(!t3.includes('原样复述主题'), '主题已复述过，不再重复注入开场提示');

  /* 反例①：只连续两轮短答 —— 不该换形态（单轮短是正常口语） */
  const streak2 = [SYS(), A('x'), U('都会说'), A('y'), U('没有固定')];
  ok(L1.shortStreak(streak2) === 2, '两轮短答计数 = 2');
  const t2 = L1.interventions(streak2, TOPIC);
  ok(!t2 || t2.indexOf('换访谈形态') < 0, '只连续两轮短答 → 不注入换形态（阈值是 3）');

  /* 反例②：短答被一句长答打断，streak 必须归零 */
  const broken = [SYS(), A('x'), U('都会说'), U('没有固定'),
    U('我一般是先打电话过去，然后看他有没有兴趣，有兴趣就约时间见面聊'),
    U('根据情况，')];
  ok(L1.shortStreak(broken) === 1, '长答打断后 streak 归零（只算最后那 1 轮）');

  /* 反例③：只提到「个体户」不算复述主题 —— 必须出现主题里连续 4 个字 */
  const partial = [
    SYS(),
    { role: 'user', content: '请开始这次访谈', internal: true },
    A('马勇你好，想请你聊聊个体户经营这块的经验。'),
    U('餐饮，建材'),
  ];
  ok(L1.topicMentioned(partial, TOPIC) === false, '只提「个体户」不算复述主题');
  const t5 = L1.interventions(partial, TOPIC);
  ok(!!t5 && t5.indexOf('原样复述主题') >= 0, '聊了 1 轮仍未复述主题 → 再注入一次（兜底）');

  /* 反例④：第 3 轮以后不再纠缠开场提示（避免每轮念主题） */
  const late = [SYS(), A('咱们聊的是「转化率高达14%」'), U('a'), A('b'), U('c'), A('d')];
  const tLate = L1.interventions(late, TOPIC);
  ok(!tLate || tLate.indexOf('原样复述主题') < 0, '第 3 轮之后不再注入开场提示');

  /* 边界：短答判定去标点后再比长度 */
  ok(L1.isShortAnswer('三天到一个星期左右') === true, '9 字 → 短答');
  ok(L1.isShortAnswer('大概三天到一星期左右') === false, '10 字 → 不算短答（阈值是 <10）');
  ok(L1.isShortAnswer('') === true, '空回复按短答处理');
}

console.log('\n[1b] 换法必须递进，不能每轮重复刷同一条');
{
  /* ★ 这条是被真实数据逼出来的：#20 连续短答 7 轮，若每轮都注入"换形态"，
     注入 7 次 —— 恰好违反提示词自己的止损条款（"换完方式还是几个字，就接受它、
     往下走，不要反复纠缠同一件事"）。所以按 streak 递增换法，用尽即止损。 */
  const mk = (n) => {
    const a = [SYS(), A('开场白')];
    for (let i = 0; i < n; i++) a.push(U('嗯'));
    return a;
  };

  ok(L1.SHORT_SWITCH_WAYS.length === 3, '三种换法（与提示词①②③一一对应）');
  ok(L1.interventions(mk(3), TOPIC).indexOf('第 1 种') >= 0, 'streak=3 → 第 1 种：给一个猜测让他判断对错');
  ok(L1.interventions(mk(4), TOPIC).indexOf('第 2 种') >= 0, 'streak=4 → 第 2 种：拿一单从头过一遍');
  ok(L1.interventions(mk(5), TOPIC).indexOf('第 3 种') >= 0, 'streak=5 → 第 3 种：说明细节的用途');

  const t6 = L1.interventions(mk(6), TOPIC);
  ok(t6.indexOf('这一块先放下') >= 0, 'streak=6 → 止损（三种都试过了，如实记下、往下走）');
  ok(t6.indexOf('换访谈形态') < 0, '止损时不再出现「换访谈形态」');
  ok(t6.indexOf('不要反复纠缠同一件事') >= 0, '止损文案点明不许纠缠');

  const t7 = L1.interventions(mk(7), TOPIC);
  ok(!t7 || (t7.indexOf('换访谈形态') < 0 && t7.indexOf('这一块先放下') < 0),
    'streak>=7 → 不再重复注入（避免每轮刷屏）');

  /* 三种换法各自的内容要对得上，不能只是编号不同 */
  ok(L1.SHORT_SWITCH_WAYS[0].indexOf('我猜') >= 0, '换法①含具体例句（我猜…）');
  ok(L1.SHORT_SWITCH_WAYS[1].indexOf('那单') >= 0, '换法②指向具体某一单');
  ok(L1.SHORT_SWITCH_WAYS[2].indexOf('给新人') >= 0, '换法③说明细节用途');
}

console.log('\n[2] 注入不污染 state.messages');
{
  const orig = [SYS(), U('对方原话')];
  const out = L1.withIntervention(orig, '【内部提示】测试');
  ok(out !== orig, '返回的是新数组');
  ok(out[1] !== orig[1], '返回的是新对象（不是同一个引用）');
  ok(orig[1].content === '对方原话', '原数组元素未被改动');
  ok(out[1].content.indexOf('对方原话') === 0, '新内容仍以对方原话开头');
  ok(out[1].content.indexOf('【内部提示】测试') >= 0, '新内容带上了注入指令');
  ok(out[1].content.indexOf('不要向对方复述') >= 0, '注入段落带「不要向对方复述」标记');

  const none = L1.withIntervention(orig, null);
  ok(none[1].content === '对方原话', '没有注入内容时原样返回');

  /* 开场白那一轮（user 消息带 internal）也必须能被注入 —— 那正是最需要它的轮次 */
  const opener = [SYS(), { role: 'user', content: '请开始这次访谈', internal: true }];
  const out2 = L1.withIntervention(opener, '【内部提示】X');
  ok(out2[1].content.indexOf('【内部提示】X') >= 0, '带 internal 的开场指令轮也能注入');
  ok(opener[1].content === '请开始这次访谈', '开场指令原文未被污染');
}

console.log('\n[3] 接入点：发送用的是注入后的消息');
{
  ok(/const tip = interventions\(msgs, state\.interviewee\.topic\)/.test(web),
    'streamAI 调用 interventions，主题取自 state.interviewee.topic');
  ok(/const reqMsgs = withIntervention\(msgs, tip\)/.test(web), '构造 reqMsgs');
  ok(/messages: buildContext\(reqMsgs\)/.test(web), '发送用的是 reqMsgs（不是 msgs）');
  ok(!/tip[\s\S]{0,100}?state\.messages\.push/.test(web), '注入内容不写进 state.messages');
  ok(/repairReply\(msgs, full\)/.test(web), '重写仍用未注入的 msgs（重写不需要重复提示）');
}

console.log('\n[4] L2 冲突消解');
{
  ok(!/不跳过任何维度/.test(web), '【约束】里已删掉「不跳过任何维度」');
  ok(/不跳过\*\*主线要求的子问题\*\*/.test(web), '改为「不跳过主线要求的子问题」（与开头主线章节对齐）');
  ok(/【规则冲突时，按这个顺序】/.test(web), '新增优先级声明（主线 > 短答兜底 > 一轮一问 > 框架维度）');
  ok(/上面的优先，下面的让位/.test(web), '优先级声明写明了让位关系');

  ok(!/少于 8 个字/.test(web), '旧的「少于 8 个字」已消失');
  ok(/去掉标点后少于 10 个字/.test(web), '短答阈值统一为 10 字');
  ok(/连着 3 轮他都答得很短（10 字以内）/.test(web), '「连续 3 轮短答」也是 10 字 —— 两处口径一致');
  ok(L1.SHORT_ANSWER_MAX === 10 && L1.SHORT_STREAK === 3, '代码阈值 = 提示词阈值（10 / 3）');

  ok(!/破冰 \+ 确认主题（\d+-\d+轮）/.test(web), '访谈框架已删掉维度轮数建议');
  ok(!/背景了解（\d+-\d+轮）/.test(web), '背景了解也删了轮数');
  ok(/也不要给每个维度分配轮数/.test(web), '框架章写明「不要给每个维度分配轮数」');
  ok(/维度不必按顺序走完/.test(web), '框架章写明「不必按顺序走完」（原「按顺序推进」已改）');
  ok(/只在真有取舍的地方\*\*问/.test(web), '框架第 5 条与取舍专章对齐（删掉「必须问出」）');
}

console.log('\n[5] 版本号');
{
  ok(/APP_BUILD = 'v2026\.10\.12-c'/.test(web), 'APP_BUILD 已 bump 到 v2026.10.12-c');
}

console.log('\n' + (fail ? '✗' : '✓') + ' 通过 ' + pass + ' 项，失败 ' + fail + ' 项\n');
process.exit(fail ? 1 : 0);
