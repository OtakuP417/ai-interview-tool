
// ─── 部署配置 ─────────────────────────────────────────
// 后端代理地址：API Key 保存在云函数环境变量中，前端源码不含任何密钥
const PROXY_URL = 'https://work-d1gs0jzrg2277d75e-1391683363.ap-shanghai.app.tcloudbase.com/api/chat';

// 留空即正常部署状态；仅本地离线自测时才需要填
const BUILT_IN_API_KEY = '';
// ──────────────────────────────────────────────────────

const API_ENDPOINT = PROXY_URL || 'https://api.deepseek.com/chat/completions';

// 归档接口（与 /api/chat 同域）
const API_BASE = PROXY_URL ? PROXY_URL.replace(/\/api\/chat\/?$/, '') : '';
const SUBMIT_URL = API_BASE + '/api/submit';

function getApiHeaders() {
  if (PROXY_URL) return { 'Content-Type': 'application/json' };
  return {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + (BUILT_IN_API_KEY || state.apiKey),
  };
}

// ─── state ───────────────────────────────────────────────
let state = {
  apiKey: '',
  interviewee: {
    name: '', position: '', topic: '',
    city: '', um: '', owner: '', ownerOrg: '',
  },
  messages: [],   // {role, content}
  roundCount: 0,
  streaming: false,
  reportRaw: '',  // 报告原文
  archived: false,
};

/* ─── 访谈过程的本地持久化 ─────────────────────────────────
   访谈动辄 15 轮以上、耗时几十分钟，期间刷新页面 / 手机息屏被回收 /
   误关标签页都会丢失全部内容。这里把访谈过程实时写入 localStorage，
   重新打开时提示续接。
   注意：正在流式输出的那条 AI 回复不落盘（半截内容无意义），
   所以保存时机是「一轮问答完成之后」。
   ──────────────────────────────────────────────────────── */
const DRAFT_KEY = 'iv_draft_v1';

/* 统一的「有效轮次」口径：只统计被访谈人真实说的话。
   system 是提示词、internal 是系统代发的控制指令（如开场白），都不算轮次。
   所有显示与统计（轮次徽标、续接提示、归档 round_count）都必须走这里，
   避免同一份访谈在不同地方数出不同轮数。 */
function countRounds(messages) {
  return (messages || []).filter(m => m.role === 'user' && !m.internal).length;
}
function hasUserTurn(messages) {
  return countRounds(messages) > 0;
}

function saveDraft() {
  // 访谈尚未开始、或尚无有效问答时不落盘
  if (!state.interviewee.name) return;
  if (!hasUserTurn(state.messages)) return;
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      v: 1,
      savedAt: Date.now(),
      interviewee: state.interviewee,
      messages: state.messages,
      roundCount: state.roundCount,
      reportRaw: state.reportRaw,
      archived: state.archived,
    }));
  } catch (e) { /* 隐私模式或配额满：静默放弃，不影响访谈本身 */ }
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || d.v !== 1 || !d.interviewee || !Array.isArray(d.messages)) return null;
    if (!hasUserTurn(d.messages)) return null;
    return d;
  } catch (e) { return null; }
}

function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
}

function fmtAgo(ts) {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return m + ' 分钟前';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' 小时前';
  return Math.floor(h / 24) + ' 天前';
}

/* 把已保存的 messages 逐条渲染回聊天区（含 system 之外的全部对话） */
function renderHistory() {
  const wrap = document.getElementById('messages');
  wrap.innerHTML = '';
  state.messages.forEach(m => {
    if (m.role === 'system') return;
    if (m.internal) return;   // 系统代发的控制指令，不进回放
    appendMsg(m.role === 'user' ? 'user' : 'ai', m.content);
  });
}

/* ─── 访谈素材信息量评估 ───────────────────────────────────
   报告的质量上限由访谈素材决定：客户只说 56 个字，AI 不可能凭空
   产出真正落地的经验，只会用通用说法把篇幅撑起来（实测出现过
   报告字数 / 客户字数 = 14 倍的案例，通篇没有一句可照做的内容）。
   所以在生成报告之前先量一下素材够不够，不够就建议继续访。
   阈值是用已归档的真实报告倒推校准的，见 tests/verify-gate.js。
   ──────────────────────────────────────────────────────── */
const GATE = {
  minRounds: 8,        // 有效轮次（被访谈人真实发言数）
  minTotalChars: 400,  // 被访谈人累计输出字数
  minLongAnswers: 2,   // 60 字以上的长回答条数
  longAnswerChars: 60,
};

function assessInterview(messages) {
  const userMsgs = (messages || [])
    .filter(m => m.role === 'user' && !m.internal)
    .map(m => String(m.content || ''));

  const rounds = userMsgs.length;
  const totalChars = userMsgs.reduce((s, t) => s + t.length, 0);
  const longAnswers = userMsgs.filter(t => t.length >= GATE.longAnswerChars).length;

  const gaps = [];
  if (rounds < GATE.minRounds) gaps.push('有效轮次还差 ' + (GATE.minRounds - rounds) + ' 轮');
  if (totalChars < GATE.minTotalChars) gaps.push('你的回答累计才 ' + totalChars + ' 字，建议说到 ' + GATE.minTotalChars + ' 字以上');
  if (longAnswers < GATE.minLongAnswers) gaps.push('说得很细的回答还差 ' + (GATE.minLongAnswers - longAnswers) + ' 条');

  return {
    rounds, totalChars, longAnswers, gaps,
    ok: gaps.length === 0,
  };
}

