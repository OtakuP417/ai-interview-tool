
/* ─── 配置 ───────────────────────────────────────────── */
const ADMIN_URL = 'https://work-d1gs0jzrg2277d75e-1391683363.ap-shanghai.app.tcloudbase.com/api/admin';
const MAIL_URL = 'https://work-d1gs0jzrg2277d75e-1391683363.ap-shanghai.app.tcloudbase.com/api/mail';

const SECTION_TITLES = ['背景与挑战','核心做法','关键判断与取舍','结果','可复制的经验点','新人注意事项'];
const STATUS_CLASS = { '待审':'wait', '已采纳':'adopt', '已退回':'reject' };
const STATUS_LIST = ['待审','已采纳','已退回'];

/* 模型偶尔把末节写成「新人容易踩的坑」而不是「新人注意事项」，
   其它节也有别称。剥正文首行重复标题时按这张表匹配，避免漏剥。 */
const SECTION_ALIASES = [
  '背景与挑战', '背景', '核心做法', '主要做法', '关键做法', '做法',
  '关键判断与取舍', '关键判断', '结果', '成果',
  '可复制的经验点', '可复制经验点', '可借鉴的经验', '新人注意事项',
  '新人容易踩的坑', '新人避坑', '避坑提示', '海报摘要',
];

/**
 * 剥掉正文首行复述的标题。
 *
 * 归档里的 report_md 段落形如 '…正文\n\n---SECTION---\n\n核心做法\n1. …'，
 * 第 2 节起正文首行前面带着前导换行。之前用的 /^[^\n]*\n/ 只吃掉一个换行，
 * 剩下的标题就留在正文里又显示了一遍（详情页与复制全文都受影响）。
 * 改成「先按标题别名表判断首行是不是标题，是则整行剥掉」，
 * 不吃正文首行、也不依赖换行个数。
 */
