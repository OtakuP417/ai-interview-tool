/**
 * 语音识别（ASR）模块 —— 腾讯云「一句话识别」SentenceRecognition
 *
 * 设计要点（为什么这么写）：
 *  1. **零 npm 依赖**：TC3-HMAC-SHA256 签名全部用 Node 内置 crypto 手写。
 *     （腾讯云官方 SDK 会引入一大堆依赖，本函数体量小，没必要。）
 *  2. **密钥只从环境变量读**，绝不写进代码或返回给前端。
 *  3. **不是所有部署都有密钥**：没配密钥时 asrConfigured() 返回 false，
 *     上层应回 503 并给一句人话提示，而不是抛 500。
 *  4. 音频约束（官方硬限）：≤60 秒、≤3MB、16kHz/16bit/单声道、
 *     格式 wav/pcm/ogg-opus/mp3/m4a/aac/amr。
 *     ★ 浏览器 MediaRecorder 默认产 webm —— 不在支持列表里，
 *       所以前端必须自己采 PCM 再手工包 WAV（见 index.html 的录音部分）。
 */

const crypto = require("crypto");

const ASR_HOST = "asr.tencentcloudapi.com";
const ASR_SERVICE = "asr";
const ASR_VERSION = "2019-06-14";
const ASR_ACTION = "SentenceRecognition";
const ASR_REGION = "ap-shanghai";

/* 一句话识别硬约束（超过直接本地拒绝，别浪费一次网络往返和一次计费） */
const MAX_AUDIO_BASE64 = 3 * 1024 * 1024; // 3MB（官方限制的是 base64 前的数据大小）
const MAX_DURATION_MS = 60000;            // 60 秒
const MAX_TEXT_LEN = 2000;                // 识别结果上限，防异常长文本打爆下游

function asrConfigured() {
  const id = process.env.TENCENT_SECRET_ID;
  const key = process.env.TENCENT_SECRET_KEY;
  return !!(id && String(id).trim() && key && String(key).trim());
}

/* ── TC3-HMAC-SHA256 签名（腾讯云 API 3.0 标准流程） ───────────── */

function sha256hex(s) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

function hmac(key, msg) {
  return crypto.createHmac("sha256", key).update(msg, "utf8").digest();
}

/**
 * @param {string} secretId
 * @param {string} secretKey
 * @param {object} payload  请求体对象（会被 JSON.stringify）
 * @returns {{authorization:string, timestamp:number, body:string}}
 */
function buildSignedRequest(secretId, secretKey, payload) {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);

  // 1. 拼接规范请求串
  const canonicalHeaders =
    "content-type:application/json; charset=utf-8\n" +
    "host:" + ASR_HOST + "\n";
  const signedHeaders = "content-type;host";
  const hashedPayload = sha256hex(body);
  const canonicalRequest = [
    "POST",
    "/",
    "",
    canonicalHeaders,
    signedHeaders,
    hashedPayload,
  ].join("\n");

  // 2. 拼接待签名字符串
  const credentialScope = date + "/" + ASR_SERVICE + "/tc3_request";
  const stringToSign = [
    "TC3-HMAC-SHA256",
    timestamp,
    credentialScope,
    sha256hex(canonicalRequest),
  ].join("\n");

  // 3. 计算签名
  const kDate = hmac("TC3" + secretKey, date);
  const kService = hmac(kDate, ASR_SERVICE);
  const kSigning = hmac(kService, "tc3_request");
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  // 4. 拼接 Authorization
  const authorization =
    "TC3-HMAC-SHA256 " +
    "Credential=" + secretId + "/" + credentialScope + ", " +
    "SignedHeaders=" + signedHeaders + ", " +
    "Signature=" + signature;

  return { authorization, timestamp, body };
}

/* ── HTTPS POST（保持与 index.js 一致：不引第三方库） ───────────── */

function postJson(host, path, headers, body, timeoutMs) {
  return new Promise(function (resolve, reject) {
    const req = require("https").request(
      {
        hostname: host,
        path: path,
        method: "POST",
        headers: Object.assign(
          { "Content-Type": "application/json; charset=utf-8" },
          headers,
          { "Content-Length": Buffer.byteLength(body) }
        ),
        timeout: timeoutMs || 30000,
      },
      function (res) {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", function (c) { data += c; });
        res.on("end", function () {
          let json = null;
          try { json = JSON.parse(data); } catch (e) { /* 下游返回非 JSON */ }
          resolve({ status: res.statusCode, json: json, raw: data });
        });
      }
    );
    req.on("timeout", function () { req.destroy(new Error("asr_timeout")); });
    req.on("error", reject);
    req.end(body);
  });
}

