/**
 * interview-proxy — AI 案例访谈助手的服务端
 *
 * 职责：
 *   1. POST /            访谈对话（DeepSeek 转发，流式）。DeepSeek Key 只存在于服务端环境变量。
 *   2. POST /api/submit  提交归档（写入 CloudBase PostgreSQL）
 *   3. POST /api/admin   管理端：登录换 token / 列表 / 详情 / 改状态 / 删除 /
 *                        AI 辅助修改（ai_edit，只生成补丁不写库）
 *   4. POST /api/mail    把归档报告发邮件给后线对接人（抄送业务管理人员）
 *
 * 环境变量：
 *   DEEPSEEK_API_KEY   DeepSeek 密钥
 *   CLOUDBASE_APIKEY   CloudBase API Key（service_role），用于访问 PG
 *   ADMIN_PASSWORD     管理页口令
 *   TCB_ENV            CloudBase 环境 ID
 *   SMTP_USER          QQ 邮箱账号（见 mailer.js）
 *   SMTP_PASS          QQ 邮箱 SMTP 授权码
 *   MAIL_TO            报告接收邮箱，逗号分隔
 *   MAIL_CC            抄送，逗号分隔（可空）
 *
 * 监听端口：9000（CloudBase HTTP 函数强制要求）
 *
 * 安全约定：
 *   - 绝不回显 process.env / req.headers
 *   - 前端提交的任何密钥字段一律忽略
 *   - 归档前做 PII 兜底脱敏
 *   - 发信接口不信任前端传入的收件人，只认服务端 MAIL_TO / MAIL_CC
 *     （否则任何人都能拿它当发信跳板）
 */

const http = require("http");
const https = require("https");
const crypto = require("crypto");
const { URL } = require("url");
const { sendReportMail } = require("./mailer");
const poster = require("./poster");
const tagger = require("./tagger");
const asr = require("./asr");
const aiEditor = require("./ai-editor");
const kb = require("./kb");
const kbStage = require("./kb-stage");

/**
 * CORS 由 CloudBase 网关统一注入。
 * 实测：网关会按请求 Origin 回填 Access-Control-Allow-Origin（并带
 * vary: Origin）。函数若再自己写一个 "*"，浏览器会收到重复值
 *   Access-Control-Allow-Origin: https://xxx,*
 * 直接判定非法并报 "Failed to fetch"（已踩坑，勿再加回）。
 * 这里仅声明函数自身需要的响应头，不回 CORS 头。
 */
const OWN_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
};

const TABLE = "interview_reports";

function env(key, fallback) {
  const v = process.env[key];
  return v && String(v).trim() ? String(v).trim() : fallback;
}

function pgBase() {
  const envId = env("TCB_ENV", "work-d1gs0jzrg2277d75e");
  return "https://" + envId + ".api.tcloudbasegateway.com/v1/rdb/rest/" + TABLE;
}

/* ─────────────────────────── 通用响应 ─────────────────────────── */

function sendJson(res, statusCode, data, extraHeaders) {
  res.writeHead(statusCode, {
    ...OWN_HEADERS,
    ...(extraHeaders || {}),
  });
  res.end(JSON.stringify(data));
}

/* 请求体上限：海报图 base64（最大 4MB 字符）+ 报告全文（60k）+ 对话记录，
   留足余量。没有上限的话一个超大 body 就能把 256MB 的实例打爆。 */
const MAX_BODY_BYTES = 12 * 1024 * 1024;

function readRawBody(req) {
  return new Promise(function (resolve, reject) {
    let raw = "";
    let size = 0;
    let aborted = false;
    req.setEncoding("utf8");
    req.on("data", function (c) {
      if (aborted) return;
      size += Buffer.byteLength(c);
      if (size > MAX_BODY_BYTES) {
        aborted = true;
        reject(new Error("body_too_large"));
        return;
      }
      raw += c;
    });
    req.on("end", function () {
      if (aborted) return;
      resolve(raw);
    });
    req.on("error", reject);
  });
}

/* ─────────────────────── PII 兜底脱敏（B 层） ─────────────────────── */

/**
 * 入库前的最后一道防线：把可被正则可靠识别的个人标识打码。
 * 注意：姓名无法用正则可靠识别，姓名层面依赖提示词约束（A 层）。
 */
function maskSensitive(text) {
  if (typeof text !== "string" || !text) return text;
  let s = text;

  // 身份证号：18 位（末位可为 X/x）
  s = s.replace(/\b\d{17}[\dXx]\b/g, function (m) {
    return m.slice(0, 4) + "*".repeat(10) + m.slice(-2);
  });

  // 手机号：11 位
  s = s.replace(/\b1[3-9]\d{9}\b/g, function (m) {
    return m.slice(0, 3) + "****" + m.slice(-4);
  });

  // 银行卡 / 长数字串：16–19 位
  s = s.replace(/\b\d{16,19}\b/g, function (m) {
    return m.slice(0, 4) + "*".repeat(m.length - 6) + m.slice(-2);
  });

  // 邮箱
  s = s.replace(
    /\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*(@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g,
    function (_m, first, domain) {
      return first + "***" + domain;
    }
  );

  return s;
}

function maskTranscript(transcript) {
  if (!Array.isArray(transcript)) return [];
  return transcript.map(function (m) {
    if (!m || typeof m !== "object") return m;
    const role = typeof m.role === "string" ? m.role : "user";
    const content =
      typeof m.content === "string" ? maskSensitive(m.content) : m.content;
    return { role: role, content: content };
  });
}

/* ───────────────────────── PG 访问层 ───────────────────────── */

/**
 * 通过 CloudBase PG HTTP API 访问数据库。
 * 返回 { ok, status, data }；data 为解析后的 JSON 或 null。
 */
function pgRequest(method, queryString, body, extraHeaders) {
  return new Promise(function (resolve) {
    const apiKey = env("CLOUDBASE_APIKEY", "");
    if (!apiKey) {
      resolve({ ok: false, status: 500, data: { error: "db_not_configured" } });
      return;
    }

    let target;
    try {
      target = new URL(pgBase() + (queryString ? "?" + queryString : ""));
    } catch (e) {
      resolve({ ok: false, status: 500, data: { error: "bad_db_url" } });
      return;
    }

    const payload = body ? JSON.stringify(body) : null;
    const headers = {
      Authorization: "Bearer " + apiKey,
      Accept: "application/json",
      ...(extraHeaders || {}),
    };
    if (payload) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }

    const req = https.request(
      {
        hostname: target.hostname,
        path: target.pathname + target.search,
        method: method,
        headers: headers,
        timeout: 20000,
      },
      function (pgRes) {
        let raw = "";
        pgRes.setEncoding("utf8");
        pgRes.on("data", function (c) {
          raw += c;
        });
        pgRes.on("end", function () {
          let parsed = null;
          if (raw) {
            try {
              parsed = JSON.parse(raw);
            } catch (e) {
              parsed = { error: "bad_json_from_db", raw: raw.slice(0, 300) };
            }
          }
          const status = pgRes.statusCode || 500;
          resolve({
            ok: status >= 200 && status < 300,
            status: status,
            data: parsed,
            contentRange: pgRes.headers["content-range"] || null,
          });
        });
      }
    );

    req.on("timeout", function () {
      req.destroy(new Error("db_timeout"));
    });
    req.on("error", function (err) {
      resolve({ ok: false, status: 502, data: { error: "db_error", detail: err.message } });
    });

    if (payload) req.write(payload);
    req.end();
  });
}

/* ───────────────────── 管理端 token（无状态） ───────────────────── */

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 小时

function makeToken(exp) {
  return crypto
    .createHmac("sha256", env("ADMIN_PASSWORD", ""))
    .update(String(exp))
    .digest("hex");
}

function verifyToken(token, exp) {
  const password = env("ADMIN_PASSWORD", "");
  if (!password) return false;
  const n = Number(exp);
  if (!token || !Number.isFinite(n) || n < Date.now()) return false;
  const expected = makeToken(n);
  const a = Buffer.from(String(token));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch (e) {
    return false;
  }
}

