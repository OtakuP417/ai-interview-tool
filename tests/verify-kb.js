/**
 * 案例经验库（kb.js / /api/kb / kb.html）护栏（2026-10-12，kb v2026.10.12-a）
 *
 * 这一套守两件事，第二件比第一件重要得多：
 *   ① 解析算得对：主题归并、两种格式变体、六要素、缺失标记；
 *   ② ★ 脱敏当真守住了 —— 知识库面向全体同事、**无口令、凭链接即看**，
 *      所以姓名/工号/机构/原始对话必须在**服务端**就消失。
 *      「前端没渲染」不算数：前端能拿到就等于泄漏。
 *
 * 脱敏断言为什么用「真跑」而不是看字面：maskWords 的替换发生在输出前，
 * 只有把带姓名的行喂进去、再扫输出 blob，才能证明替换生效。
 */
const fs = require('fs');
const path = require('path');

let pass = 0;
let fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (extra ? '  → ' + extra : '')); }
}

const ROOT = path.join(__dirname, '..');
const web = fs.readFileSync(path.join(ROOT, 'web', 'index.html'), 'utf8');
const adm = fs.readFileSync(path.join(ROOT, 'web', 'admin.html'), 'utf8');
const kbHtml = fs.readFileSync(path.join(ROOT, 'web', 'kb.html'), 'utf8');
const srv = fs.readFileSync(path.join(ROOT, 'cloudfunctions', 'interview-proxy', 'index.js'), 'utf8');
const KB = require(path.join(ROOT, 'cloudfunctions', 'interview-proxy', 'kb.js'));
const kbSrc = fs.readFileSync(path.join(ROOT, 'cloudfunctions', 'interview-proxy', 'kb.js'), 'utf8');

/* ══════════════════════════════════════════════════════════════
   夹具。刻意做成"两种格式变体 + 一份旧模板 + 一份垃圾主题"，
   并且**带全套敏感字段**（姓名/工号/城市/提交人/对话原文）——
   这样第 [2] 段才有东西可查。
   ══════════════════════════════════════════════════════════════ */
const NAME_A = '钟离明';
const NAME_B = '公孙述';
const OWNER_A = '赫连图';
const OWNER_B = '慕容青';
const UM_A = 'UM884512';
const UM_B = 'UM990137';
const CITY_A = '咸阳市';
const SUBMITTER = '拓跋远';
/* 只在 transcript 里出现、report_md 里没有的独有长句（≥20 字）——
   用它证明"对话原文没进知识库"，而不是只证明"某个词没出现"。 */
const TRANS_TAIL = '客户住在渭水苑三期那个小区，单位是西北橡胶机械厂，家里两套房子都抵押过';

const ROWS = [
  {
    id: 101,
    created_at: '2026-10-11T09:20:00+08:00',
    topic: '存量客户转介绍怎么做',
    round_count: 18,
    interviewee_name: NAME_A,
    interviewee_um: UM_A,
    backend_owner_name: OWNER_A,
    submitter_name: SUBMITTER,
    city: CITY_A,
    transcript: [['user', TRANS_TAIL]].map((x) => ({ role: x[0], content: x[1] })),
    report_md: [
      '背景与挑战',
      '客户都在外地，见面难。',
      '',
      '---SECTION---',
      '核心做法',
      '1. 加微信先发资料。这是旧模板写法，本节应被「可复制的经验点」覆盖。',
      '2. 第二条旧模板做法，绝不能被上一条吞掉。',
      '',
      '---SECTION---',
      '可复制的经验点',
      '1. 做法：老客户回访时顺带问一句有没有朋友要周转',
      '   频次/时机：每月回访一次',
      '   话术/方法：原话是「最近在忙什么」（' + NAME_A + '）',
      '   载体/工具：微信语音',
      '   对方没反应时怎么办：先发一条额度截图，过三天再问',
      '   触发信号：客户主动提到朋友、同事也在做生意',
      '   哪些情况不适用：他提到客户都是新客户，未说明对老客户是否适用',
      '2. 做法：朋友圈晒批款到账截图',
      '   频次/时机：每周两次',
      '   话术/方法：（访谈中未提到）',
      '',
      '---SECTION---',
      '关键判断与取舍',
      '选了先做老客户，没选陌拜。',
      '',
      '---SECTION---',
      '结果',
      '当月转了 3 个客户，成了 2 个。',
      '',
      '---SECTION---',
      '新人容易踩的坑',
      '急着报价。',
    ].join('\n'),
  },
  {
    id: 102,
    created_at: '2026-09-20T15:00:00+08:00',
    topic: '提升转化率的做法',
    round_count: 12,
    interviewee_name: NAME_B,
    interviewee_um: UM_B,
    backend_owner_name: OWNER_B,
    city: '西安市',
    transcript: [['assistant', '你平时怎么触达客户']],
    report_md: [
      '背景与挑战',
      '转化率偏低。',
      '',
      '---SECTION---',
      '核心做法',
      '1. 需求转接：先问清资金用途，再推荐产品；不要一上来就报价，客户会反感。',
      '2. 二次触达：首次沟通后 48 小时内必须回访一次，问一句「你考虑得怎么样了」。',
      '',
      '---SECTION---',
      '结果',
      '转化率从 7% 提升到 12%。',
      '',
      '---SECTION---',
      '新人注意事项',
      '不要承诺批款。',
    ].join('\n'),
  },
  {
    id: 103,
    created_at: '2026-10-12T08:00:00+08:00',
    topic: '某个没被归并规则覆盖的主题',
    round_count: 6,
    interviewee_name: '第五柔',
    backend_owner_name: OWNER_A,
    report_md: ['背景与挑战', '只有背景，没有做法。'].join('\n'),
  },
];

const MASK = [NAME_A, NAME_B, OWNER_A, OWNER_B, '第五柔'];