/* ── 对外主函数 ───────────────────────────────────────────────── */

/**
 * 识别一段 base64 音频。
 *
 * @param {object} opts
 *   - audioBase64 {string} 必填，纯 base64（不含 data: 前缀、不含换行）
 *   - format      {string} 音频格式，默认 "wav"；支持 wav/pcm/mp3/m4a/aac/amr/ogg-opus
 *   - durationMs  {number} 可选，前端上报的时长（用于本地超限拦截）
 *   - sampleRate  {number} 可选，pcm 格式时需要（16000/8000）
 * @returns {Promise<{ok:true, text:string, requestId:string, duration:number}|{ok:false, error:string, detail?:string}>}
 */
async function recognize(opts) {
  const o = opts || {};
  if (!asrConfigured()) {
    return { ok: false, error: "asr_not_configured", detail: "云函数未配置 TENCENT_SECRET_ID / TENCENT_SECRET_KEY" };
  }

  const secretId = String(process.env.TENCENT_SECRET_ID).trim();
  const secretKey = String(process.env.TENCENT_SECRET_KEY).trim();

  const audio = String(o.audioBase64 || "")
    .replace(/^data:[^,]*,/, "")   // 容忍前端误带 data URL 前缀
    .replace(/\s+/g, "");          // 官方要求：encoded data 不能含换行/空白
  if (!audio) return { ok: false, error: "asr_empty_audio" };
  if (audio.length > MAX_AUDIO_BASE64 * 1.4) {
    return { ok: false, error: "asr_audio_too_large", detail: "音频超过 3MB 上限，请缩短录音" };
  }
  if (o.durationMs && Number(o.durationMs) > MAX_DURATION_MS + 3000) {
    return { ok: false, error: "asr_audio_too_long", detail: "单段录音请控制在 60 秒内" };
  }

  const format = String(o.format || "wav").toLowerCase();
  const payload = {
    ProjectId: 0,
    SubServiceType: 2,
    EngSerViceType: "16k_zh",       // 16k 中文通用引擎
    SourceType: 1,                  // 1 = 直接上传音频数据
    VoiceFormat: format,
    Data: audio,
    DataLen: Buffer.from(audio, "base64").length, // ★ 长度按「解码后字节数」算，不是 base64 字符数
    FilterDirty: 0,
    FilterModal: 0,
    FilterPunc: 0,
    ConvertNumMode: 1,
    WordInfo: 0,
  };
  if (format === "pcm" && o.sampleRate) payload.InputSampleRate = Number(o.sampleRate) === 8000 ? 8000 : 16000;

  const signed = buildSignedRequest(secretId, secretKey, payload);
  const headers = {
    Authorization: signed.authorization,
    "X-TC-Action": ASR_ACTION,
    "X-TC-Version": ASR_VERSION,
    "X-TC-Timestamp": String(signed.timestamp),
    "X-TC-Region": ASR_REGION,
  };

  let resp;
  try {
    resp = await postJson(ASR_HOST, "/", headers, signed.body, 25000);
  } catch (e) {
    const msg = e && e.message ? e.message : "unknown";
    return { ok: false, error: msg === "asr_timeout" ? "asr_timeout" : "asr_network_error", detail: msg };
  }

  const j = resp.json;
  if (!j || !j.Response) {
    return { ok: false, error: "asr_bad_upstream", detail: String(resp.raw || "").slice(0, 300) };
  }
  const r = j.Response;
  if (r.Error) {
    return {
      ok: false,
      error: "asr_api_error",
      detail: (r.Error.Code || "") + " " + (r.Error.Message || ""),
    };
  }

  let text = String(r.Result || "").trim();
  if (text.length > MAX_TEXT_LEN) text = text.slice(0, MAX_TEXT_LEN);
  return {
    ok: true,
    text: text,
    requestId: r.RequestId || "",
    duration: Number(r.AudioDuration) || 0,
  };
}

module.exports = {
  asrConfigured,
  recognize,
  buildSignedRequest,
  MAX_AUDIO_BASE64,
  MAX_DURATION_MS,
};