function stripSectionHeading(text) {
  let t = String(text || '').replace(/\r/g, '').replace(/^\s+/, '');
  const firstLine = (t.split('\n')[0] || '');
  const norm = firstLine
    .replace(/^\s*(?:#{1,6}\s*)?/, '')
    .replace(/^\s*\d+[.、）)]\s*/, '')
    .replace(/[\s*_【】]/g, '')
    .replace(/[:：]$/, '');
  if (norm && SECTION_ALIASES.indexOf(norm) >= 0) {
    t = t.slice(firstLine.length).replace(/^\s+/, '');
  }
  return t.trim();
}

/* 管理端页面版本号。与访谈页的 APP_BUILD 独立编号，
   手机上缓存难清，靠这一行确认打开的是哪一版。 */
const ADMIN_BUILD = 'v2026.09.29-b';

/* ─── 覆盖度体检（与访谈页 assessCoverage 同一套判据）────────
   访谈页那套是给填表人自己看的；这里重写一份给审核方看（后台原先完全没有）。
   判据必须与访谈页保持一致，否则同一份报告两边显示不同结论。
   六个维度：背景/做法/方法层/结果/判断/避坑；必备三维=背景+做法+结果。
   ──────────────────────────────────────────────────────── */
const COV_DIMS = [
  { k: 'background', label: '案例背景', probe: '客户是什么情况、怎么接触上的', alias: ['背景与挑战', '背景'] },
  { k: 'action',     label: '具体做法', probe: '一步步怎么做的、关键动作',      alias: ['核心做法', '主要做法', '关键做法', '做法'] },
  { k: 'method',     label: '方法层细节', probe: '频次、话术、载体、对方不理会时怎么办', alias: [] },
  { k: 'result',     label: '结果与数据', probe: '带来什么结果、有没有数字',    alias: ['结果', '成果'] },
  { k: 'decision',   label: '判断与取舍', probe: '当时怎么判断的、为什么这么选', alias: ['关键判断与取舍', '关键判断'] },
  { k: 'pitfall',    label: '新人易踩的坑', probe: '新人做这件事容易错在哪',    alias: ['新人容易踩的坑', '新人注意事项', '新人避坑', '避坑提示'] },
];
const COV_METHOD_RE = /(每周|每月|每天|每隔|一次|第\s*\d+\s*天|多久|频次|时机|微信|电话|当面|拉群|朋友圈|名单|系统|原话|开场|说"|说「|对方没反应|不回|拒绝|拖延|怎么办)/;

function covSectionMap(raw) {
  const out = {};
  String(raw || '').split(/\s*---SECTION---\s*/).forEach(part => {
    const lines = String(part).split('\n');
    if (!lines.length) return;
    const title = lines[0]
      .replace(/^\s*(?:\d+[.、）)]\s*|#{1,6}\s*)/, '')
      .replace(/[*_【】]/g, '')
      .replace(/[:：]\s*$/, '')
      .trim();
    out[title] = lines.slice(1).join('\n').trim();
  });
  return out;
}

function covSubstantive(text) {
  const t = String(text || '').replace(/[\s*#\-]/g, '');
  if (t.length < 12) return false;
  if (/^(访谈中未展开|暂无|无|不适用|未提供)/.test(t)) return false;
  return true;
}

function assessCoverageAdmin(raw, transcript) {
  const secs = covSectionMap(raw);
  const turns = Array.isArray(transcript) ? transcript : [];
  const userText = turns
    .filter(m => m.role === 'user' && !m.internal)
    .map(m => String(m.content || '')).join('\n');

  const methodInReport = Object.keys(secs).some(t => COV_METHOD_RE.test(secs[t] || ''));
  const methodInTalk = COV_METHOD_RE.test(userText);

  const dims = COV_DIMS.map(d => {
    let ok = false, note = '';
    if (d.k === 'method') {
      ok = methodInReport && methodInTalk;
      note = ok ? '频次/话术/载体等细节有据可查'
        : (methodInReport ? '报告里有方法层表述，但对话中未见支撑'
          : (methodInTalk ? '对话里提到过，但没写进报告' : '还没问到具体怎么做'));
    } else {
      const hitKey = d.alias.find(a => secs[a] != null)
        || Object.keys(secs).find(t => d.alias.some(a => t.indexOf(a) >= 0));
      const hit = hitKey != null ? secs[hitKey] : null;
      ok = covSubstantive(hit);
      if (d.k === 'result' && ok && !/[0-9０-９]/.test(String(hit))) {
        note = '有内容但没数字，说服力偏弱';
      } else {
        note = ok ? '有实质内容' : '这一块还是空的';
      }
    }
    return { k: d.k, label: d.label, probe: d.probe, ok, note };
  });

  const byKey = {};
  dims.forEach(d => { byKey[d.k] = d; });
  const required = ['background', 'action', 'result'];
  const missing = required.filter(k => !byKey[k].ok);
  const reasons = [];
  if (missing.length) reasons.push('还缺：' + missing.map(k => byKey[k].label).join('、'));
  if (!byKey.method.ok) reasons.push('做法还没落到方法层（频次/话术/载体/应对）');

  // 素材厚度：客户原话累计字数。结构齐但原话极少时不能判"够用"
  const userChars = turns
    .filter(m => m.role === 'user' && !m.internal)
    .reduce((s, m) => s + String(m.content || '').length, 0);
  const thin = userChars < 400;

  return {
    dims, covered: dims.filter(d => d.ok).length, total: dims.length,
    valuable: missing.length === 0 && byKey.method.ok && !thin,
    structural: missing.length === 0 && byKey.method.ok,
    userChars, thin, reasons,
  };
}

/* 覆盖度体检条：审核时一眼看出这份报告六维齐不齐、够不够用。 */
function renderCovBar(row) {
  const c = assessCoverageAdmin(row.report_md, row.transcript);
  const chips = c.dims.map(d =>
    '<span class="cov-chip ' + (d.ok ? 'ok' : 'gap') + '" title="' + esc(d.probe) + '">'
    + (d.ok ? '✓' : '○') + ' ' + esc(d.label) + '</span>'
  ).join('');

  let head, cls;
  if (c.valuable) {
    head = '素材够用 · 六维覆盖 ' + c.covered + '/' + c.total + ' · 原话 ' + c.userChars + ' 字';
    cls = 'ok';
  } else if (c.structural && c.thin) {
    head = '结构齐但原话偏少 · ' + c.covered + '/' + c.total + ' · 原话仅 ' + c.userChars
         + ' 字，报告可能多为概括性表述';
    cls = 'gap';
  } else {
    head = '素材有缺口 · ' + c.covered + '/' + c.total + '（' + c.reasons.join('；') + '）';
    cls = 'gap';
  }

  return '<div class="cov-bar ' + cls + '">'
    + '<div class="cov-bar-head">' + esc(head) + '</div>'
    + '<div class="cov-bar-chips">' + chips + '</div>'
    + '</div>';
}

/* ─── 会话 ───────────────────────────────────────────── */
let auth = { token: '', exp: 0 };
let currentRows = [];
let currentId = null;
let transcriptOpen = false;
let origOpenState = false;   // 「查看模型原文」展开态，重绘后保持
let detailRow = null;

try {
  const saved = JSON.parse(sessionStorage.getItem('iv_admin_auth') || 'null');
  if (saved && saved.token && saved.exp > Date.now()) auth = saved;
} catch (e) {}

function saveAuth() {
  try { sessionStorage.setItem('iv_admin_auth', JSON.stringify(auth)); } catch (e) {}
}

function toast(msg, isErr) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = 'toast' + (isErr ? ' err' : ''); }, 2400);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

/* ─── 登录 ───────────────────────────────────────────── */
async function doLogin() {
  const pw = document.getElementById('pw').value;
  const err = document.getElementById('login-err');
  const btn = document.getElementById('login-btn');
  err.style.display = 'none';
  if (!pw) { err.textContent = '请输入口令'; err.style.display = 'block'; return; }

  btn.disabled = true; btn.textContent = '验证中…';
  try {
    const res = await fetch(ADMIN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'login', password: pw }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.token) throw new Error(data.error === 'bad_password' ? '口令不正确' : (data.error || ('HTTP ' + res.status)));
    auth = { token: data.token, exp: data.exp };
    saveAuth();
    enterApp();
  } catch (e) {
    err.textContent = e.message;
    err.style.display = 'block';
  }
  btn.disabled = false; btn.textContent = '进入';
}

function doLogout() {
  auth = { token: '', exp: 0 };
  try { sessionStorage.removeItem('iv_admin_auth'); } catch (e) {}
  document.getElementById('main-view').style.display = 'none';
  document.getElementById('login-view').style.display = 'flex';
  document.getElementById('pw').value = '';
}

function enterApp() {
  document.getElementById('login-view').style.display = 'none';
  document.getElementById('main-view').style.display = 'block';
  loadList();
}

/* ─── 接口 ───────────────────────────────────────────── */
async function api(payload) {
  const res = await fetch(ADMIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ token: auth.token, exp: auth.exp }, payload)),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    doLogout();
    throw new Error('登录已过期，请重新输入口令');
  }
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
}

/* ─── 列表 ───────────────────────────────────────────── */
function resetFilters() {
  document.getElementById('f-q').value = '';
  document.getElementById('f-city').value = '';
  document.getElementById('f-from').value = '';
  document.getElementById('f-to').value = '';
  loadList();
}