/* 报告里还有哪些坑：
   ① 客户字数太少 → 报告多半是 AI 自己编的通用话
   ② 最后一条 AI 提问没有对应的回答 → 访谈被截断，报告会缺一块 */
function collectReportIssues(messages, raw) {
  const issues = [];
  const a = assessInterview(messages);

  if (a.totalChars < GATE.minTotalChars) {
    issues.push({
      level: 'warn',
      text: '这次访谈的素材偏薄：你的回答累计 ' + a.totalChars + ' 字，'
          + '报告里一部分内容可能是泛泛的经验之谈，而不是你说过的做法。'
          + '建议返回访谈再补几轮细节，尤其是「具体怎么做」的部分。',
    });
  }

  const msgs = (messages || []).filter(m => !m.internal && m.role !== 'system');
  const last = msgs[msgs.length - 1];
  if (last && last.role === 'assistant') {
    issues.push({
      level: 'info',
      text: '最后一个提问没有对应的回答，这次访谈看起来是提前结束的，'
          + '报告里相关部分会缺一块。可以返回访谈补上这一问，再重新生成报告。',
    });
  }

  // 膨胀比：报告字数 ÷ 客户字数。3-5 倍以内说明报告基本是「整理」出来的；
  // 超过 8 倍通常意味着 AI 补了大量模板话，值得人工过一眼。
  const userChars = (messages || [])
    .filter(m => m.role === 'user' && !m.internal)
    .reduce((s, m) => s + String(m.content || '').length, 0);
  if (userChars > 0) {
    const ratio = Math.round(String(raw || '').length / userChars);
    if (ratio >= 8) {
      issues.push({
        level: 'warn',
        text: '报告字数是你回答字数的约 ' + ratio + ' 倍，比例偏高，'
            + '说明报告里可能有不少不是你原话的内容。归档前建议通读一遍，把不像你说的话删掉。',
      });
    }
  }

  return issues;
}

function renderAlert(list) {
  const box = document.getElementById('report-alerts');
  if (!box) return;
  const arr = list || [];
  box.innerHTML = arr.map(x =>
    '<div class="report-alert ' + (x.level === 'warn' ? 'warn' : 'info') + '">'
    + '<span class="ico">' + (x.level === 'warn' ? '!' : 'i') + '</span>'
    + '<span class="txt">' + escHtml(x.text) + '</span></div>'
  ).join('');
}

/* 主题是自由文本，这里给出六个方向并配上各自该挖的细节，
   避免不同人写同一件事却挖出完全不同的深度。 */
const TOPIC_FOCUS = [
  { k: ['转介绍','介绍','推荐'], v: '这一段重点挖：他日常做了哪几件事让老客户愿意开口转介绍；开口那一刻第一句话怎么说；转介绍来的客户与陌生客户在接触方式上有什么不同。' },
  { k: ['孤儿单','存量','老客户','盘活','不活跃'], v: '这一段重点挖：他从哪个名单/系统里取这批客户（从哪里看、怎么筛）；什么情况下先发微信、什么情况下直接打电话；微信第一句发什么、电话前三句怎么说。' },
  { k: ['批款','放款','跟进','服务','售后'], v: '这一段重点挖：批款后哪几个节点必须联系客户（第几天、对方下一步要办什么）；额度没到客户预期时原话怎么说；有没有固定的联系节奏。' },
  { k: ['件均','高件均','额度','大额','高额度'], v: '这一段重点挖：他从哪些特征判断客户可能有大额度需求；判断出之后按什么顺序推进、每一步做什么。' },
  { k: ['被拒','拒件','拒绝','挽回','二次','回捞'], v: '这一段重点挖：被拒之后隔多久重新联系；重新联系时开场白怎么说；哪些拒绝原因值得再争取、哪些直接放下。' },
  { k: ['渠道','获客','陌拜','展会','市场','商圈'], v: '这一段重点挖：他通过什么具体渠道找到客户；第一次接触的前三句怎么说；一周接触多少、在什么时间点接触。' },
];

function topicFocus(t) {
  const s = String(t || '');
  const hits = TOPIC_FOCUS.filter(g => g.k.some(w => s.includes(w)));
  if (!hits.length) return '';
  return '\n' + hits.slice(0, 2).map(g => g.v).join('\n');
}