/* ─────────────────────────── 业务处理 ─────────────────────────── */

function handleChat(req, res) {
  const apiKey = env("DEEPSEEK_API_KEY", "");
  if (!apiKey) {
    sendJson(res, 500, { error: "server_not_configured" });
    return;
  }

  readRawBody(req)
    .then(function (raw) {
      let payload;
      try {
        payload = raw ? JSON.parse(raw) : {};
      } catch (e) {
        sendJson(res, 400, { error: "invalid_json_body" });
        return;
      }

      // 前端提交的密钥一律忽略，永远以服务端环境变量为准
      delete payload.apiKey;
      delete payload.authorization;

      const isStream = payload.stream === true;
      // deepseek-chat / deepseek-reasoner 已于 2026-07-24 被官方弃用，
      // 现统一映射到 V4-Flash（兼容层也还在，但显式写新名更稳）。
      payload.model = payload.model || "deepseek-v4-flash";
      if (typeof payload.max_tokens !== "number") {
        // deepseek-v4-flash 为推理模型，推理 token 计入 max_tokens 预算；
        // 报告生成（7 节 + 海报摘要）实测需要 ~4.6k，缺省就给足。
        payload.max_tokens = isStream ? 600 : 4600;
      }
      if (typeof payload.temperature !== "number") {
        payload.temperature = isStream ? 0.7 : 0.5;
      }

      const upstreamBody = JSON.stringify(payload);
      let settled = false;

      const upReq = https.request(
        {
          hostname: "api.deepseek.com",
          path: "/chat/completions",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + apiKey,
            "Content-Length": Buffer.byteLength(upstreamBody),
          },
          timeout: 120000,
        },
        function (upRes) {
          const status = upRes.statusCode || 502;

          if (status >= 400) {
            let errText = "";
            upRes.setEncoding("utf8");
            upRes.on("data", function (c) {
              errText += c;
            });
            upRes.on("end", function () {
              if (settled) return;
              settled = true;
              sendJson(res, 502, {
                error: "upstream_error",
                status: status,
                detail: errText.slice(0, 600),
              });
            });
            return;
          }

          if (settled) return;
          settled = true;
          res.writeHead(200, {
            "Content-Type": isStream
              ? "text/event-stream; charset=utf-8"
              : "application/json; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
          });
          upRes.pipe(res);
        }
      );

      upReq.on("timeout", function () {
        upReq.destroy(new Error("upstream_timeout"));
      });
      upReq.on("error", function (err) {
        if (settled) return;
        settled = true;
        if (!res.headersSent) {
          sendJson(res, 502, { error: "proxy_error", detail: err.message });
        } else {
          res.end();
        }
      });

      upReq.end(upstreamBody);
    })
    .catch(function () {
      sendJson(res, 400, { error: "read_body_failed" });
    });
}

function asText(v, maxLen) {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  return maxLen ? s.slice(0, maxLen) : s;
}

/* ─────────────────── 主题回归 + 自动打标（P2） ─────────────────── */

/**
 * 归档后按「报告正文」自动归纳规范主题并打标签，写回 ai_topic / tags。
 *
 * 与 topic 的关系：**topic 是运营岗口述、顾问手填的原始意图，一律不动**。
 * 这一步是事后按实际访谈内容回写一个规范主题，两者并存，
 * 才能看出「运营岗以为的经验」和「顾问实际讲的经验」差在哪。
 *
 * 失败处理：整条链路吞异常，只 console.warn。
 * 打标是锦上添花，绝不能因为模型抽风就让一条已归档的报告缺字段或报错。
 * 未打标的记录 tags_at 保持 NULL，随时可以批量补跑。
 *
 * @param {number} id        归档记录 id
 * @param {object} row       已入库的行（要 report_md / topic / interviewee_position）
 * @param {string} apiKey    DeepSeek Key
 */
function autoTagById(id, row, apiKey) {
  if (!id || !row || !row.report_md) return Promise.resolve(null);

  return tagger
    .tagReport(row.report_md, {
      topic: row.topic,
      position: row.interviewee_position,
    }, { apiKey: apiKey })
    .then(function (out) {
      const patch = {
        tags_model: out.tags_model,
        tags_at: new Date().toISOString(),
      };
      // 主题与标签都有可能拿不到（报告太薄时模型会返回 null），
      // 只写拿到的部分，不留半截空值覆盖已有数据。
      if (out.ai_topic) patch.ai_topic = out.ai_topic;
      if (out.tags && out.tags.length) patch.tags = out.tags;

      return pgRequest("PATCH", "id=eq." + id, patch).then(function (r) {
        if (!r.ok) {
          console.warn("[tagger] writeback failed id=" + id + " status=" + r.status);
          return null;
        }
        return patch;
      });
    })
    .catch(function (e) {
      console.warn("[tagger] failed id=" + id + ": " + String(e && e.message || e));
      return null;
    });
}

/* ── 访谈过程事件日志（L4 可观测性，2026-10-12）─────────────────
   前端记录的「规则注入」与「回复闸门命中」。设计上刻意做白名单清洗：
   kind 只接受已知的几类，字段只保留 kind/round ——
   这一列是给统计用的，不该变成任意 JSON 的入库入口。 */
const GATE_LOG_KINDS = [
  "inject_opener", "inject_switch", "inject_release", "inject_number", "inject_boundary",
  "gate_fixed", "gate_unfixed",
];
function cleanGateLog(v) {
  if (!Array.isArray(v)) return null;
  const out = [];
  for (let i = 0; i < v.length && out.length < 400; i++) {
    const e = v[i];
    if (!e || GATE_LOG_KINDS.indexOf(e.kind) === -1) continue;
    out.push({
      kind: e.kind,
      round: Math.max(0, Math.min(999, Math.trunc(Number(e.round) || 0))),
    });
  }
  return out.length ? out : null;
}