async function loadList() {
  const rowsEl = document.getElementById('rows');
  const emptyEl = document.getElementById('empty');
  rowsEl.innerHTML = '';
  emptyEl.style.display = 'none';
  document.getElementById('stats').textContent = '加载中…';

  const payload = {
    action: 'list',
    q: document.getElementById('f-q').value.trim(),
    city: document.getElementById('f-city').value,
    page: 1,
    pageSize: 200,
  };
  const from = document.getElementById('f-from').value;
  const to = document.getElementById('f-to').value;
  if (from) payload.from = from + 'T00:00:00+08:00';
  if (to) payload.to = to + 'T23:59:59+08:00';

  try {
    const data = await api(payload);
    currentRows = data.rows || [];
    renderRows(currentRows);
    document.getElementById('stats').textContent =
      '共 ' + (data.total != null ? data.total : currentRows.length) + ' 条记录' +
      (currentRows.length < (data.total || 0) ? '（当前展示前 ' + currentRows.length + ' 条）' : '');
  } catch (e) {
    document.getElementById('stats').textContent = '加载失败：' + e.message;
  }
}

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
         ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function renderRows(rows) {
  const rowsEl = document.getElementById('rows');
  const emptyEl = document.getElementById('empty');
  if (!rows.length) { emptyEl.style.display = 'block'; return; }

  rowsEl.innerHTML = rows.map(r => {
    const cls = STATUS_CLASS[r.status] || 'wait';
    const owner = r.backend_owner_name
      ? esc(r.backend_owner_name) + (r.backend_owner_org ? '<br><span style="font-size:11.5px;color:var(--text-hint)">' + esc(r.backend_owner_org) + '</span>' : '')
      : '—';
    const mailed = !!r.mail_sent_at;
    const mailCell = mailed
      ? `<span class="pill ok">已发送</span><br><span style="font-size:11.5px;color:var(--text-hint)">${fmtTime(r.mail_sent_at)}</span>`
      : '<span class="pill wait">未发送</span>';
    return `<tr onclick="openDetail(${r.id})">
      <td class="nowrap">${fmtTime(r.created_at)}</td>
      <td class="nowrap">${esc(r.city || '—')}</td>
      <td>${esc(r.interviewee_name)}<br><span style="font-size:11.5px;color:var(--text-hint)">${esc(r.interviewee_position)}</span></td>
      <td class="topic"><div class="ell">${esc(r.topic)}</div>${
        r.ai_topic
          ? `<div class="ell ai-topic-line" title="${esc(r.ai_topic)}">AI 归纳：${esc(r.ai_topic)}</div>`
          : `<div class="ai-topic-line hint">AI 归纳：待打标</div>`
      }</td>
      <td class="hide-sm">${esc(r.interviewee_um || '—')}</td>
      <td class="hide-sm">${owner}</td>
      <td class="nowrap">${r.round_count || 0}</td>
      <td><span class="pill ${cls}">${esc(r.status)}</span></td>
      <td class="hide-sm nowrap">${mailCell}</td>
    </tr>`;
  }).join('');
}

/* ─── 导出 CSV ───────────────────────────────────────── */
function exportCsv() {
  if (!currentRows.length) { toast('当前列表为空', true); return; }
  const head = ['提交时间','城市','被访谈人','岗位','UM 号','主题','AI 归纳主题','自动标签','后线对接人','对接人所属中心','轮次','状态','邮件发送时间'];
  const body = currentRows.map(r => [
    fmtTime(r.created_at), r.city || '', r.interviewee_name || '', r.interviewee_position || '',
    r.interviewee_um || '', r.topic || '', r.ai_topic || '',
    (r.tags || []).join(' '),
    r.backend_owner_name || '',
    r.backend_owner_org || '', r.round_count || 0, r.status || '',
    r.mail_sent_at ? fmtTime(r.mail_sent_at) : '未发送',
  ]);
  const csv = '\ufeff' + [head, ...body]
    .map(line => line.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(','))
    .join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = '访谈案例归档_' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  toast('已导出 ' + currentRows.length + ' 条');
}

/* ─── 详情 ───────────────────────────────────────────── */
async function openDetail(id) {
  currentId = id;
  transcriptOpen = false;
  detailRow = null;
  document.getElementById('d-title').textContent = '案例详情';
  document.getElementById('d-body').innerHTML = '<div class="loading">加载中…</div>';
  document.getElementById('drawer').style.display = 'flex';
  document.getElementById('drawer-mask').style.display = 'block';

  try {
    const data = await api({ action: 'detail', id: id });
    detailRow = data.row;
    renderDetail(detailRow);
  } catch (e) {
    document.getElementById('d-body').innerHTML =
      '<div class="loading" style="color:var(--danger)">加载失败：' + esc(e.message) + '</div>';
  }
}

function closeDrawer() {
  document.getElementById('drawer').style.display = 'none';
  document.getElementById('drawer-mask').style.display = 'none';
  currentId = null;
}