const SYSTEM_PROMPT = (n, p, t, c, um) => `你是一名专业的案例访谈员，服务于平安融易西安分公司的销售团队。你的任务是通过结构化对话，帮助被访谈人梳理并沉淀一个真实的销售案例或工作经验，最终形成可供全员学习的经验案例。

【被访谈人信息】
姓名：${n}
岗位：${p}
UM 号：${um}
所属城市：${c}
本次访谈主题：${t}
${topicFocus(t)}
【角色定位】
你是一个有亲和力、善于倾听的访谈员，不是考官，不是评分者。用鼓励性语气让对方放松，愿意分享细节。每次只问一个问题，不要连续提多个问题。使用口语化中文，避免生硬书面体。

【最重要的一件事：问到"怎么做"，不只是"做了什么"】
这份访谈最终要变成别人能照着做的经验。所以当对方说了一个动作（维护、跟进、转介绍、沟通、打电话），你的任务不是点头接着往下问，而是继续问到方法为止。

对方说"我会定期维护客户"——这不是答案，这是标题。你要接着问出来的是：
- 多久维护一次？按周还是按月？中间隔多久没联系就不算维护了？
- 用什么方式？微信发消息、打电话、还是当面？发的是自己写的还是转的？
- 第一句话怎么说？能不能把他当时发的那条消息念一下？
- 对方一般是什么反应？如果不回，他下一步做什么？
- 这个动作做了多久才见效？有没有一个"再也没动静就放弃"的界限？

上面五问里，至少要问到两问有具体答案，这个动作才算记录完整。

注意：追问不是审问。每次只追一个问题，用"那具体是怎么做的呢？""能不能举个例子？""当时那句话是怎么说的？"这样的口气。对方答不上来或说不清时，不要硬追，换一个角度，或者记下"这一点他没说清"继续往下走。

【访谈框架】按顺序推进，每个维度深入挖掘后再进入下一个：
1. 破冰（1-2轮）：介绍访谈目的，让对方放松
2. 背景了解（2-3轮）：案例发生的背景和挑战
3. 具体行动（3-5轮）：具体做了哪些动作，关键步骤。每一步都要落到方法层
4. 结果与数据（1-2轮）：最终效果，有无数据
5. 关键决策（1-2轮）：重要判断与取舍，以及判断的依据是什么
6. 可复制经验（2-3轮）：哪些情况下其他同事可以参考
7. 新人容易踩的坑（1-2轮）：单独问一轮，让新人少走弯路
8. 收尾（1轮）：感谢对方，告知将整理成报告

【追问规则】
- 回答笼统时（"做了很多工作"）→ 追问具体动作，再用下面的"方法层五问"继续追
- 只说动作名时（"定期维护""主动开口""多沟通"）→ 一定要追问到频次、话术、工具、应对
- 给出数字时 → 追问背后逻辑
- 提到客户反应时 → 追问客户原话或具体表现
- 说"运气好"时 → 追问哪些可控因素起了作用
- 提到判断和取舍时 → 追问他是根据什么判断的，有没有看走眼的时候
- 提到用了某个工具、系统、名单时 → 追问在哪个位置看、按什么条件筛

【结束判断】满足以下条件时主动提出结束：
- 已完成至少 15 轮对话
- 六个维度均有实质内容，且至少有 3 个动作已经问到方法层（有频次、有话术或有应对办法）
- 收尾前必须问一句："还有没有什么是我没问到、但你觉得对同事有帮助的？"并等对方回答
- 最后确认："我已经收集到了很丰富的信息，我来帮你整理成报告，你看还有什么想补充的吗？"

【信息脱敏 · 必须严格遵守】
本次访谈将被归档并可能用于全员分享，因此严禁记录任何可直接识别客户身份的信息，包括但不限于：
- 客户真实姓名（须改用"某先生""某女士""某客户"等泛称）
- 手机号、座机、微信号、车牌号
- 身份证号、银行卡号、社保号
- 客户名下企业全称、门店字号、具体经营地址（可写"某建材商户""某餐饮店"）
- 客户所在的具体小区名、楼盘名、写字楼名（可写"某小区""城南一个楼盘"）
- 客户具体的贷款金额、准确的月收入数字（可写"几十万""月流水几十万"）
当被访谈人主动说出上述信息时，先礼貌提示："为了保护客户隐私，这里用'某客户'来指代就好，我们继续。"然后继续访谈，不要复述该信息。若对方坚持说出，记录时也不要重复，只做泛化处理。如果对方已经说出口，你在接下来的一两轮里不要再复述这些具体名字或数字。

【约束】不评价对方工作好坏；不透露是AI（如被问，说"我是访谈助手"）；不提任何与本次访谈无关的话题；每次回复控制在100字以内；不跳过任何维度。`;

