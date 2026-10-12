/* 语音输入（腾讯云一句话识别）静态断言。
   跑法：NODE_PATH=... node tests/verify-asr.js
   覆盖：asr.js 模块约束 / 云函数接线 / 路由 / 网关 / 前端录音链路 / 版本号 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ASR = fs.readFileSync(path.join(ROOT, "cloudfunctions", "interview-proxy", "asr.js"), "utf8");
const IDX = fs.readFileSync(path.join(ROOT, "cloudfunctions", "interview-proxy", "index.js"), "utf8");
const WEB = fs.readFileSync(path.join(ROOT, "web", "index.html"), "utf8");

let fail = 0;
function ok(name, cond, extra) {
  if (cond) console.log("  ✓ " + name);
  else { fail++; console.log("  ✗ " + name + (extra !== undefined ? "  → " + extra : "")); }
}

console.log("\n[1] asr.js：零依赖 + 密钥只从环境变量读");
ok("只 require 内置模块（无第三方依赖）",
  (ASR.match(/require\(([^)]+)\)/g) || []).every(s => /"crypto"|'crypto'|"https"|'https'/.test(s)),
  (ASR.match(/require\(([^)]+)\)/g) || []).join(","));
ok("密钥从 process.env 读", /process\.env\.TENCENT_SECRET_ID/.test(ASR) && /process\.env\.TENCENT_SECRET_KEY/.test(ASR));
ok("源码里没有硬编码密钥（无 AKID 字面量）", !/AKID[A-Za-z0-9]{10,}/.test(ASR));
ok("有 asrConfigured() 做未配置判断", /function asrConfigured/.test(ASR) && /module\.exports[\s\S]{0,200}asrConfigured/.test(ASR));

console.log("\n[2] asr.js：接口参数符合官方约束");
ok("接口名 SentenceRecognition", /ASR_ACTION = "SentenceRecognition"/.test(ASR));
ok("版本号 2019-06-14", /ASR_VERSION = "2019-06-14"/.test(ASR));
ok("域名 asr.tencentcloudapi.com", /ASR_HOST = "asr\.tencentcloudapi\.com"/.test(ASR));
ok("SourceType=1（直接上传音频数据）", /SourceType:\s*1/.test(ASR));
ok("引擎 16k_zh", /EngSerViceType:\s*"16k_zh"/.test(ASR));
ok("DataLen 按解码后字节数算（不是 base64 字符数）",
  /DataLen:\s*Buffer\.from\(audio,\s*"base64"\)\.length/.test(ASR));
ok("60 秒上限常量", /MAX_DURATION_MS = 60000/.test(ASR));
ok("3MB 上限常量", /MAX_AUDIO_BASE64 = 3 \* 1024 \* 1024/.test(ASR));
ok("容忍前端误带 data URL 前缀", /replace\(\/\^data:\[\^,\]\*,\/,\s*""\)/.test(ASR));
ok("剥掉 base64 里的空白字符（官方要求不能含换行）", /replace\(\/\\s\+\/g,\s*""\)/.test(ASR));

console.log("\n[3] asr.js：TC3 签名三件套");
ok("固定 sha256 hex", /function sha256hex/.test(ASR) && /createHash\("sha256"\)/.test(ASR));
ok("hmac 用 createHmac", /function hmac/.test(ASR) && /createHmac\("sha256"/.test(ASR));
ok("派生密钥链 kDate→kService→kSigning", /hmac\("TC3" \+ secretKey, date\)/.test(ASR) && /hmac\(kDate, ASR_SERVICE\)/.test(ASR) && /hmac\(kService, "tc3_request"\)/.test(ASR));
ok("Authorization 含 Credential/SignedHeaders/Signature",
  /"TC3-HMAC-SHA256 "/.test(ASR) && /Credential=" \+ secretId/.test(ASR) && /SignedHeaders=" \+ signedHeaders/.test(ASR) && /Signature=" \+ signature/.test(ASR));
ok("签名头 content-type;host", /signedHeaders = "content-type;host"/.test(ASR));
ok("X-TC-Region 固定 ap-shanghai", /ASR_REGION = "ap-shanghai"/.test(ASR));

console.log("\n[4] asr.js：错误分类（前端要能据此给不同话术）");
["asr_not_configured", "asr_empty_audio", "asr_audio_too_large", "asr_audio_too_long",
 "asr_timeout", "asr_network_error", "asr_bad_upstream", "asr_api_error"].forEach(function (e) {
  ok("错误码 " + e, ASR.indexOf('"' + e + '"') >= 0 || ASR.indexOf("'" + e + "'") >= 0);
});
ok("识别结果有长度上限（防超长文本打爆下游）", /MAX_TEXT_LEN = 2000/.test(ASR) && /slice\(0, MAX_TEXT_LEN\)/.test(ASR));

console.log("\n[5] 云函数接线");
ok("index.js require asr 模块", /const asr = require\("\.\/asr"\)/.test(IDX));
ok("有 handleAsr 处理函数", /function handleAsr\(req, res\)/.test(IDX));
ok("未配置密钥回 503 + 人话提示（不是 500）",
  /asr_not_configured/.test(IDX) && /503/.test(IDX) && /语音识别尚未配置/.test(IDX));
ok("参数类错误回 400、服务类回 502",
  /const clientErr = \[/.test(IDX) && /clientErr \? 400 : 502/.test(IDX));
ok("body 过大回 413", /413/.test(IDX) && /body_too_large/.test(IDX));
ok("路由分发已挂 /api/asr", /path === "\/api\/asr"/.test(IDX) && /handleAsr\(req, res\)/.test(IDX));
ok("405 白名单含 /api/asr", /path === "\/api\/asr"\s*\n?\s*\)\s*\{[\s\S]{0,120}method_not_allowed/.test(IDX));

console.log("\n[6] 前端：录音链路完整");
ok("麦克风按钮存在", /id="mic-btn"/.test(WEB) && /onclick="micToggle\(\)"/.test(WEB));
ok("默认隐藏，支持录音才显示", /id="mic-btn" hidden/.test(WEB) && /initMic\(\)/.test(WEB) && /navigator\.mediaDevices/.test(WEB));
ok("CSS 有录音态与脉冲动画", /\.mic-btn\.rec/.test(WEB) && /@keyframes micPulse/.test(WEB));
ok("状态浮层存在", /id="mic-bar"/.test(WEB) && /mic-bar-text/.test(WEB) && /id="mic-cancel"/.test(WEB));
ok("★ 自己采 PCM 包 WAV（不用 MediaRecorder 的 webm）",
  /function pcmToWavBase64/.test(WEB) && /'RIFF'/.test(WEB) && /createScriptProcessor/.test(WEB));
/* 断言的是「代码里没调用 MediaRecorder」，注释里提到不算 —— 先剥掉注释再查 */
const WEB_CODE = WEB.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
ok("★ 代码里不调用 MediaRecorder（webm 腾讯云不收）", !/MediaRecorder/.test(WEB_CODE));
ok("WAV 头字段齐全（RIFF/WAVE/fmt/data + 44 字节头）",
  /writeStr\(0, 'RIFF'\)/.test(WEB) && /writeStr\(8, 'WAVE'\)/.test(WEB) && /writeStr\(12, 'fmt '\)/.test(WEB) && /writeStr\(36, 'data'\)/.test(WEB) && /ArrayBuffer\(44 \+ total \* 2\)/.test(WEB));
