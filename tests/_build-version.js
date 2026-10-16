/**
 * 版本号断言公共模块（2026-10-15 新建）
 *
 * 背景（这是个踩了两轮的坑）：
 *   各套件原本各自硬编码「ADMIN_BUILD = 'v2026.10.12-c'」这类期望值，
 *   意图是「功能上线时版本号已 bump，线上可远程确认」。
 *   但硬编码带来两个真实故障：
 *     ① 每次 bump 要同步 5 个文件，漏一处就红 —— 而红的是断言、不是代码；
 *     ② verify-live-health.js 的期望值停在 v2026.10.12-g 从不跟 bump，
 *        失败信息里又恰好印着正确的新版本号，被误判成「CDN 缓存时序」整整两轮。
 *
 * 判据：版本号断言要表达的是「**不早于**该功能上线的版本」，不是「**等于**某个值」。
 *   这样后续 bump 自动通过，而版本号被回退、写坏、删掉时仍然会红。
 *
 * 版本号格式（2026-10-16 定的编码规则）：
 *   vYYYY.MM.DD-x —— 日期＝**这次更新的日期**，x＝**当天第几次更新**
 *   （a 第1次、b 第2次…），**跨天重置**。三端各自独立计数。
 *   例：当天第1次更新 → v2026.10.16-a；同日再改一次 → v2026.10.16-b。
 *   次日再改，不管昨天到哪，都回到 v2026.10.17-a。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/** 从 web/<file> 读出构建标记的字面值，读不到直接抛（宁可崩也不要静默放过）。 */
function readBuild(file, name) {
  const p = path.join(ROOT, 'web', file);
  const src = fs.readFileSync(p, 'utf8');
  const m = src.match(new RegExp(name + " = '([^']+)'"));
  if (!m) throw new Error('web/' + file + ' 里找不到 ' + name + ' 声明');
  return m[1];
}

/** vYYYY.MM.DD-x → [2026, 10, 15, 'a']；格式不合法返回 null。 */
function parseBuild(v) {
  const m = /^v(\d{4})\.(\d{2})\.(\d{2})-([a-z]+)$/.exec(String(v || '').trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4]];
}

/** a 是否不早于 b（同日按后缀字典序比）。任一格式不合法返回 false。 */
function buildAtLeast(a, b) {
  const x = parseBuild(a), y = parseBuild(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] > y[i];
  }
  if (x[3].length !== y[3].length) return x[3].length > y[3].length;
  return x[3] >= y[3];
}

/**
 * 生成一条「版本号不早于 since」的断言，交给各套件自己的 ok() 执行。
 * 用法：assertBuildAtLeast(ok, 'admin.html', 'ADMIN_BUILD', 'v2026.10.12-c', '标签精确筛选');
 */
function assertBuildAtLeast(ok, file, name, since, feature) {
  let actual = null, err = null;
  try { actual = readBuild(file, name); } catch (e) { err = e.message; }
  const label = '版本号不早于 ' + since + (feature ? '（' + feature + '上线版本）' : '');
  ok(label, actual !== null && buildAtLeast(actual, since),
    err || (name + ' = ' + JSON.stringify(actual) + '，格式应为 vYYYY.MM.DD-x 且不早于 ' + since));
  return actual;
}

/** 后缀自增：a→b … z→aa（与 buildAtLeast 的「长度优先」比较口径一致）。 */
function incSuffix(s) {
  if (s === '') return 'a';
  const last = s[s.length - 1], head = s.slice(0, -1);
  if (last === 'z') return incSuffix(head) + 'a';
  return head + String.fromCharCode(last.charCodeAt(0) + 1);
}
const pad2 = (n) => String(n).padStart(2, '0');

/**
 * 按编码规则算出「下一个版本号」：给定当前版本号与**本次更新的日期**。
 *   nextBuild('v2026.10.15-d', '2026-10-16') → 'v2026.10.16-a'（跨天重置）
 *   nextBuild('v2026.10.16-a', '2026-10-16') → 'v2026.10.16-b'（同日递增）
 * 日期不合法直接抛——宁可崩也不要生成出一个看起来对、实则骗人的版本号。
 */
function nextBuild(prev, date) {
  const d = String(date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error('date 需为 YYYY-MM-DD，收到 ' + JSON.stringify(date));
  const v = 'v' + d.replace(/-/g, '.');
  const p = parseBuild(prev);
  if (p && p[0] + '-' + pad2(p[1]) + '-' + pad2(p[2]) === d) return v + '-' + incSuffix(p[3]);
  return v + '-a';
}

module.exports = { readBuild, parseBuild, buildAtLeast, assertBuildAtLeast, nextBuild, incSuffix, ROOT };