const REPORT_PROMPT = (n, p, t) => `请根据以上完整的访谈对话内容，生成一份结构化案例经验报告。

【本书写总则 · 先看这条】
这份报告的唯一用途是让没做过这件事的同事照着做，所以判断标准只有一条：
读完这一节，同事能不能在明天就把动作做出来？
凡是只有动作名、没有做法的句子（"定期维护""加强沟通""主动转介绍""做好服务"），一律不合格，必须写清具体怎么做。

【不许编造 · 最后再看一遍】
只写对话里出现过的内容。不要补充被访谈人没说的经验、数字、话术、工具或案例。对话中没提到的细节，就写"这一点访谈中未展开"，不要用行业通用说法把它填满。宁可少写一条，不要凑数。

严格按照以下格式输出，每个部分之间用"---SECTION---"分隔：

背景与挑战
（2-3句话描述案例发生的背景，面临什么问题或机会。只写对话中出现过的背景。）
---SECTION---
核心做法
（这一步不要罗列人生经历，要写他实际怎么做的，用"1. 2. 3."编号分步。
每一步必须写清：什么时间/什么条件下做、具体怎么做的（动作、频次、载体）。
能被别人直接照搬的细节要保留，例如"每周五下午翻一遍批款名单，挑出额度到账满三天的客户"。
如果某一步的细节访谈里没有，直接写"（访谈中未展开）"，不要凭空补。）
---SECTION---
关键判断与取舍
（对话里出现过的决策点各写一条，用"1. 2. 3."编号。每条写清：在什么情况下、他怎么判断、依据是什么、最后选了哪一条路。
如果有他看走眼或调整过的例子，一并写出来。判断依据要落到可观察的信号（客户说了什么、做了什么），不要写成"凭经验感觉"。）
---SECTION---
结果
（量化结果优先；没有数字就写对方的描述性反馈。如果连描述性反馈也没有，写"访谈中未提供结果信息"。）
---SECTION---
可复制的经验点
（写 2-4 条。每一条必须严格按下面两层结构写，两层都要有内容：

* 做法：一句话，讲清"在什么情况下可以做什么"，不超过40字。
  具体怎么做：
  - 频次/时机：（多久一次、什么时候做。没有明确频次就写"没有固定频次，视情况"）
  - 话术/方法：（他原话怎么说的，或者具体操作步骤。尽量引用他的原话，用引号标出）
  - 载体/工具：（微信、电话、当面、哪个名单、哪张表）
  - 对方没反应时怎么办：（客户不回、拒绝、拖延时的应对）

写法示例（注意对比）：
× 不合格：在客户成交后，可以定期维护，长期积累信任。
√ 合格：做法：客户成交后，可以按时间节奏做关系维护。
  具体怎么做：
  - 频次/时机：放款后第3天必发一条到账提醒，之后每月月初发一次
  - 话术/方法：第3天发"哥，款到了记得查一下，有问题随时找我"；每月月初发跟业务无关的问候，不催不推
  - 载体/工具：微信私聊，不群发、不加表情包
  - 对方没反应时怎么办：两次不回就停1-2个月，节日再发一次，别连着追

每条一行开头必须是"做法："，紧跟"具体怎么做："，不要合并成一段。）
---SECTION---
新人容易踩的坑
（写 2-3 条容易踩坑的地方，必须是"做的事"而不是"要有的品质"。
每条格式："在……的时候，容易……，会导致……。可以改成……。"
必须落到具体动作，例如"第一次打电话就推产品，客户一句'暂时不用'就挂断，后面很难再联系上。可以改成先问对方最近资金周转情况，再谈产品。"
"要保持耐心""要用心服务"这类只讲态度不讲动作的话，不要写。）

访谈对象：${n}（${p}）
案例主题：${t}

【脱敏要求】报告正文中不得出现客户真实姓名、手机号、身份证号、银行卡号、客户企业全称等任何可直接识别客户身份的信息。如需指代客户，统一使用"某先生""某女士""某客户""某商户"等泛称。此要求优先级高于内容完整性。

请仅输出报告内容，不要有前言或后记。`;

const SECTION_TITLES = ['背景与挑战','核心做法','关键判断与取舍','结果','可复制的经验点','新人容易踩的坑'];

// ─── setup ───────────────────────────────────────────────
window.onload = () => {
  // 配置了代理或内置 Key 时，隐藏 Key 输入区域
  if (PROXY_URL || BUILT_IN_API_KEY) {
    const sec = document.getElementById('apikey-section');
    if (sec) sec.style.display = 'none';
  } else {
    const saved = localStorage.getItem('ds_key');
    if (saved) document.getElementById('f-apikey').value = saved;
    document.getElementById('toggle-key').onclick = () => {
      const inp = document.getElementById('f-apikey');
      inp.type = inp.type === 'password' ? 'text' : 'password';
    };
  }
  offerDraftResume();
};

/* ─── 打开页面时提示续接未完成的访谈 ─── */
function offerDraftResume() {
  const d = loadDraft();
  if (!d) return;
  const bar = document.getElementById('draft-bar');
  if (!bar) return;
  const rounds = countRounds(d.messages);
  document.getElementById('draft-info').textContent =
    d.interviewee.name + '（' + d.interviewee.position + '） · 已完成 ' + rounds +
    ' 轮 · 保存于 ' + fmtAgo(d.savedAt);
  bar.style.display = 'flex';
}

function resumeDraft() {
  const d = loadDraft();
  if (!d) { location.reload(); return; }

  state.interviewee = d.interviewee;
  state.messages = d.messages;
  state.roundCount = d.roundCount || 0;
  state.reportRaw = d.reportRaw || '';
  state.archived = !!d.archived;

  const iv = state.interviewee;
  document.getElementById('header-name').textContent = iv.name + ' · ' + iv.position;
  document.getElementById('header-meta').textContent =
    (iv.city || '') + ' · UM ' + (iv.um || '—') + ' · 访谈主题：' + iv.topic;

  renderHistory();
  updateRoundBadge();
  document.getElementById('draft-bar').style.display = 'none';

  // 已生成过报告：直接回到报告页，避免重复生成
  if (state.reportRaw) {
    showScreen('report-screen');
    renderReportMeta();
    renderReport(state.reportRaw);
    renderAlert(collectReportIssues(state.messages, state.reportRaw));
    resetArchiveUI();
    if (state.archived) {
      const btn = document.getElementById('archive-btn');
      btn.disabled = true;
      btn.classList.add('done');
      btn.textContent = '已归档 ✓';
      const st = document.getElementById('archive-status');
      st.textContent = '本条已提交过归档';
      st.className = 'archive-status ok';
    }
    return;
  }

  showScreen('chat-screen');
}

function discardDraft() {
  if (!confirm('放弃这条未完成的访谈记录？放弃后无法恢复。')) return;
  clearDraft();
  document.getElementById('draft-bar').style.display = 'none';
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
}

function showError(msg) {
  const el = document.getElementById('setup-error');
  el.textContent = msg; el.style.display = 'block';
}
function clearError() { document.getElementById('setup-error').style.display = 'none'; }