function renderDetail(row) {
  document.getElementById('d-title').textContent =
    row.interviewee_name + ' · ' + (row.city || '—');

  const owner = row.backend_owner_name
    ? esc(row.backend_owner_name) + (row.backend_owner_org ? '（' + esc(row.backend_owner_org) + '）' : '')
    : '—';

  // 邮件发送状态：归档时会自动发一次，失败或想补发时手动点按钮
  const mailed = !!row.mail_sent_at;
  const mailCell = mailed
    ? '<span class="pill ok">已发送</span> <span class="meta-hint">' + fmtTime(row.mail_sent_at) + '</span>'
    : '<span class="pill wait">未发送</span> <span class="meta-hint">可在下方手动发送</span>';

  // UM 形态提醒：姓名位填成了 UM 号时给个可见提示，避免这种数据静默流到海报上
  const looksUM = v => /^[A-Za-z][A-Za-z0-9_]*$/.test(String(v || '').trim());
  const nameWarn = looksUM(row.interviewee_name)
    ? ' <span class="field-warn" title="像工号/UM，建议改为真实姓名">⚠ 疑似工号</span>' : '';
  const ownerWarn = row.backend_owner_name && looksUM(row.backend_owner_name)
    ? ' <span class="field-warn" title="像工号/UM，建议改为真实姓名">⚠ 疑似工号</span>' : '';

  // 报告正文的人工修订痕迹。report_rev 为 NULL/0 表示从未编辑过。
  const repRev = Number.isFinite(Number(row.report_rev)) ? Math.trunc(Number(row.report_rev)) : 0;
  const origOpen = origOpenState;

  let html = `
    <div class="meta-grid">
      <div class="meta-item"><div class="meta-label">提交时间</div><div class="meta-value">${fmtTime(row.created_at)}</div></div>
      <div class="meta-item"><div class="meta-label">状态</div><div class="meta-value"><span class="pill ${STATUS_CLASS[row.status] || 'wait'}">${esc(row.status)}</span></div></div>
      <div class="meta-item"><div class="meta-label">被访谈人</div><div class="meta-value">${esc(row.interviewee_name)}${nameWarn}</div></div>
      <div class="meta-item"><div class="meta-label">岗位</div><div class="meta-value">${esc(row.interviewee_position)}</div></div>
      <div class="meta-item"><div class="meta-label">UM 号</div><div class="meta-value">${esc(row.interviewee_um || '—')}</div></div>
      <div class="meta-item"><div class="meta-label">所属城市</div><div class="meta-value">${esc(row.city || '—')}</div></div>
      <div class="meta-item"><div class="meta-label">对话轮次</div><div class="meta-value">${row.round_count || 0}</div></div>
      <div class="meta-item"><div class="meta-label">邮件发送</div><div class="meta-value">${mailCell}</div></div>
      <div class="meta-item"><div class="meta-label">后线对接人</div><div class="meta-value">${owner}${ownerWarn}</div></div>
      <div class="meta-item" style="grid-column:1/-1"><div class="meta-label">案例主题（顾问手填原文）</div><div class="meta-value">${esc(row.topic)}</div></div>
      <div class="meta-item" style="grid-column:1/-1"><div class="meta-label">AI 归纳主题${
        row.tags_at ? '<span class="meta-hint">按报告正文自动归纳 · ' + fmtTime(row.tags_at) + '</span>' : ''
      }</div><div class="meta-value" style="color:var(--accent)">${
        row.ai_topic ? esc(row.ai_topic) : '<span style="color:var(--text-hint)">未打标（可在下方「重跑打标」补）</span>'
      }</div></div>
      <div class="meta-item" style="grid-column:1/-1"><div class="meta-label">自动标签</div><div class="meta-value tag-row">${
        (row.tags && row.tags.length)
          ? row.tags.map(t => {
              const free = t.indexOf('自由:') >= 0;
              return `<span class="tag-chip${free ? ' free' : ''}" title="${free ? '词表外新造，待人工归并' : '固定词表内取值'}">${esc(t)}</span>`;
            }).join('')
          : '<span style="color:var(--text-hint)">未打标</span>'
      }</div></div>
    </div>

    ${repRev > 0 ? `
      <div class="rep-edited-banner">
        ⚠ 本报告正文已被人工修改 <strong>${repRev}</strong> 次，最近一次 ${fmtTime(row.report_edited_at)}
        ${row.report_edited_by ? '（' + esc(row.report_edited_by) + '）' : ''}。
        下方展示的是修改后的版本，<strong>不是模型的原始输出</strong>。
        <button class="ghost-btn" style="margin-left:6px;padding:2px 9px;font-size:11.5px"
          onclick="toggleOriginal()">${origOpen ? '隐藏' : '查看'}模型原文</button>
        <div id="orig-box" style="display:${origOpen ? 'block' : 'none'};margin-top:8px">
          <textarea readonly style="width:100%;box-sizing:border-box;min-height:220px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;line-height:1.6;padding:10px;background:var(--surface);border:0.5px solid var(--border);border-radius:var(--radius-sm)">${esc(row.report_orig || '（未留存快照——该记录在本功能上线前就已编辑过）')}</textarea>
        </div>
      </div>` : ''}

    <div id="edit-box" style="display:none"></div>
    <div id="rep-box" style="display:none"></div>
    <div id="img-box" style="display:none"></div>

    ${renderCovBar(row)}

    <div class="actions">
      ${STATUS_LIST.map(s => `<button class="status-btn ${row.status === s ? 'on' : ''}" onclick="setStatus('${s}')">${s}</button>`).join('')}
      <button class="ghost-btn" onclick="openEdit()">编辑基础信息</button>
      <button class="ghost-btn" onclick="openReportEdit()">编辑报告正文</button>
      <button class="ghost-btn" onclick="retagOne(${row.id})">重跑打标</button>
      <button class="ghost-btn" onclick="copyDetail()">复制报告全文</button>
      <button class="ghost-btn" onclick="toggleImgPanel()">生成图片</button>
      <button class="ghost-btn" onclick="exportJson()">导出本条数据</button>
      <button class="mail-btn" id="mail-btn" onclick="sendMail()">${mailed ? '重新发送' : '发送邮件'}</button>
      <span class="spacer-flex"></span>
      <button class="del-btn" onclick="deleteRecord()">删除本条</button>
    </div>`;

  const parts = String(row.report_md || '').split('---SECTION---');
  SECTION_TITLES.forEach((title, i) => {
    const text = stripSectionHeading(parts[i]);
    html += `<div class="block"><h3 data-num="${i + 1}">${title}</h3><div class="content">${esc(text || '（本节内容为空）')}</div></div>`;
  });

  const turns = Array.isArray(row.transcript) ? row.transcript : [];
  html += `<button class="transcript-tgl" id="t-tgl" onclick="toggleTranscript()">展开完整对话记录（${turns.length} 条）</button>
    <div id="t-box" style="display:none;margin-top:16px"></div>`;

  document.getElementById('d-body').innerHTML = html;
  document.getElementById('d-body').scrollTop = 0;
}

/* ─── 编辑基础信息 ────────────────────────────────────────
   允许修正人工填报的基础信息（被访谈人 / 后线对接人 / 城市 / 主题等）。
   不可编辑：报告正文（模型产出）、对话原文、轮次、提交时间、发送状态——
   这些是归档的原始凭证，改动会破坏可追溯性。服务端有同样的白名单校验。 */
const EDIT_FIELDS = [
  { k: 'interviewee_name',    label: '被访谈人姓名', col: 1, ph: '如：李示例',   hint: '不要填工号/UM' },
  { k: 'interviewee_um',      label: '被访谈人 UM 号', col: 1, ph: '如：lishili001' },
  { k: 'interviewee_position',label: '岗位',        col: 1, ph: '如：咨询顾问' },
  { k: 'city',                label: '所属城市',     col: 1, ph: '如：西安市' },
  { k: 'backend_owner_name',  label: '后线对接人姓名', col: 1, ph: '如：赵示例', hint: '不要填工号/UM' },
  { k: 'backend_owner_org',   label: '对接人所属中心', col: 1, ph: '如：西安第三咨询中心' },
  { k: 'topic',               label: '案例主题',     col: 2, ph: '如：小微企业主续贷提额' },
];

