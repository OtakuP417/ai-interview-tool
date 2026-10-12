"use strict";
/**
 * importer.js — 把已有的访谈稿转写成经验库能解析的 report_md
 *
 * 【为什么需要它】2026-10-12 导入 17 份「领航之声」历史访谈稿（15 人）。
 * 这些稿子是三种形态混杂：原始逐字问答转写稿 / 整理过的访谈记录 / 已写好的经验总结。
 * 没有一份是 report_md 格式，而经验库 kb.js 正是按
 * 「---SECTION--- 七节 + 可复制的经验点六要素」解析卡片的 —— 所以必须先转写。
 *
 * 【两条硬约束】
 *   ① **输出结构必须与 web/index.html 的 REPORT_PROMPT 逐项一致**：
 *      节名、节序、六要素键名、---SECTION--- 的数量（6 个）。
 *      kb.js 的 SECTIONS 别名与 FIELDS 正则认的就是这几个词 —— 改一边就必须改两边。
 *      护栏：tests/verify-import.js 直接抽取两个文件里的结构要求做比对。
 *   ② **只生成、不写库**（与 ai_edit 同一原则）。
 *      写库走 /api/admin 的 import_insert，中间隔一道人工校对 ——
 *      这类批量导入一旦写错，纠错成本远高于先看一眼。
 *
 * 【提示词为什么这么长】与 REPORT_PROMPT 同源。经验库解析是**格式敏感**的：
 * 少一个分隔符、六要素少写一行，卡片就会缺要素或整条解析不出来。
 * 所以宁可提示词啰嗦，也不让模型自由发挥格式。
 *
 * 零 npm 依赖；底层调用复用 tagger.callDeepseek。
 */

const tagger = require("./tagger");

const DEFAULT_MODEL = "deepseek-v4-flash";

/* deepseek-v4-flash 是推理模型，推理 token 也计入 max_tokens 预算。
   ★ 本模块的实测数据（2026-10-12，4300 字原稿）：
       max_tokens=12000 → 空内容（推理就吃掉 13545，正文一个字没写）
       max_tokens=16000 → finish_reason=length，正文写到「海报摘要」节断掉
       usage: completion_tokens=16000，其中 reasoning_tokens=13545（85%！）
     也就是说这个任务**推理就要 13000+，正文另需 3500** —— 16000 一定不够。
     所以起步 24000，撞 length 再用 32000 重试。

   ★ 与「报告生成」场景的差异：项目里记录过「16000 让模型返回空 content」。
     那是**访谈对话**场景（prompt 更长）。本模块实测 16000 是有内容的（只是截断），
     所以这里敢往上加。两个场景不要互相外推，各自以本模块的实测为准。 */
const MAX_TOKENS = 24000;
const RETRY_TOKENS = 32000;
const TIMEOUT_MS = 240000;

/* 输入上限。现存最长稿子 8100 字，留足余量；超长直接截断并记 warning，
   绝不把整本稿子塞进去把预算撑爆。 */
const MAX_INPUT_CHARS = 30000;

/**
 * 构建转写提示词。
 * ★ 模板串里不能出现 markdown 反引号（会终止字符串），用「」代替。
 *
 * @param {object} meta { name, position, topic }
 */