/* 主题快选：点一下把方向填进输入框，用户再按自己的说法改。
   全是自由填写的话，不同人对同一件事会写出差别很大的主题，
   访谈的挖掘方向也就跟着漂。 */
function pickTopic(btn) {
  const ta = document.getElementById('f-topic');
  if (!ta) return;
  const cur = ta.value.trim();
  const label = btn.textContent.trim();
  // 已经写过的内容保留，把选中的方向拼在后面
  ta.value = cur ? (cur.includes(label) ? cur : cur + ' · ' + label) : label;
  ta.focus();
  autoResize(ta);
}

/* 输入框自动增高（startInterview 之前的 textarea 没有 oninput 也能用） */
function autoResize(el) {
  if (!el || el.tagName !== 'TEXTAREA') return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}

async function startInterview() {
  clearError();
  const name = document.getElementById('f-name').value.trim();
  const position = document.getElementById('f-position').value.trim();
  const um = document.getElementById('f-um').value.trim();
  const city = document.getElementById('f-city').value;
  const topic = document.getElementById('f-topic').value.trim();
  const owner = document.getElementById('f-owner').value.trim();
  const ownerOrg = document.getElementById('f-owner-org').value.trim();

  if (!name) return showError('请填写被访谈人姓名');
  if (!position) return showError('请填写岗位');
  if (!um) return showError('请填写被访谈人 UM 号');
  if (!city) return showError('请选择所属城市');
  if (!topic) return showError('请填写访谈主题');
  if (!owner) return showError('请填写后线对接人');

  // 草稿保护：本地若存有一条尚未归档的访谈，开始新访谈会把它覆盖掉，先确认
  const pending = loadDraft();
  if (pending && !pending.archived) {
    const r = countRounds(pending.messages);
    const ok = confirm(
      '检测到一条未完成的访谈记录：\n\n' +
      pending.interviewee.name + '（' + pending.interviewee.position + '）\n' +
      '已完成 ' + r + ' 轮，保存于 ' + fmtAgo(pending.savedAt) + '\n\n' +
      '继续操作将覆盖这条记录，且无法恢复。\n确认开始新访谈吗？'
    );
    if (!ok) return;
  }

  // 仅在无代理且无内置 Key 时才要求用户输入
  let apiKey = BUILT_IN_API_KEY;
  if (!PROXY_URL && !apiKey) {
    apiKey = document.getElementById('f-apikey').value.trim();
    if (!apiKey) return showError('请填写 DeepSeek API Key');
    if (!apiKey.startsWith('sk-')) return showError('API Key 格式不正确，应以 sk- 开头');
    localStorage.setItem('ds_key', apiKey);
  }

  state.apiKey = apiKey;
  state.interviewee = { name, position, topic, city, um, owner, ownerOrg };
  state.messages = [];
  state.roundCount = 0;
  state.reportRaw = '';
  state.archived = false;

  document.getElementById('header-name').textContent = name + ' · ' + position;
  document.getElementById('header-meta').textContent = city + ' · UM ' + um + ' · 访谈主题：' + topic;
  document.getElementById('messages').innerHTML = '';
  updateRoundBadge();

  showScreen('chat-screen');

  // AI 开场白
  const sys = SYSTEM_PROMPT(name, position, topic, city, um);
  state.messages.push({ role: 'system', content: sys });
  await streamAI('请开始这次访谈，向被访谈人打招呼并说明访谈目的，然后提第一个问题。');
}

// ─── chat ─────────────────────────────────────────────────
function updateRoundBadge() {
  const badge = document.getElementById('round-badge');
  const n = state.roundCount;
  // 轮次不是越多越好，是够不够的问题：到了门槛就明说「可以出报告了」，
  // 免得一线在同一个问题上反复绕，或者刚聊两句就急着生成。
  badge.textContent = n < GATE.minRounds
    ? '第 ' + n + ' / ' + GATE.minRounds + ' 轮'
    : '第 ' + n + ' 轮 · 素材够用';
  badge.classList.toggle('ready', n >= GATE.minRounds && assessInterview(state.messages).ok);
  // 轮次不够时，「生成报告」按钮给个灰态，明确告知还需要多少
  const btn = document.getElementById('report-btn');
  if (btn) {
    const left = GATE.minRounds - n;
    if (left > 0 && n > 0) {
      btn.textContent = '还差 ' + left + ' 轮';
      btn.classList.add('not-ready');
    } else {
      btn.textContent = '生成报告';
      btn.classList.remove('not-ready');
    }
  }
}

function appendMsg(role, content, streaming = false) {
  const wrap = document.getElementById('messages');
  const div = document.createElement('div');
  div.className = 'msg ' + (role === 'user' ? 'user' : 'ai');
  const initials = role === 'user' ? '我' : 'AI';
  div.innerHTML = `
    <div class="avatar ${role === 'user' ? 'user-av' : 'ai'}">${initials}</div>
    <div class="bubble" id="bubble-${Date.now()}">${streaming ? '<span class="typing-content"></span>' : escHtml(content)}</div>`;
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
  if (streaming) {
    const inner = div.querySelector('.typing-content');
    return (chunk) => {
      inner.textContent += chunk;
      wrap.scrollTop = wrap.scrollHeight;
    };
  }
}

