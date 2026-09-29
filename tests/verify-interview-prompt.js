/* ─────────────────────────────────────────────────────────────
   访谈提示词规则自检（源码级，不需要浏览器）

   背景：2026-09-28 用 9 份真实报告做定量体检，发现两个确凿缺陷：
     ① 「每次只问一个问题」被普遍违反——最多的一份 22/22 轮都问了 >1 个问号；
     ② 客户短答（≤8 字）共 15 次，其中 12 次（80%）AI 没追问就换话题，
        信息直接丢失（#8 用户 10 轮平均只答 6 字，报告明显偏薄）。
   本测试把这些规则固化成断言，防止以后改提示词时又把规则删掉或说含糊。

   用法：node tests/verify-interview-prompt.js
   ───────────────────────────────────────────────────────────── */
const fs = require("fs");
const path = require("path");

const INDEX = path.join(__dirname, "..", "web", "index.html");
const src = fs.readFileSync(INDEX, "utf8");

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name + (extra ? "  → " + extra : "")); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
}

/* 取出 SYSTEM_PROMPT 与 REPORT_PROMPT 的模板串 */
function grab(name) {
  const i = src.indexOf("const " + name + " =");
  if (i < 0) return "";
  const j = src.indexOf("`;", i);
  return src.slice(i, j < 0 ? i + 20000 : j);
}
const SYS = grab("SYSTEM_PROMPT");
const REP = grab("REPORT_PROMPT");

console.log("\n[1] 提示词存在且可解析");
{
  ok("SYSTEM_PROMPT 取到", SYS.length > 2000, SYS.length + " 字符");
  ok("REPORT_PROMPT 取到", REP.length > 2000, REP.length + " 字符");
  ok("占位符仍然注入", /\$\{n\}/.test(SYS) && /\$\{t\}/.test(SYS) && /\$\{um\}/.test(SYS));
  ok("REPORT_PROMPT 仍注入 ${n}", /\$\{n\}/.test(REP));
}