function handleSubmit(req, res) {
  readRawBody(req)
    .then(function (raw) {
      let body;
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch (e) {
        sendJson(res, 400, { error: "invalid_json_body" });
        return;
      }

      const row = {
        city: asText(body.city, 40) || null,
        interviewee_name: asText(body.interviewee_name, 40),
        interviewee_position: asText(body.interviewee_position, 60),
        // UM 号一律全大写入库：大小写混写会让「按工号归因」的匹配对不上
        interviewee_um: asText(body.interviewee_um, 40).toUpperCase() || null,
        topic: asText(body.topic, 120),
        submitter_name: asText(body.submitter_name, 40) || null,
        backend_owner_name: asText(body.backend_owner_name, 40) || null,
        backend_owner_org: asText(body.backend_owner_org, 80) || null,
        round_count: Number.isFinite(Number(body.round_count))
          ? Math.max(0, Math.min(999, Math.trunc(Number(body.round_count))))
          : 0,
        report_md: maskSensitive(asText(body.report_md, 60000)),
        transcript: maskTranscript(body.transcript),
        /* L4：规则注入与闸门命中事件（只含类别与轮次，白名单清洗后入库） */
        gate_log: cleanGateLog(body.gate_log),
        /* L4：前端程序版本。没有这一列就分不清"旧页面没刷新"和"新版真没触发" ——
           静态托管的 JS 只在页面加载时取一次，不刷新就一直跑旧代码。 */
        app_build: asText(body.app_build, 40) || null,
      };

      const missing = [];
      if (!row.interviewee_name) missing.push("被访谈人姓名");
      if (!row.interviewee_position) missing.push("被访谈人岗位");
      if (!row.topic) missing.push("访谈主题");
      if (!row.report_md) missing.push("报告内容");
      if (missing.length) {
        sendJson(res, 400, { error: "missing_fields", fields: missing });
        return;
      }

      /* 访谈未完成闸（2026-10-10，id=17）：只聊了 3 轮就生成了报告，
         报告通篇"待补"，还随自动发信一起发了出去，等于生产了一条垃圾归档。
         前端已有硬闸（MIN_REPORT_ROUNDS = 5），这里是最后一道 —— 不管报告
         从哪条路径进来，轮次明显不够都不许入库。阈值与前端保持一致。 */
      if (row.round_count < 5) {
        sendJson(res, 400, { error: "interview_too_short", rounds: row.round_count });
        return;
      }

      /* 报告完整性闸（2026-10-10，id=19 事故）：分隔符少于 5 个说明报告
         缺节 —— 生成时被 max_tokens 掐断的报告会降级成旧版式、还带着空板块。
         前端有截断重试 + 节数校验，这里是最后一道闸：不管哪条路径进来的
         残缺报告，都不许带病入库。阈值与正文编辑护栏一致（<5 → 拒绝）。 */
      const secCount = (row.report_md.match(/---SECTION---/g) || []).length;
      if (secCount < 5) {
        sendJson(res, 400, { error: "report_sections_invalid", sections: secCount });
        return;
      }

      pgRequest("POST", "", row, { Prefer: "return=representation" }).then(function (r) {
        if (!r.ok) {
          sendJson(res, 502, { error: "db_write_failed", status: r.status });
          return;
        }
        const inserted = Array.isArray(r.data) ? r.data[0] : r.data;
        const newId = inserted && inserted.id ? inserted.id : null;
        sendJson(res, 200, {
          ok: true,
          id: newId,
          created_at: inserted && inserted.created_at ? inserted.created_at : null,
        });

        /* ── 自动发信 ──
           先回响应再发：邮件走 SMTP 握手要几秒，不能拖慢归档接口。
           传客户端在浏览器里栅格化好的海报图（有就带，没有则纯 HTML 正文）。
           任何异常都必须吞掉——邮件发不出去不该影响已成功的归档，
           mail_sent_at 留空，管理页仍可手动补发。 */
        if (newId) {
          const autoRow = Object.assign({}, inserted || row, {
            id: newId,
            mail_sent_at: null,
          });
          sendReportMailById(autoRow, {
            posterPngBase64: body.poster_png_base64,
            fullPngBase64: body.full_png_base64,
          }).catch(function () {});

          /* ── 自动打标 ──
             同样先回响应再干活：一次打标要一次 LLM 往返，不能拖慢归档。
             用「已入库的那份 report_md」（inserted）而不是 body 里前端传的，
             因为入库时做过 PII 脱敏，打标也该基于同一份文本。 */
          autoTagById(newId, autoRow, env("DEEPSEEK_API_KEY", ""));
        }
      });
    })
    .catch(function (e) {
      const tooBig = String(e && e.message) === "body_too_large";
      sendJson(res, tooBig ? 413 : 400, {
        error: tooBig ? "body_too_large" : "read_body_failed",
      });
    });
}

function toPgPattern(q) {
  // PostgREST ilike 通配：把用户输入里的 * 与 % 归一，其余按字面量
  const cleaned = String(q).replace(/[*%]/g, "");
  return "*" + cleaned + "*";
}

