'use strict';
/**
 * kb.js — 知识库聚合（只读、实时、零依赖）
 *
 * 把已归档报告的 report_md 解析成「主题 → 做法卡片」两层。
 * **实时聚合、不落库**：新报告一归档就自动出现在知识库里，零维护成本。
 *
 * ★★ 脱敏是硬约束。本模块只读 report_md / id / topic / round_count / created_at，
 *    返回结构里**绝不出现** interviewee_name、interviewee_um、backend_owner_*、
 *    submitter_name、city、transcript。
 *    报告正文本身已由 REPORT_PROMPT 约束脱敏；而 transcript 是用户原始输入、
 *    不经模型，最容易带出小区名/单位名，所以整列都不进知识库。
 *
 * 实测的两种格式变体（都兼容）：
 *   · 做法行：「1. 做法：xxx」（带编号，正文缩进 3 空格）/「做法：xxx」（无编号）
 *   · 节标题：「可复制的经验点」/「可复制经验点」；「新人容易踩的坑」/「新人注意事项」
 */

/* 节标题别名 → 标准键 */
const SECTIONS = [
  ['background', /背景|挑战/],
  ['methods', /核心做法/],
  ['judgment', /关键判断|取舍/],
  ['result', /^结果/],
  ['skills', /可复制.{0,2}经验点/],
  ['pitfalls', /踩的坑|注意事项/],
  ['poster', /海报摘要/],
];

/* 八要素的键与展示顺序。
   ★ 值里同时认新旧两个词：「失效边界」是 2026-10-12 前的旧字段名，
   存量报告正文里还留着；「哪些情况不适用」是换过之后的新词。两个都得认，
   否则老报告的边界要素会解析不出来（改词时最容易漏的就是这一处）。 */
const FIELDS = [
  ['when', /频次\s*\/?\s*时机|频次/],
  ['how', /话术\s*\/?\s*方法|话术/],
  ['tool', /载体\s*\/?\s*工具|载体/],
  ['ifno', /对方没反应时怎么办|对方没反应/],
  ['trigger', /触发信号/],
  ['boundary', /哪些情况不适用|失效边界/],
];

const FIELD_LABELS = {
  when: '频次/时机',
  how: '话术/方法',
  tool: '载体/工具',
  ifno: '对方没反应时怎么办',
  trigger: '触发信号',
  boundary: '哪些情况不适用',
};

/* 凡沿用旧模板的报告（多在 2026-09 及以前）没有八要素，靠「核心做法」兜底 */
const OLD_BEFORE = '2026-09-30';

/* 场景关键词表。★ 判据跑在**卡片自身文本**上，不再跑在报告主题上 ——
   报告主题只说明"这次访谈聊什么"，同一份报告里的做法常常跨场景。
   （2026-10-12 实测：69 张卡里只有 11 张的文本能自证属于所在组。） */
const TOPIC_GROUPS = [
  ['客户转介绍', /转介绍/],
  ['批款后的跟进与服务', /批款|跟进与服务/],
  ['转化率提升', /转化率/],
  ['棱镜签约', /棱镜/],
  ['新人开单', /新人/],
  ['孤儿单盘活', /孤儿单/],
  ['房抵二押签约', /房抵|二押/],
  ['法人客户开发', /法人/],
  ['受薪客群开发', /受薪/],
  ['被拒与挂断客户的挽回', /被拒|挂断/],
  ['高件均客户开发', /高件均/],
];

/* 与具体场景无关的通用招式 —— 模型判定用这个词，不进场景索引 */
const GENERIC_SCENE = '通用';

/* ── 动作阶段（客户旅程八阶段）────────────────────────────────
   为什么必须有这个维度：这些访谈产出的做法约七成是**跨场景的通用招式**
   （致电/测额/约见/寒暄/算成本账/嫌费率处理/月度回访…），
   「场景」这一个维度装不下它们 —— 场景组因此被稀释得名不副实。
   ★ 顺序即客户旅程顺序，前端按此顺序展示（不按数量排序）。
   ★ 定义与 kb-stage.js 的提示词共用这一份，改这里就够。 */