console.log('\n[1] 解析：归并规则 / 两种格式变体 / 六要素');
{
  const out = KB.buildKb(ROWS, { maskWords: MASK.slice() });

  ok(out.stats.reports === 3, 'reports 计数', JSON.stringify(out.stats));

  /* 归并规则本身还在，但它现在只作用于**卡片文本**（sceneOf），
     不再作用于报告主题 —— 报告主题以原文出现在 source_topic 上。
     ★ 这是 2026-10-12 修的那件事：判据从「报告主题」搬到「卡片自身」。 */
  ok(KB.sceneOf('存量客户转介绍怎么做') === '客户转介绍',
    '归并规则：「存量客户转介绍怎么做」→「客户转介绍」');
  ok(KB.sceneOf('提升转化率的做法') === '转化率提升', '「提升转化率的做法」→「转化率提升」');
  ok(KB.sceneOf('某个没被归并规则覆盖的主题') === null,
    '未命中规则的文本不强行归类（返回 null = 通用）');
  ok(typeof KB.normTopic === 'function', 'normTopic 仍导出（仅供历史对比探针，buildKb 已不用它）');
  /* ★ 反向断言：buildKb 函数体里不许再出现 normTopic —— 一旦回归，
     整份报告的做法又会被标题带着走。 */
  const buildBody = (kbSrc.match(/function buildKb\(rows, opts\) \{[\s\S]*?\n\}/) || [''])[0];
  ok(buildBody.length > 0 && buildBody.indexOf('normTopic') < 0,
    '★ buildKb 不再调用 normTopic（归并判据已落到卡片自身）');

  /* 卡片按 report_id 取 —— 不再经主题组中转 */
  const cardsOf = (id) => out.cards.filter((c) => c.report_id === id);
  const caseOf = (id) => out.cases.filter((c) => c.id === id)[0];
  const t101 = { cards: cardsOf(101) };
  const t102 = { cards: cardsOf(102) };

  /* 有「可复制的经验点」时优先用它，「核心做法」不再产出卡片（否则同一做法出两遍） */
  ok(t101.cards.length === 2, 'skills 段优先：出 2 张全要素卡片', String(t101.cards.length));
  ok(t101.cards.every((c) => c.grade === 'full'), '这 2 张都是 full 档');
  ok(t101.cards.every((c) => c.title.indexOf('加微信先发资料') < 0),
    '「核心做法」的旧模板条目没有被混进来');

  /* 旧模板兜底：「1. xxx」编号步骤 → basic 卡片 */
  ok(t102.cards.length === 2, '旧模板「核心做法」兜底出 2 张卡片', String(t102.cards.length));
  ok(t102.cards.every((c) => c.grade === 'basic'), '旧模板卡片是 basic 档');
  /* ★ 这条是曾经踩过的坑：按 head 反查边界会在中文冒号/顿号处落空，
     结果是第一张卡片吞掉后面所有步骤（只剩 1 张）。 */
  ok(t102.cards[0] && t102.cards[1] && t102.cards[0].title !== t102.cards[1].title,
    '★ 旧模板两张卡片各自独立，第一张没有吞掉第二张',
    t102.cards.map((c) => c.title).join(' || '));
  ok(t102.cards[1] && /48 小时/.test(t102.cards[1].title + ' ' + (t102.cards[1].body || '')),
    '第二张卡片的内容落在自己名下（没被第一张吞走）',
    t102.cards.map((c) => c.title).join(' || '));

  /* 六要素 */
  const c1 = t101.cards[0];
  ok(c1.fields.when === '每月回访一次', '要素 when 解析');
  ok(c1.fields.how && c1.fields.how.indexOf('最近在忙什么') >= 0, '要素 how 解析');
  ok(c1.fields.tool === '微信语音', '要素 tool 解析');
  ok(c1.fields.ifno && c1.fields.ifno.indexOf('额度截图') >= 0, '要素 ifno 解析');
  ok(c1.fields.trigger && c1.fields.trigger.indexOf('主动提到朋友') >= 0, '要素 trigger 解析');
  ok(c1.fields.boundary && c1.fields.boundary.indexOf('新客户') >= 0, '要素 boundary 解析');

  /* ★ 换词：2026-10-12 起报告字段名从「失效边界」改成「哪些情况不适用」（一线不好理解）。
     两面都要守：①展示标签是新词 ②解析正则**同时认新旧** —— 存量报告正文里还是旧词，
     只认新词会让老报告的边界要素整条消失。 */
  ok(KB.FIELD_LABELS.boundary === '哪些情况不适用',
    '★ 经验库展示标签用新词「哪些情况不适用」', KB.FIELD_LABELS.boundary);
  {
    const bdField = KB.FIELDS.filter(function (f) { return f[0] === 'boundary'; })[0];
    ok(!!bdField && bdField[1].test('哪些情况不适用：只在见过面的客户身上有效'), '识别新词');
    ok(!!bdField && bdField[1].test('失效边界：只在见过面的客户身上有效'),
      '★ 换词后仍识别旧词（存量报告正文里是旧词，只认新词会丢要素）');
    ok(!!bdField && !bdField[1].test('触发信号：客户主动问额度'),
      'boundary 正则不会误吞其他要素');
  }

  /* 缺失标记：整条就是"没问出来" → missing；空值 → absent */
  const c2 = t101.cards[1];
  ok(c2.missing.indexOf('how') >= 0, 'how=（访谈中未提到）→ 标 missing', JSON.stringify(c2.missing));
  ok(c2.absent.length >= 1, '没写出来的要素进 absent', JSON.stringify(c2.absent));

  /* ★ MISSING_RE 必须整条锚定：这句含"未说明"但是**有效的边界说明** */
  ok(KB.MISSING_RE.test('（访谈中未提到）') === true, 'MISSING_RE：整条"未提到"判为缺失');
  ok(KB.MISSING_RE.test(c1.fields.boundary) === false,
    '★ MISSING_RE：含"未说明"但内容是有效边界的句子不判缺失', c1.fields.boundary);

  /* ★ 2026-10-12：批量导入件（非访谈来源）的占位写「（稿子中未展开）」。
     此前只认「访谈中」→ 导入件的诚实兜底会被当成正常字段值渲染出来。
     放宽主语，但**必须仍不吞有效边界说明**（下面两条是配对的，不能只留一条）。 */
  ['（稿子中未展开）', '（稿子中未提到）', '（稿子中未覆盖主题中的 XX）',
   '稿子中未提供结果信息', '这一点稿子中未展开', '（材料中未明确）',
  ].forEach(function (s) {
    ok(KB.MISSING_RE.test(s) === true, 'MISSING_RE：导入件占位「' + s + '」判为缺失');
  });
  ok(KB.MISSING_RE.test('客户未提到过额度要求，但每次都会问利率') === false,
    '★ MISSING_RE：句中出现"未提到"的正常内容不判缺失');
  ok(KB.MISSING_RE.test('未') === false, 'MISSING_RE：单个"未"不判缺失');

  /* 原话抽取「」『』，且缺失说明不算原话 */
  ok(c1.quotes.length === 1 && c1.quotes[0] === '最近在忙什么', '原话抽取', JSON.stringify(c1.quotes));
  ok(c2.quotes.length === 0, '缺失说明里的括号内容不当原话');

  /* case 层：轮次 / 日期 / 旧模板标记 / 结果文本 */
  const case101 = caseOf(101);
  ok(!!case101, '顶层 cases 里有 101 的摘要');
  ok(case101.rounds === 18, 'case.rounds 取 round_count');
  ok(case101.date === '2026-10-11', 'case.date 取 created_at 前 10 位', case101.date);
  ok(case101.old_template === false, '10 月的报告不标早期模板');
  ok(caseOf(102).old_template === true, '9/20 的报告标早期模板（< 09-30）');
  ok(case101.result && case101.result.indexOf('3 个客户') >= 0, 'case.result 取自「结果」节');

  /* ★ 回归防护：改成卡片级归类后，摘要曾一度只能从 topics[].cases / stages[].cases
     抵达 —— 一份没有卡片归入场景或阶段的报告（还没跑分类 / 只有占位卡）
     就会整份从输出里消失。顶层 cases 保证一份都不丢。 */
  ok(out.cases.length === 3, '★ 顶层 cases 收齐全部 3 份报告的摘要', String(out.cases.length));
  ok(cardsOf(103).length === 0 && !!caseOf(103),
    '★ 没有任何做法的报告，摘要仍然出现在输出里（不再被归类逻辑顺手吞掉）');
  ok(caseOf(103) && caseOf(103).topic === '某个没被归并规则覆盖的主题',
    'case.topic 用报告主题原文，不再被归并');
  ok(out.cards.every((c) => typeof c.source_topic === 'string' && c.source_topic.length > 0),
    '每张卡都带 source_topic（来源访谈主题）');

  /* 节标题别名：旧报告的「新人注意事项」等价于「新人容易踩的坑」 */
  ok(caseOf(102).pitfalls && caseOf(102).pitfalls.indexOf('承诺批款') >= 0,
    '节标题别名「新人注意事项」被识别');
  ok(case101.pitfalls && case101.pitfalls.indexOf('报价') >= 0,
    '节标题「新人容易踩的坑」被识别');

  /* ★ 占位卡：访谈没问出任何做法时，报告里会留一条「（访谈中未展开——…）」的
     诚实兜底。它是**空缺的证据**，不是做法 —— 留在 cards 里，但不许进索引，
     否则会凭空给知识库添一条带「需求判断/通用」标签的假经验。 */
  const PH_TITLE = '（访谈中未展开——目前只问到客户的行业与资金缺口，未涉及任何具体跟进动作）';
  const ph = KB.buildKb([{
    id: 301,
    created_at: '2026-10-12T12:00:00+08:00',
    topic: '批款后的跟进与服务',
    round_count: 3,
    kb_stages: [{ stage: '需求判断', scene: '通用' }],
    report_md: [
      '背景与挑战', '客户做餐饮。', '',
      '---SECTION---', '核心做法', '（本节不用旧模板）', '',
      '---SECTION---', '可复制的经验点',
      '1. 做法：' + PH_TITLE, '',
      '---SECTION---', '关键判断与取舍', '（未覆盖）', '',
      '---SECTION---', '结果', '（未覆盖）', '',
      '---SECTION---', '新人容易踩的坑', '（未覆盖）', '',
    ].join('\n'),
  }], {});
  ok(ph.cards.length === 1 && ph.cards[0].title === PH_TITLE,
    '占位卡逐字解析出来了（用于下面几条断言的前置条件）', ph.cards[0] && ph.cards[0].title);
  ok(ph.stats.placeholder === 1, 'stats.placeholder 如实计数', String(ph.stats.placeholder));
  ok(ph.stages.length === 0, '★ 占位卡不进阶段索引（不给知识库添一条假经验）');
  ok(ph.topics.length === 0, '占位卡也不进场景索引');
  ok(ph.cases.length === 1, '但报告摘要仍在（缺口本身是要被看见的）');
}

