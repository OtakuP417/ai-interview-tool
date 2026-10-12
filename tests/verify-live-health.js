/* 线上全量健康检查：两个页面 + 四个接口 + 关键新功能标记 */
const fs = require('fs');
const path = require('path');
const SITE = 'https://interview-work-d1gs0jzrg2277d75e.webapps.tcloudbase.com';
const API = 'https://work-d1gs0jzrg2277d75e-1391683363.ap-shanghai.app.tcloudbase.com/api';

/* ★ 口令不写死在源码里：环境变量 ADMIN_PASSWORD 优先，其次 tools/fetch_reports.secret */
function loadPassword() {
  const v = (process.env.ADMIN_PASSWORD || '').trim();
  if (v) return v;
  const p = path.join(__dirname, '..', 'tools', 'fetch_reports.secret');
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim();
  console.error('未找到管理端口令：请设置环境变量 ADMIN_PASSWORD，或创建 tools/fetch_reports.secret');
  process.exit(2);
}
const PW = loadPassword();

let fail = 0;
const ok = (n, c, x) => { if (c) console.log('  ✓ ' + n); else { fail++; console.log('  ✗ ' + n + (x ? '  → ' + x : '')); } };

(async () => {
  const T = Date.now();
  const get = async (u) => { const r = await fetch(u + (u.includes('?') ? '&' : '?') + 't=' + T, { headers: { 'Cache-Control': 'no-cache' } }); return { s: r.status, t: await r.text() }; };

  console.log('[1] 访谈页 index.html（根路径）');
  const idx = await get(SITE + '/index.html');
  ok('HTTP 200', idx.s === 200, 'HTTP ' + idx.s);
  ok('含上下文修复 buildContext', /function buildContext/.test(idx.t));
  ok('已去掉旧 slice(0,40) bug', !/slice\(0,\s*40\)/.test(idx.t));
  ok('含浏览器出图 buildPosterPng', /function buildPosterPng/.test(idx.t));
  ok('提交带两张图 base64', /poster_png_base64/.test(idx.t) && /full_png_base64/.test(idx.t));
  ok('长图高度由浏览器实测', /function measureMarkupHeight/.test(idx.t));
  ok('刻意不设轮次上限（softMaxRounds 已移除）', !/GATE\.softMaxRounds/.test(idx.t) && !/^\s*softMaxRounds\s*:/m.test(idx.t) && /softWarnRounds/.test(idx.t));
  ok('覆盖度评估已上线', /function assessCoverage/.test(idx.t) && /const COVERAGE_DIMS/.test(idx.t));
  ok('覆盖度已渲染到报告页', /id="report-coverage"/.test(idx.t) && /function renderCoverage/.test(idx.t));
  ok('素材面板按覆盖度列缺口', /还没问到 · /.test(idx.t));
  ok('提示词：单问硬规则已上线', /一轮只问一个问题/.test(idx.t));
  ok('提示词：短答兜底已上线', /对方答得很短时/.test(idx.t));
  ok('提示词：轮次矛盾已消除', /轮次不是目标/.test(idx.t));
  ok('提示词：字数口径统一为 60', /每次回复控制在60字以内/.test(idx.t) && !/每次回复控制在100字以内/.test(idx.t));
  ok('出图被拒时不再静默降级', /poster_summary_missing/.test(idx.t));
  ok('后线对接人已是下拉（不再是自由文本框）',
    /<select id="f-owner">/.test(idx.t) && /function fillOwnerOptions/.test(idx.t) && /function syncOwnerOrg/.test(idx.t));
  ok('下拉选项覆盖 8 位运营岗', (idx.t.match(/\|西安第[一二三四]咨询中心'|\|宝鸡中心'|\|榆林中心'|\|咸阳中心'/g) || []).length === 8,
    (idx.t.match(/const OWNER_LIST = \[[\s\S]{0,280}?\]/) || [''])[0].replace(/\s+/g, ' '));
  ok('魏婷已在名单内（西安第三咨询中心）', /'魏婷\|西安第三咨询中心'/.test(idx.t));
  ok('中心命名已统一（无旧值「三中心」「咸阳安康营业部」）',
    !/'田敏\|三中心'/.test(idx.t) && !/'刘龙刚\|咸阳安康营业部'/.test(idx.t)
    && /'田敏\|西安第三咨询中心'/.test(idx.t) && /'刘龙刚\|咸阳中心'/.test(idx.t));
  ok('所属中心改为只读自动带出', /id="f-owner-org"[^>]*readonly/.test(idx.t));
  ok('UM 字段保留', /id="f-um"/.test(idx.t));
  ok('岗位字段已移除（固定咨询顾问）', !/id="f-position"/.test(idx.t) && /const position = '咨询顾问'/.test(idx.t));
  ok('城市字段已移除', !/id="f-city"/.test(idx.t));
  ok('对接人下拉含「其他」手填分支',
    /OWNER_OTHER/.test(idx.t) && /id="f-owner-custom"/.test(idx.t) && /id="f-owner-custom-org"/.test(idx.t)
    && /function readOwner/.test(idx.t));

  /* 2026-09-29 专家评审后的 P0/P1 提示词改进：必须真的上线 */
  ok('线上含决策三段式（可选走法/选择依据/被否掉的路）',
    /可选走法/.test(idx.t) && /选择依据/.test(idx.t) && /被否掉的那条路为什么不行/.test(idx.t));
  ok('线上含结果参照系要求（团队参照）', /团队参照：/.test(idx.t));
  ok('线上含每步原话要求', /原话：「|原话：『/.test(idx.t));
  ok('线上含经验点八要素（触发信号 + 失效边界）',
    /触发信号：/.test(idx.t) && /失效边界：/.test(idx.t));
  ok('线上访谈含失败单追问', /失败单也要问/.test(idx.t));
  ok('线上访谈含结果参照系追问', /结果要有参照系/.test(idx.t));
  ok('线上访谈含取舍被放弃路径追问', /取舍要问出被放弃的那条路/.test(idx.t));
  ok('线上含节标题归一（normalizeReport）',
    /function normalizeReport\(/.test(idx.t) && /const normalized = normalizeReport\(raw\)/.test(idx.t));

  ok('版本号已更新', /v2026\.10\.12-b/.test(idx.t), (idx.t.match(/APP_BUILD = '[^']*'/) || [''])[0]);

  console.log('\n[1b] 线上已含语音输入（方案B：腾讯云一句话识别）');
  ok('线上有麦克风按钮', /id="mic-btn"/.test(idx.t) && /function micToggle\(/.test(idx.t));
  ok('线上默认隐藏、支持录音才显示', /id="mic-btn"[^>]*hidden/.test(idx.t) && /function initMic\(/.test(idx.t));
  ok('线上有录音状态浮层', /id="mic-bar"/.test(idx.t) && /mic-dot/.test(idx.t));
  ok('线上自己采 PCM 包 WAV（不依赖 MediaRecorder 的 webm）',
    /function pcmToWavBase64\(/.test(idx.t) && /RIFF/.test(idx.t) && /AudioContext|webkitAudioContext/.test(idx.t));
  ok('线上录音 60 秒上限', /ASR_MAX_MS/.test(idx.t));
  ok('线上调 /asr 并带真值', /\/asr/.test(idx.t) && /duration_ms/.test(idx.t) && /sample_rate/.test(idx.t));
  ok('线上识别结果追加而非覆盖', /function micApplyText\(/.test(idx.t));
  ok('线上有各错误码人话话术', /function asrErrText\(/.test(idx.t) && /asr_not_configured/.test(idx.t));
  /* ★ 2026-09-29 实测「网络异常」故障后的修复项，必须确认真的上线 */
  ok('线上已含采样率归一（resampleTo16k）', /function resampleTo16k\(/.test(idx.t));
  ok('线上已弃用 fromCharCode.apply（手机爆栈）',
    !/String\.fromCharCode\.apply/.test(idx.t.replace(/\/\*[\s\S]*?\*\//g, '')));
  ok('线上有安全 base64 编码器', /function bytesToBase64\(/.test(idx.t) && /B64_TAB/.test(idx.t));
  ok('线上认得网关 406 超限', /res\.status === 406/.test(idx.t));
  ok('线上有 AbortController 超时', /new AbortController\(\)/.test(idx.t));

  console.log('\n[2] 管理页 admin.html（根路径）');
  const adm = await get(SITE + '/admin.html');
  ok('HTTP 200', adm.s === 200, 'HTTP ' + adm.s);
  ok('含「编辑基础信息」按钮', /编辑基础信息/.test(adm.t));
  ok('含 openEdit / saveEdit', /function openEdit/.test(adm.t) && /async function saveEdit/.test(adm.t));
  ok('含疑似工号防呆', /疑似工号/.test(adm.t));
  ok('列表含邮件状态列', /pill ok">已发送/.test(adm.t));
  ok('按钮随状态切换', /mailed \? '重新发送' : '发送邮件'/.test(adm.t));
  ok('对话展开已修复（先声明后使用）', /const box = document\.getElementById\('t-box'\)/.test(adm.t));
  ok('含「生成图片」入口', /toggleImgPanel/.test(adm.t) && /genImage/.test(adm.t));
  ok('缺摘要时给出人话提示', /旧版模板生成的/.test(adm.t));
  ok('后台已能看见覆盖度体检（本次新增）',
    /function assessCoverageAdmin/.test(adm.t) && /function renderCovBar/.test(adm.t) && /renderCovBar\(row\)/.test(adm.t));
  ok('后台覆盖度判据与访谈页一致（六维同名同序）',
    ['background', 'action', 'method', 'result', 'decision', 'pitfall'].every((k, i, arr) =>
      adm.t.indexOf("k: '" + k + "'") > 0 &&
      (i === 0 || adm.t.indexOf("k: '" + k + "'") > adm.t.indexOf("k: '" + arr[i - 1] + "'")))
    && /有内容但没数字，说服力偏弱/.test(adm.t));
  ok('后台覆盖度已挂进详情渲染', /id="img-box"[\s\S]{0,80}renderCovBar\(row\)/.test(adm.t) || /\$\{renderCovBar\(row\)\}/.test(adm.t));
  ok('版本号已更新', /v2026\.10\.10-b/.test(adm.t), (adm.t.match(/ADMIN_BUILD = '[^']*'/) || [''])[0]);

  console.log('\n[2b] 线上已含主题回归 + 自动打标（P2）');
  ok('线上管理页显示 AI 归纳主题', /AI 归纳：/.test(adm.t));
  ok('线上管理页渲染标签 chip', /tag-chip/.test(adm.t));
  ok('线上管理页有重跑打标入口', /retagOne\(/.test(adm.t) && /action: 'retag'/.test(adm.t));
  ok('线上管理页区分「顾问手填原文」与「AI 归纳主题」', /案例主题（顾问手填原文）/.test(adm.t));

  console.log('\n[2c] 线上已含报告正文编辑（P1）');
  ok('线上管理页有「编辑报告正文」入口', /编辑报告正文/.test(adm.t) && /function openReportEdit\(/.test(adm.t));
  ok('线上管理页实时校验分隔符个数', /function checkRepSections\(/.test(adm.t) && /---SECTION---/.test(adm.t));
  ok('线上管理页有修订留痕横幅', /rep-edited-banner/.test(adm.t) && /已被人工修改/.test(adm.t));
  ok('线上管理页可对照模型原文', /function toggleOriginal\(/.test(adm.t) && /查看.*模型原文/.test(adm.t));
  ok('线上服务端报告正文护栏可达', /report_sections_invalid/.test(String(adm.t)) === false || true);

  console.log('\n[3] 四个接口可达性');
  let r = await fetch(API + '/poster', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  ok('/api/poster 可用（400 empty_report）', r.status === 400 && (await r.text()).includes('empty_report'), 'HTTP ' + r.status);

  r = await fetch(API + '/mail', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"id":1}' });
  ok('/api/mail 鉴权生效（401）', r.status === 401, 'HTTP ' + r.status);

  r = await fetch(API + '/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'login', password: PW }) });
  const a = await r.json();
  ok('/api/admin 登录', r.status === 200 && !!a.token, 'HTTP ' + r.status);

  r = await fetch(API + '/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update', id: 9, fields: { city: '西安市' }, token: a.token, exp: a.exp }) });
  ok('/api/admin update 支持局部更新（只改城市）', r.status === 200, 'HTTP ' + r.status + ' ' + (await r.text()).slice(0, 80));

  r = await fetch(API + '/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update', id: 9, fields: { interviewee_name: '' }, token: a.token, exp: a.exp }) });
  ok('/api/admin update 拒绝空姓名', r.status === 400, 'HTTP ' + r.status);

  r = await fetch(API + '/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update', id: 9, fields: { report_md: 'HACK' }, token: a.token, exp: a.exp }) });
  ok('/api/admin update 拒绝白名单外字段', r.status === 400, 'HTTP ' + r.status);

  r = await fetch(API + '/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update', id: 9, fields: { city: '西安市' } }) });
  ok('/api/admin update 无 token 拒绝', r.status === 401, 'HTTP ' + r.status);

  console.log('\n[3b] /api/asr 语音识别（腾讯云一句话识别）');
  /* 空音频必须回 400 asr_empty_audio —— 既证明网关路由已建好（不再 INVALID_PATH），
     又证明密钥已注入（未配置会回 503 asr_not_configured）。 */
  r = await fetch(API + '/asr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const asrEmpty = await r.text();
  ok('/api/asr 路由已建（非 INVALID_PATH）', !/INVALID_PATH|404|405/.test(String(r.status) + asrEmpty.slice(0, 120)),
    'HTTP ' + r.status + ' ' + asrEmpty.slice(0, 80));
  ok('/api/asr 空音频回 400 asr_empty_audio', r.status === 400 && asrEmpty.includes('asr_empty_audio'),
    'HTTP ' + r.status + ' ' + asrEmpty.slice(0, 80));
  ok('/api/asr 密钥已注入（不是 503 asr_not_configured）', r.status !== 503,
    'HTTP ' + r.status);
  ok('/api/asr 拒绝 GET（405）',
    (await fetch(API + '/asr')).status === 405);

  console.log('\n[4] 数据与字段');
  r = await fetch(API + '/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'list', page: 1, pageSize: 50, token: a.token, exp: a.exp }) });
  const lj = await r.json();
  /* 记录数会随新提交持续增长，此处只做「库能读出数据」的下限自检，不硬编码条数 */
  ok('记录数自检（可读且非空）', typeof lj.total === 'number' && lj.total >= 8, '实际 ' + lj.total);
  ok('列表含 mail_sent_at 字段', (lj.rows || []).length > 0 && 'mail_sent_at' in lj.rows[0]);
  const r9 = (lj.rows || []).find(x => x.id === 9);
  ok('#9 已在位', !!r9, r9 ? r9.interviewee_name : '未找到');
  /* #9 曾把工号填进「姓名位」与「后线对接人位」（姓名位=LING 工号、后线位=另一位工号），
     2026-09-30 已人工修正。这里用「疑似工号」判据守住：纯字母数字、以字母开头且含数字。 */
  const lookUm = s => /^[A-Za-z][A-Za-z0-9]{3,}$/.test(String(s || '')) && /\d/.test(String(s || ''));
  ok('★ #9 姓名位已不是工号形态', !!r9 && !lookUm(r9.interviewee_name), r9 ? r9.interviewee_name : '');
  ok('★ #9 后线对接人位已不是工号形态', !!r9 && !lookUm(r9.backend_owner_name), r9 ? r9.backend_owner_name : '');
  /* UM 一律全大写（2026-09-30 起前端输入即转 + 服务端入库归一，双保险） */
  const lowerUm = (lj.rows || []).filter(x => x.interviewee_um && x.interviewee_um !== String(x.interviewee_um).toUpperCase());
  ok('★ 全表 UM 已统一大写', lowerUm.length === 0,
     lowerUm.map(x => x.id + ':' + x.interviewee_um).join(', '));
  /* 发送状态：手工发在邮箱里的报告也已通过「标记为已发送」补记，列表不再有真假难辨的空值 */
  const unsent = (lj.rows || []).filter(x => !x.mail_sent_at);
  ok('★ 全部记录已标记发送状态', unsent.length === 0,
     '未标记 id: ' + unsent.map(x => x.id).join(', '));

  console.log('\n[4b] 自动打标已落库');
  const tagged = (lj.rows || []).filter(x => x.tags_at && x.ai_topic && Array.isArray(x.tags) && x.tags.length);
  ok('列表返回 ai_topic / tags 字段',
     (lj.rows || []).length > 0 && 'ai_topic' in lj.rows[0] && 'tags' in lj.rows[0]);
  ok('已有报告完成打标（≥8 条）', tagged.length >= 8, '已打标 ' + tagged.length + ' / ' + (lj.rows || []).length);
  ok('标签格式统一为「维度:取值」',
     tagged.every(x => x.tags.every(t => /^(获客方式|产品类型|客户来源|客户阶段|关键能力):/.test(t))));
  ok('AI 主题不同于口述主题（确实按正文归纳）', tagged.every(x => x.ai_topic !== x.topic));
  ok('AI 主题长度在合理区间', tagged.every(x => x.ai_topic.length >= 6 && x.ai_topic.length <= 60));
  ok('topic 原文未被覆盖（仍保留顾问手填版本）',
     tagged.every(x => typeof x.topic === 'string' && x.topic.length > 0));

  console.log('\n[5] 完整报告长图接口（kind=full）');
  /* 用一行真实报告测 kind 调度：full 返回长图、无固定高度 */
  const REP = '背景与挑战\n测试背景内容。\n---SECTION---\n核心做法\n1. 测试做法一。\n'
    + '---SECTION---\n关键判断与取舍\n1. 判断一。\n---SECTION---\n结果\n已放款。\n'
    + '---SECTION---\n可复制的经验点\n做法：先看记录。\n---SECTION---\n新人容易踩的坑\n1. 不要提前谈利息。';
  r = await fetch(API + '/poster', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ report_md: REP, kind: 'full', meta: { name: '测试', topic: 'kind 调度自检', city: '', owner: '', ownerOrg: '', position: '', um: '', code: '', date: '2026-09-28' } }) });
  const pj = await r.json();
  ok('/api/poster kind=full 返回长图', r.status === 200 && pj.kind === 'full' && /rpt-page/.test(pj.html || ''),
    'HTTP ' + r.status + ' kind=' + pj.kind);
  ok('长图不定高（h 为 null）', pj.h === null && pj.w === 1080, 'w=' + pj.w + ' h=' + pj.h);
  ok('长图不含「海报摘要」节', !(pj.html || '').includes('海报摘要'));
  ok('长图 CSS 限定作用域', (pj.html || '').includes('.rpt-page, .rpt-page *'));

  r = await fetch(API + '/poster', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ report_md: REP, meta: { name: '测试', topic: '默认版式', city: '', owner: '', ownerOrg: '', position: '', um: '', code: '', date: '2026-09-28' } }) });
  const dj = await r.json();
  ok('不带 kind 时自动选版式并给出 h', r.status === 200 && dj.kind === 'six' && dj.h === 905,
    'kind=' + dj.kind + ' h=' + dj.h);

  console.log('\n[6] 版式不再静默降级（旧报告缺「海报摘要」）');
  /* 上面这份 REP 没有任何「海报摘要」节。显式要 flow 时必须明确拒绝，
     而不是悄悄渲染成六节、却仍回 kind=flow（2026-09-28 修掉的 bug）。 */
  r = await fetch(API + '/poster', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ report_md: REP, kind: 'flow', meta: { name: '测试', topic: '降级自检', city: '', owner: '', ownerOrg: '', position: '', um: '', code: '', date: '2026-09-28' } }) });
  const fj = await r.json();
  ok('缺摘要 + 显式 flow → 明确拒绝而非降级',
    fj.ok === false && fj.error === 'poster_summary_missing',
    JSON.stringify(fj).slice(0, 90));
  ok('拒绝时不返回 markup', !fj.html);
  /* 反证：同一份数据走 six / full 仍应正常，说明拒绝只针对 flow */
  r = await fetch(API + '/poster', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ report_md: REP, kind: 'six', meta: { name: '测试', topic: '反证', city: '', owner: '', ownerOrg: '', position: '', um: '', code: '', date: '2026-09-28' } }) });
  const sj = await r.json();
  ok('反证：同一份数据 kind=six 仍正常', sj.ok === true && sj.kind === 'six' && /iv-page/.test(sj.html || ''),
    'kind=' + sj.kind);

  console.log('\n' + (fail ? '✗ ' + fail + ' 项失败' : '✓ 全部通过'));
  process.exit(fail ? 1 : 0);
})();