const STAGES = [
  ['获客开发', '找到并接触新客户：陌拜、电销、抄号码、发单页、名单筛选、渠道开发'],
  ['首次接触', '第一次有效沟通：第一通电话、开场、寒暄、先聊行业不直接谈产品、引导测额'],
  ['需求判断', '判断能不能做、值不值得跟：问用途/金额/时间、核实征信与资质、看风险点、筛行业'],
  ['约见推进', '把沟通推进到见面、把流程往前推：当天约、约不到就上门、持续约时间、催进度'],
  ['异议处理', '客户提出抗拒：嫌费率高/利息高、说暂时不需要、说先考虑一下、反复拖延'],
  ['签约落地', '走到签约与手续环节：签约核查、办房本、转他项、资料补正、合同面签'],
  ['批款后服务', '批款/放款之后的动作：到账致电、批款后几天内跟进、出额后处理利息异议'],
  ['关系维护', '不带业绩目的的长期保温：月度回访、节日送礼、朋友圈互动、闲聊、老客户背书'],
];
const STAGE_NAMES = STAGES.map(function (s) { return s[0]; });

/* 整条值就是"没问出来"的说明 → 标 missing。
   注意必须锚定整条：像「他提到客户都是新客户，未说明对老客户是否适用」里
   虽然含"未说明"，但那是**有效的边界说明**，不能判成缺失。

   ★ 2026-10-12：批量导入件（非访谈来源）的占位写法是「（稿子中未展开）」
   「（稿子中未提到）」，此前只认「访谈中」→ 导入件的诚实兜底会被当成正常内容渲染。
   现按**主语白名单**放宽；**不要**改成模糊匹配（[^）)]{0,N}），
   那会把「他提到客户都是新客户，未说明…」这类有效边界说明一并吞掉。 */
const MISSING_RE = /^[（(]?\s*(?:这一点|该点|此项|这一项)?\s*(?:(?:访谈|稿子|稿|材料|原文|课件|课程|文档)中)?\s*未(?:提到|展开|覆盖|留下原话|明确|说明|提供|形成)[^）)]*[）)]?$/;

/**
 * 报告主题 → 场景组名。
 *
 * @deprecated 2026-10-12 起 buildKb **不再调用它**。这正是当初出错的地方：
 *   按「报告主题」归并，会迫使一份报告里所有做法都跟着标题走 ——
 *   「棱镜签约」主题下于是混进了大量通用招式（实测 69 张卡里只有 11 张能自证归属）。
 *   现在的判据落在卡片自身，走 sceneOf()。
 *   保留它只是为了 tests/tmp 里的历史对比探针（topic-purity / kb-coverage）还能跑。
 */
function normTopic(raw) {
  const t = String(raw || '').trim();
  for (let i = 0; i < TOPIC_GROUPS.length; i++) {
    if (TOPIC_GROUPS[i][1].test(t)) return TOPIC_GROUPS[i][0];
  }
  return t || '未分类';
}

/* 卡片文本 → 场景组名。命中不了返回 null（=这条做法与具体场景无关）。
   ★ 这是把归并判据从「报告主题」搬到「卡片自身」的关键一步。 */
function sceneOf(text) {
  const t = String(text || '');
  for (let i = 0; i < TOPIC_GROUPS.length; i++) {
    if (TOPIC_GROUPS[i][1].test(t)) return TOPIC_GROUPS[i][0];
  }
  return null;
}

/* 卡片的全部文本（标题 + 正文 + 要素值 + 原话）—— 判据与检索都用它 */
function cardText(c) {
  const parts = [c.title, c.body];
  Object.keys(c.fields || {}).forEach(function (k) { parts.push(c.fields[k]); });
  (c.quotes || []).forEach(function (q) { parts.push(q); });
  return parts.join(' ');
}

function sectionKey(title) {
  const t = String(title || '').trim();
  for (let i = 0; i < SECTIONS.length; i++) {
    if (SECTIONS[i][1].test(t)) return SECTIONS[i][0];
  }
  return null;
}

/* 按 ---SECTION--- 切段，返回 { skills: '正文', methods: '正文', … } */
function splitSections(md) {
  const out = {};
  const parts = String(md || '').split(/^\s*---SECTION---\s*$/m);
  for (let i = 0; i < parts.length; i++) {
    const seg = String(parts[i] || '').replace(/^\s+/, '');
    if (!seg) continue;
    const nl = seg.indexOf('\n');
    const title = nl === -1 ? seg : seg.slice(0, nl);
    const body = nl === -1 ? '' : seg.slice(nl + 1);
    const key = sectionKey(title);
    if (key && !out[key]) out[key] = body.trim();
  }
  return out;
}

