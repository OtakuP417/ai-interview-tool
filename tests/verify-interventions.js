/**
 * L1 条件注入 + L2 冲突消解 护栏（2026-10-12，v2026.10.12-f）
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
const adm = fs.readFileSync(path.join(__dirname, '..', 'web', 'admin.html'), 'utf8');

/* 从页面里抽出 L1 那段函数（到 saveDraft 为止），真跑而不是只做字面断言。
   ★ 必须把 METHOD_SIGNAL_RE 的定义一起带上 —— 触发器④ 直接复用它的口径。
   漏掉这段会抛 ReferenceError，而如果测试恰好没走到 ④ 就会"假绿"。 */
const srcMethod = web.slice(web.indexOf('const METHOD_SIGNAL_RE'), web.indexOf('function sectionMap'));
const src = web.slice(web.indexOf('const SHORT_ANSWER_MAX'), web.indexOf('function saveDraft'));
const L1 = new Function(srcMethod + '\n' + src + '\nreturn { interventions, withIntervention, interventionKinds, countKind, shortStreak, isShortAnswer, topicMentioned, saidBy, SHORT_ANSWER_MAX, SHORT_STREAK, SHORT_SWITCH_WAYS, INTERVENTION_MAX_HITS, NUMERIC_TOPIC_RE, BOUNDARY_ASKED_RE };')();

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
  /* 2026-10-15：换法档位看累计 switch 次数，不看 streak 数值。
     这里没传 events（= 本场还没换过形态）→ 必须是第 1 种「拿一单从头过一遍」。
     原断言期望第 2 种，那是旧的 step = streak - SHORT_STREAK 口径。 */
  ok(!!t3 && t3.indexOf('第 1 种') >= 0, '本场还没换过形态 → 先上第 1 种');
  ok(!!t3 && t3.indexOf('那单') >= 0, '注入的是「拿一单从头过一遍」这一种换法');
  const t3b = L1.interventions(streak3, TOPIC, [{ kind: 'switch' }]);
  ok(!!t3b && t3b.indexOf('给一个猜测') >= 0, '已换过 1 次 → 升到「给一个猜测让他判断对错」');
  ok(!t3.includes('原样复述主题'), '主题已复述过，不再重复注入开场提示');

  /* 正例：连续两轮短答就该换形态（阈值 2026-10-15 由 3 降到 2） */
  const streak1 = [SYS(), A('x'), U('都会说'), A('y'), U('没有固定')];
  ok(L1.shortStreak(streak1) === 2, '两轮短答计数 = 2');
  const t1 = L1.interventions(streak1, TOPIC);
  ok(!!t1 && t1.indexOf('换访谈形态') >= 0, '连续两轮短答 → 触发换形态（阈值是 2）');

  /* 反例①：最后一轮是长答 —— streak 归零，不该换形态 */
  const streakLong = [SYS(), A('x'), U('都会说'), A('y'), U('我一般是先打电话问有没有需求然后约见面聊')];
  ok(L1.shortStreak(streakLong) === 0, '最后一轮长答 → streak=0');
  const tLong = L1.interventions(streakLong, TOPIC);
  ok(!tLong || tLong.indexOf('换访谈形态') < 0, '最后一轮长答 → 不注入换形态');

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

  /* ★★ 2026-10-15 档位口径由「瞬时 streak」改为「累计 switch 次数」。
     原因（回测 17 份归档）：shortStreak() 从最后一轮往回数，中间一轮长答就归零，
     于是 step = streak - SHORT_STREAK 让递进链反复从第 1 种重新开始 ——
     #20 的 streak 轨迹 1 2 3 0 1 0 0 1 2 3 0 … 归零后重新爬到 2 共 4 次，
     switch 实打 10 次、三种换法轮播，全库 33 次 switch 只换来 3 次止损。
     所以档位必须看「这一场已经换过几次形态」，而不是「眼下连续短答几轮」。
     因此这里的夹具改成：短答轮数固定（只要 >= SHORT_STREAK 就够），
     用 events 里的 switch / release 条数来驱动档位。 */
  const sw = (n) => Array.from({ length: n }, () => ({ kind: 'switch' }));

  ok(L1.SHORT_SWITCH_WAYS.length === 3, '三种换法（与提示词①②③一一对应）');
  ok(L1.interventions(mk(2), TOPIC, sw(0)).indexOf('第 1 种') >= 0, '换过 0 次 → 第 1 种：拿一单从头过一遍');
  ok(L1.interventions(mk(2), TOPIC, sw(1)).indexOf('第 2 种') >= 0, '换过 1 次 → 第 2 种：给一个猜测让他判断对错');
  ok(L1.interventions(mk(2), TOPIC, sw(2)).indexOf('第 3 种') >= 0, '换过 2 次 → 第 3 种：说明细节的用途');

  /* 长答打断后 streak 归零，但累计次数不归零 —— 这正是本次要修的那个 bug */
  const brokenThenShort = [SYS(), A('开场白'), U('我一般是先打电话过去问他有没有资金需求，有兴趣就约时间见面'), A('那你多久联系一次？'), U('嗯'), A('具体呢？'), U('还好')];
  const tBroken = L1.interventions(brokenThenShort, TOPIC, sw(2));
  ok(tBroken.indexOf('第 3 种') >= 0, '中间夹过长答也不会退回第 1 种（累计口径）');

  const t5 = L1.interventions(mk(2), TOPIC, sw(3));
  ok(t5.indexOf('这一块先放下') >= 0, '换过 3 次 → 止损（三种都试过了，如实记下、往下走）');
  ok(t5.indexOf('换访谈形态') < 0, '止损时不再出现「换访谈形态」');
  ok(t5.indexOf('不要反复纠缠同一件事') >= 0, '止损文案点明不许纠缠');

  /* 止损只提一次：events 里已有 release 之后不再重复念 */
  const t6 = L1.interventions(mk(2), TOPIC, sw(3).concat([{ kind: 'release' }]));
  ok(!t6 || (t6.indexOf('换访谈形态') < 0 && t6.indexOf('这一块先放下') < 0),
    '止损提过一次后 → 不再重复注入（避免每轮刷屏）');

  /* 三种换法各自的内容要对得上，不能只是编号不同 */
  ok(L1.SHORT_SWITCH_WAYS[0].indexOf('那单') >= 0, '换法①含具体某一单（叙事先行）');
  ok(L1.SHORT_SWITCH_WAYS[1].indexOf('我猜') >= 0, '换法②含具体例句（我猜…）');
  ok(L1.SHORT_SWITCH_WAYS[2].indexOf('给新人') >= 0, '换法③说明细节用途');
}