console.log("\n[2] 「一轮只问一个问题」必须是硬规则（体检发现最常被违反）");
{
  ok("存在该条硬规则标题", /一轮只问一个问题/.test(SYS));
  ok("明确写了「只能有一个问号」", SYS.includes("只能有一个问号"));
  ok("说明是硬性要求而非建议", /硬性要求/.test(SYS) || /硬规则/.test(SYS));
  ok("给了反例（多问号的错误示范）", /✗\s*错/.test(SYS));
  ok("给了正例（只含一个问号）", /✓\s*对/.test(SYS));
  ok("给了自查动作（数问号）", /数一遍问号|自查/.test(SYS));
  ok("给了替代策略（拆成多轮）", /拆成好几轮|宁可多聊两轮/.test(SYS));
  /* 反例文本里确实有 3 个问号——证明示例是真实的多问反例 */
  const bad = SYS.match(/✗\s*错[^：]*：("[^"]+")/);
  ok("反例确实是「多问」的样本", !!bad && (bad[1].match(/？/g) || []).length >= 2,
    bad ? (bad[1].match(/？/g) || []).length + " 个问号" : "未取到");
  const good = SYS.match(/✓\s*对[^：]*：("[^"]+")/);
  ok("正例确实只含 1 个问号", !!good && (good[1].match(/？/g) || []).length === 1,
    good ? (good[1].match(/？/g) || []).length + " 个问号" : "未取到");
}

console.log("\n[3] 短答兜底（体检显示 80% 短答被放过）");
{
  ok("存在短答专章", /对方答得很短时/.test(SYS));
  ok("给出量化判断标准（少于 8 个字）", /少于\s*8\s*个字/.test(SYS));
  ok("明确「这是没答，不是信息」", /不是信息，是没答|是没答/.test(SYS));
  ok("要求就地补问而非跳过", /就地补一枪|就地补问/.test(SYS));
  ok("给了具体短答的应对话术", /对方说"直接打"|"直接打"/.test(SYS));
  ok("提示用选择题替代开放式提问", /选择题|是A还是B/.test(SYS));
  ok("设了止损（同一点最多补两枪）", /最多补两枪/.test(SYS));
  ok("禁止直接说对方答得短", /不要直接说.*答得太短|不要直接说"你答得太短了"/.test(SYS));
  ok("提示补问话术要短", /补问的话术要\*\*短\*\*|话术要短/.test(SYS));
}

console.log("\n[4] 轮次规则不再自相矛盾（原「≥15 轮」与「简短应付就收尾」冲突）");
{
  ok("保留 15 轮下限", /至少\s*15\s*轮/.test(SYS));
  ok("新增「轮次不是目标」小标题", /轮次不是目标/.test(SYS));
  ok("明确「没到 15 轮不要主动收尾」", /没问到\s*15\s*轮之前不要主动收尾|不要主动收尾/.test(SYS));
  ok("给出仅有的两种可提前收尾情形", /这两种情况可以早于\s*15\s*轮收尾|先这样吧/.test(SYS));
  ok("尊重对方明确终止", /对方明确表示不想继续/.test(SYS));
  ok("保留 20 轮上限软提示", /超过\s*20\s*轮/.test(SYS));
  /* 关键：原来自相矛盾的那句必须已改写 */
  ok("已移除「对方明显在简短应付就该收尾」的裸规则",
    !/对方明显在简短应付（"嗯""对""就这样"），说明可挖的已经挖完了/.test(SYS));
  ok("收尾条件已与短答兜底联动（连续三轮 + 已补枪）",
    /连续三轮.*已.*补过一枪|补过一枪仍无进展/.test(SYS));
}

console.log("\n[5] 字数口径必须一致（原 100 字与新增 60 字冲突）");
{
  ok("单问段要求 60 字以内", /60\s*字以内/.test(SYS));
  ok("末轮约束也改成 60 字", /每次回复控制在\s*60\s*字以内/.test(SYS));
  ok("不再残留 100 字口径", !/每次回复控制在\s*100\s*字以内/.test(SYS));
  ok("末轮约束重申只含一个问号", /只含一个问号/.test(SYS));
}

console.log("\n[6] 原有硬规则不得被删（防误改）");
{
  ok("方法层五问仍在", /多久维护一次|多久一次/.test(SYS));
  ok("追问规则仍在", /【追问规则】/.test(SYS));
  ok("访谈框架八步仍在", /【访谈框架】/.test(SYS));
  ok("脱敏要求仍在（SYSTEM）", /【信息脱敏/.test(SYS));
  ok("脱敏优先级高于完整性（REPORT）", /脱敏要求.*优先级高于内容完整性/s.test(REP));
  ok("报告不许编造仍在", /不许编造/.test(REP));
  ok("四要素格式仍在", /频次\/时机/.test(REP) && /话术\/方法/.test(REP) &&
    /载体\/工具/.test(REP) && /对方没反应时怎么办/.test(REP));
  ok("海报摘要节仍在", /海报摘要/.test(REP) && /钩子句/.test(REP));
  ok("七个 SECTION 标题未变",
    ["背景与挑战", "核心做法", "关键判断与取舍", "结果", "可复制的经验点",
     "新人容易踩的坑", "海报摘要"].every(k => REP.includes(k)));
}

console.log("\n[7] 报告级：新增要求必须可执行（不是空口号）");
{
  ok("REPORT_PROMPT 要求具体做法可照搬", /直接照搬|照搬/.test(REP));
  ok("REPORT_PROMPT 对空内容要求写「未展开」", /访谈中未展开/.test(REP));
  ok("REPORT_PROMPT 禁止只写动作名",
    /只有动作名|"定期维护""加强沟通"/.test(REP));
}

/* ── 2026-09-29 专家评审后的 P0/P1 改进 ──
   评审在 9 份真实报告里查出 8 处缺口，其中 6 处只改提示词即可：
     缺口1 关键判断只写「选了什么」不写「放弃了什么」→ 决策三段式
     缺口2 结果 0/9 有参照系 → 结果节强制「团队参照」
     缺口4 原话引句 1–12 条/份 不稳定 → 每做法保底一句原话
     缺口5 访谈没有对比性追问 → 加「新人一般怎么做/你差在哪」
     缺口6 访谈不问失败单 → 加「搞砸过的那一单」追问
     缺口3 经验点缺触发信号与失效边界 → 六要素扩到八要素
   本组断言把这六条固化，防止后续改提示词时被删。 */

console.log("\n[8] P0 报告：决策三段式（缺口 1）");
{
  ok("存在三段式标题「可选走法」", /可选走法/.test(REP));
  ok("存在「选择依据」", /选择依据/.test(REP));
  ok("存在「被否掉的那条路为什么不行」", /被否掉的那条路为什么不行/.test(REP));
  ok("要求至少列 2 条走法（A/B 标出）", /至少列\s*2\s*条|至少\s*2\s*条/.test(REP) && /\bA\b/.test(REP) && /\bB\b/.test(REP));
  ok("明确「缺一段这条就不合格」", /缺一段这条就不合格/.test(REP));
  ok("给了不合格/合格对比示例", /×\s*不合格/.test(REP) && /√\s*合格/.test(REP));
  ok("对没问到的情况给了诚实兜底", /他没提到其他走法/.test(REP));
}

console.log("\n[9] P0 报告：结果必须有参照系（缺口 2，原 0/9）");
{
  ok("存在「团队参照：」这个明确键名", /团队参照：/.test(REP));
  ok("要求出现在结果节", /结果[\s\S]{0,900}?团队参照/.test(REP));
  ok("给出三种参照维度",
    /团队平均/.test(REP) && /自己/.test(REP) && /同条件/.test(REP));
  ok("给了示例写法", /同期营业部人均约/.test(REP));
  ok("没问到参照时不许编", /建议补充访谈/.test(REP));
}

console.log("\n[10] P0 报告：每步做法保底一句原话（缺口 4）");
{
  ok("核心做法节要求带原话行", /原话：[「『]/.test(REP));
  ok("要求标注是谁说的", /谁说的/.test(REP));
  ok("要求原样抄、不转述", /不要转述|原样抄/.test(REP));
  ok("没原话时给诚实兜底", /访谈中未留下原话/.test(REP));
  ok("总则里把「没有原话」点名为不合格项", /一句原话都没有/.test(REP));
}

console.log("\n[11] P0 访谈：对比性追问（缺口 5）");
{
  ok("存在对比性追问的框架提示", /新人.*一般会怎么做|别人常踩的坑/.test(SYS));
  ok("访谈框架第 7 步变成 2 轮", /7\.\s*新人容易踩的坑（2轮）/.test(SYS));
}

console.log("\n[12] P0 访谈：失败单追问（缺口 6）");
{
  ok("存在失败单专章", /失败单也要问/.test(SYS));
  ok("要求单独问一轮", /单独问一轮/.test(SYS));
  ok("给了三连问（丢了/错在哪/改了什么）",
    /跟进丢了|做砸过/.test(SYS) && /错在哪一步/.test(SYS) && /改了什么做法/.test(SYS));
  ok("对方说没有时给选择题兜底", /丢在前期接触|丢在资料/.test(SYS));
  ok("明确不要编造失败经历", /他说没有类似的失败经历/.test(SYS));
  ok("追问规则清单里也加了这条", /有没有哪一单你是搞砸过的/.test(SYS));
}

console.log("\n[13] P0 访谈：结果参照系追问（缺口 2 的输入侧）");
{
  ok("存在结果参照系专章", /结果要有参照系/.test(SYS));
  ok("说明「只报一个数字等于没报」", /只报一个数字等于没报/.test(SYS));
  ok("给了团队平均的追问话术", /算高的还是平的/.test(SYS));
  ok("给了自身平时的追问话术", /你平时一个月大概多少|你平时大概多少/.test(SYS));
  ok("接受模糊档位而非硬逼数字", /算好的那一档/.test(SYS));
}

console.log("\n[14] P0 访谈：取舍要问出被放弃的路（缺口 1 的输入侧）");
{
  ok("存在取舍专章", /取舍要问出被放弃的那条路/.test(SYS));
  ok("给了「还有别的选择吗」的问法", /还有别的选择吗/.test(SYS));
  ok("给了「为什么没选那个」的问法", /为什么没选那个/.test(SYS));
  ok("访谈框架第 5 步扩到 2-3 轮并带提示", /5\.\s*关键决策（2-3轮）/.test(SYS));
}

console.log("\n[15] P1 报告：经验点扩到八要素（缺口 3）");
{
  ok("存在「触发信号」要素", /触发信号：/.test(REP));
  ok("存在「失效边界」要素", /失效边界：/.test(REP));
  ok("触发信号要求是可观察现象", /可观察的现象/.test(REP));
  ok("触发信号反例说明了什么叫「没法判断」", /客户有需求的时候/.test(REP));
  ok("失效边界给了会适得其反的例子", /适得其反/.test(REP));
  ok("没提到时给了诚实兜底", /未提到触发信号/.test(REP) && /未提到失效边界/.test(REP));
  ok("示例块里补了这两行", / - 触发信号：/.test(REP) && / - 失效边界：/.test(REP));
}

console.log("\n[16] P1 报告：海报摘要的「判断句」要带上被否掉的走法");
{
  ok("判断句说明里带了被否掉的那条路", /要带上被否掉的那条路/.test(REP));
  ok("给了对比式示例", /陌拜一天十条搭上话不到两个/.test(REP));
}

console.log("\n[17] P1 后处理：节标题归一函数存在且行为正确");
{
  const IDX = fs.readFileSync(INDEX, "utf8");
  ok("存在 SECTION_ALIASES 别名表", /const SECTION_ALIASES = \[/.test(IDX));
  ok("存在 normalizeSectionTitle", /function normalizeSectionTitle\(/.test(IDX));
  ok("存在 normalizeReport", /function normalizeReport\(/.test(IDX));
  ok("生成报告时调用过后处理", /const normalized = normalizeReport\(raw\)/.test(IDX));
  ok("落盘用的是归一后的文本", /state\.reportRaw = normalized/.test(IDX));
  ok("七个标准标题都在别名表里",
    ["背景与挑战", "核心做法", "关键判断与取舍", "结果", "可复制的经验点", "新人容易踩的坑", "海报摘要"]
      .every(t => new RegExp("\\['" + t + "'").test(IDX)));
  ok("别名表覆盖了常见误写（避坑指南）", /避坑指南/.test(IDX));
  ok("覆盖度别名也补了「效果」", /'结果', '成果', '效果'/.test(IDX));
}

console.log("\n" + "─".repeat(52));
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