console.log('\n[1b] ★ 双维度：动作阶段 + 场景（卡片级归并，不看报告主题）');
{
  /* 夹具刻意做成"报告主题是棱镜签约，但里面的做法大多是通用招式" ——
     这正是用户 2026-10-12 指出的问题：棱镜主题下混着大量与棱镜无关的做法。 */
  const secs = (arr) => arr.join('\n');
  const R2 = [
    {
      id: 201,
      created_at: '2026-10-12T10:00:00+08:00',
      topic: '棱镜签约',
      round_count: 12,
      interviewee_name: NAME_A,
      backend_owner_name: OWNER_A,
      /* 服务端分类结果：与下面 3 张卡**按下标对齐** */
      kb_stages: [
        { stage: '异议处理', scene: '通用' },      /* 模型判通用 → scene 置空但记 scene_by */
        { stage: '签约落地', scene: '棱镜签约' },  /* 真专属 → scene 保留 */
        { stage: '约见推进', scene: '通用' },
      ],
      report_md: secs([
        '背景与挑战', '客户要的是大额，普通额度不够。', '',
        '---SECTION---', '核心做法', '（本节不用旧模板）', '',
        '---SECTION---', '可复制的经验点',
        '1. 做法：面谈嫌费率时，先打压再给「先用后结清」',
        '   频次/时机：面谈当场',
        '   话术/方法：原话是「你先用着，半年后提前结清只算实际用的天数」（' + NAME_A + '）',
        '2. 做法：签约核查时逐一核对资料',
        '   频次/时机：签约环节',
        '   话术/方法：按清单逐项过一遍',
        '3. 做法：约不到客户就直接上门',
        '   频次/时机：约了两次没成之后',
        '   话术/方法：到店门口等',
        '',
        '---SECTION---', '关键判断与取舍', '选了先谈费率再谈额度。', '',
        '---SECTION---', '结果', '当月放款 2 件。', '',
        '---SECTION---', '新人容易踩的坑', '不要在电话里报价。', '',
      ]),
    },
    {
      /* 第二份**没有 kb_stages**（还没跑过分类）→ 场景退回关键词判定 */
      id: 202,
      created_at: '2026-10-12T11:00:00+08:00',
      topic: '客户转介绍',
      round_count: 9,
      report_md: secs([
        '背景与挑战', '新客来源少。', '',
        '---SECTION---', '核心做法', '（本节不用旧模板）', '',
        '---SECTION---', '可复制的经验点',
        '1. 做法：拿到转介绍电话后，第一次联系先报介绍人名字',
        '   频次/时机：首次致电时',
        '   话术/方法：原话是「是张哥让我联系您的」',
        '',
        '---SECTION---', '关键判断与取舍', '先报介绍人再谈需求。', '',
        '---SECTION---', '结果', '当月成交 1 件。', '',
        '---SECTION---', '新人容易踩的坑', '不要绕弯子。', '',
      ]),
    },
  ];

  const out = KB.buildKb(R2, { maskWords: [NAME_A, OWNER_A] });
  const all = out.cards;
  ok(all.length === 4, '两份共出 4 张卡', String(all.length));

  ok(JSON.stringify(out.stage_names) === JSON.stringify(KB.STAGE_NAMES),
    'stage_names 随输出下发（前端「按动作看」的标签来源）');
  ok(KB.STAGE_NAMES.length === 8, '客户旅程八阶段', KB.STAGE_NAMES.join('/'));
  ok(KB.STAGE_NAMES[0] === '获客开发' && KB.STAGE_NAMES[7] === '关系维护',
    '八阶段顺序 = 客户旅程先后', KB.STAGE_NAMES.join(' > '));

  const c0 = all[0], c1 = all[1], c2 = all[2], c3 = all[3];
  /* ★ 场景不再等于报告主题：报告主题是「棱镜签约」，但第 0、2 条是通用招式 */
  ok(c0.stage === '异议处理' && c0.scene === null && c0.scene_by === 'model',
    '★ 模型判「通用」→ scene 置空、scene_by=model（与「没分类」区分开）',
    JSON.stringify([c0.stage, c0.scene, c0.scene_by]));
  ok(!c0.scene, '★ 棱镜签约主题下的通用做法**不再**被归进棱镜组');
  ok(c1.stage === '签约落地' && c1.scene === '棱镜签约' && c1.scene_by === 'model',
    '真专属的做法保留场景', JSON.stringify([c1.stage, c1.scene, c1.scene_by]));
  ok(c2.stage === '约见推进', '第 3 条拿到自己的阶段（下标对齐没有漂移）', String(c2.stage));
  ok(c0.source_topic === '棱镜签约', '卡片上保留源访谈主题（source_topic），但它不再决定归属');

  /* 兜底路径：没跑过分类的行，场景退回关键词判定 */
  ok(c3.stage === null, '没跑过分类 → stage 为空（不猜）');
  ok(c3.scene === '客户转介绍' && c3.scene_by === 'keyword',
    '没跑过分类时场景退回关键词判定', JSON.stringify([c3.scene, c3.scene_by]));

  /* 索引 */
  const stageNames = out.stages.map((s) => s.name);
  const expect = KB.STAGE_NAMES.filter((n) => stageNames.indexOf(n) >= 0);
  ok(JSON.stringify(stageNames) === JSON.stringify(expect),
    '★ 动作索引按客户旅程顺序，不按做法数排序', stageNames.join(' > '));
  ok(stageNames.every((n, i) => i === 0 ||
      KB.STAGE_NAMES.indexOf(n) > KB.STAGE_NAMES.indexOf(stageNames[i - 1])),
    '★ 动作索引逐项递增（严格客户旅程序，没被数量排序打乱）', stageNames.join(' > '));
  const sceneNames = out.topics.map((t) => t.name);
  ok(sceneNames.indexOf('棱镜签约') >= 0 && sceneNames.length === 2,
    '场景索引只收真专属的（通用不进索引）', sceneNames.join(' / '));
  ok(out.topics.filter((t) => t.name === '棱镜签约')[0].cards.length === 1,
    '「棱镜签约」组里只有 1 条（不再被整份报告的做法灌满）');

  /* 计数如实 */
  ok(out.stats.staged === 3, 'stats.staged = 判出阶段的卡片数', String(out.stats.staged));
  ok(out.stats.scened === 2, 'stats.scened = 有场景的卡片数', String(out.stats.scened));
  ok(out.stats.generic === 2, 'stats.generic = 模型判为通用的卡片数', String(out.stats.generic));

  /* 脱敏对新增字段同样生效 */
  const blob = JSON.stringify(out);
  [NAME_A, OWNER_A].forEach((w) => ok(blob.indexOf(w) < 0, '双维度结构里也不含「' + w + '」'));
  ok(blob.indexOf('该顾问') >= 0, '原话后的归属标注仍被替换为「该顾问」');
  ok(blob.indexOf('"interviewee_name"') < 0, '输出结构里没有姓名键');
}

