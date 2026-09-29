/**
 * 测试卫生守护：所有 verify-*.js 必须读「正本」源码，不得读废弃副本。
 *
 * 背景（2026-09-28 发现）：项目根目录下曾长期存在一份 09-24 的 index.html 旧副本，
 * verify-resume.js / verify-report.js 都在读它，结果这两个套件（146 项断言）
 * 一直在测过期页面 —— 我们几次改动它们都"全绿"，实际根本没覆盖到。
 * 这类问题不会报错、不会失败，安静地把测试变成摆设，必须用断言守住。
 *
 * 规则：
 *   1. 规范路径只有 web/index.html 与 web/admin.html；
 *   2. 禁止 path...'index.html' / 'admin.html' 这类**不带 web 目录**的读取；
 *   3. 根目录不得再出现 index.html / admin.html 副本。
 */
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
};

const TESTS = path.resolve(__dirname);
const ROOT = path.resolve(__dirname, '..');

console.log('\n[1] 正本文件必须存在');
ok('web/index.html 存在', fs.existsSync(path.join(ROOT, 'web', 'index.html')));
ok('web/admin.html 存在', fs.existsSync(path.join(ROOT, 'web', 'admin.html')));

console.log('\n[2] 根目录不得再有 index.html / admin.html 副本');
ok('根目录无 index.html', !fs.existsSync(path.join(ROOT, 'index.html')),
  '根目录 index.html 是废弃副本，会诱使测试读错文件；应放在 tools/out/backup 下');
ok('根目录无 admin.html', !fs.existsSync(path.join(ROOT, 'admin.html')));

console.log('\n[3] 每个 verify-*.js 必须从 web/ 读源码');
const files = fs.readdirSync(TESTS).filter(f => /^verify-.*\.js$/.test(f));
ok('找到测试文件', files.length >= 10, String(files.length));

/* 判定：readFileSync 的实参里若出现 index.html/admin.html，
   则整段必须包含 web 段（'web' 或 web/）；否则视为读到了废弃副本。 */
const offenders = [];
for (const f of files) {
  const src = fs.readFileSync(path.join(TESTS, f), 'utf8');
  const readPaths = src.match(/readFileSync\([^)]*\)/g) || [];
  for (const r of readPaths) {
    if (!/(?:index|admin)\.html/.test(r)) continue;
    const hasWeb = /['"]web['"]/.test(r) || /web\//.test(r);
    if (!hasWeb) offenders.push(f + ' :: ' + r.trim());
  }
}
ok('没有测试读根目录 html 副本', offenders.length === 0, offenders.join(' | '));

console.log('\n[4] 曾出错的两个套件已显式指向 web/');
for (const f of ['verify-resume.js', 'verify-report.js']) {
  const src = fs.readFileSync(path.join(TESTS, f), 'utf8');
  ok(f + ' 指向 web/index.html',
    /web['"],\s*['"]index\.html|\/web\/index\.html|web\/index\.html/.test(src) || /'web',\s*'index\.html'/.test(src));
}

console.log('\n' + (fail ? '✗ ' + fail + ' 项失败' : '✓ 全部通过'));
console.log('  测试卫生守护：通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
