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
      '   失效边界：他提到客户都是新客户，未说明对老客户是否适用',
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

console.log('\n[1] 解析：主题归并 / 两种格式变体 / 六要素');
{
  const out = KB.buildKb(ROWS, { maskWords: MASK.slice() });

  ok(out.stats.reports === 3, 'reports 计数', JSON.stringify(out.stats));

  /* 主题归并：两份散乱主题各归到一个组，第三份不被规则命中就保留原主题 */
  const names = out.topics.map((t) => t.name);
  ok(names.indexOf('客户转介绍') >= 0, '「存量客户转介绍怎么做」归并到「客户转介绍」', names.join(' / '));
  ok(names.indexOf('转化率提升') >= 0, '「提升转化率的做法」归并到「转化率提升」');
  ok(names.indexOf('某个没被归并规则覆盖的主题') >= 0, '未命中规则的主题保留原文，不强行归类');

  const t101 = out.topics.filter((t) => t.name === '客户转介绍')[0];
  const t102 = out.topics.filter((t) => t.name === '转化率提升')[0];

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

  /* 缺失标记：整条就是"没问出来" → missing；空值 → absent */
  const c2 = t101.cards[1];
  ok(c2.missing.indexOf('how') >= 0, 'how=（访谈中未提到）→ 标 missing', JSON.stringify(c2.missing));
  ok(c2.absent.length >= 1, '没写出来的要素进 absent', JSON.stringify(c2.absent));

  /* ★ MISSING_RE 必须整条锚定：这句含"未说明"但是**有效的失效边界** */
  ok(KB.MISSING_RE.test('（访谈中未提到）') === true, 'MISSING_RE：整条"未提到"判为缺失');
  ok(KB.MISSING_RE.test(c1.fields.boundary) === false,
    '★ MISSING_RE：含"未说明"但内容是有效边界的句子不判缺失', c1.fields.boundary);

  /* 原话抽取「」『』，且缺失说明不算原话 */
  ok(c1.quotes.length === 1 && c1.quotes[0] === '最近在忙什么', '原话抽取', JSON.stringify(c1.quotes));
  ok(c2.quotes.length === 0, '缺失说明里的括号内容不当原话');

  /* case 层：轮次 / 日期 / 旧模板标记 / 结果文本 */
  const case101 = t101.cases[0];
  ok(case101.rounds === 18, 'case.rounds 取 round_count');
  ok(case101.date === '2026-10-11', 'case.date 取 created_at 前 10 位', case101.date);
  ok(case101.old_template === false, '10 月的报告不标早期模板');
  ok(t102.cases[0].old_template === true, '9/20 的报告标早期模板（< 09-30）');
  ok(case101.result && case101.result.indexOf('3 个客户') >= 0, 'case.result 取自「结果」节');

  /* 第 3 份没有做法，仍要出现在主题索引里（不能整份丢掉） */
  const t103 = out.topics.filter((t) => t.name === '某个没被归并规则覆盖的主题')[0];
  ok(t103 && t103.cards.length === 0 && t103.cases.length === 1,
    '没有做法的报告也留在主题索引里（只是 0 条做法）');

  /* 节标题别名：旧报告的「新人注意事项」等价于「新人容易踩的坑」 */
  ok(t102.cases[0].pitfalls && t102.cases[0].pitfalls.indexOf('承诺批款') >= 0,
    '节标题别名「新人注意事项」被识别');
  ok(t101.cases[0].pitfalls && t101.cases[0].pitfalls.indexOf('报价') >= 0,
    '节标题「新人容易踩的坑」被识别');
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
  ['id', 'created_at', 'topic', 'round_count', 'report_md', 'interviewee_name', 'backend_owner_name']
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
  ok(/const KB_BUILD = 'v2026\.10\.12-a';/.test(kbHtml), 'KB_BUILD 已声明',
    (kbHtml.match(/KB_BUILD = '[^']*'/) || [''])[0]);
  ok(/\/api\/kb'/.test(kbHtml), 'KB_API 指向 /api/kb');

  /* 页面必须在最显眼处告诉读者"这页是脱敏的"，否则一线会以为能看到别人全貌 */
  ok(/本页已脱敏/.test(kbHtml), '头部有脱敏说明');
  ok(/不含被访谈人姓名、工号、所属机构与原始对话/.test(kbHtml), '脱敏说明写清了剔除了哪几类');

  /* 两层结构：主题索引 + 做法卡片 */
  ok(/function renderTopics\(\)/.test(kbHtml), '主题索引视图');
  ok(/function renderTopicDetail\(name\)/.test(kbHtml), '主题详情视图');
  ok(/function renderAll\(\)/.test(kbHtml), '全部做法视图');
  ok(/function cardHtml\(c\)/.test(kbHtml), '做法卡片渲染');
  ok(/早期报告 · 要素不全/.test(kbHtml), 'basic 档卡片带「早期报告」标记');

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
    ['c.title', 'c.body', 'c.topic', 'c.topic_raw', 'c.date'].forEach((v) => {
      const p = v.replace('.', '\\.');
      const escN = (body.match(new RegExp('esc\\(' + p + '[\\s\\S]{0,20}?\\)', 'g')) || []).length;
      ok(escN >= 1, 'cardHtml 里 ' + v + ' 经 esc() 输出', escN + ' 处');
    });
    /* 反向：任何 `+ c.xxx` 形式的直接拼接都是漏转义 */
    const leak = body.match(/\+ *(c\.(?:title|body|topic|topic_raw|date)\b)/g) || [];
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
  ok(/APP_BUILD = 'v2026\.10\.12-f'/.test(web), '访谈页 APP_BUILD',
    (web.match(/APP_BUILD = '[^']*'/) || [''])[0]);
  ok(/ADMIN_BUILD = 'v2026\.10\.12-c'/.test(adm), '管理端 ADMIN_BUILD（加知识库入口后 bump）',
    (adm.match(/ADMIN_BUILD = '[^']*'/) || [''])[0]);
  ok(/KB_BUILD = 'v2026\.10\.12-a'/.test(kbHtml), '知识库 KB_BUILD（新建）');
}

console.log('\n' + '─'.repeat(56));
console.log('案例经验库护栏：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
