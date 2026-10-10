/* 断线续接：真实 DOM 环境验证（jsdom）
   覆盖用户提出的三类场景：刷新页面 / 锁屏重开（等同刷新） / 误关标签页（重开=刷新）
   核心断言：localStorage 草稿能完整还原「表单 → 对话历史 → 报告 → 归档态」全链路。
*/
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

/* ⚠️ 必须指向 web/index.html —— 项目根目录下的 index.html 是 09-24 的遗留旧副本，
   曾导致本套件长期在测过期页面（改动完全没被覆盖）。不要再改回 '../index.html'。 */
const HTML_PATH = path.resolve(__dirname, '..', 'web', 'index.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');

let pass = 0, fail = 0;
const t = (label, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (extra ? '  → ' + extra : '')); }
};
const sec = s => console.log('\n' + s);

const PAGE_URL = 'https://interview-work-d1gs0jzrg2277d75e.webapps.tcloudbase.com/';

/* 模拟真实「选人」动作：先选中再派发 change。
   只赋 value 不触发 change 的话，syncOwnerOrg() 不会跑，所属中心就是空的——
   这正是之前测试假失败的原因，也让测试更贴近真实用户操作。 */
function selectOwner(w, d, name) {
  const sel = d.getElementById('f-owner');
  sel.value = name;
  sel.dispatchEvent(new w.Event('change'));
}

/* ── 建一个可复用 localStorage 的共享存储（模拟同一浏览器 profile）── */
const makeStore = () => {
  const map = new Map();
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k),
    clear: () => map.clear(),
    key: i => [...map.keys()][i],
    get length() { return map.size; },
    _map: map,
  };
};

/* ── 构建一个「页面会话」：真实执行页内脚本，注入共享 localStorage ── */
function openSession(store, opts = {}) {
  const dom = new JSDOM(html, {
    url: PAGE_URL,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      Object.defineProperty(window, 'localStorage', { value: store, configurable: true });
      window.confirm = () => (opts.confirm === undefined ? true : opts.confirm);
      window.alert = () => {};
      // 阻断真实网络，返回可控的假响应
      // 报告正文刻意写成带 ---SECTION--- 的六节结构，便于验证渲染；
      // finish_reason=stop 表示未被截断（length 会触发「末尾可能被截断」提示）
      window.fetch = async () => ({
        ok: true, status: 200,
        json: async () => ({
          choices: [{
            message: { content: [
              '背景与挑战\n某客户需要一笔周转资金。',
              '核心做法\n1. 先翻上个月批款名单',
              '关键判断与取舍\n1. 先了解其他渠道的批款难度',
              '结果\n最终成交 30 万元。',
              '可复制的经验点\n做法：成交后按时间节奏做关系维护。\n具体怎么做：\n- 频次/时机：放款后第3天发到账提醒',
              '新人容易踩的坑\n1. 第一次打电话就推产品，容易一句"不用"被挂断。可以改成先问资金周转情况。',
            ].join('\n---SECTION---\n') },
            finish_reason: 'stop',
          }],
        }),
        body: {
          getReader: () => {
            const chunks = [Buffer.from('data: {"choices":[{"delta":{"content":"你好"}}]}\n\n'), Buffer.from('data: [DONE]\n\n')];
            let i = 0;
            return { read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined }) };
          },
        },
      });
    },
  });
  return dom;
}

/* 等脚本在 window.onload 里跑完 */
const settle = (ms = 250) => new Promise(r => setTimeout(r, ms));