ok("16kHz 单声道 16bit", /ASR_SAMPLE_RATE = 16000/.test(WEB) && /view\.setUint16\(22, 1, true\)/.test(WEB) && /view\.setUint16\(34, 16, true\)/.test(WEB));
ok("自动停在上限前留缓冲（ASR_MAX_MS 真被用上）",
  /ASR_MAX_MS = 55000/.test(WEB) && /Date\.now\(\) - micStartedAt >= ASR_MAX_MS\) micStop\(false\)/.test(WEB));
ok("录音过短给提示（<600ms）", /durationMs < 600/.test(WEB) && /说话时间太短/.test(WEB));
ok("识别结果追加而非覆盖已输入内容", /ta\.value = cur \? cur \+ sep \+ text : text/.test(WEB));

console.log("\n[6b] ★ 采样率归一与体积护栏（2026-09-29 实测故障修复）");
ok("★ 有 resampleTo16k 做采样率归一", /function resampleTo16k\(/.test(WEB));
ok("★ 录音链路先重采样再包 WAV（不能直接用设备原生率）",
  /resampleTo16k\(chunks, micInputRate\)/.test(WEB) && /pcmToWavBase64\(\[pcm16k\], ASR_SAMPLE_RATE\)/.test(WEB));
ok("★ 不再用 String.fromCharCode.apply 拼 base64（手机会爆栈）",
  !/String\.fromCharCode\.apply/.test(WEB_CODE));
ok("★ 改用逐字节查表编码", /function bytesToBase64\(/.test(WEB) && /const B64_TAB =/.test(WEB));
ok("★ 有发起前体积检查（留安全余量）",
  /const MAX_B64_LEN = 3600000/.test(WEB) && /base64\.length > MAX_B64_LEN/.test(WEB));
ok("★ 认得网关 406（请求体超限，空 body）", /res\.status === 406/.test(WEB));
ok("★ 请求带 AbortController 超时", /new AbortController\(\)/.test(WEB) && /ctl\.abort\(\)/.test(WEB) && /signal: ctl \? ctl\.signal : undefined/.test(WEB));
ok("★ 区分「超时中止」与「真网络异常」", /err\.name === 'AbortError'/.test(WEB) && /识别超时（网络较慢）/.test(WEB));
ok("★ 非 JSON 响应先取 text 再尝试解析（避免误报网络异常）",
  /r\.text\(\)\.then\(function \(t\)/.test(WEB) && /try \{ j = JSON\.parse\(t\); \} catch \(e\) \{\}/.test(WEB));
ok("★ 失败时把真实原因留 console 便于远程排障",
  /console\.warn\('\[语音识别\] 请求失败：name=/.test(WEB));

ok("调 /asr 接口并带 duration_ms/sample_rate", /fetch\(apiUrl\('\/asr'\)/.test(WEB) && /duration_ms: durationMs/.test(WEB) && /sample_rate: ASR_SAMPLE_RATE/.test(WEB));
ok("各错误码有对应人话话术", /function asrErrText/.test(WEB) && /语音识别尚未开通，请先手动输入/.test(WEB) && /录音超过 60 秒，请分段说/.test(WEB));
ok("失败不阻断打字（用轻提示不用 alert）", /function micToast/.test(WEB));
ok("用后释放麦克风与音频上下文", /getTracks\(\)\.forEach/.test(WEB) && /micCtx\.close\(\)/.test(WEB));

console.log("\n[7] 版本号");
ok("index.html APP_BUILD 已 bump 到 v2026.10.12-e", /APP_BUILD = 'v2026\.10\.12-e'/.test(WEB));

console.log("\n[12] ★★★ 接口 URL 拼接契约（2026-09-29 十轮排查最终根因，绝不许回归）");
ok("★★ 常量已改名 API_ORIGIN（语义=域名根，避免再被误读成「含 /api 的基址」）",
  /const API_ORIGIN = /.test(WEB) && !/const API_BASE = /.test(WEB));
ok("★★ 有 apiUrl() 收口函数（调用方只传 /asr，前缀由它统一补）",
  /function apiUrl\(path\) \{/.test(WEB));
ok("★★ apiUrl 会补 /api 前缀（'/asr' → '/api/asr'）", /'\/api' \+ \(p\.charAt\(0\) === '\/' \? p : '\/' \+ p\)/.test(WEB));
ok("★★ apiUrl 对已带 /api 的入参不重复补（防 /api/api/ 双重前缀）",
  /\/\^\\\/api\(\\\/\|\$\)\/\.test\(p\) \? p :/.test(WEB));
ok("★★ 语音请求走 apiUrl('/asr')", /fetch\(apiUrl\('\/asr'\)/.test(WEB));
ok("★★ 页面里不许再出现手写拼接的坏写法（API_ORIGIN/API_BASE + '/asr'）",
  !/API_(ORIGIN|BASE) \+ '\/asr'/.test(WEB_CODE) && !/API_(ORIGIN|BASE) \+ '\/api\/asr'/.test(WEB_CODE));
ok("★★ 全部接口调用点都走 apiUrl（submit / poster / asr）",
  /const SUBMIT_URL = apiUrl\('\/submit'\)/.test(WEB) && /return apiUrl\('\/poster'\)/.test(WEB) && /fetch\(apiUrl\('\/asr'\)/.test(WEB));
ok("★★ 诊断日志里的 url 也走 apiUrl", /url=' \+ apiUrl\('\/asr'\)/.test(WEB));

console.log("\n[11] ★ 启动期错误捕获（2026-09-29 八轮排查新增，主脚本崩溃取证）");
ok("★ 有顶部错误条容器（id=app-err-bar）", /id = 'app-err-bar'/.test(WEB) && /app-err-bar/.test(WEB));
ok("★ 注册 window error 捕获（捕获阶段，含资源加载失败分支）",
  /window\.addEventListener\('error'/.test(WEB) && /t\.tagName === 'IMG' \|\| t\.tagName === 'SCRIPT'/.test(WEB));
ok("★ 注册 unhandledrejection 捕获", /window\.addEventListener\('unhandledrejection'/.test(WEB));
ok("★ 捕获器在主脚本所有业务代码之前注册（防主脚本中途崩导致漏抓）",
  WEB.indexOf("addEventListener('error'") < WEB.indexOf('const PROXY_URL'));
ok("★ 主脚本末尾置 __appBooted=true（false 即代表没跑完）", /window\.__appBooted = true;/.test(WEB));

console.log("\n[10] ★ file:// 环境检测（App 内置预览禁 fetch —— 该场景确存在，但非本次故障根因）");
ok("★ 有 file:// 警告横幅元素", /id="file-proto-warn"/.test(WEB) && /当前打开方式无效/.test(WEB));
ok("★ 检测到 file:// 显示警告", /location\.protocol === 'file:'/.test(WEB) && /file-proto-warn/.test(WEB));
ok("★ 警告含替代域名（引导用户换浏览器）", /work-d1gs0jzrg2277d75e-1391683363\.tcloudbaseapp\.com/.test(WEB));

console.log("\n[9] ★ 上传阶段可观测性 + 自动重试（2026-09-23 三轮排查新增）");
ok("★ 网络失败自动重试一次（非主动中止才重试）",
  /function doFetch\(attempt\)/.test(WEB) && /if \(attempt < 2 && !\(err && err\.name === 'AbortError'\)\)/.test(WEB));
ok("★ 重试时给出可见提示", /网络不稳，正在重试…/.test(WEB) && /第 2 次尝试/.test(WEB));
ok("★ 上传/等待过程有计时提示（用户能看见是否卡住）",
  /等待服务器响应…（/.test(WEB) && /setInterval\(function \(\) \{\s*if \(!uploading\) return;/.test(WEB));
ok("★ 超时放宽到 45 秒（移动网络慢）", /ctl\.abort\(\); \}, 45000\)/.test(WEB));
ok("★ 诊断码增加「耗时」维度", /'·耗时' \+ Math\.round\(\(Date\.now\(\) - sendAt\) \/ 1000\) \+ 's'/.test(WEB));
ok("★ 重试按钮名与进度提示不冲突（uploading 标志）", /let uploading = true;/.test(WEB));

console.log("\n[8] ★ 真机诊断能力（2026-09-29 二轮排查新增）");
ok("★ 网络失败提示里带诊断码（用户截图即可定位）",
  /网络异常，识别失败 \[' \+ diag \+ '\]/.test(WEB) && /const diag = code/.test(WEB));
ok("★ 诊断码分级 E1/E2/E4", /code = 'E4'/.test(WEB) && /code = 'E2'/.test(WEB) && /code = 'E1'/.test(WEB));
ok("★ 诊断码含 err.name 与 cause.code", /nm \+ \(cause \? '\/' \+ cause : ''\)/.test(WEB));
ok("★ 采集为空时明确提示（不发空音频给服务端）",
  /base64\.length < 200/.test(WEB) && /没有采到声音/.test(WEB));
ok("★ 重采样输入率有合法性兜底（防 Infinity 长度）",
  /if \(!isFinite\(inRate\) \|\| inRate < 4000 \|\| inRate > 384000\) inRate = outRate;/.test(WEB));
ok("★ 录音开始即打印采样率与状态（真机排障）",
  /console\.log\('\[语音识别\] 开始录音：AudioContext\.sampleRate='/.test(WEB));
ok("★ 采集诊断：打印 chunks/采样点/重采样后长度",
  /console\.log\('\[语音识别\] 采集诊断：chunks='/.test(WEB));
ok("★ 数据处理失败也带诊断码", /录音数据处理失败 \[' \+ \(e && e\.name\)/.test(WEB));

console.log("");
if (fail) { console.log("FAIL: " + fail + " 项未通过"); process.exit(1); }
console.log("全部通过");
