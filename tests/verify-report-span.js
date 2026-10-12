/**
 * 报告覆盖跨度自检（2026-10-12）
 *
 * 事故背景：id=21（46 轮访谈）归档出来的报告只覆盖到对话 49% 处 ——
 * 第 4、5 段采用率 0%，丢了三段高价值素材：
 *   利息话术「坦诚说利息确实高，但比较灵活」（#69）
 *   机制解释「我的客户几乎都是短期周转」（#71）
 *   频次分档「意向客户天天联系」（#85）
 * 报告里「利息」「短期周转」「天天」各出现 0 次。
 * 而 #19（93%）、#20（98%）覆盖均匀 —— 说明机制不是系统性截断，是"报告过期"
 * 或"生成时漏读后段"这两种成因之一在作怪。
 *
 * 这一套断言守两件事：
 *   ① 过期报告不许被当成新报告归档（入口清空 + 归档前拦截）
 *   ② 覆盖跨度检测本身算得对（真跑 reportSpan，不只看字面）
 */
const fs = require('fs');
const path = require('path');

let pass = 0;
let fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (extra ? '  → ' + extra : '')); }
}

const web = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');

console.log('\n[1] 过期报告不许归档');
{
  ok(/function reportSpan/.test(web), '存在覆盖跨度检测 reportSpan');

  /* 入口清空：进 generateReport 就先清 reportRaw，否则生成失败时旧报告残留，
     归档按钮照样能提交（generateReport 的失败分支与节数校验分支都只改 UI）。 */
  ok(/async function generateReport\(\) \{[\s\S]{0,700}?state\.reportRaw = '';[\s\S]{0,120}?saveDraft\(\);/
      .test(web), 'generateReport 入口清空 reportRaw 并同步落盘');

  /* 归档前拦截：报告只覆盖前段时先确认，避免连带自动发信把过期报告发出去 */
  ok(/async function submitArchive\(\) \{[\s\S]*?reportSpan\(state\.reportRaw, state\.messages\)/
      .test(web), 'submitArchive 归档前调用 reportSpan');
  ok(/tailEmpty\) \{[\s\S]{0,300}?confirm\(/.test(web), '覆盖不足时弹出确认，不静默归档');

  /* 报告页可见告警 */
  ok(/function buildReportAlerts[\s\S]*?reportSpan\(raw, messages\)/.test(web),
    'buildReportAlerts 把覆盖跨度算进报告页提示');
}

console.log('\n[2] reportSpan 真跑（不只看字面）');
{
  const src = web.slice(web.indexOf('function reportSpan'), web.indexOf('/* 报告页要显示的内容'));
  const reportSpan = new Function(src + '\nreturn reportSpan;')();

  /* 造 20 条可判定的回答（每条 >10 字）。
     ★ 夹具要点：每条回答之间不能有 >=6 字的公共片段 —— 6 字滑窗会因此互相误命中。
     初版用统一后缀"条回答的具体内容若干字"，20 条全部彼此命中，采用率被算成 100%。
     这里给每条一个独有的填充字符，保证任何 6 字窗口只属于自己。 */
  const uniq = (i) => '第' + i + '轮' + String.fromCharCode(0x4e00 + i * 3).repeat(20);
  const msgs = [];
  for (let i = 0; i < 20; i++) {
    msgs.push({ role: 'user', content: uniq(i) });
    msgs.push({ role: 'assistant', content: '问题' + i });
  }
  const users = msgs.filter(m => m.role === 'user').map(m => m.content);
  const half = users.slice(0, 10).join('\n');
  const full = users.join('\n');
  const tail = users.slice(10).join('\n');

  const s1 = reportSpan(half, msgs);
  ok(s1 && s1.tailEmpty === true, '只用前半段的报告 → 判定为覆盖断裂');
  ok(s1 && Math.abs(s1.hitRate - 0.5) < 0.01, '采用率算得对（前 10/20 = 50%）',
    s1 ? String(s1.hitRate) : 'null');
  ok(s1 && s1.headHit > 0 && s1.tailHit === 0, '前段有命中、末段全空（两个条件都对）');

  const s2 = reportSpan(full, msgs);
  ok(s2 && s2.tailEmpty === false, '覆盖完整的报告 → 不误报');
  ok(s2 && Math.abs(s2.hitRate - 1) < 0.01, '全量覆盖时采用率 100%');

  const s3 = reportSpan(tail, msgs);
  ok(s3 && s3.tailEmpty === false, '只覆盖后半段也不报"覆盖断裂"（判据要求前段有命中）');

  ok(reportSpan('', msgs) === null, '空报告返回 null，不误判');
  ok(reportSpan('报告内容', []) === null, '没有对话时返回 null');
  ok(reportSpan(full, msgs.slice(0, 6)) === null,
    '可判定样本 <4 条时返回 null（避免小样本误报）');

  // 短回答要跳过，不参与判定
  const shortMsgs = [{ role: 'user', content: '很短' }, { role: 'user', content: '也短' }];
  ok(reportSpan(full, shortMsgs) === null, '回答过短时不计入判定');

  // internal 的系统消息不算轮次
  const withInternal = msgs.concat([{ role: 'user', content: '系统代发的开场白内容', internal: true }]);
  const s4 = reportSpan(full, withInternal);
  ok(s4 && s4.n === 20, 'internal 的系统消息被排除（判定样本仍是 20 条）',
    s4 ? String(s4.n) : 'null');
}

console.log('\n[3] 生成端的素材取舍要求');
{
  ok(/【四条最容易写不合格的地方 · 写完自查】/.test(web), '自查清单已扩到四条');

  // 第 4 条：不许只写前半段
  ok(/只用了对话前半段的素材/.test(web), '第 4 条点出「只用了对话前半段的素材」');
  ok(/这些后段内容往往比前段更值钱/.test(web), '明确后段素材比前段更值钱');
  ok(/不许因为"不合主线"或"前面已经写过流程了"就丢掉/.test(web), '堵住"不合主线就丢"的取舍理由');
  ok(/对话最后三分之一的回答里，有几条的内容进了这份报告/.test(web), '给了可执行的自查动作');
  ok(/回去把后段重看一遍再写/.test(web), '给出漏读时的补救动作（重看后段）');

  // 第 2 条修正：被否的路不是必填
  ok(/不是每条做法都有取舍/.test(web), '第 2 条修正：不是每条做法都有取舍');
  ok(/不要硬凑一条"被否掉的路"/.test(web), '明令禁止硬凑"被否掉的路"（防编造）');
  ok(/这类做法\*\*不要硬凑|不要硬凑一条"被否掉的路"\*\*，/.test(web) ||
     /这一段整个不写即可/.test(web), '没有取舍时允许整段不写');
}

console.log('\n[4] 版本号');
{
  ok(/APP_BUILD = 'v2026\.10\.12-c'/.test(web), 'APP_BUILD 已 bump 到 v2026.10.12-c',
    (web.match(/APP_BUILD = '[^']*'/) || [''])[0]);
}

console.log('\n' + '─'.repeat(56));
console.log('报告覆盖跨度自检：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