function showTyping() {
  const wrap = document.getElementById('messages');
  const div = document.createElement('div');
  div.className = 'msg ai'; div.id = 'typing-msg';
  div.innerHTML = `<div class="avatar ai">AI</div>
    <div class="bubble"><div class="typing-indicator">
      <div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>
    </div></div>`;
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
}
function hideTyping() {
  const el = document.getElementById('typing-msg');
  if (el) el.remove();
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}

function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

async function sendMessage() {
  if (state.streaming) return;
  const inp = document.getElementById('user-input');
  const text = inp.value.trim();
  if (!text) return;
  inp.value = ''; inp.style.height = 'auto';

  appendMsg('user', text);
  state.messages.push({ role: 'user', content: text });
  state.roundCount = countRounds(state.messages);   // 统一口径，避免计数器漂移
  updateRoundBadge();
  saveDraft();   // 先落盘用户这一句，即使此刻断线也不丢

  await streamAI();
}

async function streamAI(injectedUserMsg = null) {
  state.streaming = true;
  document.getElementById('send-btn').disabled = true;

  const msgs = [...state.messages];
  if (injectedUserMsg) {
    // 开场白这类「系统代发」的指令也要进对话历史，
    // 否则刷新续接后这一段上下文会凭空消失。
    // internal:true 表示它是给 AI 的控制指令，不算被访谈人的发言——
    // 回放与归档时都要滤掉，避免一线看到访谈提纲式的指令文字。
    state.messages.push({ role: 'user', content: injectedUserMsg, internal: true });
    msgs.push({ role: 'user', content: injectedUserMsg });
  }

  showTyping();

  try {
    const res = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: getApiHeaders(),
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: msgs.filter(m => m.role !== 'system' ? true : m).slice(0, 40),
        stream: true,
        max_tokens: 600,
        temperature: 0.7,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      hideTyping();
      appendMsg('ai', '请求失败：' + (err.error?.message || res.status) + '。请检查 API Key 是否正确。');
      state.streaming = false;
      document.getElementById('send-btn').disabled = false;
      return;
    }

    hideTyping();
    const push = appendMsg('ai', '', true);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const lines = decoder.decode(value).split('\n');
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') break;
        try {
          const j = JSON.parse(data);
          const chunk = j.choices?.[0]?.delta?.content || '';
          if (chunk) { push(chunk); full += chunk; }
        } catch {}
      }
    }

    state.messages.push({ role: 'assistant', content: full });

  } catch (e) {
    hideTyping();
    appendMsg('ai', '网络错误：' + e.message);
  }

  state.streaming = false;
  document.getElementById('send-btn').disabled = false;
  saveDraft();   // 一轮问答完成，落盘
}

// ─── report ───────────────────────────────────────────────
async function endAndReport() {
  if (countRounds(state.messages) < 3) {
    alert('访谈内容不够，请至少进行几轮对话后再生成报告。');
    return;
  }

  const a = assessInterview(state.messages);

  // 素材不够时不拦死，但把差距摆出来，让用户自己选继续访还是照常生成——
  // 强行生成出来的报告只是看着完整，其实全是通用话。
  if (!a.ok && !state.reportRaw) {
    showGatePanel(a);
    return;
  }

  await generateReport();
}

function showGatePanel(a) {
  showScreen('report-screen');
  renderReportMeta();
  renderAlert([]);
  const cls = (ok) => ok ? 'good' : 'bad';
  document.getElementById('report-content').innerHTML = `
    <div class="gate-panel">
      <div class="gate-title">素材还不够，现在生成多半是空话</div>
      <div class="gate-desc">
        报告里能写多少具体做法，取决于访谈里说了多少细节。现在这些指标还没到位，
        直接生成出来的报告通常只有「定期维护」「主动沟通」这类读不出动作的句子，
        发给同事没法照着做。
      </div>
      <div class="gate-stats">
        <div class="stat">
          <div class="stat-label">有效轮次</div>
          <div class="stat-val ${cls(a.rounds >= GATE.minRounds)}">${a.rounds} / ${GATE.minRounds}</div>
        </div>
        <div class="stat">
          <div class="stat-label">你的累计字数</div>
          <div class="stat-val ${cls(a.totalChars >= GATE.minTotalChars)}">${a.totalChars} / ${GATE.minTotalChars}</div>
        </div>
        <div class="stat">
          <div class="stat-label">60 字以上的回答</div>
          <div class="stat-val ${cls(a.longAnswers >= GATE.minLongAnswers)}">${a.longAnswers} / ${GATE.minLongAnswers}</div>
        </div>
      </div>
      <div class="gate-desc" style="margin-bottom:14px">
        还差：${escHtml(a.gaps.join('；'))}。<br>
        接着聊时，把「多久一次、第一句话怎么说、用了什么、对方不回怎么办」这几样讲出来，就够用了。
      </div>
      <div class="gate-actions">
        <button class="primary" onclick="backToChat()">返回继续访</button>
        <button class="ghost" onclick="generateReport()">仍要生成报告</button>
      </div>
    </div>`;
}