console.log('\n[1c] 触发器③：数字未问来路');
{
  /* 造一段"聊了 n 轮、每轮都有内容"的对话，可选地让 AI 问过 / 没问过数字来路 */
  const talk = (n, aiExtra) => {
    const a = [SYS()];
    for (let i = 0; i < n; i++) {
      a.push(U('我一般是先打电话过去问他有没有资金需求，有兴趣就约时间见面聊具体方案'));
      a.push(A('那你一般多久联系一次呢，是每周还是每月？' + (aiExtra || '')));
    }
    return a;
  };

  const TOPIC_NUM = '转化率高达14%，个体户放款4件，怎么经营个体户？';
  const TOPIC_PLAIN = '新人快速签约开单';

  /* turns=3 且主题带数字、AI 没问过 → 命中 */
  const hit = L1.interventions(talk(3), TOPIC_NUM);
  ok(!!hit && hit.indexOf('问出这个数的来路') >= 0, 'turns=3 + 主题带数字 + 未问过 → 注入');
  ok(!!hit && hit.indexOf('14%') >= 0, '注入文案里点出了主题中的那个数（14%）');
  ok(!!hit && hit.indexOf('怎么统计') >= 0, '注入问的是"怎么统计出来的"');

  /* 反例①：主题里没有数字/比例 → 不该注入 */
  const plain = L1.interventions(talk(3), TOPIC_PLAIN);
  ok(!plain || plain.indexOf('问出这个数的来路') < 0, '主题无量化表述 → 不注入');

  /* 反例②：AI 已经问过 → 必须停，不能反复提醒 */
  const asked = L1.interventions(talk(3, '这个数是怎么统计出来的？是系统里能查到的吗？'), TOPIC_NUM);
  ok(!asked || asked.indexOf('问出这个数的来路') < 0, 'AI 问过之后 → 停止注入');

  /* 反例③：间隔 3 轮，不是每轮都催 */
  ok(!L1.interventions(talk(4), TOPIC_NUM) || L1.interventions(talk(4), TOPIC_NUM).indexOf('问出这个数的来路') < 0,
    'turns=4（非 3 的倍数）→ 不催，避免变成噪音');
  ok(L1.interventions(talk(6), TOPIC_NUM).indexOf('问出这个数的来路') >= 0, 'turns=6 → 再提醒一次');

  /* 反例④：连续短答时不叠加 —— 先解决配合度，别再堆任务 */
  const shortAndNum = [SYS(), A('开场')];
  for (let i = 0; i < 3; i++) {
    shortAndNum.push(U('嗯'));
    shortAndNum.push(A('那你具体是怎么做的呢？'));
  }
  const both = L1.interventions(shortAndNum, TOPIC_NUM);
  ok(both.indexOf('换访谈形态') >= 0, '连续短答时走换形态分支（3 轮 → 第 1 种）');
  ok(both.indexOf('问出这个数的来路') < 0, '连续短答时不叠加数字来路（避免堆任务）');

  /* 判据本身：中文份额也算量化表述 */
  ok(L1.NUMERIC_TOPIC_RE.test('法人进件占一半，如何锁定法人客户？'), '「占一半」算量化表述');
  ok(L1.NUMERIC_TOPIC_RE.test('转化率高'), '「转化率高」这类成果声明也算');
  ok(!L1.NUMERIC_TOPIC_RE.test('新人快速签约开单'), '纯描述性主题不算');
}

