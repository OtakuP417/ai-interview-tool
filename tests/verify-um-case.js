/* 验证「UM 号统一大写」（2026-09-30 新增）：
   ① 访谈页填表：输入即转大写，且提交取值时再转一次（兜粘贴/自动填充）
   ② 管理端编辑：UM 字段标了 up:true，输入与保存两处都转大写
   ③ 服务端：submit 与 update 两条入库路径都做归一（不信前端的权威兜底）
   ④ 归一范围只限 interviewee_um —— 不得把姓名/主题等也顺手大写
   ⑤ 示例文案本身用大写，避免 placeholder 引导用户填小写
   全部为源码级断言，不连库、不调 LLM。 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const IDX = fs.readFileSync(path.join(ROOT, 'web/index.html'), 'utf8');
const ADM = fs.readFileSync(path.join(ROOT, 'web/admin.html'), 'utf8');
const FN = fs.readFileSync(path.join(ROOT, 'cloudfunctions/interview-proxy/index.js'), 'utf8');

let fail = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  ✓ ' + name);
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}

console.log('[1] 访谈页填表（web/index.html）');
ok('#f-um 输入框存在', /id="f-um"/.test(IDX));
ok('★ 输入即转大写（oninput 就地转换，所见即所得）',
   /id="f-um"[\s\S]{0,220}oninput="this\.value=this\.value\.toUpperCase\(\)"/.test(IDX));
ok('★ 提交取值时再转一次（兜住粘贴/自动填充等绕过 oninput 的路径）',
   /document\.getElementById\('f-um'\)\.value\.trim\(\)\.toUpperCase\(\)/.test(IDX));

console.log('\n[2] 管理端编辑（web/admin.html）');
ok('UM 字段在 EDIT_FIELDS 里标了 up:true',
   /\{\s*k:\s*'interviewee_um'[^}]*up:\s*true/.test(ADM));
ok('★ 示例文案用大写（placeholder 不再引导填小写）',
   /ph:\s*'如：LISHILI001'/.test(ADM));
ok('小写示例已不复存在（反向断言）',
   !/ph:\s*'如：lishili001'/.test(ADM));
ok('★ 表单渲染对 up 字段挂 oninput 大写',
   /f\.up \? ' oninput="this\.value=this\.value\.toUpperCase\(\)"'/.test(ADM));
ok('★ 保存收集时对 up 字段转大写（兜住粘贴）',
   /f\.up \? el\.value\.trim\(\)\.toUpperCase\(\) : el\.value\.trim\(\)/.test(ADM));
ok('up 标记的用途已在注释里说明（可回溯）',
   /up:true 的字段在输入与保存时统一转大写/.test(ADM));

console.log('\n[3] 服务端入库归一（cloudfunctions/interview-proxy/index.js）');
ok('★ submit 路径：interviewee_um 入库前 toUpperCase',
   /interviewee_um:\s*asText\(body\.interviewee_um, 40\)\.toUpperCase\(\) \|\| null/.test(FN));
ok('★ update 路径：定义了 UPPERCASE_FIELDS 归一表',
   /const UPPERCASE_FIELDS = \["interviewee_um"\]/.test(FN));
ok('update 循环里对命中字段做 toUpperCase',
   /if \(UPPERCASE_FIELDS\.indexOf\(k\) >= 0\) v = v\.toUpperCase\(\)/.test(FN));
ok('两条入口都覆盖（缺一即为可绕过）',
   /asText\(body\.interviewee_um, 40\)\.toUpperCase\(\)/.test(FN) &&
   /UPPERCASE_FIELDS\.indexOf\(k\)/.test(FN));

console.log('\n[4] ★ 归一范围只限 UM，不得误伤其它字段');
const m = FN.match(/const UPPERCASE_FIELDS = \[([^\]]*)\]/);
const listed = m ? m[1].split(',').map(s => s.trim().replace(/["']/g, '')).filter(Boolean) : [];
ok('归一表恰好只有 1 个字段', listed.length === 1, JSON.stringify(listed));
ok('归一表就是 interviewee_um', listed[0] === 'interviewee_um', JSON.stringify(listed));
['interviewee_name', 'topic', 'city', 'backend_owner_name', 'backend_owner_org', 'report_md']
  .forEach(k => ok('未把 ' + k + ' 纳入大写归一', listed.indexOf(k) < 0));
ok('新增归一字段的位置有注释说明动机',
   /UM 号一律全大写/.test(FN));

console.log('');
if (fail) { console.log('FAIL: ' + fail + ' 项未通过'); process.exit(1); }
console.log('全部通过');