function buildImportPrompt(meta) {
  const m = meta || {};
  const name = String(m.name || "").trim() || "（未署名）";
  const position = String(m.position || "").trim() || "咨询顾问";
  const topic = String(m.topic || "").trim() || "（未定主题）";

  const L = [];
  L.push("你是平安融易（融资担保 / 助贷）的业务训练编辑。");
  L.push("任务：下面是一份**已有的访谈稿**，请把它转写成一份结构化案例经验报告。");
  L.push("这份报告会进公司内部的经验库，读者是没做过这件事的一线同事。");
  L.push("");
  L.push("【访谈对象】" + name + "（" + position + "）");
  L.push("【案例主题】" + topic);
  L.push("");
  L.push("【稿子可能是什么形态 · 先判断一下】");
  L.push("它可能是下面三种之一，处理方法不同：");
  L.push("· **逐字问答转写稿**（带时间戳、一问一答、有大量口语和重复）：");
  L.push("  提问者的话只是线索，**不要写进报告**；只萃取被访谈人讲的经验。");
  L.push("  这类稿子信息最全、也最杂，需要你自己归纳，不要照抄对话。");
  L.push("· **整理过的访谈记录**（已去掉口语、保留问答或分节小标题）：直接取材即可。");
  L.push("· **已经写好的经验总结**（叙述体、有标题）：它已经是二手提炼 ——");
  L.push("  ★ 特别小心：不要把它的概括性表述当成结论照搬（「注重细节」「建立信任」这类）。");
  L.push("  要尽量还原成可执行的动作；如果原稿里已经没有动作细节，");
  L.push("  就如实写「（稿子中未展开）」，不要用行业通用说法把它填满。");
  L.push("");
  L.push("【这份报告要回答的问题 · 先看这条】");
  L.push("上面这个主题，就是这份报告必须回答的问题。写完自己检查一遍：");
  L.push("一个没参加过访谈的人，读完这份报告，能不能回答「" + topic + "」？");
  L.push("答不上的部分，**在该节里明确写「稿子中未覆盖主题中的 XX」**，不要用行业通用说法把它填满。");
  L.push("");
  L.push("【本书写总则 · 先看这条】");
  L.push("这份报告的唯一用途是让没做过这件事的同事照着做，所以判断标准只有一条：");
  L.push("读完这一节，同事能不能在明天就把动作做出来？");
  L.push("凡是只有动作名、没有做法的句子（「定期维护」「加强沟通」「主动转介绍」「做好服务」），");
  L.push("一律不合格，必须写清具体怎么做。");
  L.push("");
  L.push("【四条最容易写不合格的地方 · 写完自查】");
  L.push("1. **只报结果、没有参照系**：光写「做到 300 万」，读者不知道这是好还是坏。");
  L.push("   凡是出现结果数字，必须同时给出参照（团队平均 / 他自己的平时水平 / 同条件同事的档次）。");
  L.push("   稿子里没提到参照，就写「（稿子中未提到参照系）」，不要自己造一个。");
  L.push("2. **只写选了什么、没写放弃了什么**：判断与取舍一节如果只写「他决定先做老客户」，");
  L.push("   读者学不到边界。**但凡稿子里提到过取舍的地方**（放弃了某类客户、换过做法、");
  L.push("   对不同客户分档处理），都要写清另外那条路是什么、为什么不行。");
  L.push("   ⚠️ 但**不是每条做法都有取舍** —— 很多做法是条件使然，根本不是二选一。");
  L.push("   这类做法**不要硬凑一条「被否掉的路」**，这一段整个不写即可；凑出来的那条是编造。");
  L.push("3. **一条做法里一句原话都没有**：核心做法每一步至少要保住一句被访谈人的原话");
  L.push("   （用「」标出），原话是这份报告最不可替代的部分。");
  L.push("   **确实没有原话的步骤，那一行写「（访谈中未留下原话）」，不要自己造一句。**");
  L.push("4. **只用了稿子前半段的内容**：访谈是按时间推进的，越往后问得越深");
  L.push("   （利息怎么接、被截单怎么复盘、什么情况下这招就不管用了）。");
  L.push("   **这些后段内容往往比前段更值钱，不许因为「不合主线」或「前面已经写过流程了」就丢掉。**");
  L.push("   动笔前先自查：稿子最后三分之一里，有几条内容进了这份报告？");
  L.push("");
  L.push("【不许编造 · 最后再看一遍】");
  L.push("只写稿子里出现过的内容。不要补充访谈对象没说的经验、数字、话术、工具或案例。");
  L.push("稿子里没提到的细节，就写「这一点稿子中未展开」，不要用行业通用说法把它填满。");
  L.push("宁可少写一条，不要凑数。");
  L.push("★ 凡是「稿子里确实没有」的地方，**只用下面这几种写法，不要自创**");
  L.push("  （经验库靠这几句话认出「这里本来就空」，换个说法就会被当成正常内容显示出来）：");
  L.push("  （稿子中未展开）／（稿子中未提到）／（稿子中未留下原话）／（稿子中未覆盖主题中的 XX）");
  L.push("★ 逐字稿常有同音字转写错误（例如把「咨询本」写成「资本」、把「老白」写成「老班」）。");
  L.push("  引用原话时，你可以按上下文改掉**明显**的错别字，但");
  L.push("  **不得改变语义、不得添加原文没有的内容**；拿不准就照原样引，不要猜。");
  L.push("");
  L.push("严格按照以下格式输出，每个部分之间用「---SECTION---」分隔：");
  L.push("");
  L.push("【分隔符 · 必须逐字符照抄，这是最容易写错的地方】");
  L.push("节与节之间**只能**写这 13 个字符：---SECTION--- （三横线 + SECTION + 三横线）。");
  L.push("· 不许写成 ---、----、***、===、—— 或空行");
  L.push("· 不许写成 --- SECTION ---、--SECTION--、---section---");
  L.push("· 不许给分隔符加缩进、编号或说明文字");
  L.push("每写完一节就立刻敲这 13 个字符，再开始下一节。报告总共要有 6 个这样的分隔符（7 节）。");
  L.push("★ 每一节的**第一行必须是节名本身**（背景与挑战 / 核心做法 / 关键判断与取舍 / 结果 /");
  L.push("  可复制的经验点 / 新人容易踩的坑 / 海报摘要），从第二行起才是这一节的内容；");
  L.push("  千万不要把内容的第一行当成节名（经验库是按节名找内容的，丢了节名整节就读不出来）。");
  L.push("");
  L.push("背景与挑战");
  L.push("（2-3 句话描述案例发生的背景，面临什么问题或机会。只写稿子里出现过的背景。）");
  L.push("---SECTION---");
  L.push("核心做法");
  L.push("（不要罗列人生经历，要写他实际怎么做的，用「1. 2. 3.」编号分步。");
  L.push("每一步必须写清：什么时间/什么条件下做、具体怎么做的（动作、频次、载体）。");
  L.push("能被别人直接照搬的细节要保留，例如「每周五下午翻一遍批款名单，挑出额度到账满三天的客户」。");
  L.push("**每一步的末尾必须带一行原话**，格式为「原话：『……』（谁说的）」，");
  L.push("把被访谈人当时说的那句话原样抄进来，不要转述、不要润色。");
  L.push("例： 原话：『哥，款到了记得查一下，有问题随时找我』（某顾问）");
  L.push("★ 原话的归属一律写「（某顾问）」，**不要写真实姓名**。");
  L.push("如果这一步确实没留下原话，就写「原话：（访谈中未留下原话）」，不要自己造一句。");
  L.push("如果某一步的细节稿子里没有，直接写「（稿子中未展开）」，不要凭空补。）");
  L.push("---SECTION---");
  L.push("关键判断与取舍");
  L.push("（稿子里出现过的决策点各写一条，用「1. 2. 3.」编号。");
  L.push("**每条必须写成三段式，缺一段这条就不合格**：");
  L.push("");
  L.push("* 可选走法：当时面前摆着几条路（至少列 2 条，用 A/B 标出，一句话一条）");
  L.push("* 选择依据：他根据什么选的，要落到可观察的信号（客户说了什么、做了什么，");
  L.push("  哪个名单/哪条数据），不要写成「凭经验感觉」");
  L.push("* 被否掉的那条路为什么不行：他放弃的那条路是哪个、为什么放弃");
  L.push("");
  L.push("如果稿子确实没提到其他走法，第三段写「（他没提到其他走法）」，不要替他编一个。）");
  L.push("---SECTION---");
  L.push("结果");
  L.push("（量化结果优先；没有数字就写对方的描述性反馈。如果连描述性反馈也没有，写「稿子中未提供结果信息」。");
  L.push("**只要出现了结果数字，这一节的最后必须单独加一行「团队参照：」**，");
  L.push("写清这个数字相对团队平均 / 他自己平时 / 同条件同事处于什么水平。");
  L.push("例：团队参照：同期营业部人均约 5 单，他做了 12 单，属于靠前的那一档");
  L.push("   稿子里没提到参照，就写「团队参照：（稿子中未提到）」，不要自己编一个。）");
  L.push("---SECTION---");
  L.push("可复制的经验点");
  L.push("（写 2-4 条。每一条必须严格按下面两层结构写，两层都要有内容：");
  L.push("");
  L.push("* 做法：一句话，讲清「在什么情况下可以做什么」，不超过 40 字。");
  L.push("  具体怎么做：");
  L.push("  - 频次/时机：（多久一次、什么时候做。没有明确频次就写「没有固定频次，视情况」）");
  L.push("  - 话术/方法：（他原话怎么说的，或者具体操作步骤。尽量引用他的原话，用引号标出）");
  L.push("  - 载体/工具：（微信、电话、当面、哪个名单、哪张表）");
  L.push("  - 对方没反应时怎么办：（客户不回、拒绝、拖延时的应对）");
  L.push("  - 触发信号：（出现什么信号就该启动这个动作。要写成可观察的现象，");
  L.push("    例如「客户说『我再考虑一下』超过两次」「批款到账第 3 天没动静」。");
  L.push("    不要写成「客户有需求的时候」这种没法判断的话。没提到就写「（未提到触发信号）」）");
  L.push("  - 哪些情况不适用：（什么情况下这个做法不管用 / 会适得其反。例如「这个做法只在客户已经");
  L.push("    见过一次面的前提下有效，纯陌拜打过去会被当成骚扰」。没提到就写「（未提到哪些情况不适用）」）");
  L.push("");
  L.push("写法示例（注意对比）：");
  L.push("× 不合格：在客户成交后，可以定期维护，长期积累信任。");
  L.push("√ 合格：做法：客户成交后，可以按时间节奏做关系维护。");
  L.push("  具体怎么做：");
  L.push("  - 频次/时机：放款后第 3 天必发一条到账提醒，之后每月月初发一次");
  L.push("  - 话术/方法：第 3 天发「哥，款到了记得查一下，有问题随时找我」；每月月初发跟业务无关的问候，不催不推");
  L.push("  - 载体/工具：微信私聊，不群发、不加表情包");
  L.push("  - 对方没反应时怎么办：两次不回就停 1-2 个月，节日再发一次，别连着追");
  L.push("  - 触发信号：批款到账后第 3 天还没收到客户的回执消息");
  L.push("  - 哪些情况不适用：只在已经见过面、加过微信的客户身上有效；纯电话名单上直接发会被当营销短信");
  L.push("");
  L.push("每条一行开头必须是「做法：」，紧跟「具体怎么做：」，不要合并成一段。）");
  L.push("---SECTION---");
  L.push("新人容易踩的坑");
  L.push("（写 2-3 条容易踩坑的地方，必须是「做的事」而不是「要有的品质」。");
  L.push("每条格式：「在……的时候，容易……，会导致……。可以改成……。」");
  L.push("必须落到具体动作，例如「第一次打电话就推产品，客户一句『暂时不用』就挂断，后面很难再联系上。");
  L.push("可以改成先问对方最近资金周转情况，再谈产品。」");
  L.push("「要保持耐心」「要用心服务」这类只讲态度不讲动作的话，不要写。）");
  L.push("---SECTION---");
  L.push("海报摘要");
  L.push("（这一节是给「一图流」海报用的，会被排成一张横版图发到群里。要求极简、可读。");
  L.push("必须严格按下面的键值格式写，每个键另起一行：");
  L.push("");
  L.push("钩子句：<一句话点出这件事的反差或亮点，20 字以内，要带数字；数字单独用【】括起来>");
  L.push("成果1：<数字>|<这个数字是什么，10 字以内的名词短语>");
  L.push("成果2：<数字>|<这个数字是什么，10 字以内的名词短语>");
  L.push("成果3：<数字或关键词>|<这个数字是什么，10 字以内的名词短语>");
  L.push("做法1标题：<4-6 字>");
  L.push("做法1做法：<一句话讲清在什么条件下做什么，30 字以内>");
  L.push("做法1示例：<他原话怎么说的，或具体到能照搬的细节，30 字以内。尽量用原话>");
  L.push("做法2标题：……");
  L.push("（按上面的四行一组，把核心做法逐条写完，条数与「核心做法」一节一致，最多 8 条）");
  L.push("判断句：<把「关键判断与取舍」里最重要的那条压成一句话，45 字以内。前半是被否掉的那条路，");
  L.push("后半是为什么不行，中间用「——」分开>");
  L.push("避坑句：<把「新人容易踩的坑」里最要紧的那条压成一句话，45 字以内>");
  L.push("");
  L.push("写这一节的硬要求：");
  L.push("1. 每一条都必须能在上面的正文里找到对应，不许为了排版好看而新造内容。");
  L.push("2. 数字必须与正文一致，没有数字就写「暂无」，不要编一个。");
  L.push("3. 字数超了宁可删词，不要写成半句话。");
  L.push("4. ★ 这一节的**第一行仍然是节名「海报摘要」**，从第二行开始才是上面那些键值行；");
  L.push("   键值行本身不要加序号、不要加 markdown 符号、不要再套一层小标题");
  L.push("   （曾把「不要加标题层级」理解成「连节名也不用写」，结果整节丢了标题，");
  L.push("     经验库认不出这一节 → 生成海报时报「缺海报摘要」）。");
  L.push("");
  L.push("【脱敏要求 · 优先级高于内容完整性】");
  L.push("报告正文中不得出现：访谈对象的真实姓名、提问者/主持人的姓名、其他同事的姓名、");
  L.push("客户真实姓名、手机号、身份证号、银行卡号、客户企业全称，以及可识别到具体人的");
  L.push("小区名、单位全称。需要指代时统一用「某先生」「某女士」「某客户」「某商户」等泛称。");
  L.push("访谈对象本人一律称「他」或不带姓名地叙述。");

  return L.join("\n");
}