(async () => {
  /* ══════════════ 场景 A：全新用户，无草稿 ══════════════ */
  sec('[A] 全新用户 · 无草稿时不应有续接干扰');
  let store = makeStore();
  let dom = openSession(store);
  await settle();
  let w = dom.window, d = w.document;

  t('页面标题正确', /经验萃取/.test(d.title), d.title);
  t('续接提示条默认隐藏', w.getComputedStyle(d.getElementById('draft-bar')).display === 'none');
  t('表单含 UM 号字段', !!d.getElementById('f-um'));
  t('表单含后线对接人字段', !!d.getElementById('f-owner'));
  t('表单含对接人所属中心字段', !!d.getElementById('f-owner-org'));
  t('提交人字段已移除', !d.getElementById('f-submitter') && !/提交人/.test(d.body.textContent));
  t('岗位字段已移除（固定为咨询顾问）', !d.getElementById('f-position'));
  t('城市字段已移除', !d.getElementById('f-city'));
  t('对接人下拉含「其他」手填选项', /其他/.test(d.getElementById('f-owner').innerHTML));
  t('选「其他」的手填框默认隐藏', (() => {
    const g = d.getElementById('g-owner-custom-name');
    return !!g && g.style.display === 'none';
  })());

  /* ══════════════ 场景 B：访谈进行中被刷新 ══════════════ */
  sec('[B] 访谈进行到第 6 轮被刷新 · 草稿应落盘并可续接');

  // 1. 填表 + 开始访谈（岗位与城市已从表单移除，由代码固定/留空）
  d.getElementById('f-name').value = '康红钦';
  d.getElementById('f-um').value = '87654321';
  d.getElementById('f-topic').value = '孤儿单盘活经验';
  selectOwner(w, d, '王珍');   // 模拟真实选人：赋值 + 触发 change（否则中心不会自动带出）

  await w.startInterview();
  await settle();
  t('已进入聊天页', d.getElementById('chat-screen').classList.contains('active'));
  t('页眉显示姓名', /康红钦/.test(d.getElementById('header-name').textContent));
  t('页眉显示 UM 号', /87654321/.test(d.getElementById('header-meta').textContent));
  t('页眉岗位固定为咨询顾问', /咨询顾问/.test(d.getElementById('header-name').textContent));
  t('页眉不再出现城市分隔符残留', !/^· /.test(d.getElementById('header-meta').textContent.trim()));

  // 2. 先聊 3 轮，用来验证「轮次明显不够」时报告硬闸生效
  for (let i = 1; i <= 3; i++) {
    d.getElementById('user-input').value = '这是第 ' + i + ' 轮的回答内容';
    await w.sendMessage();
    await settle(120);
  }

  /* ★ 2026-10-10 新增硬闸：MIN_REPORT_ROUNDS = 5 以下直接不出报告。
     教训来自 id=17 那份 —— 只聊了 3 轮就生成了报告，通篇"待补"，
     还随自动发信一起发了出去。 */
  let gateAlert = '';
  w.alert = (m) => { gateAlert = String(m); };
  await w.endAndReport();
  t('★ 少于 5 轮时生成报告被拦下（且不进入报告页）',
    /只有 3 轮/.test(gateAlert) && !d.getElementById('report-screen').classList.contains('active'), gateAlert);
  w.alert = () => {};

  // 继续聊到 6 轮（≥ 硬闸），后面场景 C 才能走到「素材不足」提示面板那条路径
  for (let i = 4; i <= 6; i++) {
    d.getElementById('user-input').value = '这是第 ' + i + ' 轮的回答内容';
    await w.sendMessage();
    await settle(120);
  }
  // ★ 2026-09-29：徽标不再暴露门槛分母（8 是内部最低线，露出会让被访谈人
  //   误以为"聊满 8 轮就结束"）。改为只显示进度"已聊 N 轮"。
  t('轮次徽标显示当前轮次', /已聊 6 轮/.test(d.getElementById('round-badge').textContent), d.getElementById('round-badge').textContent);
  t('★ 徽标不暴露门槛分母（不出现 / 8）', !/\/\s*8|\/8/.test(d.getElementById('round-badge').textContent), d.getElementById('round-badge').textContent);
  t('★ 未达门槛时按钮不诱导"凑轮数"（不出现"还差 N 轮"）', !/还差/.test(d.getElementById('report-btn').textContent), d.getElementById('report-btn').textContent);
  t('★ 未达门槛时按钮提示"再聊一会儿"', /再聊一会儿/.test(d.getElementById('report-btn').textContent), d.getElementById('report-btn').textContent);
  t('草稿已写入 localStorage', store.getItem('iv_draft_v1') !== null);

  const saved = JSON.parse(store.getItem('iv_draft_v1'));
  t('草稿含姓名', saved.interviewee.name === '康红钦');
  t('草稿含 UM 号', saved.interviewee.um === '87654321');
  t('草稿含后线对接人', saved.interviewee.owner === '王珍', String(saved.interviewee.owner));
  t('草稿含对接人所属中心（自动带出）', saved.interviewee.ownerOrg === '西安第一咨询中心', String(saved.interviewee.ownerOrg));
  t('草稿轮次 = 6', saved.roundCount === 6, String(saved.roundCount));
  t('草稿含 15 条消息（1 system + 1 开场白指令 + 1 开场白回复 + 6 问 + 6 答）', saved.messages.length === 15, String(saved.messages.length));
  t('开场白指令带 internal 标记', saved.messages.filter(m => m.internal).length === 1,
    'internal 条数 ' + saved.messages.filter(m => m.internal).length);
  t('真实用户发言 6 条', saved.messages.filter(m => m.role === 'user' && !m.internal).length === 6,
    String(saved.messages.filter(m => m.role === 'user' && !m.internal).length));
  t('开场白不计入轮次（roundCount = 6）', saved.roundCount === 6, String(saved.roundCount));
  dom.window.close();

  /* ── 刷新：用同一个 store 新建会话 ── */
  sec('[B-续] 刷新页面后（等同锁屏重开/误关标签页重进）');
  dom = openSession(store);
  await settle();
  w = dom.window; d = w.document;

  t('续接提示条已自动显示', w.getComputedStyle(d.getElementById('draft-bar')).display !== 'none');
  const info = d.getElementById('draft-info').textContent;
  t('提示含姓名', /康红钦/.test(info), info);
  t('提示含岗位', /咨询顾问/.test(info), info);
  t('提示含轮次', /6 轮/.test(info), info);
  t('提示含相对时间', /刚刚|分钟前|小时前/.test(info), info);

  console.log('       提示文案：' + info.trim());

  // 点「继续访谈」
  await w.resumeDraft();
  await settle();
  t('点击后进入聊天页', d.getElementById('chat-screen').classList.contains('active'));
  t('页眉姓名已还原', /康红钦/.test(d.getElementById('header-name').textContent));
  t('页眉 UM 号已还原', /87654321/.test(d.getElementById('header-meta').textContent));
  t('页眉不再显示城市（字段已移除）', !/西安市/.test(d.getElementById('header-meta').textContent));
  const msgCount = d.getElementById('messages').querySelectorAll('.msg').length;
  t('对话历史渲染出 13 条气泡（1 开场白回复 + 6 问 + 6 答）', msgCount === 13, '实际 ' + msgCount);
  t('历史含第 1 轮回答', /这是第 1 轮的回答内容/.test(d.getElementById('messages').textContent));
  t('历史含第 6 轮回答', /这是第 6 轮的回答内容/.test(d.getElementById('messages').textContent));
  t('历史不含系统指令文字', !/请开始这次访谈/.test(d.getElementById('messages').textContent));
  t('轮次徽标还原为已聊 6 轮', /已聊 6 轮/.test(d.getElementById('round-badge').textContent), d.getElementById('round-badge').textContent);
  t('进入聊天后提示条收起', w.getComputedStyle(d.getElementById('draft-bar')).display === 'none');
  const memState = w.eval('JSON.stringify({roundCount: state.roundCount, owner: state.interviewee.owner, msgs: state.messages.length})');
  const ms = JSON.parse(memState);
  t('内存 state 轮次同步', ms.roundCount === 6, String(ms.roundCount));
  t('内存 state 对接人同步', ms.owner === '王珍', ms.owner);
  t('内存 state 消息与草稿一致', ms.msgs === 15, String(ms.msgs));
  dom.window.close();

  /* ══════════════ 场景 C：报告已生成后断线 ══════════════ */
  sec('[C] 报告生成后断线重进 · 应直接回到报告页');
  dom = openSession(store);
  await settle();
  w = dom.window; d = w.document;
  await w.resumeDraft();
  await settle();
  // 6 轮素材过了硬闸但达不到信息量门槛，此时点「生成报告」应先出提示面板而不是直接出报告。
  // 旧测试直接调 endAndReport() 期望出报告，这里改为走「仍要生成报告」按钮的真实路径。
  await w.endAndReport();
  await settle(60);
  const gateShown = d.getElementById('report-content').textContent.includes('素材还偏薄');
  t('素材不足时先出提示面板而非报告', gateShown, d.getElementById('report-content').textContent.slice(0, 60));
  if (gateShown) {
    await w.generateReport();   // 等价于点「仍要生成报告」
    await settle(300);
  }

  const afterReport = JSON.parse(store.getItem('iv_draft_v1'));
  t('报告已落入草稿', /核心做法/.test(afterReport.reportRaw || ''), (afterReport.reportRaw || '').slice(0, 40));
  t('当前处于报告页', d.getElementById('report-screen').classList.contains('active'));
  dom.window.close();

  // 再次刷新
  dom = openSession(store);
  await settle();
  w = dom.window; d = w.document;
  t('重进后提示条显示', w.getComputedStyle(d.getElementById('draft-bar')).display !== 'none');
  await w.resumeDraft();
  await settle();
  t('续接后直达报告页（不重跑生成）', d.getElementById('report-screen').classList.contains('active'));
  t('报告内容已渲染', /核心做法/.test(d.getElementById('report-content').textContent));
  t('归档按钮可点', d.getElementById('archive-btn').disabled === false);
  dom.window.close();

  /* ══════════════ 场景 D：开始新访谈时的覆盖保护 ══════════════ */
  sec('[D] 存在未归档草稿时 · 开始新访谈必须二次确认');

  // D1：用户点「取消」
  dom = openSession(store, { confirm: false });
  await settle();
  w = dom.window; d = w.document;
  let confirmMsg = null;
  w.confirm = m => { confirmMsg = m; return false; };

  d.getElementById('f-name').value = '张三';
  d.getElementById('f-um').value = '11111111';
  d.getElementById('f-topic').value = '新访谈';
  selectOwner(w, d, '赵婕');
  await w.startInterview();
  await settle();

  t('弹出了确认框', confirmMsg !== null);
  t('确认文案含被访谈人姓名', /康红钦/.test(confirmMsg || ''), (confirmMsg || '').slice(0, 80));
  t('确认文案含已完成轮次', /轮/.test(confirmMsg || ''));
  t('确认文案说明会被覆盖', /覆盖/.test(confirmMsg || ''));
  t('取消后仍停留在设置页', d.getElementById('setup-screen').classList.contains('active'));
  t('取消后草稿未被清掉', store.getItem('iv_draft_v1') !== null);
  dom.window.close();

  // D2：用户点「确定」
  sec('[D-续] 用户确认覆盖 · 正常开始新访谈');
  dom = openSession(store, { confirm: true });
  await settle();
  w = dom.window; d = w.document;
  d.getElementById('f-name').value = '张三';
  d.getElementById('f-um').value = '11111111';
  d.getElementById('f-topic').value = '新访谈';
  selectOwner(w, d, '赵婕');
  await w.startInterview();
  await settle();
  t('已切到新访谈人', /张三/.test(d.getElementById('header-name').textContent), d.getElementById('header-name').textContent);
  t('对话区已清空重置', d.getElementById('messages').querySelectorAll('.msg').length <= 2, String(d.getElementById('messages').querySelectorAll('.msg').length));
  dom.window.close();

  /* ══════════════ 场景 E：归档成功后草稿应被清除 ══════════════ */
  sec('[E] 归档成功后 · 本地草稿应清除且重进不再提示');
  store = makeStore();
  dom = openSession(store, { confirm: true });
  await settle();
  w = dom.window; d = w.document;

  // 直接用已知草稿灌入，避免重跑对话
  const seed = {
    v: 1, savedAt: Date.now(),
    interviewee: { name: '李四', position: '咨询顾问', topic: '测试主题', city: '咸阳市', um: '22222222', owner: '赵经理', ownerOrg: '咸阳中心' },
    messages: [
      { role: 'system', content: 'SYS' },
      { role: 'assistant', content: 'A1' }, { role: 'user', content: 'U1' },
      { role: 'assistant', content: 'A2' }, { role: 'user', content: 'U2' },
      { role: 'assistant', content: 'A3' }, { role: 'user', content: 'U3' },
    ],
    roundCount: 3, reportRaw: '背景与挑战\n---SECTION---\n核心做法', archived: false,
  };
  store.setItem('iv_draft_v1', JSON.stringify(seed));
  await w.resumeDraft();
  await settle();
  t('已续接到报告页', d.getElementById('report-screen').classList.contains('active'));

  // mock 归档接口成功
  w.fetch = async (url) => {
    if (String(url).includes('/api/submit')) {
      return { ok: true, status: 200, json: async () => ({ id: 42 }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  await w.submitArchive();
  await settle(200);
  t('归档状态显示成功', /归档编号 #42/.test(d.getElementById('archive-status').textContent), d.getElementById('archive-status').textContent);
  t('按钮变为已归档', /已归档/.test(d.getElementById('archive-btn').textContent));
  t('本地草稿已清除', store.getItem('iv_draft_v1') === null);
  dom.window.close();

  dom = openSession(store);
  await settle();
  t('重进后不再提示续接', store.getItem('iv_draft_v1') === null);

  /* ══════════════ 场景 F：放弃草稿 ══════════════ */
  sec('[F] 点「放弃」应清除草稿');
  store = makeStore();
  store.setItem('iv_draft_v1', JSON.stringify(seed));
  dom = openSession(store, { confirm: true });
  await settle();
  w = dom.window; d = w.document;
  t('提示条显示', w.getComputedStyle(d.getElementById('draft-bar')).display !== 'none');
  await w.discardDraft();
  await settle();
  t('草稿已删除', store.getItem('iv_draft_v1') === null);
  t('提示条已隐藏', w.getComputedStyle(d.getElementById('draft-bar')).display === 'none');
  dom.window.close();

  /* ══════════════ 结果 ══════════════ */
  console.log('\n' + '='.repeat(52));
  console.log('  断线续接验证：通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log('='.repeat(52));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('\n验证脚本异常：', e); process.exit(2); });