console.log('\n[2] ★ 脱敏：输出 blob 里不许出现敏感字段（真跑，不看字面）');
{
  const out = KB.buildKb(ROWS, { maskWords: MASK.slice() });
  const blob = JSON.stringify(out);

  /* (a) 报告表里的身份字段，一个都不许出现 */
  [NAME_A, NAME_B, '第五柔', OWNER_A, OWNER_B, UM_A, UM_B, CITY_A, SUBMITTER].forEach((w) => {
    ok(blob.indexOf(w) < 0, '输出不含「' + w + '」');
  });

  /* (b) 姓名的**替换**确实生效（而不是"恰好没读到"）：报告正文里的归属标注要变成「该顾问」 */
  ok(blob.indexOf('该顾问') >= 0, '姓名在报告正文里被替换为「该顾问」');

  /* (c) ★ 原始对话：用"只在 transcript 里出现"的独有长句检测，而不是查某个词 */
  const tailCut = TRANS_TAIL.slice(0, 24);
  ok(blob.indexOf(tailCut) < 0, '★ 对话原文独有片段（小区名/单位名）未进知识库', tailCut);
  ok(blob.indexOf('渭水苑') < 0 && blob.indexOf('西北橡胶机械厂') < 0,
    '★ 小区名与单位名未进知识库');

  /* (d) 敏感列名本身也不该出现在任何输出键里 */
  [
    'interviewee_name', 'interviewee_um', 'backend_owner_name', 'backend_owner_org',
    'submitter_name', 'transcript',
  ].forEach((k) => {
    ok(blob.indexOf('"' + k + '"') < 0, '输出结构里没有键 ' + k);
  });

  /* (e) 计数如实：masked 告诉我们替换了几个词，别静默 */
  ok(out.stats.masked === MASK.length, 'stats.masked 记录实际参与替换的词数', String(out.stats.masked));

  /* (f) maskWords 为空时不做替换（避免"没传就以为脱过"的误判）——
         这条是反向保护：调用方必须真的把名单传进来。 */
  const raw = KB.buildKb(ROWS, {});
  ok(JSON.stringify(raw).indexOf('该顾问') < 0, '不传 maskWords 就不会有替换（调用方必须传）');
}