console.log('\n[1d] 触发器④：做法未问失效边界');
{
  const withMethod = (n, aiExtra) => {
    const a = [SYS()];
    for (let i = 0; i < n; i++) {
      /* 含 METHOD_SIGNAL_RE 的信号（微信/电话、频次、"第一句"），说明做法已到方法层 */
      a.push(U('我一般是每周用微信发一次消息，第一句就先问他最近生意怎么样'));
      a.push(A('那你觉得这样做的效果如何？' + (aiExtra || '')));
    }
    return a;
  };
  const noMethod = (n) => {
    const a = [SYS()];
    for (let i = 0; i < n; i++) {
      a.push(U('就是认真地做，把该做的事情做好，客户自然就来了'));
      a.push(A('那你觉得这件事难在哪？'));
    }
    return a;
  };

  const hit4 = L1.interventions(withMethod(4), '新人快速签约开单');
  ok(!!hit4 && hit4.indexOf('追一句失效边界') >= 0, 'turns=4 + 做法已到方法层 + 未问过 → 注入');
  ok(!!hit4 && hit4.indexOf('有没有试过不灵的') >= 0, '注入的是口语问法（不说书面词）');
  ok(!!hit4 && hit4.indexOf('别说"哪些情况不适用"') >= 0, '明确要求模型不要用书面词（与报告字段名一致）');

  const asked4 = L1.interventions(withMethod(4, '那有没有试过不灵的？什么样的客户身上就不管用了？'), '新人快速签约开单');
  ok(!asked4 || asked4.indexOf('追一句失效边界') < 0, 'AI 问过之后 → 停止注入');

  const noM = L1.interventions(noMethod(4), '新人快速签约开单');
  ok(!noM || noM.indexOf('追一句失效边界') < 0, '对方还没讲到方法层 → 不注入（避免硬问）');

  ok(!L1.interventions(withMethod(5), '新人快速签约开单') ||
     L1.interventions(withMethod(5), '新人快速签约开单').indexOf('追一句失效边界') < 0,
    'turns=5（非 4 的倍数）→ 不催');

  /* 判据复用：与 assessCoverage 用的 METHOD_SIGNAL_RE 是同一个常量 */
  ok(/METHOD_SIGNAL_RE\.test\(userSaid\)/.test(web), '触发器④ 复用 METHOD_SIGNAL_RE（与素材覆盖判断同口径）');
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
  ok(/const tip = interventions\(msgs, state\.interviewee\.topic, state\.events\)/.test(web),
    'streamAI 调用 interventions，主题取自 state.interviewee.topic，并带上 events');
  ok(/const reqMsgs = withIntervention\(msgs, tip\)/.test(web), '构造 reqMsgs');
  ok(/messages: buildContext\(reqMsgs\)/.test(web), '发送用的是 reqMsgs（不是 msgs）');
  ok(!/tip[\s\S]{0,100}?state\.messages\.push/.test(web), '注入内容不写进 state.messages');
  /* 2026-10-15：repairReply 加了 mode 参数（bad / closed 两类毛病纠错方向相反） */
  ok(/repairReply\(msgs, full, mode\)/.test(web), '重写仍用未注入的 msgs（重写不需要重复提示）');
}