function openEdit() {
  if (!detailRow) return;
  const box = document.getElementById('edit-box');
  if (box.style.display === 'block') { box.style.display = 'none'; return; }

  box.innerHTML = `
    <div class="edit-panel">
      <div class="edit-head">
        <strong>编辑基础信息</strong>
        <span class="edit-note">只影响归档记录与邮件主题；报告正文与对话记录不可修改</span>
      </div>
      <div class="edit-grid">
        ${EDIT_FIELDS.map(f => `
          <label class="edit-field" ${f.col === 2 ? 'style="grid-column:1/-1"' : ''}>
            <span class="edit-label">${f.label}${f.hint ? `<em>（${f.hint}）</em>` : ''}</span>
            <input class="edit-input" id="ed-${f.k}" value="${esc(String(detailRow[f.k] == null ? '' : detailRow[f.k]))}" placeholder="${f.ph}">
          </label>`).join('')}
      </div>
      <div class="edit-foot">
        <span class="edit-msg" id="ed-msg"></span>
        <span class="spacer-flex"></span>
        <button class="ghost-btn" onclick="closeEdit()">取消</button>
        <button class="save-btn" id="ed-save" onclick="saveEdit()">保存修改</button>
      </div>
    </div>`;
  box.style.display = 'block';
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeEdit() {
  const box = document.getElementById('edit-box');
  if (box) box.style.display = 'none';
}

async function saveEdit() {
  if (!currentId || !detailRow) return;
  const fields = {};
  EDIT_FIELDS.forEach(f => {
    const el = document.getElementById('ed-' + f.k);
    if (el) fields[f.k] = el.value.trim();
  });

  if (!fields.interviewee_name) {
    document.getElementById('ed-msg').textContent = '被访谈人姓名不能为空';
    document.getElementById('ed-msg').className = 'edit-msg err';
    return;
  }

  // 没改动就别发请求
  const changed = Object.keys(fields).filter(k => String(detailRow[k] || '') !== fields[k]);
  if (!changed.length) {
    document.getElementById('ed-msg').textContent = '没有改动';
    document.getElementById('ed-msg').className = 'edit-msg';
    return;
  }

  const btn = document.getElementById('ed-save');
  const msg = document.getElementById('ed-msg');
  btn.disabled = true;
  btn.textContent = '保存中…';

  try {
    const data = await api({ action: 'update', id: currentId, fields: fields });
    // 服务端回传完整行，直接换掉本地缓存并重绘，不必再查一次
    detailRow = data.row || Object.assign({}, detailRow, fields);
    const listRow = currentRows.find(x => x.id === currentId);
    if (listRow) Object.assign(listRow, data.row || fields);

    renderDetail(detailRow);
    renderRows(currentRows);
    openEdit();                       // 重绘后重新展开，让用户看到已保存的值
    const m = document.getElementById('ed-msg');
    m.textContent = '已保存' + (changed.length ? '（' + changed.length + ' 项）' : '');
    m.className = 'edit-msg ok';
    toast('已保存。若邮件已发过，可点「重新发送」用新信息补发。');
  } catch (e) {
    btn.disabled = false;
    btn.textContent = '保存修改';
    msg.textContent = '保存失败：' + e.message;
    msg.className = 'edit-msg err';
  }
}

/* ─── 编辑报告正文 ────────────────────────────────────────
   报告正文原设计为「不可编辑」（模型产出、归档原始凭证）。
   实际使用中确有「个别措辞要修」的合理需求，改库风险反而更高，
   因此放开编辑，但强制留痕：
     · 首次编辑前把模型原文快照进 report_orig，之后不再覆盖
     · 每次保存累加 report_rev，记录时间与操作人
     · 详情页对已编辑的记录给出显著提示 + 可展开对照模型原文
     · 服务端强制校验分隔符（至少 5 个 ---SECTION---），
       防止编辑时误删分隔符导致整份报告塌成一节
   对话原文（transcript）仍然不可编辑——那是无法重建的一手凭证。 */
function openReportEdit() {
  if (!detailRow) return;
  const box = document.getElementById('rep-box');
  if (box.style.display === 'block') { box.style.display = 'none'; return; }
  document.getElementById('edit-box').style.display = 'none';

  const md = String(detailRow.report_md || '');
  const secCount = (md.match(/---SECTION---/g) || []).length;

  box.innerHTML = `
    <div class="edit-panel">
      <div class="edit-head">
        <strong>编辑报告正文</strong>
        <span class="edit-note">改动会记入修订次数，模型原文自动留档；对话记录仍不可修改</span>
      </div>
      <div class="rep-editor">
        <div class="rep-editor-tip">
          节与节之间<strong>必须保留</strong>分隔符 <code>---SECTION---</code>（三横线 + SECTION + 三横线，共 13 个字符）。
          报告按它切成 6 节，删掉会导致整份报告只剩一节、海报也出不来。
          正常应有 <strong>5 个</strong>分隔符；节标题写标准名称即可（背景与挑战 / 核心做法 / 关键判断与取舍 / 结果 / 可复制的经验点 / 新人容易踩的坑）。
        </div>
        <textarea id="rep-md" oninput="checkRepSections()">${esc(md)}</textarea>
        <div class="edit-foot">
          <span class="rep-editor-stat" id="rep-stat"></span>
          <span class="edit-msg" id="rep-msg"></span>
          <span class="spacer-flex"></span>
          <button class="ghost-btn" onclick="closeReportEdit()">取消</button>
          <button class="save-btn" id="rep-save" onclick="saveReportEdit()">保存正文</button>
        </div>
      </div>
    </div>`;
  box.style.display = 'block';
  checkRepSections();
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeReportEdit() {
  const box = document.getElementById('rep-box');
  if (box) box.style.display = 'none';
}

/** 实时显示分隔符计数，不足 5 个时标红并禁用保存——不让人把报告改废。 */
function checkRepSections() {
  const ta = document.getElementById('rep-md');
  const stat = document.getElementById('rep-stat');
  const btn = document.getElementById('rep-save');
  if (!ta || !stat) return;
  const n = (ta.value.match(/---SECTION---/g) || []).length;
  const chars = ta.value.length;
  const okSec = n >= 5;
  stat.textContent = `分隔符 ${n} 个（需 ≥5）· 共 ${chars} 字`;
  stat.className = 'rep-editor-stat ' + (okSec ? 'good' : 'bad');
  if (btn) {
    btn.disabled = !okSec;
    btn.textContent = okSec ? '保存正文' : '分隔符不足，无法保存';
  }
}

async function saveReportEdit() {
  if (!currentId || !detailRow) return;
  const ta = document.getElementById('rep-md');
  const msg = document.getElementById('rep-msg');
  if (!ta) return;

  const md = ta.value;
  const n = (md.match(/---SECTION---/g) || []).length;
  if (n < 5) {
    msg.textContent = '分隔符只有 ' + n + ' 个，至少需要 5 个';
    msg.className = 'edit-msg err';
    return;
  }
  if (md === String(detailRow.report_md || '')) {
    msg.textContent = '正文没有改动';
    msg.className = 'edit-msg';
    return;
  }

  const btn = document.getElementById('rep-save');
  btn.disabled = true;
  btn.textContent = '保存中…';

  try {
    const data = await api({ action: 'update', id: currentId, fields: { report_md: md } });
    detailRow = data.row || Object.assign({}, detailRow, { report_md: md });
    const listRow = currentRows.find(x => x.id === currentId);
    if (listRow && data.row) Object.assign(listRow, data.row);

    renderDetail(detailRow);
    openReportEdit();
    const m = document.getElementById('rep-msg');
    m.textContent = '已保存（第 ' + (detailRow.report_rev || 1) + ' 次修订）';
    m.className = 'edit-msg ok';
    toast('正文已保存。图与邮件还是旧的，建议重出图后再「重新发送」。');
  } catch (e) {
    btn.disabled = false;
    btn.textContent = '保存正文';
    msg.textContent = '保存失败：' + e.message;
    msg.className = 'edit-msg err';
  }
}

/** 展开/收起「模型原文」对照，并保持展开态跨重绘有效。 */
function toggleOriginal() {
  origOpenState = !origOpenState;
  const box = document.getElementById('orig-box');
  if (box) box.style.display = origOpenState ? 'block' : 'none';
  renderDetail(detailRow);
}

/**
 * 展开 / 收起完整对话记录。
 * （box / btn），而且 transcriptOpen 一直是 false —— 于是每次点击都走
 * 「隐藏 + 复位文案」那条分支并抛 ReferenceError，表现为「点了没反应」。
 * 现有实现：现场取 DOM、先翻转状态、再按新状态渲染。
 */
function toggleTranscript() {
  const box = document.getElementById('t-box');
  const btn = document.getElementById('t-tgl');
  if (!box || !btn) return;

  transcriptOpen = !transcriptOpen;

  if (!transcriptOpen) {
    box.style.display = 'none';
    buttonLabelTranscript(btn, false);
    return;
  }

  const turns = (detailRow && Array.isArray(detailRow.transcript)) ? detailRow.transcript : [];
  box.innerHTML = turns.map(t => {
    const isAI = t.role === 'assistant';
    return `<div class="turn ${isAI ? 'ai' : 'me'}">
      <div class="who">${isAI ? 'AI' : '访'}</div>
      <div class="txt">${esc(t.content)}</div>
    </div>`;
  }).join('') || '<div class="loading">无对话记录</div>';
  box.style.display = 'block';
  buttonLabelTranscript(btn, true);
}

/* 按钮文案只有这一处生成，展开/收起/重绘三处共用，避免文案与实际状态脱节 */
function buttonLabelTranscript(btn, open) {
  if (!btn) return;
  if (open) { btn.textContent = '收起对话记录'; return; }
  const n = (detailRow && Array.isArray(detailRow.transcript)) ? detailRow.transcript.length : 0;
  btn.textContent = '展开完整对话记录（' + n + ' 条）';
}

/* ─── 生成图片并下载 ───────────────────────────────────────
   把某条归档报告导出成 PNG，方便直接转发或存档。两种可选：
     flow  简略一图流（16:9 固定画布，早会讲一页）
     full  完整报告长图（宽 1080，高度由内容决定，全文不截断）
   版式唯一来源在服务端（/api/mail?want_html），这里只负责栅格化。
   生成后同时给「预览 + 下载」：电脑上点下载；手机浏览器不一定支持
   a[download]，长按预览图也能保存到相册。 */
const IMG_KINDS = [
  { k: 'flow', label: '简略一图流',   note: '16:9 横版，早会投屏讲一页' },
  { k: 'full', label: '完整报告',     note: '竖版长图，六节全文不截断' },
];

function toggleImgPanel() {
  const box = document.getElementById('img-box');
  if (!box) return;
  if (box.style.display === 'block') { box.style.display = 'none'; return; }

  box.innerHTML = `
    <div class="edit-panel">
      <div class="edit-head">
        <strong>生成图片</strong>
        <span class="edit-note">在浏览器里排版并导出 PNG；手机上长按预览图也能保存</span>
      </div>
      <div class="img-choices">
        ${IMG_KINDS.map(x => `
          <button class="img-choice" id="img-btn-${x.k}" onclick="genImage('${x.k}')">
            <span class="img-choice-t">${x.label}</span>
            <span class="img-choice-n">${x.note}</span>
          </button>`).join('')}
      </div>
      <div class="edit-msg" id="img-msg"></div>
      <div id="img-result" style="display:none;margin-top:14px">
        <img id="img-prev" alt="生成的图片预览"
             style="max-width:100%;border:0.5px solid var(--border);border-radius:10px;display:block">
        <div style="margin-top:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <a id="img-dl" class="save-btn" download>下载 PNG</a>
          <span class="edit-note" id="img-size"></span>
        </div>
      </div>
    </div>`;
  box.style.display = 'block';
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeImgPanel() {
  const box = document.getElementById('img-box');
  if (box) box.style.display = 'none';
}

/* 生成期间的按钮文案与禁用状态集中管理，避免两张按钮互相覆盖 */
function setImgBusy(busy, label) {
  IMG_KINDS.forEach(x => {
    const b = document.getElementById('img-btn-' + x.k);
    if (!b) return;
    b.disabled = !!busy;
    b.querySelector('.img-choice-t').textContent =
      busy ? (x.k === label ? '生成中…' : x.label) : x.label;
  });
}

function safeImageName(kind) {
  const label = kind === 'full' ? '完整报告' : '经验一图流';
  const base = (detailRow && detailRow.interviewee_name) || '报告';
  const day = String((detailRow && detailRow.created_at) || '').slice(0, 10).replace(/-/g, '');
  return (label + '-' + base + (day ? '-' + day : '')).replace(/[\\/:*?"<>|\s]/g, '') + '.png';
}

async function genImage(kind) {
  if (!currentId || !detailRow) return;
  const msg = document.getElementById('img-msg');
  const prev = document.getElementById('img-prev');
  const dl = document.getElementById('img-dl');
  if (!msg || !prev || !dl) return;

  setImgBusy(true, kind);
  msg.textContent = '排版并渲染中…（完整报告较长，可能要等几秒）';
  msg.className = 'edit-msg';
  document.getElementById('img-result').style.display = 'none';

  try {
    const p = await fetchPosterHtml(currentId, kind);
    const png = await rasterizeAuto(p.html, p.css, p.w, p.h);

    prev.src = png;
    dl.href = png;
    dl.setAttribute('download', safeImageName(kind));

    const bytes = Math.round(png.length * 3 / 4);
    document.getElementById('img-result').style.display = 'block';
    msg.textContent = '已生成';
    msg.className = 'edit-msg ok';
    document.getElementById('img-size').textContent =
      Math.round(bytes / 1024) + ' KB · ' + (p.kind === 'full' ? '完整报告' : '一图流');
  } catch (e) {
    msg.textContent = '生成失败：' + e.message;
    msg.className = 'edit-msg err';
  } finally {
    setImgBusy(false, '');
  }
}

/* ─── 重跑打标 ─────────────────────────────────────────────
   给单条归档重新执行「按报告正文归纳主题 + 打标签」。
   用途：① 旧数据在功能上线前归档的，补一次；② 改了词表或换了模型后重打。
   只影响 ai_topic / tags 这两个派生字段，不动顾问手填的主题原文。 */
async function retagOne(id) {
  if (!id) return;
  toast('正在打标…');
  try {
    const d = await api({ action: 'retag', id: id });
    const r = (d.results || [])[0] || {};
    if (r.error) { toast('打标失败：' + r.error, true); return; }
    /* 服务端只回打标结果，重取一次详情拿最新的完整行 */
    const fresh = await api({ action: 'detail', id: id });
    detailRow = fresh.row;
    renderDetail(detailRow);
    loadList();
    toast(r.ai_topic ? '已重新打标' : '打标完成，但模型未产出主题（报告可能偏薄）', !r.ai_topic);
  } catch (e) {
    toast('打标失败：' + e.message, true);
  }
}

async function setStatus(status) {
  if (!currentId) return;
  if (detailRow && detailRow.status === status) return;
  try {
    await api({ action: 'status', id: currentId, status: status });
    detailRow.status = status;
    renderDetail(detailRow);
    toast('状态已更新为「' + status + '」');
    loadList();
  } catch (e) {
    toast('更新失败：' + e.message, true);
  }
}

/* ─── 发送邮件 ─────────────────────────────────────────────
   收件人固定在服务端环境变量里（MAIL_TO / MAIL_CC），前端只传归档 id，
   服务端自己从 PG 取报告并排版。主题格式也是服务端统一的：
   访谈报告【后线对接人姓名】访谈主题

   流程分两步：
   ① want_html=true 拿服务端排好的海报 HTML（版式的唯一来源在服务端）；
   ② 在浏览器里用 SVG foreignObject 把 HTML 栅格化成 PNG
     （零依赖方案：海报不含任何外部图片/字体，全部是 CSS 文本，可以安全
     画进 canvas），连同 id 一起再调一次 /api/mail 发出去。
   栅格化失败不阻塞发送——邮件正文本身就是海报版式，只是没图。 */

async function fetchPosterHtml(id, kind) {
  const res = await fetch(MAIL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: auth.token, exp: auth.exp, id: id, want_html: true, kind: kind || '' }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { doLogout(); throw new Error('登录已过期，请重新输入口令'); }
  /* 服务端对「显式要一图流但没有海报摘要」回 HTTP 200 + ok:false：
     不静默换版式，这里把原因翻成人话给运营看。 */
  if (data && data.ok === false) {
    if (data.error === 'poster_summary_missing') {
      throw new Error('这份报告是旧版模板生成的，没有「海报摘要」节，出不了简略一图流。请改选「完整报告」。');
    }
    throw new Error(data.detail || data.error || '出图失败');
  }
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
}

function rasterizePoster(html, css, w, h) {
  // 去掉 XML 不允许的控制字符，保证 SVG 解析不炸
  const clean = String(html).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">' +
    '<foreignObject width="100%" height="100%">' +
    '<div xmlns="http://www.w3.org/1999/xhtml" style="width:' + w + 'px;height:' + h + 'px;overflow:hidden;background:#fff">' +
    '<style>' + css + '</style>' + clean +
    '</div></foreignObject></svg>';

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/png'));
      } catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error('海报栅格化失败'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
}

/**
 * 量出一段 markup 在指定宽度下的真实高度（供完整报告长图用）。
 *
 * 一图流是 16:9 固定画布，服务端直接给得出 h；完整报告长图的高度由
 * 内容决定，服务端估高会随字号/换行漂移，估短了就裁掉最后一段，
 * 所以让浏览器把 markup 先插进离屏容器实测，再拿这个高度去拼 SVG。
 *
 * 安全前提：长图模板的 CSS 全部挂在 .rpt-page 作用域下、排版完全自足
 * （见 poster.js），所以可以安全地短暂插入本页，量完立即移除。
 * 字号/行高在这里显式写成中性值，避免继承本页 body 的 14px 影响实测。
 */
function measureMarkupHeight(html, css, w) {
  return new Promise((resolve) => {
    const holder = document.createElement('div');
    holder.style.cssText =
      'position:fixed;left:-10000px;top:0;width:' + w + 'px;visibility:hidden;' +
      'font-family:"Microsoft YaHei","PingFang SC",sans-serif;font-size:16px;line-height:normal;';
    const styleEl = document.createElement('style');
    styleEl.textContent = String(css || '');
    holder.innerHTML = String(html).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
    document.body.appendChild(styleEl);
    document.body.appendChild(holder);

    requestAnimationFrame(() => {
      try {
        const rect = holder.getBoundingClientRect();
        resolve(Math.ceil(Math.max(rect.height, holder.scrollHeight)) + 2);
      } catch (e) {
        resolve(0);
      } finally {
        holder.remove();
        styleEl.remove();
      }
    });
  });
}

/* 长图高度兜底上限：超出说明数据异常，宁可不出图也不把浏览器画崩 */
const MAX_FULL_PNG_H = 9000;

async function rasterizeAuto(html, css, w, hHint) {
  let h = hHint;
  if (!h) {
    h = await measureMarkupHeight(html, css, w);
    if (!h) throw new Error('无法量出长图高度');
    if (h > MAX_FULL_PNG_H) h = MAX_FULL_PNG_H;
  }
  return rasterizePoster(html, css, w, h);
}

async function sendMail() {
  if (!currentId || !detailRow) return;
  const btn = document.getElementById('mail-btn');
  if (!btn || btn.disabled) return;

  btn.disabled = true;
  btn.textContent = '生成图片…';
  let png = null;
  let fullPng = null;
  try {
    /* 两张图：简略一图流 + 完整报告长图。哪张失败就少带哪张，
       不阻塞发送——正文本身就是海报版式 + 报告全文。 */
    try {
      const p = await fetchPosterHtml(currentId, 'flow');
      png = await rasterizeAuto(p.html, p.css, p.w, p.h);
    } catch (e) {
      png = null;
    }
    try {
      const f = await fetchPosterHtml(currentId, 'full');
      fullPng = await rasterizeAuto(f.html, f.css, f.w, f.h);
    } catch (e) {
      fullPng = null;
    }

    btn.textContent = '发送中…';
    const res = await fetch(MAIL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: auth.token, exp: auth.exp, id: currentId,
        poster_png_base64: png, full_png_base64: fullPng,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      doLogout();
      throw new Error('登录已过期，请重新输入口令');
    }
    if (!res.ok) throw new Error(data.detail || data.error || ('HTTP ' + res.status));

    btn.classList.add('done');
    const files = (data.attachments || []).map(a => a.filename).join('、');
    btn.textContent = '已发送 ✓';
    toast('已发送至 ' + (data.to || []).join('、') + (files ? '（附件：' + files + '）' : ''));

    // 回写本地状态：之后按钮显示「重新发送」，并刷新详情里的发送时间
    const sentAt = data.mail_sent_at || new Date().toISOString();
    if (detailRow) detailRow.mail_sent_at = sentAt;
    const listRow = currentRows.find(x => x.id === currentId);
    if (listRow) { listRow.mail_sent_at = sentAt; renderRows(currentRows); }
    setTimeout(() => {
      btn.classList.remove('done');
      btn.textContent = '重新发送';
      btn.disabled = false;
      if (detailRow) renderDetail(detailRow);
    }, 4000);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = '重新发送';
    toast('发送失败：' + e.message, true);
  }
}

function buildPlainReport(row) {
  const parts = String(row.report_md || '').split('---SECTION---');
  let text = '案例经验报告\n访谈对象：' + row.interviewee_name + '（' + row.interviewee_position + '）\n' +
             'UM 号：' + (row.interviewee_um || '—') + '\n' +
             '所属城市：' + (row.city || '—') + '\n案例主题：' + row.topic + '\n' +
             '对话轮次：' + (row.round_count || 0) + '\n' +
             '后线对接人：' + (row.backend_owner_name || '—') +
             (row.backend_owner_org ? '（' + row.backend_owner_org + '）' : '') +
             '\n提交时间：' + fmtTime(row.created_at) + '\n\n';
  SECTION_TITLES.forEach((title, i) => {
    const t = stripSectionHeading(parts[i]);
    text += (i + 1) + '. ' + title + '\n' + t + '\n\n';
  });
  return text;
}

function copyDetail() {
  if (!detailRow) return;
  navigator.clipboard.writeText(buildPlainReport(detailRow))
    .then(() => toast('报告全文已复制'))
    .catch(() => toast('复制失败，请手动选择', true));
}

function exportJson() {
  if (!detailRow) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(detailRow, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = '案例_' + detailRow.id + '_' + detailRow.interviewee_name + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  toast('已导出本条数据');
}

async function deleteRecord() {
  if (!currentId || !detailRow) return;
  const label = '【' + detailRow.interviewee_name + '】' + (detailRow.topic || '');
  if (!confirm('确认删除这条归档记录？\n\n' + label + '\n\n删除后不可恢复，建议先「导出本条数据」备份。')) return;
  if (!confirm('再次确认：确定要永久删除该记录？')) return;
  try {
    await api({ action: 'delete', id: currentId });
    toast('已删除');
    closeDrawer();
    loadList();
  } catch (e) {
    toast('删除失败：' + e.message, true);
  }
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });

/* ─── 启动 ───────────────────────────────────────────── */
(() => {
  const el = document.getElementById('build-stamp');
  if (el) el.textContent = '程序版本 ' + ADMIN_BUILD;
  console.log('[管理端] 程序版本 ' + ADMIN_BUILD);
})();
if (auth.token && auth.exp > Date.now()) enterApp();