/* 结构校验：报告能不能被 kb.js 解析出来，取决于分隔符个数与节名。
   这里只做「够不够解析」的最低校验，不阻断 —— 内容好不好由人校对。

   ★ 节名必须用**别名正则**，不能精确匹配：模型偶尔把「可复制的经验点」写成
   「可复制经验点」（少个「的」）。精确匹配会误报缺节，而 kb.js 那边用
   /可复制.{0,2}经验点/ 认得出 —— 于是一份其实完好的报告在校对表里显示成
   「缺节、无卡片」，白白触发重跑。别名表与 kb.js 的 SECTIONS 一一对应，
   由 tests/verify-import.js 断言两边不漂移。 */
const SECTION_ALIASES = [
  ["背景与挑战", /背景|挑战/],
  ["核心做法", /核心做法/],
  ["关键判断与取舍", /关键判断|取舍/],
  ["结果", /^结果/],
  ["可复制的经验点", /可复制.{0,2}经验点/],
  ["新人容易踩的坑", /踩的坑|注意事项/],
  ["海报摘要", /海报摘要/],
];
const SECTION_NAMES = SECTION_ALIASES.map(function (a) { return a[0]; });

function inspect(md) {
  const text = String(md || "");
  const parts = text.split(/^\s*---SECTION---\s*$/m).map(function (s) { return s.trim(); }).filter(Boolean);
  const seen = parts.map(function (s) {
    const nl = s.indexOf("\n");
    return (nl === -1 ? s : s.slice(0, nl)).trim();
  });
  const missing = SECTION_ALIASES.filter(function (a) {
    return !seen.some(function (t) { return a[1].test(t); });
  }).map(function (a) { return a[0]; });
  const skillRe = /可复制.{0,2}经验点/;
  const skillIdx = seen.findIndex(function (t) { return skillRe.test(t); });
  const skillSeg = skillIdx >= 0 ? (parts[skillIdx] || "") : "";
  const cardCount = (skillSeg.match(/做法\s*[：:]/g) || []).length;
  const FIELDS = ["频次/时机", "话术/方法", "载体/工具", "对方没反应时怎么办", "触发信号", "哪些情况不适用"];
  const fieldHits = FIELDS.filter(function (f) { return skillSeg.indexOf(f) >= 0; });
  return {
    sections: parts.length,
    section_names: seen,
    missing_sections: missing,
    separator_count: (text.match(/---SECTION---/g) || []).length,
    card_count: cardCount,
    field_hits: fieldHits,
    parseable: missing.length === 0 && parts.length === 7 && cardCount > 0,
  };
}