console.log('\n[4] L2 冲突消解');
{
  ok(!/不跳过任何维度/.test(web), '【约束】里已删掉「不跳过任何维度」');
  ok(/不跳过\*\*主线要求的子问题\*\*/.test(web), '改为「不跳过主线要求的子问题」（与开头主线章节对齐）');
  ok(/【规则冲突时，按这个顺序】/.test(web), '新增优先级声明（主线 > 短答兜底 > 一轮一问 > 框架维度）');
  ok(/上面的优先，下面的让位/.test(web), '优先级声明写明了让位关系');

  ok(!/少于 8 个字/.test(web), '旧的「少于 8 个字」已消失');
  ok(/去掉标点后少于 10 个字/.test(web), '短答阈值统一为 10 字');
  ok(/连着 2 轮他都答得很短（10 字以内）/.test(web), '「连续 2 轮短答」也是 10 字 —— 两处口径一致');
  ok(L1.SHORT_ANSWER_MAX === 10 && L1.SHORT_STREAK === 2, '代码阈值 = 提示词阈值（10 / 2）');

  ok(!/破冰 \+ 确认主题（\d+-\d+轮）/.test(web), '访谈框架已删掉维度轮数建议');
  ok(!/背景了解（\d+-\d+轮）/.test(web), '背景了解也删了轮数');
  ok(/也不要给每个维度分配轮数/.test(web), '框架章写明「不要给每个维度分配轮数」');
  ok(/维度不必按顺序走完/.test(web), '框架章写明「不必按顺序走完」（原「按顺序推进」已改）');
  ok(/只在真有取舍的地方\*\*问/.test(web), '框架第 5 条与取舍专章对齐（删掉「必须问出」）');
}