console.log('\n[3] 服务端 /api/kb：白名单列 + 路由 + 405');
{
  ok(/const kb = require\("\.\/kb"\)/.test(srv), 'index.js 引入 kb 模块');
  ok(/function handleKb\(req, res\)/.test(srv), '存在 handleKb');
  ok(/if \(req\.method !== "GET"\)[\s\S]{0,80}?method_not_allowed/.test(srv),
    'handleKb 只接受 GET');

  /* ★ SELECT 白名单：这是脱敏的第一道闸 —— 不读就不会漏。
     注意必须从 handleKb 的函数体里取，文件里还有 admin list 的 select，
     全局第一个 select= 是 admin 的（它是全量列，本来就该有姓名工号）。 */
  const kbFn = srv.match(/function handleKb\(req, res\) \{[\s\S]*?\n\}/);
  ok(!!kbFn, '取到 handleKb 函数体');
  const sel = ((kbFn || [''])[0].match(/select=([a-z_,]+)/) || [])[1] || '';
  const cols = sel.split(',').filter(Boolean);
  ok(cols.length > 0, '取到 handleKb 的 SELECT 列表', sel);
  ['id', 'created_at', 'topic', 'round_count', 'report_md', 'interviewee_name', 'backend_owner_name', 'kb_stages']
    .forEach((c) => ok(cols.indexOf(c) >= 0, 'SELECT 含 ' + c));
  ['transcript', 'interviewee_um', 'city', 'submitter_name', 'backend_owner_org', 'interviewee_position']
    .forEach((c) => ok(cols.indexOf(c) < 0, '★ SELECT 不含 ' + c));

  /* 姓名取出**只用于替换** */
  ok(/const maskWords = \[\];/.test(srv) && /kb\.buildKb\(rows, \{ maskWords: maskWords \}\)/.test(srv),
    '姓名收进 maskWords 后交给 buildKb 做替换');

  /* 缓存：命中缓存时直接返回，不再查库 */
  ok(/KB_CACHE_MS/.test(srv) && /kbCache = \{ at: now, data: payload \};/.test(srv),
    '有 60 秒内存缓存，命中即返回');

  /* 路由 + 405 白名单（新增接口必须两处都加，否则 GET 通、别的动词返回 404 not_found） */
  ok(/path === "\/api\/kb"/.test(srv), '路由注册 /api/kb');
  const wl = srv.match(/if \(\s*\n\s*path === "\/"[\s\S]*?sendJson\(res, 405/);
  ok(!!wl, '取到 405 白名单块');
  ok(wl && /path === "\/api\/kb"/.test(wl[0]), '405 白名单已加 /api/kb');
}

console.log('\n[4] kb.html：页面契约');
{
  ok(/const KB_BUILD = 'v2026\.10\.12-d';/.test(kbHtml), 'KB_BUILD 已声明',
    (kbHtml.match(/KB_BUILD = '[^']*'/) || [''])[0]);
  ok(/\/api\/kb'/.test(kbHtml), 'KB_API 指向 /api/kb');

  /* 页面必须在最显眼处告诉读者"这页是脱敏的"，否则一线会以为能看到别人全貌 */
  ok(/本页已脱敏/.test(kbHtml), '头部有脱敏说明');
  ok(/不含被访谈人姓名、工号、所属机构与原始对话/.test(kbHtml), '脱敏说明写清了剔除了哪几类');

  /* 三视图：动作（主轴）/ 场景（辅轴）/ 全部 */
  ok(/function renderStages\(\)/.test(kbHtml), '动作索引视图');
  ok(/function renderStageDetail\(name\)/.test(kbHtml), '动作详情视图');
  ok(/function renderTopics\(\)/.test(kbHtml), '场景索引视图');
  ok(/function renderTopicDetail\(name\)/.test(kbHtml), '场景详情视图');
  ok(/function renderAll\(\)/.test(kbHtml), '全部做法视图');
  ok(/function cardHtml\(c\)/.test(kbHtml), '做法卡片渲染');
  ok(/早期报告 · 要素不全/.test(kbHtml), 'basic 档卡片带「早期报告」标记');

  /* ★ 默认视图 = 按动作看，且动作索引不按数量排序（顺序本身是信息） */
  ok(/let view = 'act';/.test(kbHtml), '默认视图是「按动作看」');
  const stagesFn = kbHtml.match(/function renderStages\(\) \{[\s\S]*?\n\}/);
  ok(!!stagesFn, '取到 renderStages 函数体');
  ok(stagesFn && !/\.sort\(/.test(stagesFn[0]),
    '★ 动作索引不做排序（沿用服务端的客户旅程顺序）');
  const sortedFn = kbHtml.match(/function renderTopics\(\) \{[\s\S]*?\n\}/);
  ok(sortedFn && !/\.sort\(/.test(sortedFn[0]),
    '场景索引也不在页面重排（服务端已按做法数排好）');

  /* 双维度标签：阶段必显示，场景为空就不显示（不许把「通用」当标签挂满页） */
  ok(/tag act/.test(kbHtml), '阶段标签有独立样式类');
  ok(!/esc\(c\.scene \|\| '通用'\)|>通用</.test(kbHtml), '★ 不在卡片上把「通用」渲染成标签');

  /* 缺失要素：full 档渲染「未问到」，不要把空白当内容 */
  ok(/未问到/.test(kbHtml), '全要素卡片缺项显示「未问到」');

  /* 转义：来自报告正文的每一处插值都必须过 esc()，否则正文里的尖括号会破版
     （报告是模型输出的 markdown，含 < > & 是常态）
     判定法：函数体里不许出现"直接拼未转义的 c.xxx"——一律写 esc(c.xxx)。 */
  ok(/const esc = /.test(kbHtml), '有 esc 转义函数');
  const cardFn = kbHtml.match(/function cardHtml\(c\) \{[\s\S]*?\n\}/);
  ok(!!cardFn, '取到 cardHtml 函数体');
  if (cardFn) {
    const body = cardFn[0];
    /* ★ 字段名以服务端为准：卡片上是 source_topic / scene / stage（2026-10-12 双维度改造） */
    ['c.title', 'c.body', 'c.source_topic', 'c.scene', 'c.stage', 'c.date'].forEach((v) => {
      const p = v.replace('.', '\\.');
      const escN = (body.match(new RegExp('esc\\(' + p + '[\\s\\S]{0,20}?\\)', 'g')) || []).length;
      ok(escN >= 1, 'cardHtml 里 ' + v + ' 经 esc() 输出', escN + ' 处');
    });
    /* 反向：任何 `+ c.xxx` 形式的直接拼接都是漏转义 */
    const leak = body.match(/\+ *(c\.(?:title|body|source_topic|scene|stage|date)\b)/g) || [];
    ok(leak.length === 0, 'cardHtml 里没有绕过 esc() 的直接拼接', leak.join(' | '));
    ok(/esc\(FL\[k\]\)/.test(body), '要素名经 esc()');
    ok(/esc\(q\)/.test(body), '原话经 esc()');
  }

  /* 三端职责与访问边界表格 —— 用户明确要求"明确三者的职责与访问边界" */
  const bd = kbHtml.match(/<details class="boundary">[\s\S]*?<\/details>/);
  ok(!!bd, '底部有职责与边界区块');
  if (bd) {
    ['给谁用', '入口', '口令', '能看什么', '能做什么', '数据流向'].forEach((r) => {
      ok(bd[0].indexOf(r) >= 0, '边界表含「' + r + '」一行');
    });
    ['index.html', 'admin.html', 'kb.html'].forEach((f) => {
      ok(bd[0].indexOf(f) >= 0, '边界表列出入口 ' + f);
    });
    ok(/在服务端就把姓名、工号、所属机构与原始对话全部剔除了/.test(bd[0]),
      '★ 边界说明交代了"脱敏在服务端做，不是前端隐藏"');
  }
}

console.log('\n[5] 三端互不越界');
{
  /* 管理端要有知识库入口（运营岗是"萃取发起方"，由他发现并分享给同事） */
  ok(/href="kb\.html"/.test(adm), '管理端有指向 kb.html 的入口');
  ok(/案例经验库/.test(adm), '入口文案是「案例经验库」');

  /* 访谈页不得出现知识库入口 —— 顾问是来"被访谈"的，塞入口只会分散注意力，
     而且访谈页无口令，不该给一线一个"去看别人案例"的默认路径。 */
  ok(web.indexOf('kb.html') < 0, '访谈页不放知识库入口（三端职责不混）');

  /* 管理端不得内嵌知识库内容（否则等于把脱敏页塞进有口令页，边界没意义） */
  ok(adm.indexOf('/api/kb') < 0, '管理端不直接调用 /api/kb，只外链');
}

console.log('\n[6] 版本号');
{
  /* ★ 只校验格式；精确值的唯一权威断言在 tests/verify-interventions.js */
  ok(/APP_BUILD = 'v20\d{2}\.\d{2}\.\d{2}-[a-z]'/.test(web), '访谈页 APP_BUILD 格式合法',
    (web.match(/APP_BUILD = '[^']*'/) || [''])[0]);
  /* 2026-10-15：改为「不早于」判定（本文件 ok 是先条件后名称，故不用公共模块的 assert） */
  const BV = require('./_build-version.js');
  ok(BV.buildAtLeast((adm.match(/ADMIN_BUILD = '([^']*)'/) || [])[1], 'v2026.10.12-c'),
    '管理端 ADMIN_BUILD 不早于 v2026.10.12-c（知识库入口上线版本）',
    (adm.match(/ADMIN_BUILD = '[^']*'/) || [''])[0]);
  ok(BV.buildAtLeast((kbHtml.match(/KB_BUILD = '([^']*)'/) || [])[1], 'v2026.10.12-d'),
    '知识库 KB_BUILD 不早于 v2026.10.12-d（换「哪些情况不适用」字段名的版本）',
    (kbHtml.match(/KB_BUILD = '[^']*'/) || [''])[0]);
}

console.log('\n[8] ★ kb-stage.js：受约束输出 + 内容锚校验（两个已踩过的坑都要守住）');
{
  const stageSrc = fs.readFileSync(
    path.join(ROOT, 'cloudfunctions', 'interview-proxy', 'kb-stage.js'), 'utf8');
  const tagSrc = fs.readFileSync(
    path.join(ROOT, 'cloudfunctions', 'interview-proxy', 'tagger.js'), 'utf8');
  const ST = require(path.join(ROOT, 'cloudfunctions', 'interview-proxy', 'kb-stage.js'));

  ok(ST.STAGE_NAMES.length === 8, '导出客户旅程八阶段', ST.STAGE_NAMES.join('/'));
  ok(JSON.stringify(ST.STAGE_NAMES) === JSON.stringify(KB.STAGE_NAMES),
    '阶段词表与 kb.js 共用一份定义（两处漂移会让索引和标签对不上）');
  ok(ST.SCENE_NAMES.length === KB.TOPIC_GROUPS.length, '场景词表来自 TOPIC_GROUPS',
    ST.SCENE_NAMES.length + ' vs ' + KB.TOPIC_GROUPS.length);
  /* ★ 坑 1：预算不够时，这个任务的推理会把预算吃光（content 为空串、
     finish_reason=length），业务层只看到「分类失败」。4000 不够、8000 仍有整份判不完的。
     现在给到 16000，配套 socket 超时也要放宽（默认 60s 会先于预算触发）。 */
  ok(ST.MAX_TOKENS >= 16000,
    '★ 输出预算 ≥ 16000（实测推理 4000–8000+ token 起伏，给 4000 必被吃光）',
    String(ST.MAX_TOKENS));
  ok(ST.STAGE_TIMEOUT_MS > 60000,
    '★ socket 超时随之放宽（大预算下 60s 会先触发 tag_timeout，被误判成网络抖动）',
    String(ST.STAGE_TIMEOUT_MS));
  ok(/timeoutMs: STAGE_TIMEOUT_MS/.test(stageSrc),
    '分类与探针都显式传 timeoutMs');

  /* ── 提示词契约 ── */
  const p = ST.buildStagePrompt(
    [{ title: '面谈嫌费率时，先打压再给「先用后结清」', fields: { when: '面谈当场' }, body: '' }],
    { topic: '棱镜签约' });
  /* ★ 坑 2：tagger.parseJsonLoose 显式拒绝数组（`!Array.isArray(v)`），
     提示词若要求输出裸数组，解析恒为 null、matched 恒为 0 —— 首次上线就是这么挂的。 */
  ok(/\{"items":\[/.test(p), '★ 提示词要求输出 {"items":[...]} 对象，不是裸数组');
  ok(p.indexOf('绝大多数做法') >= 0 || p.indexOf('大多数做法是放之四海皆准的通用招式') >= 0,
    '提示词明确说了多数做法是通用招式（给模型一个「别硬靠」的出口）');
  ok(p.indexOf('宁可多选') >= 0, '提示词给了「宁可选通用」的取向');
  ok(p.indexOf('不代表') >= 0, '★ 提示词交代「报告标题不代表每条做法都属于该场景」');
  ok(p.indexOf('棱镜签约') >= 0, '报告主题作为背景写进提示词（但明确不许被它带跑）');
  ok(String(p).indexOf(String.fromCharCode(96)) < 0,
    '提示词里没有 markdown 反引号（会终止模板串 → Unexpected identifier）');
  ST.STAGE_NAMES.forEach((n) => ok(p.indexOf(n) >= 0, '提示词列出阶段「' + n + '」'));
  ST.SCENE_NAMES.forEach((n) => ok(p.indexOf(n) >= 0, '提示词列出场景「' + n + '」'));

  /* ── 解析与对齐（真跑，用真实卡片形状） ── */
  const cards = [
    { title: '面谈嫌费率时，先打压再给「先用后结清」', fields: {}, body: '' },
    { title: '签约核查时逐一核对资料', fields: {}, body: '' },
    { title: '约不到客户就直接上门', fields: {}, body: '' },
  ];
  const mkItems = (fn) => JSON.stringify({ items: cards.map(fn) });
  const good = mkItems((c, i) => ({
    i: i, title: c.title.slice(0, 10), stage: ST.STAGE_NAMES[i], scene: i ? '通用' : '棱镜签约' }));
  const r1 = ST.normalizeStageResult(ST.parseStageOutput(good), cards);
  ok(r1.matched === 3 && r1.anchored === 3 && r1.dropped === 0,
    '对象形态：3 条全部靠标题锚定', JSON.stringify(r1));

  const bare = '先说两句\n' + JSON.stringify(cards.map((c, i) => ({
    i: i, title: c.title.slice(0, 10), stage: ST.STAGE_NAMES[i], scene: '通用' })));
  ok(ST.normalizeStageResult(ST.parseStageOutput(bare), cards).matched === 3,
    '★ 裸数组（模型忽略格式要求时）也能解析');

  /* ★ 下标与标题不一致 → 以标题为准（这类任务最易出的错是顺序错位） */
  const mism = mkItems((c, pos) => {
    const src = [2, 1, 0][pos];
    return { i: pos, title: cards[src].title.slice(0, 10), stage: ST.STAGE_NAMES[src], scene: '通用' };
  });
  const r3 = ST.normalizeStageResult(ST.parseStageOutput(mism), cards);
  ok(r3.anchored === 3, '★ 下标与标题冲突时按标题锚定（3 条全锚定）', JSON.stringify(r3));
  ok(r3.labels[2] && r3.labels[2].stage === ST.STAGE_NAMES[2],
    '★ 第 3 张卡拿到的是写着自己标题的那条结果（下标不可信）');
  ok(r3.labels[0] && r3.labels[0].stage === ST.STAGE_NAMES[0], '第 1 张卡同样被纠正回来');

  /* 位置兜底：标题抄歪时不至于整份丢弃 */
  const bad = mkItems((c, i) => ({ i: i, title: '我乱写的标题' + i, stage: ST.STAGE_NAMES[1], scene: '通用' }));
  const r4 = ST.normalizeStageResult(ST.parseStageOutput(bad), cards);
  ok(r4.positional === 3 && r4.anchored === 0, '★ 标题抄歪 → 位置兜底生效', JSON.stringify(r4));

  /* 宁缺毋滥：闭集外的值必须丢，不许塞猜的 */
  const junk = JSON.stringify({ items: [
    { i: 0, title: cards[0].title.slice(0, 10), stage: '乱写的阶段', scene: '乱写的场景' },
    { i: 99, title: 'x', stage: ST.STAGE_NAMES[0], scene: '通用' },
  ] });
  const r5 = ST.normalizeStageResult(ST.parseStageOutput(junk), cards);
  ok(r5.matched === 0 && r5.dropped === 2,
    '★ 闭集外的阶段/场景与越界下标一律丢弃', JSON.stringify(r5));
  ok(ST.normalizeStageResult(ST.parseStageOutput('我拒绝输出 JSON'), cards).matched === 0,
    '垃圾输入不炸，返回全 null（调用方按失败处理）');
  ok(ST.normalizeStageResult(ST.parseStageOutput(''), cards).labels.length === 3,
    'labels 与 cards 同长（下标对齐的前提）');

  ok(ST.titleMatches('面谈嫌费率时，先打压', '面谈嫌费率时先打压再给') === true,
    '标题比对忽略标点差异');
  ok(ST.titleMatches('约见推进', '获客开发') === false, '短标题不同就不认（防误粘）');

  /* ── 服务端接线 ── */
  ok(/action === "kb_stage"/.test(srv), 'index.js 有 kb_stage 动作');
  ok(/kb_stages_at=is\.null/.test(srv), 'kb_stage 支持按「未分类」补跑');
  ok(/kb_stages: out\.labels/.test(srv), '分类结果写回 kb_stages');
  ok(/if \(out\.parse_failed\) throw new Error\("stage_parse_failed"\)/.test(srv),
    '★ 一条都没对上时抛错、不写库（不把失败当成功）');
  ok(/body\.probe === true/.test(srv), '有「只探测不写库」的探针出口（排障第一个取证物）');
  ok(/retries: 0/.test(srv), '★ 函数内不重试（一次调用约 45s，重试必撞 60s 函数超时）');

  /* tagger 提供原始返回，探针才拿得到 finish_reason / usage */
  ok(/function callDeepseek\(apiKey, prompt, model, maxTokens, opts\)/.test(tagSrc),
    'callDeepseek 签名带 maxTokens + opts');
  ok(/opts && opts\.timeoutMs/.test(tagSrc),
    'callDeepseek 的 socket 超时可由调用方覆盖');
  ok(/opts && opts\.raw/.test(tagSrc) && /finish_reason: choice\.finish_reason/.test(tagSrc),
    'tagger 支持 raw 模式（探针要 finish_reason/usage 才能区分三种失败成因）');
  ok(/const rawMode = /.test(tagSrc), 'raw 标志改名避开 http 回调里的 raw（响应原文）遮蔽');
}

console.log('\n[7] 同义词检索（jsdom 真跑页面搜索，不看字面）');
{
  const { JSDOM } = require('jsdom');

  /* 夹具：三张卡，刻意让"同一个意思、不同说法"真实存在 ——
     卡 1-1 说「周转」、卡 1-2 说「放款截图」、卡 2-1 说「到账」。
     这三组词必须能互相搜到，否则同义词表就是摆设。 */
  const FX = {
    generated_at: 'fixture',
    field_labels: KB.FIELD_LABELS,
    stage_names: KB.STAGE_NAMES,
    stats: { reports: 2, topics: 2, stages: 1, cards: 3, full: 3, basic: 0, quoted: 0, masked: 0 },
    topics: [
      { name: '客户转介绍', cards: [], cases: [] },
      { name: '批款后的跟进与服务', cards: [], cases: [] },
    ],
    /* ★ 默认视图已经改成「按动作看」，boot() 一进来就会渲染 stages ——
       夹具缺这个键会让页面在 boot 阶段直接抛错（而且 [7] 只关心搜索，容易误判成搜索坏了）。 */
    stages: [
      { name: '获客开发', cards: [], cases: [] },
    ],
    cases: [],
    cards: [
      { key: '1-1', report_id: 1, scene: '客户转介绍', scene_by: 'model', stage: '获客开发',
        source_topic: '老客户转介绍', grade: 'full',
        title: '回访时顺带问一句', body: '', fields: { how: '客户说手头紧、要周转' },
        missing: [], absent: [], quotes: [], date: '2026-10-01' },
      { key: '1-2', report_id: 1, scene: '客户转介绍', scene_by: 'model', stage: '获客开发',
        source_topic: '老客户转介绍', grade: 'full',
        title: '晒批款记录', body: '', fields: { how: '把放款截图发到朋友圈' },
        missing: [], absent: [], quotes: [], date: '2026-10-01' },
      { key: '2-1', report_id: 2, scene: '批款后的跟进与服务', scene_by: 'model', stage: '批款后服务',
        source_topic: '批款跟进', grade: 'full',
        title: '到账当天致电', body: '', fields: { how: '到账当天打电话' },
        missing: [], absent: [], quotes: [], date: '2026-10-02' },
    ],
  };

  const script = (kbHtml.match(/<script>([\s\S]*?)<\/script>/) || [])[1];
  const shell = kbHtml.replace(/<script>[\s\S]*?<\/script>/, '');
  const dom = new JSDOM(shell, { runScripts: 'dangerously', url: 'http://127.0.0.1:8899/kb.html' });
  const w = dom.window;
  w.fetch = () => Promise.resolve({ json: () => Promise.resolve(FX) });
  /* 末尾补一行把同义词表暴露出来：顶层 const 在后续 eval 里读不到，
     只有同一次 eval 内可见（jsdom 的老坑）。 */
  w.eval(script + '\n;window.__SYN = SYN_GROUPS;');

  return new Promise((resolve) => setTimeout(resolve, 60)).then(() => {
    const doc = w.document;
    const setQ = (v) => {
      const q = doc.getElementById('q');
      q.value = v;
      q.dispatchEvent(new w.Event('input', { bubbles: true }));
      return doc.querySelectorAll('.card').length;
    };

    doc.getElementById('v-all').onclick();

    /* (a) 结构：表本身立得住 */
    const SYN = w.__SYN;
    ok(Array.isArray(SYN) && SYN.length >= 5, '同义词表已加载', String(SYN && SYN.length) + ' 组');
    ok(SYN.every((g) => Array.isArray(g) && g.length >= 2), '每组至少 2 个说法');
    ok(SYN.every((g) => g.every((t) => typeof t === 'string' && t === t.trim() && t === t.toLowerCase() && t.length >= 2)),
      '所有词都是 ≥2 字的小写词（与 kw 的 lowercase 口径一致）');
    const seen = {};
    const dupes = [];
    SYN.forEach((g) => g.forEach((t) => { if (seen[t]) dupes.push(t); seen[t] = 1; }));
    ok(dupes.length === 0, '★ 没有跨组重复的词（重复会让搜索意图变歧义）', dupes.join('、'));

    /* (b) 端到端：口语词要能命中书面词的卡片 */
    ok(setQ('周转') === 1, '搜「周转」命中 1 张', String(setQ('周转')));
    ok(setQ('没钱') === 1, '★ 搜「没钱」也命中同一张（同义词生效，语料里并没有"没钱"这个词）',
      String(setQ('没钱')));
    ok(setQ('资金紧张') === 1, '★ 搜「资金紧张」同样命中', String(setQ('资金紧张')));
    ok(setQ('到账') === 2, '搜「到账」命中 2 张（到账 + 放款截图同组）', String(setQ('到账')));
    ok(setQ('放款') === 2, '搜「放款」命中同样 2 张（与「到账」互认）', String(setQ('放款')));

    /* (c) 多词 AND：单独都有结果，合起来没有 → 必须是 0 */
    ok(setQ('周转') > 0 && setQ('朋友圈') > 0, '两个词单独搜都有结果');
    ok(setQ('周转 朋友圈') === 0, '★ 空格分隔 = 同时满足（AND），不是任一命中', String(setQ('周转 朋友圈')));
    ok(setQ('  周转   ') === 1, '多余空格被忽略，不会变成空词');

    /* (d) 空态 */
    ok(setQ('zzz不存在zzz') === 0 && /没有匹配/.test(doc.getElementById('main').textContent),
      '搜不到时给空态提示');

    /* (e) 提示文案：口径要让用户看得懂 */
    const hint = doc.getElementById('q-hint');
    ok(!!hint && /空格隔开/.test(hint.textContent), '提示里说明了「空格=同时满足」');
    ok(!!hint && /同义词/.test(hint.textContent), '提示里说明了会自动连同义词一起找');

    console.log('\n' + '─'.repeat(56));
    console.log('案例经验库护栏：' + pass + ' 通过 / ' + fail + ' 失败');
    w.close();
    process.exit(fail ? 1 : 0);
  });
}