function handleAdmin(req, res) {
  readRawBody(req)
    .then(function (raw) {
      let body;
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch (e) {
        sendJson(res, 400, { error: "invalid_json_body" });
        return;
      }

      const action = asText(body.action, 20);

      /* ── 登录：口令换 token ── */
      if (action === "login") {
        const password = env("ADMIN_PASSWORD", "");
        if (!password) {
          sendJson(res, 500, { error: "admin_not_configured" });
          return;
        }
        const given = asText(body.password, 64);
        const a = Buffer.from(given);
        const b = Buffer.from(password);
        const ok =
          a.length === b.length && crypto.timingSafeEqual(a, b);
        if (!ok) {
          sendJson(res, 401, { error: "bad_password" });
          return;
        }
        const exp = Date.now() + TOKEN_TTL_MS;
        sendJson(res, 200, { ok: true, token: makeToken(exp), exp: exp });
        return;
      }

      /* ── 其余动作必须带有效 token ── */
      if (!verifyToken(body.token, body.exp)) {
        sendJson(res, 401, { error: "unauthorized" });
        return;
      }

      /* ── 列表 ── */
      if (action === "list") {
        const params = [
          "select=id,created_at,city,interviewee_name,interviewee_position,interviewee_um,topic,ai_topic,tags,tags_at,tags_model,submitter_name,backend_owner_name,backend_owner_org,round_count,status,mail_sent_at",
          "order=created_at.desc",
        ];

        const city = asText(body.city, 40);
        if (city) params.push("city=eq." + encodeURIComponent(city));

        const from = asText(body.from, 30);
        if (from) params.push("created_at=gte." + encodeURIComponent(from));

        const to = asText(body.to, 30);
        if (to) params.push("created_at=lte." + encodeURIComponent(to));

        const q = asText(body.q, 60);
        if (q) {
          const p = encodeURIComponent(toPgPattern(q));
          params.push(
            "or=(topic.ilike." + p + ",ai_topic.ilike." + p +
              ",interviewee_name.ilike." + p +
              ",interviewee_um.ilike." + p + ",backend_owner_name.ilike." + p +
              ",submitter_name.ilike." + p + ")"
          );
        }

        /* ── 按标签筛（tags @> '["获客方式:老客户转介绍"]'）──
           数组包含查询走 GIN 索引（见迁移 20260929100000）。
           支持传多个标签做「同时满足」，与检索词是 AND 关系。 */
        const tagList = Array.isArray(body.tags)
          ? body.tags.map(function (t) { return asText(t, 60); }).filter(Boolean).slice(0, 8)
          : [];
        if (tagList.length) {
          params.push("tags=cs." + encodeURIComponent(JSON.stringify(tagList)));
        }

        const page = Math.max(1, Math.trunc(Number(body.page) || 1));
        const pageSize = Math.min(200, Math.max(1, Math.trunc(Number(body.pageSize) || 50)));
        const offset = (page - 1) * pageSize;

        pgRequest("GET", params.join("&"), null, {
          Prefer: "count=exact",
          Range: offset + "-" + (offset + pageSize - 1),
        }).then(function (r) {
          if (!r.ok && r.status !== 206) {
            sendJson(res, 502, { error: "db_read_failed", status: r.status });
            return;
          }
          let total = null;
          if (r.contentRange) {
            const m = /\/(\d+)\s*$/.exec(r.contentRange);
            if (m) total = Number(m[1]);
          }
          sendJson(res, 200, {
            ok: true,
            rows: Array.isArray(r.data) ? r.data : [],
            total: total,
            page: page,
            pageSize: pageSize,
          });
        });
        return;
      }

      /* ── 详情 ── */
      if (action === "detail") {
        const id = Math.trunc(Number(body.id) || 0);
        if (!id) {
          sendJson(res, 400, { error: "missing_id" });
          return;
        }
        pgRequest("GET", "id=eq." + id + "&limit=1", null).then(function (r) {
          if (!r.ok) {
            sendJson(res, 502, { error: "db_read_failed", status: r.status });
            return;
          }
          const row = Array.isArray(r.data) ? r.data[0] : null;
          if (!row) {
            sendJson(res, 404, { error: "not_found" });
            return;
          }
          sendJson(res, 200, { ok: true, row: row });
        });
        return;
      }

      /* ── 改状态 ── */
      if (action === "status") {
        const id = Math.trunc(Number(body.id) || 0);
        const status = asText(body.status, 20);
        const allowed = ["待审", "已采纳", "已退回"];
        if (!id || allowed.indexOf(status) === -1) {
          sendJson(res, 400, { error: "bad_params" });
          return;
        }
        pgRequest(
          "PATCH",
          "id=eq." + id,
          { status: status },
          { Prefer: "return=representation" }
        ).then(function (r) {
          if (!r.ok) {
            sendJson(res, 502, { error: "db_write_failed", status: r.status });
            return;
          }
          sendJson(res, 200, { ok: true });
        });
        return;
      }

      /* ── 补记邮件发送状态（人工）──
         mail_sent_at 平时由发送逻辑独占回写（见 update 分支的禁止名单）。
         但「人直接在邮箱里把报告发掉」这条路径不经过发送逻辑，归档就一直是空：
         管理页显示「未发送」，列表里也分不清是漏发还是已发。
         这个 action 是唯一例外入口 —— 只写 mail_sent_at 一个字段，
         不碰其它任何字段，也不真的发信。 */
      if (action === "mark_sent") {
        const id = Math.trunc(Number(body.id) || 0);
        if (!id) {
          sendJson(res, 400, { error: "missing_id" });
          return;
        }
        /* 真实发送时刻只有当事人知道，允许补记时指定；不指定则记为当前时间。
           传了就必须能解析成合法时间，否则会在界面显示 Invalid Date。 */
        let at = new Date();
        if (body.sent_at) {
          const t = new Date(String(body.sent_at));
          if (isNaN(t.getTime())) {
            sendJson(res, 400, { error: "invalid_sent_at" });
            return;
          }
          at = t;
        }
        pgRequest("PATCH", "id=eq." + id, { mail_sent_at: at.toISOString() })
          .then(function (r) {
            if (!r.ok) {
              sendJson(res, 502, { error: "db_write_failed", status: r.status });
              return;
            }
            sendJson(res, 200, { ok: true, id: id, mail_sent_at: at.toISOString() });
          })
          .catch(function () {
            sendJson(res, 502, { error: "db_write_failed" });
          });
        return;
      }

      /* ── 编辑归档字段（修正填错的基础信息，如被访谈人姓名/后线对接人）── */
      if (action === "update") {
        const id = Math.trunc(Number(body.id) || 0);
        if (!id) {
          sendJson(res, 400, { error: "missing_id" });
          return;
        }

        /* 白名单：允许改「基础信息」这一类人工填报字段，以及**报告正文**。
           严禁放开的：transcript（访谈对话原文，这是无法重建的一手凭证）、
           id/created_at（标识与时间）、mail_sent_at（发送状态由发送逻辑维护，
           人工补记只走独立的 mark_sent 分支，不从这里放开）、
           以及 report_rev / report_orig（留痕字段只能由服务端自己维护，
           否则前端可以传 report_rev:0 把「已编辑」痕迹抹掉）。 */
        const EDITABLE = {
          interviewee_name: 40,
          interviewee_position: 60,
          interviewee_um: 40,
          city: 40,
          topic: 120,
          backend_owner_name: 40,
          backend_owner_org: 80,
        };

        /* 入库归一：UM 号一律全大写。录入端已自动转大写，这里是不信前端的
           权威兜底 —— 服务端才是数据一致性的最后一道闸。 */
        const UPPERCASE_FIELDS = ["interviewee_um"];

        const patch = {};
        const raw = body.fields && typeof body.fields === "object" ? body.fields : body;
        Object.keys(EDITABLE).forEach(function (k) {
          if (Object.prototype.hasOwnProperty.call(raw, k)) {
            var v = asText(raw[k], EDITABLE[k]);
            if (UPPERCASE_FIELDS.indexOf(k) >= 0) v = v.toUpperCase();
            patch[k] = v;
          }
        });

        /* ── 报告正文单独走一条路径 ──
           正文可改，但必须留痕：首次编辑前把模型原文快照进 report_orig（只存一次，
           后续编辑不再覆盖），并累加 report_rev。
           留痕字段本身不接受前端传值，全部由服务端读现值后计算，
           防止「改完正文再顺手把修订计数抹零」。 */
        const wantsReport =
          Object.prototype.hasOwnProperty.call(raw, "report_md");
        let reportMd = "";
        if (wantsReport) {
          reportMd = maskSensitive(asText(raw.report_md, 60000));
          if (!reportMd) {
            sendJson(res, 400, { error: "report_md_required" });
            return;
          }
          /* 分隔符护栏：报告靠 ---SECTION--- 切节，前端渲染、海报出图、
             覆盖度体检都依赖它。若编辑时把分隔符弄丢，整份报告会塌成 1 节，
             等于把这份归档废掉。这里宁可拒绝也不收。 */
          const secCount = (reportMd.match(/---SECTION---/g) || []).length;
          if (secCount < 5) {
            sendJson(res, 400, {
              error: "report_sections_invalid",
              detail: "报告需包含至少 5 个 ---SECTION--- 分隔符（共 6 节）；当前只有 " +
                secCount + " 个。请检查是否误删了分隔符。",
            });
            return;
          }
        }

        if (!Object.keys(patch).length && !wantsReport) {
          sendJson(res, 400, { error: "no_editable_field" });
          return;
        }
        /* 姓名为空只在「本次提交了姓名」时才拦——允许只改城市等局部更新，
           未提交的字段保持原值不动。 */
        if (
          Object.prototype.hasOwnProperty.call(patch, "interviewee_name") &&
          !patch.interviewee_name
        ) {
          sendJson(res, 400, { error: "interviewee_name_required" });
          return;
        }

        /* 报告正文编辑需要先读现值（拿 report_orig / report_rev），
           其余情况直接 PATCH，少一次往返。 */
        const prepare = wantsReport
          ? pgRequest("GET", "id=eq." + id + "&limit=1&select=report_md,report_orig,report_rev", null)
              .then(function (r) {
                if (!r.ok) return { error: "db_read_failed", status: r.status };
                const cur = Array.isArray(r.data) ? r.data[0] : null;
                if (!cur) return { error: "not_found", status: 404 };
                return { cur: cur };
              })
          : Promise.resolve({ cur: null });

        prepare.then(function (got) {
          if (got.error) {
            sendJson(res, got.status || 502, { error: got.error });
            return;
          }
          if (wantsReport) {
            const cur = got.cur || {};
            const oldMd = String(cur.report_md || "");
            if (oldMd === reportMd) {
              // 正文没变（可能只是同一次提交里带了基础信息），不记修订次数
              delete body.fields;
            } else {
              patch.report_md = reportMd;
              patch.report_rev =
                (Number.isFinite(Number(cur.report_rev)) ? Math.trunc(Number(cur.report_rev)) : 0) + 1;
              patch.report_edited_at = new Date().toISOString();
              patch.report_edited_by = "管理员";
              /* 首次编辑才存快照。只存一次，之后即使再改也不再覆盖——
                 否则「模型原始输出」会被中间某次人工版本顶掉，就没法追溯了。 */
              if (!cur.report_orig && oldMd) patch.report_orig = oldMd;
            }
            if (!Object.keys(patch).length) {
              sendJson(res, 400, { error: "no_editable_field" });
              return;
            }
          }

          return pgRequest("PATCH", "id=eq." + id, patch, {
            Prefer: "return=representation",
          }).then(function (r) {
            if (!r.ok) {
              sendJson(res, 502, { error: "db_write_failed", status: r.status });
              return;
            }
            const row = Array.isArray(r.data) ? r.data[0] : null;
            if (!row) {
              sendJson(res, 404, { error: "not_found" });
              return;
            }
            sendJson(res, 200, {
              ok: true,
              id: id,
              fields: patch,
              /* 回传完整行，前端可直接刷新详情，不必再查一次 */
              row: row,
              /* 正文改过就提示重出图/重发信，否则同事看到的还是旧内容 */
              reportEdited: !!patch.report_md,
              /* 主题里嵌了后线对接人姓名，改完要提示用户主题会跟着变 */
              subjectHint: buildMailSubject(row.backend_owner_name, row.topic),
            });
          });
        });
        return;
      }

      /* ── 删除（清理误提交 / 测试记录）── */
      if (action === "delete") {
        const id = Math.trunc(Number(body.id) || 0);
        if (!id) {
          sendJson(res, 400, { error: "missing_id" });
          return;
        }
        pgRequest("DELETE", "id=eq." + id, null).then(function (r) {
          if (!r.ok) {
            sendJson(res, 502, { error: "db_delete_failed", status: r.status });
            return;
          }
          sendJson(res, 200, { ok: true });
        });
        return;
      }

      /* ── 重跑打标 ──
         两个用途：① 迁移后给历史数据补标；② 换模型/改词表后重打一遍。
         单条（传 id）或批量（force=true 时扫 tags_at IS NULL 的，限量）。
         这属于「派生数据」而非归档原始凭证，所以允许被覆盖——
         但仍只写 ai_topic / tags / tags_model / tags_at 四列，不碰 topic。 */
      if (action === "retag") {
        const apiKey = env("DEEPSEEK_API_KEY", "");
        if (!apiKey) {
          sendJson(res, 500, { error: "server_not_configured" });
          return;
        }
        const id = Math.trunc(Number(body.id) || 0);
        const force = body.force === true;
        const limit = Math.min(50, Math.max(1, Math.trunc(Number(body.limit) || 10)));

        const query = id
          ? "id=eq." + id + "&limit=1"
          : (force
              ? "select=id,report_md,topic,interviewee_position&order=id.desc&limit=" + limit
              : "select=id,report_md,topic,interviewee_position&tags_at=is.null&order=id.desc&limit=" + limit);

        pgRequest("GET", query, null).then(function (r) {
          if (!r.ok) {
            sendJson(res, 502, { error: "db_read_failed", status: r.status });
            return;
          }
          const rows = Array.isArray(r.data) ? r.data : [];
          if (!rows.length) {
            sendJson(res, 200, { ok: true, retagged: 0, results: [] });
            return;
          }
          /* 串行跑：并发打标会同时占多个 DeepSeek 连接，
             云函数实例只有 256MB，且没必要抢。 */
          let done = 0;
          const results = [];
          const next = function (i) {
            if (i >= rows.length) {
              sendJson(res, 200, {
                ok: true,
                retagged: done,
                total: rows.length,
                results: results,
              });
              return;
            }
            const row = rows[i];
            if (!row.report_md) { next(i + 1); return; }
            tagger
              .tagReport(row.report_md, {
                topic: row.topic,
                position: row.interviewee_position,
              }, { apiKey: apiKey })
              .then(function (out) {
                const patch = {
                  tags_model: out.tags_model,
                  tags_at: new Date().toISOString(),
                };
                if (out.ai_topic) patch.ai_topic = out.ai_topic;
                if (out.tags && out.tags.length) patch.tags = out.tags;
                return pgRequest("PATCH", "id=eq." + row.id, patch).then(function (w) {
                  if (w.ok) {
                    done++;
                    results.push({
                      id: row.id,
                      ai_topic: out.ai_topic,
                      tags: out.tags,
                      topic_original: row.topic,
                    });
                  } else {
                    results.push({ id: row.id, error: "write_failed_" + w.status });
                  }
                });
              })
              .catch(function (e) {
                results.push({ id: row.id, error: String(e && e.message || e) });
              })
              .then(function () { next(i + 1); });
          };
          next(0);
        });
        return;
      }

      /* ── 知识库分类：动作阶段（客户旅程八阶段）+ 场景 ──
         起因：原先卡片按「报告主题」归并，一份报告只要求标题带"棱镜"，
         它下面所有做法就被塞进棱镜组。实测 69 张卡仅 11 张能自证归属。
         改法：一次调用同时判 stage + scene，结果落 kb_stages（与卡片下标对齐）。

         与 retag 同一套模式：派生数据、可覆盖、kb_stages_at IS NULL 筛选补跑。
         ★ 小批量：一份报告串行调一次模型，云函数硬超时 60s —— limit 默认 3，分轮跑。 */
      if (action === "kb_stage") {
        const apiKey = env("DEEPSEEK_API_KEY", "");
        if (!apiKey) {
          sendJson(res, 500, { error: "server_not_configured" });
          return;
        }
        const id = Math.trunc(Number(body.id) || 0);
        const force = body.force === true;
        const limit = Math.min(20, Math.max(1, Math.trunc(Number(body.limit) || 3)));

        const COLS = "select=id,report_md,topic";
        const query = id
          ? COLS + "&id=eq." + id + "&limit=1"
          : (force
              ? COLS + "&order=id.asc&limit=" + limit
              : COLS + "&kb_stages_at=is.null&order=id.asc&limit=" + limit);

        pgRequest("GET", query, null).then(function (r) {
          if (!r.ok) {
            sendJson(res, 502, { error: "db_read_failed", status: r.status });
            return;
          }
          const rows = Array.isArray(r.data) ? r.data : [];
          if (!rows.length) {
            sendJson(res, 200, { ok: true, staged: 0, results: [] });
            return;
          }

          /* ── 探针模式：只调模型、看 finish_reason/usage，**不写任何库** ──
             分类失败有三种成因（推理吃光预算 / 没按格式输出 / 锚不上），
             靠业务层那一句错误分不清。探针把区别摆出来，是排障的第一个取证物。
             用法：{"action":"kb_stage","id":5,"probe":true,"maxTokens":4000} */
          if (body.probe === true) {
            const probeRow = rows[0];
            const probeCards = kb.buildKb([probeRow], {}).cards;
            /* ★ 别写 Math.max(256, Number(x)||0)：没有 maxTokens 时它会把「未指定」
               夹成 256，探针就成了「永远撞 length」。未指定就该原样交给默认值。 */
            const wantTok = Math.trunc(Number(body.maxTokens) || 0);
            const budget = wantTok > 0 ? Math.min(32000, Math.max(256, wantTok)) : 0;
            kbStage
              .probeCards(probeCards, { topic: probeRow.topic },
                { apiKey: apiKey, maxTokens: budget })
              .then(function (p) { sendJson(res, 200, { ok: true, id: probeRow.id, probe: p }); })
              .catch(function (e) {
                sendJson(res, 500, { error: String((e && e.message) || e).slice(0, 200) });
              });
            return;
          }
          /* 串行跑：并发会同时占多个 DeepSeek 连接，且 256MB 实例没必要抢 */
          let done = 0;
          const results = [];
          const next = function (i) {
            if (i >= rows.length) {
              sendJson(res, 200, { ok: true, staged: done, total: rows.length, results: results });
              return;
            }
            const row = rows[i];
            const cards = kb.buildKb([row], {}).cards;

            /* 没有可分类的卡片（报告里一条做法都没抽出来）：
               直接标成已分类但空数组，免得每轮都被 kb_stages_at IS NULL 再捞一遍。 */
            const stamp = new Date().toISOString();
            if (!cards.length) {
              pgRequest("PATCH", "id=eq." + row.id,
                { kb_stages: [], kb_stages_at: stamp }).then(function () {
                results.push({ id: row.id, cards: 0, note: "no_cards" });
                next(i + 1);
              });
              return;
            }

            kbStage
              .classifyCards(cards, { topic: row.topic }, { apiKey: apiKey, retries: 0 })
              .then(function (out) {
                /* 一条都没对上 = 模型没按格式输出，当成失败，不写库（下轮会重试） */
                if (out.parse_failed) throw new Error("stage_parse_failed");
                return pgRequest("PATCH", "id=eq." + row.id, {
                  kb_stages: out.labels,
                  kb_stages_at: new Date().toISOString(),
                  kb_stages_model: out.stages_model,
                }).then(function (w) {
                  if (w.ok) {
                    done++;
                    results.push({
                      id: row.id,
                      cards: cards.length,
                      matched: out.matched,
                      dropped: out.dropped,
                      anchored: out.anchored,
                      positional: out.positional,
                      stages: out.labels.map(function (x) { return x ? x.stage : null; }),
                      scenes: out.labels.map(function (x) { return x ? (x.scene || "通用") : null; }),
                    });
                  } else {
                    results.push({ id: row.id, error: "write_failed_" + w.status });
                  }
                });
              })
              .catch(function (e) {
                results.push({ id: row.id, error: String((e && e.message) || e) });
              })
              .then(function () { next(i + 1); });
          };
          next(0);
        });
        return;
      }

      /* ── AI 辅助修改报告（生成补丁，不写库）──
         人话说的「把结果节的 30% 改成 32%」「补一句这客户是老客户转介绍」，
         由模型翻译成结构化补丁回给前端。这里**刻意不写库**：
         真正的落地仍然走上面的 action:'update' + fields:{report_md}——
         那条路径自带 report_orig 首次快照、report_rev 累加、分隔符 ≥5 的服务端校验。
         在这里再开一个写入口，等于给「AI 改过的正文」留一条绕开留痕的暗道。

         正文从库里读，不采信前端传的 report_md：前端手里那份可能还是旧版本，
         拿它做定位基准会让补丁对不上原文。 */
      if (action === "ai_edit") {
        const apiKey = env("DEEPSEEK_API_KEY", "");
        if (!apiKey) {
          sendJson(res, 500, { error: "server_not_configured" });
          return;
        }
        const id = Math.trunc(Number(body.id) || 0);
        if (!id) {
          sendJson(res, 400, { error: "missing_id" });
          return;
        }

        const mode = asText(body.mode, 20) === "section" ? "section" : "patch";
        const instruction = asText(body.instruction, 4000);
        if (!instruction) {
          sendJson(res, 400, { error: "instruction_required" });
          return;
        }

        const targets = Array.isArray(body.targets)
          ? body.targets
              .map(function (n) { return Math.trunc(Number(n) || 0); })
              .filter(function (n) { return n > 0; })
          : [];
        if (mode === "section" && !targets.length) {
          sendJson(res, 400, { error: "targets_required" });
          return;
        }

        /* 前几轮对话只作语境，截断到最近 8 条、每条 800 字，
           防止历史累积把 prompt 撑到影响补丁预算。 */
        const history = Array.isArray(body.history)
          ? body.history.slice(-8).map(function (h) {
              return {
                role: h && h.role === "assistant" ? "assistant" : "user",
                content: asText(h && h.content, 800),
              };
            })
          : [];

        pgRequest("GET", "id=eq." + id + "&limit=1&select=report_md", null).then(function (r) {
          if (!r.ok) {
            sendJson(res, 502, { error: "db_read_failed", status: r.status });
            return;
          }
          const cur = Array.isArray(r.data) ? r.data[0] : null;
          if (!cur) {
            sendJson(res, 404, { error: "not_found" });
            return;
          }

          return aiEditor
            .editReport({
              apiKey: apiKey,
              reportMd: cur.report_md,
              instruction: instruction,
              mode: mode,
              targets: targets,
              history: history,
            })
            .then(function (out) {
              sendJson(res, 200, Object.assign({ ok: true, id: id, instruction: instruction }, out));
            })
            .catch(function (e) {
              const msg = String((e && e.message) || e);
              /* 「没有需要改的地方」和「输出不是合法 JSON」都当**正常结果**回 200：
                 前端要把这句话显示给操作的人看，让人知道模型这次为什么空手而归。
                 其余（没配 Key、上游超时、网络抖动）才是真失败，如实报错。 */
              if (msg === "ai_edit_no_change" || msg === "ai_edit_unparsable_output") {
                sendJson(res, 200, {
                  ok: true,
                  id: id,
                  instruction: instruction,
                  mode: mode,
                  ops: [],
                  sections: [],
                  unclear: [],
                  note: msg === "ai_edit_no_change"
                    ? "按这条要求，模型认为没有需要改动的地方。"
                    : "模型这次的输出不是合法 JSON，没能解析。可以换个说法再试一次。",
                });
                return;
              }
              sendJson(res, 502, { error: "ai_edit_failed", detail: msg.slice(0, 300) });
            });
        });
        return;
      }

      sendJson(res, 400, { error: "unknown_action" });
    })
    .catch(function () {
      sendJson(res, 400, { error: "read_body_failed" });
    });
}