console.log('\n[6] L4 可观测性：注入与闸门事件');
{
  /* 这一层要回答的问题是：哪条规则靠自己生效、哪条靠兜底 ——
     以前只能人工读 40 多轮对话判断（本轮诊断就是这么做的），不可持续。 */
  ok(/const tip = interventions\(msgs, state\.interviewee\.topic, state\.events\)/.test(web),
    'streamAI 把 state.events 传进 interventions（用于抑制重复提醒）');
  ok(/function pushEvent\(kind, round\)/.test(web), '存在 pushEvent');
  ok(/pushEvent\('inject_' \+ kinds\[i\], r\)/.test(web), '注入记录成 inject_* 事件');
  ok(/pushEvent\(fixed \? 'gate_fixed' : 'gate_unfixed'/.test(web), '闸门命中记录成 gate_* 事件');
  ok(/if \(badBefore\) pushEvent/.test(web), '只有真的命中闸门才记录（不冤枉正常回复）');

  ok(/events: state\.events,/.test(web), 'saveDraft 保存 events');
  ok(/state\.events = Array\.isArray\(d\.events\) \? d\.events : \[\]/.test(web), 'resumeDraft 恢复 events（否则"提醒过几次"会从零重来）');
  ok(/state\.events = \[\];\s*\/\/ L4/.test(web), 'startInterview 清空 events');
  ok(/gate_log: state\.events,/.test(web), '归档 payload 带上 gate_log');

  /* 真跑：同类触发器到上限后不再注入 */
  ok(L1.INTERVENTION_MAX_HITS === 2, '同类触发器上限为 2 次');
  const many = (n) => {
    const a = [SYS()];
    for (let i = 0; i < n; i++) {
      a.push(U('我一般是每周用微信发一次消息，第一句就先问他最近生意怎么样'));
      a.push(A('那你觉得这样做的效果如何？'));
    }
    return a;
  };
  const used = [{ kind: 'boundary' }, { kind: 'boundary' }];
  const r1 = L1.interventions(many(4), '新人快速签约开单', used);
  ok(!r1 || r1.indexOf('追一句失效边界') < 0, '同类事件已到上限 → 不再注入（提醒不能变成噪音）');
  const r2 = L1.interventions(many(4), '新人快速签约开单', []);
  ok(!!r2 && r2.indexOf('追一句失效边界') >= 0, '没有历史事件时照常注入（上限只针对重复）');

  /* interventionKinds 把注入文案解析成类别 —— 记录与去重都靠它 */
  ok(L1.interventionKinds('【换访谈形态 · 第 1 种】…').indexOf('switch') >= 0, '能解析出 switch');
  ok(L1.interventionKinds('【问出这个数的来路】…').indexOf('number') >= 0, '能解析出 number');
  ok(L1.interventionKinds('【追一句失效边界】…').indexOf('boundary') >= 0, '能解析出 boundary');
  ok(L1.interventionKinds('【本轮第一件事】原样复述主题「X」…').indexOf('opener') >= 0, '能解析出 opener');
  ok(L1.interventionKinds('【这一块先放下】…').indexOf('release') >= 0, '能解析出 release（止损）');
  ok(L1.interventionKinds('').length === 0, '空文案解析为空数组');

  /* 服务端与管理端：入库白名单清洗 + 详情页可见 */
  const srv = fs.readFileSync(path.join(__dirname, '..', 'cloudfunctions', 'interview-proxy', 'index.js'), 'utf8');
  ok(/function cleanGateLog\(v\)/.test(srv), '云函数对 gate_log 做白名单清洗（不是任意 JSON 入口）');
  ok(/GATE_LOG_KINDS\.indexOf\(e\.kind\) === -1\) continue/.test(srv), '未知 kind 一律丢弃');
  ok(/gate_log: cleanGateLog\(body\.gate_log\)/.test(srv), '/api/submit 写入清洗后的 gate_log');
  ok(/out\.length > 400/.test(srv) || /out\.length < 400/.test(srv), '事件条数有上限（单列不会无限增长）');

  ok(/function renderGateLog\(row\)/.test(adm), '管理端有 renderGateLog');
  ok(/\$\{renderGateLog\(row\)\}/.test(adm), '详情页插入了事件区块');
  ok(/GATE_LOG_LABELS/.test(adm), '事件类别有中文标签（不把 inject_* 直接甩给运营）');
  ok(/只记类别与轮次，不记访谈内容/.test(adm), '界面写明只记类别与轮次');

  /* app_build：让归档自证"由哪一版前端产出"。
     2026-10-12 的现场教训 —— 用户开着的旧页面不刷新，就一直跑旧代码：d 版
     11:26 上线，11:35 归档的那份访谈仍是上午打开的旧版，L1/L2/L4 全部未参与。
     而 gate_log 为 null **两种原因都可能**（旧版前端 / 新版但零事件，因为
     cleanGateLog 对空数组也返回 null），当时只能靠"回放对比 + 读开场白"推理。
     有了 app_build，这类判断一眼就能完成。 */
  ok(/app_build: APP_BUILD,/.test(web), '归档 payload 带上 app_build');
  ok(/app_build: asText\(body\.app_build, 40\) \|\| null,/.test(srv), '/api/submit 写入 app_build（截断防脏值）');
  ok(/function renderAppBuild\(row\)/.test(adm), '管理端有 renderAppBuild');
  ok(/\$\{renderAppBuild\(row\)\}/.test(adm), '详情页插入了程序版本');
  ok(/未记录（该记录早于本功能上线）/.test(adm), '旧记录空态有解释（不把"没数据"显示成"坏了"）');
}

console.log('\n[5] 版本号');
{
  ok(/APP_BUILD = 'v2026\.10\.15-c'/.test(web), 'APP_BUILD 已 bump 到 v2026.10.15-c');
}

console.log('\n' + (fail ? '✗' : '✓') + ' 通过 ' + pass + ' 项，失败 ' + fail + ' 项\n');
process.exit(fail ? 1 : 0);
