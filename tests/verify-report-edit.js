/* 验证「报告正文可编辑 + 修订留痕」（2026-09-29 新增）：
   ① 服务端白名单放开 report_md，但留痕字段（report_rev/orig/edited_at/by）不可由前端传入
   ② 编辑正文走「先读现值 → 快照模型原文 → 累加修订次数」三步
   ③ report_orig 只在首次编辑时写入，之后不再覆盖（否则追溯不到模型原始输出）
   ④ 分隔符护栏：< 5 个 ---SECTION--- 直接拒绝（防把报告改成一节）
   ⑤ 空正文拒绝；正文未变时不记修订次数
   ⑥ 前端：入口按钮 / 实时分隔符计数 / 不足时禁用保存 / 修订横幅 / 模型原文对照
   ⑦ 对话原文仍不可编辑（保护一手凭证）
   ⑧ 发送状态补记（mark_sent）：邮件在邮箱里手工发掉时补记 mail_sent_at，
      独立分支只写这一个字段、且不真的发信；不从 update 白名单放开
   全部为源码级断言，不连库。 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FN = fs.readFileSync(path.join(ROOT, 'cloudfunctions/interview-proxy/index.js'), 'utf8');
const ADM = fs.readFileSync(path.join(ROOT, 'web/admin.html'), 'utf8');

let fail = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  ✓ ' + name);
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}

/* 把 update 动作整段切出来，断言只看这一段，避免误命中别处 */
const start = FN.indexOf('action === "update"');
const end = FN.indexOf('action === "delete"');
const UPD = FN.slice(start, end);

/* EDITABLE 白名单块单独切出来看（只在键名位置匹配，避免命中 select= 列表） */
const EDITABLE = UPD.slice(UPD.indexOf('const EDITABLE'), UPD.indexOf('};', UPD.indexOf('const EDITABLE')));

console.log('[1] 服务端：白名单');
ok('update 分支存在', start > 0 && end > start);
ok('report_md 已进入可写路径', /hasOwnProperty\.call\(raw, "report_md"\)/.test(UPD));
ok('EDITABLE 基础信息白名单仍在', /interviewee_name:\s*40/.test(EDITABLE) && /backend_owner_org:\s*80/.test(EDITABLE));
ok('★ 留痕字段不在 EDITABLE 里（前端无法直接传，遮不住修订痕迹）',
   !/^\s*report_rev\s*:/m.test(EDITABLE) &&
   !/^\s*report_orig\s*:/m.test(EDITABLE) &&
   !/^\s*report_edited_at\s*:/m.test(EDITABLE) &&
   !/^\s*report_edited_by\s*:/m.test(EDITABLE));
ok('report_md 也不在 EDITABLE 里（正文走单独带护栏的路径）',
   !/^\s*report_md\s*:/m.test(EDITABLE));
ok('transcript 仍不可写', !/transcript/.test(EDITABLE));
ok('mail_sent_at 仍不可写', !/mail_sent_at/.test(EDITABLE));