/* ─────────────────────────── 邮件发送 ─────────────────────────── */

/**
 * 只允许「业务管理人员本人」触发的接口，用 ADMIN_PASSWORD 派生的 token 鉴权。
 * 单独建一个小函数而不是复用 verifyToken，是为了把语义说清楚：
 * 这两个接口的信任边界一样（都是内部人员操作），但用途不同，
 * 将来要换成别的口令或加 IP 白名单时能各改各的。
 */
function verifyAdminToken(token, exp) {
  return verifyToken(token, exp);
}

/**
 * 主题格式固定为「访谈报告【后线对接人姓名】访谈主题」。
 * 后线对接人姓名可能带空格或空值，统一收敛成干净的方括号内容；
 * 姓名缺失时退化为「访谈报告：主题」，避免出现「【】」这种空洞。
 */
function buildMailSubject(owner, topic) {
  const o = asText(owner, 40).replace(/[【】\s]/g, "");
  const t = asText(topic, 120) || "未命名主题";
  return o ? "访谈报告【" + o + "】" + t : "访谈报告：" + t;
}

function buildPlainBody(row) {
  const lines = [];
  lines.push("案例经验报告");
  lines.push("访谈对象：" + (row.interviewee_name || "—") +
    (row.interviewee_position ? "（" + row.interviewee_position + "）" : ""));
  if (row.interviewee_um) lines.push("UM 号：" + row.interviewee_um);
  lines.push("所属城市：" + (row.city || "—"));
  lines.push("案例主题：" + (row.topic || "—"));
  if (row.backend_owner_name) {
    lines.push("后线对接人：" + row.backend_owner_name +
      (row.backend_owner_org ? "（" + row.backend_owner_org + "）" : ""));
  }
  if (row.created_at) lines.push("归档时间：" + row.created_at);
  lines.push("");
  lines.push("附件为两张图：");
  lines.push("  1. 经验一图流（简略版）—— 早会投屏讲一页");
  lines.push("  2. 完整报告（详细版）—— 六节全文不截断，供存档、转发、事后查阅");
  lines.push("");
  lines.push("────────── 报告全文（文字版，便于复制编辑）──────────");
  lines.push("");
  lines.push(row.report_md || "（报告内容为空）");
  return lines.join("\n");
}