/**
 * 把一份访谈稿转写成 report_md。**只生成、不写库。**
 *
 * @param {object} doc  { name, position, topic, text }
 * @param {object} opts { apiKey, model, maxTokens }
 * @returns {Promise<object>} { report_md, model, finish_reason, usage, inspection, warnings }
 */
function extractReport(doc, opts) {
  const o = opts || {};
  if (!o.apiKey) return Promise.reject(new Error("import_no_api_key"));
  const d = doc || {};
  const text = String(d.text || "").trim();
  if (!text) return Promise.reject(new Error("import_no_text"));

  const warnings = [];
  let src = text;
  if (src.length > MAX_INPUT_CHARS) {
    src = src.slice(0, MAX_INPUT_CHARS);
    warnings.push("input_truncated");
  }

  const prompt = buildImportPrompt(d) + "\n\n【以下是访谈稿全文】\n" + src;
  const model = o.model || DEFAULT_MODEL;
  const budget = typeof o.maxTokens === "number" && o.maxTokens > 0 ? o.maxTokens : MAX_TOKENS;

  const once = function (tokens) {
    return tagger.callDeepseek(o.apiKey, prompt, model, tokens, { raw: true, timeoutMs: TIMEOUT_MS });
  };

  return once(budget).then(function (out) {
    const first = {
      finish_reason: out.finish_reason,
      usage: out.usage,
      reasoning_len: String(out.reasoning || "").length,
      content_len: String(out.content || "").length,
      budget: budget,
    };
    let content = String(out.content || "");
    let finish = out.finish_reason;
    /* 撞到 length 说明推理吃掉了预算，报告被截断 —— 加大预算重试一次 */
    if (finish === "length" || !content.trim()) {
      warnings.push("retry_" + (finish || "empty"));
      return once(RETRY_TOKENS).then(function (out2) {
        return {
          out: out2,
          model: out2.model,
          finish_reason: out2.finish_reason,
          diag: {
            first: first,
            retry: {
              finish_reason: out2.finish_reason,
              usage: out2.usage,
              reasoning_len: String(out2.reasoning || "").length,
              content_len: String(out2.content || "").length,
              budget: RETRY_TOKENS,
            },
          },
        };
      });
    }
    return { out: out, model: out.model, finish_reason: finish, diag: { first: first } };
  }).then(function (r) {
    const content = String(r.out.content || "").trim();
    if (!content) {
      /* 空内容要能看出"是哪一次空的、预算多少、推理吃了多少" ——
         否则只有一句 import_empty_content，无从判断该调预算还是该改提示词。 */
      const e = new Error("import_empty_content");
      e.diag = { attempts: warnings, detail: r.diag };
      throw e;
    }
    const ins = inspect(content);
    if (ins.missing_sections.length) warnings.push("missing_sections:" + ins.missing_sections.join(","));
    if (ins.separator_count !== 6) warnings.push("separator_count:" + ins.separator_count);
    if (!ins.card_count) warnings.push("no_cards");
    return {
      report_md: content,
      model: r.model,
      finish_reason: r.finish_reason,
      usage: r.out.usage,
      reasoning_len: String(r.out.reasoning || "").length,
      inspection: ins,
      warnings: warnings,
    };
  });
}

module.exports = {
  buildImportPrompt: buildImportPrompt,
  extractReport: extractReport,
  inspect: inspect,
  SECTION_NAMES: SECTION_NAMES,
  SECTION_ALIASES: SECTION_ALIASES,
  DEFAULT_MODEL: DEFAULT_MODEL,
  MAX_TOKENS: MAX_TOKENS,
  RETRY_TOKENS: RETRY_TOKENS,
  MAX_INPUT_CHARS: MAX_INPUT_CHARS,
};
