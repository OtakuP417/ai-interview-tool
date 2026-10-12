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

/* 八要素的键与展示顺序 */
const FIELDS = [
  ['when', /频次\s*\/?\s*时机|频次/],
  ['how', /话术\s*\/?\s*方法|话术/],
  ['tool', /载体\s*\/?\s*工具|载体/],
  ['ifno', /对方没反应时怎么办|对方没反应/],
  ['trigger', /触发信号/],
  ['boundary', /失效边界/],
];

const FIELD_LABELS = {
  when: '频次/时机',
  how: '话术/方法',
  tool: '载体/工具',
  ifno: '对方没反应时怎么办',
  trigger: '触发信号',
  boundary: '失效边界',
};

/* 凡沿用旧模板的报告（多在 2026-09 及以前）没有八要素，靠「核心做法」兜底 */
const OLD_BEFORE = '2026-09-30';

/* 主题归并：16 份报告 16 个主题、多数只有 1 份，直接铺开会很碎。
   按打法关键词归组；未命中的保留原主题。 */
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

/* 整条值就是"没问出来"的说明 → 标 missing。
   注意必须锚定整条：像「他提到客户都是新客户，未说明对老客户是否适用」里
   虽然含"未说明"，但那是**有效的失效边界**，不能判成缺失。 */
const MISSING_RE = /^[（(]?\s*(?:访谈中)?未(?:提到|展开|覆盖|留下原话|明确|说明|提供|形成)[^）)]*[）)]?$/;

function normTopic(raw) {
  const t = String(raw || '').trim();
  for (let i = 0; i < TOPIC_GROUPS.length; i++) {
    if (TOPIC_GROUPS[i][1].test(t)) return TOPIC_GROUPS[i][0];
  }
  return t || '未分类';
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
 * 入口。rows 为数据库行（只需 5 个字段，多余的会被忽略 —— 这点由调用方保证）。
 * @returns {{generated_at, stats, topics, cards, field_labels}}
 */
function buildKb(rows, opts) {
  const list = Array.isArray(rows) ? rows : [];
  const maskWords = (opts && opts.maskWords) || [];
  const byTopic = {};
  const all = [];

  list.forEach(function (row) {
    const id = Number(row.id) || 0;
    const rawTopic = String(row.topic || '').trim();
    const group = normTopic(rawTopic);
    const date = String(row.created_at || '').slice(0, 10);
    const secs = splitSections(row.report_md);

    const bucket = byTopic[group] || (byTopic[group] = { name: group, cards: [], cases: [] });

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
      const card = {
        key: id + '-' + (i + 1),
        report_id: id,
        topic: group,
        topic_raw: rawTopic,
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
      bucket.cards.push(card);
      all.push(card);
    });

    bucket.cases.push({
      id: id,
      topic: rawTopic,
      rounds: Number(row.round_count) || 0,
      date: date,
      old_template: date && date < OLD_BEFORE,
      cards: cards.length,
      result: clampText(secs.result, 160),
      judgment: clampText(secs.judgment, 200),
      pitfalls: clampText(secs.pitfalls, 200),
    });
  });

  const topics = Object.keys(byTopic).map(function (k) { return byTopic[k]; })
    .sort(function (a, b) {
      return (b.cards.length - a.cards.length) || (b.cases.length - a.cases.length) || a.name.localeCompare(b.name);
    });

  const out = {
    generated_at: new Date().toISOString(),
    field_labels: FIELD_LABELS,
    stats: {
      reports: list.length,
      topics: topics.length,
      cards: all.length,
      full: all.filter(function (c) { return c.grade === 'full'; }).length,
      basic: all.filter(function (c) { return c.grade === 'basic'; }).length,
      quoted: all.filter(function (c) { return c.quotes.length; }).length,
      masked: maskWords.length,
    },
    topics: topics,
    cards: all,
  };
  return maskWords.length ? scrubDeep(out, maskWords) : out;
}

module.exports = {
  buildKb: buildKb,
  normTopic: normTopic,
  splitSections: splitSections,
  scrubDeep: scrubDeep,
  FIELDS: FIELDS,
  FIELD_LABELS: FIELD_LABELS,
  TOPIC_GROUPS: TOPIC_GROUPS,
  MISSING_RE: MISSING_RE,
};