/**
 * 把六节报告整理成便于二次编辑的纯文本。
 * 与邮件正文不同：正文是内联在邮件里的，这里是要落成 .txt 附件的，
 * 所以带上编号与分隔线，复制到 Word / 微信里结构不会散。
 */
const SECTION_TITLES = [
  "背景与挑战",
  "核心做法",
  "关键判断与取舍",
  "结果",
  "可复制的经验点",
  "新人容易踩的坑",
];

function buildReportTxt(row) {
  const parts = String(row.report_md || "").split("---SECTION---");
  const lines = [];
  lines.push("案例经验报告");
  lines.push("=".repeat(40));
  lines.push("访谈对象：" + (row.interviewee_name || "—") +
    (row.interviewee_position ? "（" + row.interviewee_position + "）" : ""));
  if (row.interviewee_um) lines.push("UM 号：" + row.interviewee_um);
  lines.push("所属城市：" + (row.city || "—"));
  lines.push("案例主题：" + (row.topic || "—"));
  if (row.backend_owner_name) {
    lines.push("后线对接人：" + row.backend_owner_name +
      (row.backend_owner_org ? "（" + row.backend_owner_org + "）" : ""));
  }
  if (row.created_at) lines.push("归档时间：" + row.created_at);
  lines.push("");
  SECTION_TITLES.forEach(function (title, i) {
    let body = String(parts[i] || "").replace(/\r/g, "").trim();
    // 剥掉正文首行复述的标题
    const first = body.split("\n")[0] || "";
    if (first.replace(/[\s*_【】#]/g, "").replace(/^\d+[.、）)]/, "") === title.replace(/[\s]/g, "")) {
      body = body.slice(first.length).trim();
    }
    lines.push((i + 1) + ". " + title);
    lines.push("-".repeat(40));
    lines.push(body || "（本节内容为空）");
    lines.push("");
  });
  lines.push("=".repeat(40));
  lines.push("本报告由 AI 案例访谈助手根据访谈对话整理，已做个人信息脱敏处理。");
  return lines.join("\r\n");
}

/**
 * 文件名里不能出现路径分隔符和通配符，否则某些邮件客户端保存时会失败。
 * 统一把非法字符换掉，再把长度收在 60 字以内。
 */
function safeFilename(s, fallback) {
  const t = String(s || "")
    .replace(/[\\/:*?"<>|\r\n\t]/g, "")
    .replace(/\s+/g, "")
    .trim();
  return (t || fallback || "报告").slice(0, 60);
}

/**
 * 把归档行映射成海报模板要的紧凑 meta（短键名）。
 * 手动发送与提交自动发送两条路径共用，避免字段口径漂移。
 */
function buildMailMeta(row) {
  return {
    name: row.interviewee_name || "—",
    position: row.interviewee_position || "",
    um: row.interviewee_um || "",
    city: row.city || "",
    topic: row.topic || "",
    owner: row.backend_owner_name || "",
    ownerOrg: row.backend_owner_org || "",
    /* 档案编号：IV-<归档年份>-<四位 id>，海报页眉展示用 */
    code: "IV-" +
      String(row.created_at ? String(row.created_at).slice(0, 4) : new Date().getFullYear()) +
      "-" + String(row.id).padStart(4, "0"),
    date: row.created_at
      ? String(row.created_at).slice(0, 10)
      : new Date().toISOString().slice(0, 10),
  };
}

/**
 * 由一行归档数据组出邮件所需的一切，并真正发出去。
 * 自动触发（提交后）与手动发送（管理页）共用这一个入口。
 *
 *   row                          归档行（必含 report_md）
 *   opts.posterPngBase64         可选。浏览器栅格化好的「一图流」PNG（简略版）
 *   opts.fullPngBase64           可选。浏览器栅格化好的「完整报告」PNG（详细版）
 *   opts.skipIfSent              true 时若 row.mail_sent_at 非空则跳过发送
 *
 * 返回 { sent:false, skipped:"already_sent" } 或
 *      { sent:true, subject, to, attachments:[{filename,size}] }
 *
 * 附件固定是两张图（简略一图流 + 完整报告）。报告全文以文字形式
 * 放在邮件正文里（下方 buildPlainBody），复制编辑不受影响。
 *
 * 收件人永远取自服务端环境变量（见 mailer.js），不接受调用方传入。
 */
function sendReportMailById(row, opts) {
  const o = opts || {};
  if (!row || !row.report_md) {
    return Promise.reject(new Error("empty_report"));
  }

  // 幂等：手动补发时若已发过就不重复发（由调用方决定是否开这个开关）
  if (o.skipIfSent && row.mail_sent_at) {
    return Promise.resolve({ sent: false, skipped: "already_sent", mailSentAt: row.mail_sent_at });
  }

  const meta = buildMailMeta(row);

  const subject = buildMailSubject(row.backend_owner_name, row.topic);
  const fileBase = safeFilename(
    (row.interviewee_name || "报告") + "-" + meta.date.replace(/-/g, ""),
    "报告"
  );

  const attachments = [];

  // 附件 1：经验一图流（简略版，浏览器栅格化；失败时降级为纯 HTML 邮件）
  const png = asText(o.posterPngBase64, 4000000);
  if (png) {
    attachments.push({
      filename: safeFilename("经验一图流-" + fileBase) + ".png",
      contentType: "image/png",
      content: Buffer.from(png.replace(/^data:image\/png;base64,/, ""), "base64"),
    });
  }

  // 附件 2：完整报告（详细版长图，全文不截断）
  const fullPng = asText(o.fullPngBase64, 4000000);
  if (fullPng) {
    attachments.push({
      filename: safeFilename("完整报告-" + fileBase) + ".png",
      contentType: "image/png",
      content: Buffer.from(fullPng.replace(/^data:image\/png;base64,/, ""), "base64"),
    });
  }

  return sendReportMail({
    subject: subject,
    text: buildPlainBody(row),
    html: poster.renderPosterEmail(row.report_md, meta),
    fromName: "访谈报告",
    attachments: attachments,
  }).then(function (r) {
    const sentAt = new Date().toISOString();
    // 回写发送时间；失败不影响已发出的邮件，只是管理页看不到「已发送」标记
    const mark = row.id
      ? pgRequest("PATCH", "id=eq." + row.id, { mail_sent_at: sentAt }).catch(function () {})
      : Promise.resolve();
    return mark.then(function () {
      return {
        sent: true,
        id: row.id || null,
        subject: subject,
        to: r.to,
        response: r.response,
        mailSentAt: sentAt,
        attachments: attachments.map(function (a) {
          return { filename: a.filename, size: a.content.length };
        }),
      };
    });
  });
}

/**
 * POST /api/mail
 *
 * 入参：
 *   token, exp                管理端登录拿到的 token（必须）
 *   id                        归档记录 id；给了就从 PG 读全文（推荐）
 *   report_md / 其余元数据      没有 id 时可用前端上传的原文（归档前的即时发送）
 *   poster_png_base64         可选。前端在浏览器里栅格化好的横版 PNG
 *   want_html                 true 时只返回海报 markup，不发信
 *   skip_if_sent              可选。true 时已发过就不再发（默认 false，允许重发）
 *
 * 出参：{ ok, subject, to, cc, attachments, response }
 *
 * 注意：收件人永远取自服务端环境变量，请求体里的 to / cc / bcc 一律忽略。
 */
function handleMail(req, res) {
  readRawBody(req)
    .then(function (raw) {
      let body;
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch (e) {
        sendJson(res, 400, { error: "invalid_json_body" });
        return;
      }

      if (!verifyAdminToken(body.token, body.exp)) {
        sendJson(res, 401, { error: "unauthorized" });
        return;
      }

      const id = Math.trunc(Number(body.id) || 0);

      /* ── 预览模式：只返回海报 markup，不发信。
             客户端拿它在浏览器里栅格化成 PNG，再带上 poster_png_base64 调一次 ── */
      if (body.want_html === true) {
        if (!id) {
          sendJson(res, 400, { error: "id_required" });
          return;
        }
        pgRequest("GET", "id=eq." + id + "&limit=1", null).then(function (r) {
          if (!r.ok) {
            sendJson(res, 502, { error: "db_read_failed", status: r.status });
            return;
          }
          const row = Array.isArray(r.data) ? r.data[0] : null;
          if (!row) {
            sendJson(res, 404, { error: "not_found" });
            return;
          }
          if (!row.report_md) {
            sendJson(res, 400, { error: "empty_report" });
            return;
          }
          const meta = buildMailMeta(row);
          sendJson(res, 200, poster.buildPreviewPayload(row.report_md, meta, body.kind));
        }).catch(function (e) {
          sendJson(res, 502, { error: "mail_failed", detail: String(e && e.message || e) });
        });
        return;
      }

      const proceed = id
        ? pgRequest("GET", "id=eq." + id + "&limit=1", null).then(function (r) {
            if (!r.ok) return { error: "db_read_failed", status: r.status };
            const row = Array.isArray(r.data) ? r.data[0] : null;
            if (!row) return { error: "not_found", status: 404 };
            return { row: row };
          })
        : Promise.resolve({
            row: {
              interviewee_name: asText(body.interviewee_name, 40),
              interviewee_position: asText(body.interviewee_position, 60),
              interviewee_um: asText(body.interviewee_um, 40),
              city: asText(body.city, 40),
              topic: asText(body.topic, 120),
              backend_owner_name: asText(body.backend_owner_name, 40),
              backend_owner_org: asText(body.backend_owner_org, 80),
              report_md: asText(body.report_md, 60000),
              created_at: null,
            },
          });

      proceed
        .then(function (got) {
          if (got.error) {
            sendJson(res, got.status || 502, { error: got.error });
            return;
          }
          if (!got.row.report_md) {
            sendJson(res, 400, { error: "empty_report" });
            return;
          }

          return sendReportMailById(got.row, {
            posterPngBase64: body.poster_png_base64,
            fullPngBase64: body.full_png_base64,
            skipIfSent: body.skip_if_sent === true,
          }).then(function (out) {
            if (!out.sent) {
              sendJson(res, 200, {
                ok: true,
                id: id || null,
                skipped: out.skipped,
                mail_sent_at: out.mailSentAt || null,
              });
              return;
            }
            sendJson(res, 200, {
              ok: true,
              id: out.id,
              subject: out.subject,
              to: out.to,
              mail_sent_at: out.mailSentAt,
              response: out.response,
              attachments: out.attachments,
            });
          });
        })
        .catch(function (e) {
          // 邮件发不出去不该让整个流程报 500：把原因原样带回去便于排查
          sendJson(res, 502, { error: "mail_failed", detail: String(e && e.message || e) });
        });
    })
    .catch(function () {
      sendJson(res, 400, { error: "read_body_failed" });
    });
}

/**
 * POST /api/poster
 *
 * 只排版、不发信、不落库。给访谈页在「提交归档」时用：
 * 浏览器拿这里返回的海报 markup 自己栅格化成 PNG，随提交一起上传，
 * 服务端自动发信时就能带上图（云函数内存 256MB，自己渲染不了）。
 *
 * 入参：{ report_md, meta:{ name, position, um, city, topic, owner, ownerOrg, code, date } }
 * 出参：{ ok, html, css, w, h }
 *
 * 与 /api/mail 的区别：不需要管理端 token（归档前的页面本来就没有），
 * 但也不做任何有副作用的动作——纯函数式渲染，不读库、不发信。
 */
function handlePoster(req, res) {
  readRawBody(req)
    .then(function (raw) {
      let body;
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch (e) {
        sendJson(res, 400, { error: "invalid_json_body" });
        return;
      }

      const reportMd = asText(body.report_md, 60000);
      if (!reportMd) {
        sendJson(res, 400, { error: "empty_report" });
        return;
      }

      const m = body.meta && typeof body.meta === "object" ? body.meta : {};
      const meta = {
        name: asText(m.name, 40) || "—",
        position: asText(m.position, 60),
        um: asText(m.um, 40),
        city: asText(m.city, 40),
        topic: asText(m.topic, 120),
        owner: asText(m.owner, 40),
        ownerOrg: asText(m.ownerOrg, 80),
        code: asText(m.code, 40),
        date: asText(m.date, 20) || new Date().toISOString().slice(0, 10),
      };

      sendJson(res, 200, poster.buildPreviewPayload(reportMd, meta, body.kind));
    })
    .catch(function () {
      sendJson(res, 400, { error: "read_body_failed" });
    });
}

/* ─────────────────── 语音识别（一句话识别） ───────────────────
   访谈打字费劲，前端录一段话（≤60s）传上来转文字，再填进输入框。
   密钥走环境变量（子账号密钥，只挂 QcloudASRFullAccess）；
   未配置时回 503 + 人话提示，而不是 500——好让前端能优雅降级回打字。
   计费：一句话识别每月 5000 次免费额度、优先扣减，后付费默认关闭。 */
function handleAsr(req, res) {
  if (!asr.asrConfigured()) {
    sendJson(res, 503, {
      error: "asr_not_configured",
      detail: "语音识别尚未配置，请先打字。管理员需为云函数配置 TENCENT_SECRET_ID / TENCENT_SECRET_KEY。",
    });
    return;
  }

  readRawBody(req)
    .then(function (raw) {
      let body;
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch (e) {
        sendJson(res, 400, { error: "invalid_json_body" });
        return;
      }

      if (!body.audio_base64) {
        sendJson(res, 400, { error: "asr_empty_audio" });
        return;
      }

      return asr
        .recognize({
          audioBase64: body.audio_base64,
          format: asText(body.format, 20) || "wav",
          durationMs: Number(body.duration_ms) || 0,
          sampleRate: Number(body.sample_rate) || 0,
        })
        .then(function (r) {
          if (!r.ok) {
            // 参数类问题回 400（前端可提示重录），其余回 502（服务侧问题）
            const clientErr = ["asr_empty_audio", "asr_audio_too_large", "asr_audio_too_long"].indexOf(r.error) >= 0;
            sendJson(res, clientErr ? 400 : 502, { error: r.error, detail: r.detail || "" });
            return;
          }
          sendJson(res, 200, {
            ok: true,
            text: r.text,
            duration: r.duration,
            request_id: r.requestId,
          });
        });
    })
    .catch(function (e) {
      const msg = e && e.message ? e.message : "";
      if (msg === "body_too_large") {
        sendJson(res, 413, { error: "body_too_large", detail: "录音数据超过上限，请缩短时长" });
        return;
      }
      sendJson(res, 400, { error: "read_body_failed", detail: msg });
    });
}

/* ── 知识库聚合（GET，只读，无鉴权）─────────────────────────
   把已归档报告解析成「主题 → 做法卡片」两层，给 kb.html 用。

   ★ 实时聚合、不落库：新报告一归档就自动出现在知识库里，没有同步逻辑要维护。

   ★ 脱敏是这一层的核心职责（知识库面向一线全员、无口令）：
     · SELECT 只取白名单列 —— 绝不碰 transcript（用户原始输入，含小区名/单位名）
       与 um / city / submitter_name；
     · interviewee_name / backend_owner_name 取出来**只用于替换**（报告正文里写
       原话会带归属标注「（某顾问）」），进 kb.buildKb 当 maskWords，不进任何字段。
   改动这里时请连带跑 tests/verify-kb.js 的脱敏反向断言。 */
let kbCache = { at: 0, data: null };
const KB_CACHE_MS = 60 * 1000;

function handleKb(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }
  const now = Date.now();
  if (kbCache.data && now - kbCache.at < KB_CACHE_MS) {
    sendJson(res, 200, kbCache.data);
    return;
  }
  pgRequest(
    "GET",
    /* ★ 白名单列：绝不碰 transcript / interviewee_um / city / submitter_name / backend_owner_org。
       interviewee_name / backend_owner_name 只取出当 maskWords（报告原话里带归属标注要替换掉），
       不随卡片下发（kb.js 的 scrubDeep 会在输出前把它们抹成「该顾问」）。
       kb_stages 是派生分类（与卡片下标对齐的 [{stage,scene}]），非敏感，可下发。 */
    "select=id,created_at,topic,round_count,report_md,interviewee_name,backend_owner_name,kb_stages" +
      "&order=id.asc&limit=500",
    null
  )
    .then(function (r) {
      if (!r.ok) {
        sendJson(res, 502, { error: "db_read_failed", status: r.status });
        return;
      }
      const rows = Array.isArray(r.data) ? r.data : [];
      const maskWords = [];
      rows.forEach(function (x) {
        const n = asText(x.interviewee_name, 40);
        const o = asText(x.backend_owner_name, 40);
        if (n && maskWords.indexOf(n) === -1) maskWords.push(n);
        if (o && maskWords.indexOf(o) === -1) maskWords.push(o);
      });
      const payload = kb.buildKb(rows, { maskWords: maskWords });
      kbCache = { at: now, data: payload };
      sendJson(res, 200, payload);
    })
    .catch(function (e) {
      sendJson(res, 502, { error: "kb_failed", detail: String((e && e.message) || e).slice(0, 200) });
    });
}

/* ─────────────────────────── 路由 ─────────────────────────── */

const server = http.createServer(function (req, res) {
  if (req.method === "OPTIONS") {
    // 预检直接 204 返回，CORS 头由网关注入（见 OWN_HEADERS 注释）
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || "/", "http://127.0.0.1");
  const path = url.pathname;

  if (req.method === "GET" && (path === "/health" || path === "/")) {
    sendJson(res, 200, { ok: true, service: "interview-proxy" });
    return;
  }

  /* 知识库：GET /api/kb（无鉴权，只读，服务端已硬脱敏） */
  if (path === "/api/kb" || path === "/kb") {
    handleKb(req, res);
    return;
  }

  if (req.method === "POST") {
    // "/" 来自网关剥掉前缀后的 /api/chat 路由
    if (path === "/" || path === "/api/chat" || path === "/chat") {
      handleChat(req, res);
      return;
    }
    if (path === "/api/submit") {
      handleSubmit(req, res);
      return;
    }
    if (path === "/api/admin") {
      handleAdmin(req, res);
      return;
    }
    if (path === "/api/mail") {
      handleMail(req, res);
      return;
    }
    if (path === "/api/poster") {
      handlePoster(req, res);
      return;
    }
    if (path === "/api/asr") {
      handleAsr(req, res);
      return;
    }
  }

  if (
    path === "/" ||
    path === "/api/chat" ||
    path === "/api/submit" ||
    path === "/api/admin" ||
    path === "/api/mail" ||
    path === "/api/poster" ||
    path === "/api/asr" ||
    path === "/api/kb"
  ) {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  sendJson(res, 404, { error: "not_found" });
});

server.listen(9000);