/* 抽「原话」。报告里两种写法都收：
     · 原话：『最近在忙什么』（何佳佳）      ← 独立行，姓名在括号里、不进结果
     · 话术/方法：原话是「说可以走个优惠政策…」 ← 嵌在要素值里 */
function pickQuotes(text) {
  const out = [];
  const re = /[『「]([^』」]{2,120})[』」]/g;
  let m;
  while ((m = re.exec(String(text || ''))) !== null) {
    const q = m[1].trim();
    if (!q) continue;
    if (MISSING_RE.test(q)) continue;
    if (out.indexOf(q) === -1) out.push(q);
  }
  return out;
}

/* 「可复制的经验点」→ 结构化卡片。按「做法：」切块，不依赖缩进。 */
function parseSkillBlock(body) {
  const lines = String(body || '').split('\n');
  const cards = [];
  let cur = null;
  let lastKey = null;

  lines.forEach(function (line) {
    const t = line.trim();
    if (!t) return;

    const mt = t.match(/^(?:\d+[.、)]\s*|[-*·]\s*)?做法\s*[：:]\s*(.+)$/);
    if (mt) {
      cur = { title: mt[1].trim(), fields: {}, quotes: [] };
      lastKey = null;
      cards.push(cur);
      return;
    }
    if (!cur) return;

    const mf = t.match(/^[-*·]?\s*([^：:]{2,14})\s*[：:]\s*(.*)$/);
    if (mf) {
      const label = mf[1].trim();
      const val = mf[2].trim();
      for (let i = 0; i < FIELDS.length; i++) {
        if (FIELDS[i][1].test(label)) {
          cur.fields[FIELDS[i][0]] = val;
          lastKey = FIELDS[i][0];
          return;
        }
      }
      lastKey = null;          // 「具体怎么做：」这类小标题，忽略
      return;
    }
    /* 续行：极少数报告把要素值折了行，接到上一个要素上 */
    if (lastKey && cur.fields[lastKey] !== undefined) {
      cur.fields[lastKey] = (cur.fields[lastKey] + ' ' + t).trim();
    }
  });

  cards.forEach(function (c) {
    c.quotes = pickQuotes(
      c.title + '\n' + Object.keys(c.fields).map(function (k) { return c.fields[k]; }).join('\n')
    );
  });
  return cards.filter(function (c) { return c.title; });
}

/* 「核心做法」→ 兜底卡片（旧模板没有八要素，只有"做法标题 + 叙述"） */
function parseMethodBlock(body) {
  const text = String(body || '');
  const re = /^[ \t]*(\d+)[.、)]\s*(.+)$/gm;
  const hits = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    hits.push({ start: m.index, end: m.index + m[0].length, head: m[2].trim() });
  }
  const cards = [];
  hits.forEach(function (h, i) {
    /* ★ 边界取「下一个编号项的起点」，不能靠 indexOf(head) 反查 ——
       旧报告的步骤句里含中文冒号、引号与顿号，反查容易落空，
       落空就退化成"第一张卡片吞掉后面所有步骤"。 */
    const stop = i + 1 < hits.length ? hits[i + 1].start : text.length;
    const chunk = text.slice(h.end, stop).trim();
    /* 标题取首句（报告里第一句通常就是做法名），太长截断 */
    let title = h.head.split(/[。；;]/)[0].trim();
    if (title.length > 46) title = title.slice(0, 46) + '…';
    cards.push({ title: title, body: chunk, quotes: pickQuotes(h.head + '\n' + chunk) });
  });
  return cards.filter(function (c) { return c.title; });
}

/* 递归替换所有字符串里的敏感词。
   ★ 为什么必须在**输出前**做、而不是"干脆不读"：被访谈人姓名会出现在
     报告正文里 —— 报告写原话时会带归属标注「（某顾问）」。所以只能先读
     进来、再替换掉。（姓名字段本身不进任何输出结构，这是两件事。） */
function scrubDeep(node, words) {
  if (typeof node === 'string') {
    let s = node;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (w && s.indexOf(w) >= 0) s = s.split(w).join('该顾问');
    }
    return s;
  }
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) node[i] = scrubDeep(node[i], words);
    return node;
  }
  if (node && typeof node === 'object') {
    const keys = Object.keys(node);
    for (let i = 0; i < keys.length; i++) node[keys[i]] = scrubDeep(node[keys[i]], words);
    return node;
  }
  return node;
}

