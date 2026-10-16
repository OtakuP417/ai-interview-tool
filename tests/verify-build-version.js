/**
 * 版本号编码规则 护栏（2026-10-16 加）
 *
 * 为什么单独守一套：版本号是"这版代码到底上没上线"的唯一远程证据。
 * 编码规则（vYYYY.MM.DD-当日第几次）一旦算错或格式写坏，
 * 所有「不早于」断言都会静默失真——要么永远绿，要么永远红。
 * 这里把规则本身钉死，nextBuild 出错立刻可见。
 */
const BV = require('./_build-version.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
const eq = (name, got, want) => ok(name, got === want, '得到 ' + JSON.stringify(got) + '，应为 ' + JSON.stringify(want));

console.log('\n[1] 解析与比较');
eq('合法值解析', JSON.stringify(BV.parseBuild('v2026.10.16-a')), '[2026,10,16,"a"]');
ok('缺后缀非法', BV.parseBuild('v2026.10.16') === null);
ok('非法值 buildAtLeast 返回 false（不静默放过）', BV.buildAtLeast('BROKEN', 'v2026.10.15-c') === false);
ok('日期优先于后缀：10.16-a 不早于 10.15-z',
  BV.buildAtLeast('v2026.10.16-a', 'v2026.10.15-z') === true);
ok('同日按后缀：b 不早于 a', BV.buildAtLeast('v2026.10.16-b', 'v2026.10.16-a') === true);
ok('同日反向：a 早于 b', BV.buildAtLeast('v2026.10.16-a', 'v2026.10.16-b') === false);

console.log('\n[2] 编码规则：跨天重置 / 同日递增');
eq('跨天重置为 a', BV.nextBuild('v2026.10.15-d', '2026-10-16'), 'v2026.10.16-a');
eq('同日递增', BV.nextBuild('v2026.10.16-a', '2026-10-16'), 'v2026.10.16-b');
eq('同日再递增', BV.nextBuild('v2026.10.16-b', '2026-10-16'), 'v2026.10.16-c');
eq('昨天到 z，今天仍回 a', BV.nextBuild('v2026.10.15-z', '2026-10-16'), 'v2026.10.16-a');
eq('跨月重置', BV.nextBuild('v2026.10.31-c', '2026-11-01'), 'v2026.11.01-a');
eq('跨年重置', BV.nextBuild('v2026.12.31-b', '2027-01-01'), 'v2027.01.01-a');
eq('z 进位到 aa', BV.nextBuild('v2026.10.16-z', '2026-10-16'), 'v2026.10.16-aa');
ok('新版本号必然不早于旧版本号',
  BV.buildAtLeast(BV.nextBuild('v2026.10.16-a', '2026-10-16'), 'v2026.10.16-a') === true);
ok('反证：日期不合法直接抛', (() => {
  try { BV.nextBuild('v2026.10.16-a', '2026/10/16'); return false; } catch { return true; }
})());

console.log('\n[3] 三端实际值都符合格式');
for (const [file, name] of [['index.html', 'APP_BUILD'], ['admin.html', 'ADMIN_BUILD'], ['kb.html', 'KB_BUILD']]) {
  const v = BV.readBuild(file, name);
  ok(file + ' 的 ' + name + ' 格式合法（' + v + '）', BV.parseBuild(v) !== null, v);
}

console.log('\n' + (fail ? '✗' : '✓') + ' 通过 ' + pass + ' 项，失败 ' + fail + ' 项\n');
process.exit(fail ? 1 : 0);