async function generateReport() {
  showScreen('report-screen');
  renderReportMeta();
  renderAlert([]);
  document.getElementById('report-content').innerHTML = `
    <div class="report-generating">
      <div class="loading-dots"><span></span><span></span><span></span></div>
      正在根据访谈内容生成报告，请稍候…
    </div>`;

  const { name, position, topic } = state.interviewee;
  const reportMsgs = [
    ...state.messages,
    { role: 'user', content: REPORT_PROMPT(name, position, topic) }
  ];

  try {
    const res = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: getApiHeaders(),
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: reportMsgs,
        stream: false,
        max_tokens: 2800,   // 经验点改成「做法 + 具体怎么做」两层后篇幅变长，2.0k 容易截断
        temperature: 0.5,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || res.status);

    const raw = data.choices?.[0]?.message?.content || '';
    const truncated = data.choices?.[0]?.finish_reason === 'length';

    state.reportRaw = raw;
    renderReport(raw);
    renderAlert(collectReportIssues(state.messages, raw));
    saveDraft();   // 报告已生成，落盘，便于断线后直接回看

    if (truncated) {
      alert('报告字数达到上限，末尾可能被截断了。建议点「返回访谈」补充几轮后重新生成，或直接检查最后两节内容是否完整。');
    }

  } catch (e) {
    document.getElementById('report-content').innerHTML =
      `<div class="report-section"><div class="content" style="color:var(--danger)">报告生成失败：${escHtml(e.message)}</div></div>`;
  }
}

function renderReportMeta() {
  const { name, position, topic, city, um, owner, ownerOrg } = state.interviewee;
  const today = new Date().toLocaleDateString('zh-CN', { year:'numeric', month:'long', day:'numeric' });
  const ownerTxt = owner
    ? escHtml(owner) + (ownerOrg ? '（' + escHtml(ownerOrg) + '）' : '')
    : '—';
  document.getElementById('report-meta').innerHTML = `
    <div class="meta-item"><div class="meta-label">访谈对象</div><div class="meta-value">${escHtml(name)}</div></div>
    <div class="meta-item"><div class="meta-label">岗位</div><div class="meta-value">${escHtml(position)}</div></div>
    <div class="meta-item"><div class="meta-label">UM 号</div><div class="meta-value">${escHtml(um || '—')}</div></div>
    <div class="meta-item"><div class="meta-label">所属城市</div><div class="meta-value">${escHtml(city || '—')}</div></div>
    <div class="meta-item"><div class="meta-label">访谈日期</div><div class="meta-value">${today}</div></div>
    <div class="meta-item"><div class="meta-label">后线对接人</div><div class="meta-value">${ownerTxt}</div></div>
    <div class="meta-item" style="grid-column:1/-1"><div class="meta-label">案例主题</div><div class="meta-value">${escHtml(topic)}</div></div>`;
}

const SUBHEAD_RE = /^(?:\*{0,2}|【)\s*(做法|具体怎么做|具体做法|怎么做)\s*(?:\*{0,2}|】)\s*[:：]?\s*/;
const METHOD_KEY_RE = /^(频次|时机|周期|话术|方法|做法|载体|工具|渠道|对方|客户|注意|要点|条件|判断|标准|要点提示|其他|备注)\s*[:：]/;

function splitLines(text) {
  return String(text || '').replace(/\r/g, '').split('\n').map(s => s.trim()).filter(Boolean);
}

/* 经验点要做成「做法 → 具体怎么做」的层级，纯粹为了好读：
   一线扫一眼就能看出哪句是结论、哪几条是能照着做的动作。 */
function looksStructured(lines) {
  return lines.some(l => SUBHEAD_RE.test(l) || METHOD_KEY_RE.test(l));
}

function renderStructured(text) {
  const lines = splitLines(text);
  const items = [];
  let cur = null;

  lines.forEach(line => {
    const lead = line.match(SUBHEAD_RE);
    if (lead && lead[1] === '做法') {
      cur = { lead: line.replace(SUBHEAD_RE, '').trim(), steps: [] };
      items.push(cur);
      return;
    }
    if (lead) return;               // 「具体怎么做：」这行本身不显示，交给下面的键值行
    line.split('；').map(s => s.trim()).filter(Boolean).forEach(part => {
      const m = part.match(/^(?:[-*•]\s*)?([^:：]{1,12})[:：]\s*(.+)$/);
      if (m && cur) cur.steps.push({ k: m[1].replace(/^[-*•\s]+/, ''), v: m[2].trim() });
      else if (cur) cur.steps.push({ k: '', v: part });
      else items.push({ lead: part, steps: [] });
    });
  });

  return items.map(it => {
    if (!it.lead && !it.steps.length) return '';
    const body = it.steps.map(s =>
      s.k ? '<div class="exp-step"><span class="k">' + escHtml(s.k) + '</span><span class="v">' + escHtml(s.v) + '</span></div>'
          : '<div class="exp-step"><span class="v">' + escHtml(s.v) + '</span></div>'
    ).join('');
    return '<div class="exp-item">'
         + (it.lead ? '<div class="exp-lead">' + escHtml(it.lead) + '</div>' : '')
         + (body ? '<div class="exp-body">' + body + '</div>' : '')
         + '</div>';
  }).join('');
}

function renderPlain(text) {
  const lines = splitLines(text);
  if (!lines.length) return '';
  // 逐行 <div> 而不是整块 pre-wrap：一是换行稳定，二是不依赖 white-space 继承
  return lines.map(l => {
    const hasNum = /^\d+[.、）)]/.test(l);
    return '<div class="ln' + (hasNum ? ' num' : '') + '">' + escHtml(l) + '</div>';
  }).join('');
}

/* 去掉模型在正文首行复述的章节标题。
   原来用 /^[^\n]*\n/ 粗暴砍掉第一行，遇到正文前有空行时砍不干净，
   标题就留在了正文里（表现为第 2 节往后每节标题重复一次）。 */