function clampText(s, n) {
  const t = String(s || '').replace(/[ \t]+/g, ' ').replace(/\n+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

/**
 * 入口。rows 为数据库行（只需 6 个字段，多余的会被忽略 —— 这点由调用方保证）。
 * @returns {{generated_at, stats, field_labels, stage_names, topics, stages, cases, cards}}
 *   topics = 场景索引（卡片级，按做法数排序）
 *   stages = 动作索引（卡片级，按客户旅程顺序）
 *   cases  = 每份报告的结果/关键判断/踩坑摘要（与归类无关，保证一份都不丢）
 */
function buildKb(rows, opts) {
  const list = Array.isArray(rows) ? rows : [];
  const maskWords = (opts && opts.maskWords) || [];
  const caseMap = {};                       // report_id → 案例摘要（结果/关键判断/踩坑）
  const sceneMap = {};                      // 场景 → { name, cards, ids:{} }
  const stageMap = {};                      // 阶段 → { name, cards, ids:{} }
  const all = [];

  list.forEach(function (row) {
    const id = Number(row.id) || 0;
    const rawTopic = String(row.topic || '').trim();
    const date = String(row.created_at || '').slice(0, 10);
    const secs = splitSections(row.report_md);

    /* 分类结果：jsonb 数组，与下面 cards 的**下标对齐**。
       没跑过分类的行这里是 []，卡片就退回关键词判定（stage 为空）。 */
    const labels = Array.isArray(row.kb_stages) ? row.kb_stages : [];

    /* 优先用「可复制的经验点」（结构化）；没有才退回「核心做法」（旧报告） */
    let cards = [];
    if (secs.skills) {
      cards = parseSkillBlock(secs.skills).map(function (c) {
        return { grade: 'full', title: c.title, fields: c.fields, quotes: c.quotes, body: '' };
      });
    }
    if (!cards.length && secs.methods) {
      cards = parseMethodBlock(secs.methods).map(function (c) {
        return { grade: 'basic', title: c.title, fields: {}, quotes: c.quotes, body: clampText(c.body, 220) };
      });
    }

    cards.forEach(function (c, i) {
      const lab = labels[i] || {};
      const modelScene = String(lab.scene || '').trim();
      const kwScene = sceneOf(cardText(c));

      /* ★ 场景归属：模型判定优先（它看的是这张做法**本身**），没有就退回关键词；
         模型判「通用」时 scene 置空但记下 scene_by='model' —— 这样前端能区分
         「判定为通用」与「压根还没分类」两件事。 */
      let scene = null;
      let sceneBy = null;
      if (modelScene) {
        sceneBy = 'model';
        scene = modelScene === GENERIC_SCENE ? null : modelScene;
      } else if (kwScene) {
        scene = kwScene;
        sceneBy = 'keyword';
      }

      const stage = STAGE_NAMES.indexOf(String(lab.stage || '').trim()) >= 0
        ? String(lab.stage).trim() : null;

      const card = {
        key: id + '-' + (i + 1),
        report_id: id,
        scene: scene,
        scene_by: sceneBy,
        stage: stage,
        source_topic: rawTopic,
        grade: c.grade,
        title: c.title,
        body: c.body,
        fields: c.fields,
        missing: [],
        absent: [],
        quotes: c.quotes,
        date: date,
      };
      FIELDS.forEach(function (f) {
        const v = c.fields[f[0]];
        if (v === undefined || v === '') {
          if (c.grade === 'full') card.absent.push(f[0]);
        } else if (MISSING_RE.test(v)) {
          card.missing.push(f[0]);
        }
      });

      /* ★ 占位卡不进索引：访谈没问出任何做法时，报告里会留一条
         「（访谈中未展开——……）」的诚实兜底。它是**空缺的证据**，不是做法 ——
         留在 all 里（「全部做法」视图仍能看到这个缺口），但别让它带上
         「需求判断 / 通用」这种标签混进阶段索引，那会凭空给知识库添一条假经验。
         判据直接复用 MISSING_RE（它本来就是"整条就是没问出来"的锚定式判定）。 */
      const placeholder = MISSING_RE.test(String(c.title || '').trim());

      if (scene && !placeholder) {
        const b = sceneMap[scene] || (sceneMap[scene] = { name: scene, cards: [], ids: {} });
        b.cards.push(card);
        b.ids[id] = 1;
      }
      if (stage && !placeholder) {
        const b = stageMap[stage] || (stageMap[stage] = { name: stage, cards: [], ids: {} });
        b.cards.push(card);
        b.ids[id] = 1;
      }
      all.push(card);
    });

    caseMap[id] = {
      id: id,
      topic: rawTopic,
      rounds: Number(row.round_count) || 0,
      date: date,
      old_template: date && date < OLD_BEFORE,
      cards: cards.length,
      result: clampText(secs.result, 160),
      judgment: clampText(secs.judgment, 200),
      pitfalls: clampText(secs.pitfalls, 200),
    };
  });

  /* 场景索引：按做法数排序（用户是"我想看这个场景怎么做"，多的排前面） */
  const topics = Object.keys(sceneMap).map(function (k) {
    const b = sceneMap[k];
    b.cases = Object.keys(b.ids).map(function (id) { return caseMap[id]; }).filter(Boolean);
    delete b.ids;
    return b;
  }).sort(function (a, b) {
    return (b.cards.length - a.cards.length) || (b.cases.length - a.cases.length) || a.name.localeCompare(b.name);
  });

  /* 动作索引：★ 按客户旅程顺序，**不按数量排序** —— 顺序本身就是信息 */
  const stages = STAGE_NAMES.map(function (name) {
    const b = stageMap[name];
    if (!b) return null;
    b.cases = Object.keys(b.ids).map(function (id) { return caseMap[id]; }).filter(Boolean);
    delete b.ids;
    return b;
  }).filter(Boolean);

  /* ★ 顶层 cases：把「结果 / 关键判断 / 踩过的坑」摘要单独发一份。
     为什么必须有：改成卡片级双维度后，案例摘要原本只挂在 topics[].cases 与
     stages[].cases 里 —— 一份**没有任何卡片归入场景或阶段**的报告（还没跑分类、
     或报告里只有占位卡）就会整份从输出里消失，那节内容等于被吞掉。
     这与「通用招式不该被硬塞进某个主题」是两件事：摘要归报告、归类归卡片。 */
  const cases = Object.keys(caseMap).map(function (id) { return caseMap[id]; });

  const out = {
    generated_at: new Date().toISOString(),
    field_labels: FIELD_LABELS,
    stage_names: STAGE_NAMES,
    stats: {
      reports: list.length,
      topics: topics.length,
      stages: stages.length,
      cards: all.length,
      full: all.filter(function (c) { return c.grade === 'full'; }).length,
      basic: all.filter(function (c) { return c.grade === 'basic'; }).length,
      quoted: all.filter(function (c) { return c.quotes.length; }).length,
      scened: all.filter(function (c) { return c.scene; }).length,
      staged: all.filter(function (c) { return c.stage; }).length,
      /* ★「模型判定为通用」= 模型判过（scene_by=model）但没给具体场景。
         不能只写 scene_by==='model' —— 那会把模型判的**具体场景**也算进来，
         名字叫 generic 却数了「判过」的卡，对账时必错。 */
      generic: all.filter(function (c) { return c.scene_by === 'model' && !c.scene; }).length,
      /* 分类覆盖率：模型判过的卡片数（含判为具体场景的），用来看补跑进度 */
      classified: all.filter(function (c) { return c.scene_by === 'model' || !!c.stage; }).length,
      /* 占位卡（访谈没问出做法，报告留的空缺说明）——它们不进索引，
         所以 stages/topics 索引里的做法数加起来会少于 cards，这个数字用于对账。 */
      placeholder: all.filter(function (c) { return MISSING_RE.test(String(c.title || '').trim()); }).length,
      masked: maskWords.length,
    },
    topics: topics,
    stages: stages,
    cases: cases,
    cards: all,
  };
  return maskWords.length ? scrubDeep(out, maskWords) : out;
}

module.exports = {
  buildKb: buildKb,
  normTopic: normTopic,
  sceneOf: sceneOf,
  cardText: cardText,
  splitSections: splitSections,
  scrubDeep: scrubDeep,
  FIELDS: FIELDS,
  STAGES: STAGES,
  STAGE_NAMES: STAGE_NAMES,
  GENERIC_SCENE: GENERIC_SCENE,
  FIELD_LABELS: FIELD_LABELS,
  TOPIC_GROUPS: TOPIC_GROUPS,
  MISSING_RE: MISSING_RE,
};