console.log('\n[2] 服务端：三步写入');
ok('先读现值（拿 report_orig / report_rev）',
   /pgRequest\("GET", "id=eq\.\+?[\s\S]{0,80}select=report_md,report_orig,report_rev/.test(UPD));
ok('正文写入 patch', /patch\.report_md = reportMd/.test(UPD));
ok('修订次数累加（旧值 +1）',
   /patch\.report_rev\s*=[\s\S]{0,120}\+\s*1/.test(UPD));
ok('记录编辑时间', /patch\.report_edited_at = new Date\(\)\.toISOString\(\)/.test(UPD));
ok('记录编辑人', /patch\.report_edited_by/.test(UPD));
ok('★ report_orig 只在首次编辑时写（拿不到旧快照才写）',
   /if \(!cur\.report_orig && oldMd\) patch\.report_orig = oldMd/.test(UPD));
ok('空正文拒绝', /report_md_required/.test(UPD));

console.log('\n[3] 服务端：分隔符护栏');
ok('统计分隔符个数', /match\(\/---SECTION---\/g\)/.test(UPD) && /secCount/.test(UPD));
ok('少于 5 个直接拒绝', /secCount < 5/.test(UPD) && /report_sections_invalid/.test(UPD));
ok('拒绝时给出人话说明（含当前个数）', /至少 5 个 ---SECTION---/.test(UPD));
ok('拒绝时不落库（return 早退）',
   /report_sections_invalid[\s\S]{0,300}return;/.test(UPD));

console.log('\n[4] 服务端：边界');
ok('正文没变时不记修订次数', /oldMd === reportMd/.test(UPD));
ok('只改基础信息时不走读现值分支', /wantsReport\s*\n?\s*\?\s*pgRequest\("GET"/.test(UPD));
ok('正文经脱敏（与入库同一道）', /maskSensitive\(asText\(raw\.report_md, 60000\)\)/.test(UPD));
ok('长度上限 60000 与归档一致', /raw\.report_md, 60000/.test(UPD));
ok('回传 reportEdited 便于前端提示重出图', /reportEdited: !!patch\.report_md/.test(UPD));
ok('仍回传完整 row 供前端直接刷新', /row: row/.test(UPD));

console.log('\n[5] 前端：入口与编辑面板');
ok('有「编辑报告正文」按钮', /onclick="openReportEdit\(\)"/.test(ADM));
ok('编辑框容器 rep-box 存在', /id="rep-box"/.test(ADM));
ok('打开正文编辑时收起基础信息编辑', /openReportEdit[\s\S]{0,400}edit-box'\)\.style\.display = 'none'/.test(ADM));
ok('说明里点明分隔符要保留', /必须保留<\/strong>分隔符/.test(ADM));
ok('说明里给出标准节标题', /新人容易踩的坑/.test(ADM) && /可复制的经验点/.test(ADM));
ok('实时统计分隔符个数', /function checkRepSections/.test(ADM) && /oninput="checkRepSections\(\)"/.test(ADM));

console.log('\n[6] 前端：防改废');
ok('分隔符不足时置灰保存按钮', /btn\.disabled = !okSec/.test(ADM));
ok('按钮文案随状态变化', /分隔符不足，无法保存/.test(ADM));
ok('保存前二次校验', /if \(n < 5\)/.test(ADM) && /至少需要 5 个/.test(ADM));
ok('无改动时不发请求', /正文没有改动/.test(ADM));
ok('保存成功提示要重出图/重发信', /重出图后再「重新发送」/.test(ADM));
ok('提示本次是第几次修订', /第 ' \+ \(detailRow\.report_rev \|\| 1\) \+ ' 次修订/.test(ADM));

console.log('\n[7] 前端：留痕可见');
ok('已编辑时顶部给显著提示横幅', /rep-edited-banner/.test(ADM));
ok('横幅里写明「不是模型的原始输出」', /不是模型的原始输出/.test(ADM));
ok('横幅显示修订次数与时间', /已被人工修改[\s\S]{0,60}repRev/.test(ADM) && /report_edited_at/.test(ADM));
ok('可展开查看模型原文', /toggleOriginal/.test(ADM) && /report_orig/.test(ADM));
ok('原文对照展开态跨重绘保持', /let origOpenState = false/.test(ADM) && /const origOpen = origOpenState/.test(ADM));
ok('无快照时给诚实说明（不假装有）', /未留存快照/.test(ADM));
ok('横幅只在有修订时出现', /\$\{repRev > 0 \?/.test(ADM));

console.log('\n[8] 文案与版本');
ok('基础信息编辑的说明已同步更新（不再说正文不可改）',
   !/报告正文与对话记录不可修改/.test(ADM));
ok('注释里说明 transcript 仍不可编辑', /对话原文（transcript）仍然不可编辑/.test(ADM));
ok('版本号已 bump', /ADMIN_BUILD = 'v2026\.10\.09-a'/.test(ADM));

console.log('\n[9] 迁移');
const mig = fs.readFileSync(
  path.join(ROOT, 'cloudbase/migrations/20260929101500_add_report_revision.sql'), 'utf8');
ok('加四个留痕列',
   ['report_rev', 'report_orig', 'report_edited_at', 'report_edited_by'].every(c => mig.indexOf(c) >= 0));
ok('全部可空（旧数据不受影响）', !/NOT\s+NULL/i.test(mig));
ok('不触碰 report_md / transcript',
   !/ALTER\s+COLUMN\s+report_md/i.test(mig) && !/transcript/i.test(mig));

console.log('\n[10] 发送状态补记（mark_sent）');
/* 把 mark_sent 分支连同它上方的注释一起切出来断言
   （注释在 if 之前，只切 if 会漏掉说明文字导致误判） */
const msIf = FN.indexOf('action === "mark_sent"');
const msHead = FN.lastIndexOf('/*', msIf);
const msStart = msHead > 0 ? msHead : msIf;
const msEnd = FN.indexOf('action === "update"');
const MS = FN.slice(msStart, msEnd);
ok('服务端有独立的 mark_sent 分支', msStart > 0 && msEnd > msStart && MS.length > 200);
ok('★ 只写 mail_sent_at 一个字段（不夹带其它列）',
   /pgRequest\("PATCH", "id=eq\." \+ id, \{ mail_sent_at: at\.toISOString\(\) \}\)/.test(MS));
ok('★ 不从 update 白名单放开 mail_sent_at（补记不能变成通用改写口）',
   EDITABLE.indexOf('mail_sent_at') < 0);
ok('★ 只补状态、不发信（不会意外重发一封）',
   MS.indexOf('sendReportMail') < 0 && MS.indexOf('sendReportMailById') < 0);
ok('缺少 id 时明确报错', /error: "missing_id"/.test(MS));
ok('补记时间可指定，但必须可解析（防写入 Invalid Date）',
   /isNaN\(t\.getTime\(\)\)/.test(MS) && /error: "invalid_sent_at"/.test(MS));
ok('不传时间则记为当前时刻', /let at = new Date\(\);/.test(MS));
ok('数据库写失败有明确错误码', /error: "db_write_failed"/.test(MS));
ok('解释了这个例外入口为什么存在（可回溯）',
   /唯一例外入口/.test(MS) && /不经过发送逻辑|不经过/.test(MS));

console.log('\n[11] 前端：补记入口');
ok('有 markSent 入口按钮', /onclick="markSent\(\)"/.test(ADM));
ok('未发送时才渲染该按钮（已发送则隐藏，避免语义重复）',
   /\$\{mailed \? '' : '<button/.test(ADM));
ok('★ 点击前二次确认（防误标）', /confirm\('确认这份报告已经在邮箱里发出过了/.test(ADM));
ok('调用服务端 mark_sent', /api\(\{ action: 'mark_sent', id: currentId \}\)/.test(ADM));
ok('成功后回写本地并重绘（列表状态即刻可见）',
   /listRow\.mail_sent_at = at;[\s\S]{0,90}renderRows\(currentRows\)/.test(ADM));
ok('★ 文案说明不会真的重发（避免误会）',
   /不会真的再发一封/.test(ADM));
ok('补记后的时间戳直接用于界面显示', /fmtTime\(at\)/.test(ADM));

console.log('');
if (fail) { console.log('FAIL: ' + fail + ' 项未通过'); process.exit(1); }
console.log('全部通过');