function stripSectionHeading(text, title) {
  let t = String(text || '').replace(/^\s+/, '');
  t = t.replace(/^\s*(?:#{1,6}\s*)?(?:\d+[.、）)]\s*)?/, '');
  t = t.replace(/^[\s*_【]*(?:\d+[.、）)]\s*)?/, '');
  const esc = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  t = t.replace(new RegExp('^' + esc + '\\s*[】*_]*\\s*[:：]?\\s*\\n?'), '');
  return t.replace(/^\s+/, '').trim();
}

function renderReport(raw) {
  const parts = String(raw || '').split('---SECTION---');
  const container = document.getElementById('report-content');
  container.innerHTML = '';

  SECTION_TITLES.forEach((title, i) => {
    const text = stripSectionHeading(parts[i] || '', title);
    const empty = '（本节内容未获取到，请尝试重新生成）';
    let inner;
    if (!text) {
      inner = escHtml(empty);
    } else if (title === '可复制的经验点' && looksStructured(splitLines(text))) {
      inner = renderStructured(text);   // 结构化渲染，避免裸 JSON 感
    } else {
      inner = renderPlain(text);
    }
    const sec = document.createElement('div');
    sec.className = 'report-section';
    sec.innerHTML = `<h3 data-num="${i + 1}">${title}</h3><div class="content">${inner}</div>`;
    container.appendChild(sec);
  });
}

function copyReport() {
  const { name, position, topic, city, um, owner, ownerOrg } = state.interviewee;
  const today = new Date().toLocaleDateString('zh-CN');
  let text = `案例经验报告\n访谈对象：${name}（${position}）\nUM 号：${um || '—'}\n所属城市：${city || '—'}\n` +
             `后线对接人：${owner || '—'}${ownerOrg ? '（' + ownerOrg + '）' : ''}\n` +
             `案例主题：${topic}\n访谈日期：${today}\n\n`;
  document.querySelectorAll('#report-content .report-section').forEach((sec, i) => {
    text += `${i + 1}. ${SECTION_TITLES[i]}\n`;
    const lines = [];
    sec.querySelectorAll('.exp-lead, .ln').forEach(el => lines.push(el.textContent.trim()));
    sec.querySelectorAll('.exp-step').forEach(el => {
      const k = el.querySelector('.k');
      const v = el.querySelector('.v');
      lines.push((k ? '    - ' + k.textContent.trim() + '：' : '    ') + (v ? v.textContent.trim() : ''));
    });
    text += (lines.length ? lines.join('\n') : sec.querySelector('.content').textContent.trim()) + '\n\n';
  });
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('copy-all-btn');
    btn.textContent = '已复制 ✓';
    setTimeout(() => { btn.textContent = '复制报告'; }, 2500);
  });
}

// ─── 归档 ─────────────────────────────────────────────────
function resetArchiveUI() {
  const btn = document.getElementById('archive-btn');
  const st = document.getElementById('archive-status');
  if (btn) { btn.disabled = false; btn.classList.remove('done'); btn.textContent = '提交归档'; }
  if (st) { st.textContent = ''; st.className = 'archive-status'; }
}

async function submitArchive() {
  const btn = document.getElementById('archive-btn');
  const st  = document.getElementById('archive-status');
  if (state.archived) return;
  if (!SUBMIT_URL) {
    st.textContent = '归档服务未配置';
    st.className = 'archive-status err';
    return;
  }
  if (!state.reportRaw) {
    st.textContent = '报告尚未生成，无法归档';
    st.className = 'archive-status err';
    return;
  }

  btn.disabled = true;
  btn.textContent = '归档中…';
  st.textContent = '';
  st.className = 'archive-status';

  const iv = state.interviewee;
  const transcript = state.messages
    .filter(m => m.role !== 'system' && !m.internal)
    .map(m => ({ role: m.role, content: m.content }));

  const payload = {
    city: iv.city,
    interviewee_name: iv.name,
    interviewee_position: iv.position,
    interviewee_um: iv.um || null,
    topic: iv.topic,
    backend_owner_name: iv.owner || null,
    backend_owner_org: iv.ownerOrg || null,
    round_count: countRounds(state.messages),   // 与 transcript 口径一致，避免计数器漂移
    report_md: state.reportRaw,
    transcript,
  };

  try {
    const res = await fetch(SUBMIT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.fields ? ('缺少：' + data.fields.join('、')) : (data.error || ('HTTP ' + res.status));
      throw new Error(msg);
    }

    state.archived = true;
    btn.classList.add('done');
    btn.textContent = '已归档 ✓';
    st.textContent = '归档编号 #' + (data.id != null ? data.id : '—');
    st.className = 'archive-status ok';
    clearDraft();   // 已归档入库，本地草稿完成使命
  } catch (e) {
    btn.disabled = false;
    btn.textContent = '重新提交归档';
    st.textContent = '归档失败：' + e.message;
    st.className = 'archive-status err';
  }
}

function backToChat() { showScreen('chat-screen'); }
function resetToSetup() {
  if (!confirm('重置将清除当前访谈记录，确认？')) return;
  clearDraft();
  state.messages = []; state.roundCount = 0; state.streaming = false;
  state.reportRaw = ''; state.archived = false;
  state.interviewee = { name:'', position:'', topic:'', city:'', um:'', owner:'', ownerOrg:'' };
  document.getElementById('draft-bar').style.display = 'none';
  showScreen('setup-screen');
}
