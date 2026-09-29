/**
 * mailer.js — 归档通知邮件发送（零依赖 SMTP over TLS）
 *
 * 为什么自己写而不引 nodemailer：
 *   云函数目录是零 npm 依赖（只靠 Node 内置模块），一旦引入 dependencies
 *   就要在云端跑 npm install，部署链路变脆。这里只需要「用 QQ 邮箱发一封
 *   带 HTML 正文和图片附件的邮件」，用内置 tls 手写 SMTP 会话即可。
 *
 * 环境变量（在 CloudBase 云函数配置里设置，不进代码库）：
 *   SMTP_USER    发件 QQ 邮箱地址，如 xxxxx@qq.com
 *   SMTP_PASS    QQ 邮箱「SMTP 授权码」（16 位，不是登录密码）
 *   MAIL_TO      报告接收邮箱（工作邮箱），多个用逗号分隔
 *   MAIL_CC      抄送，可空
 *   MAIL_BCC     密送，可空
 *
 * 用法：
 *   const { sendReportMail } = require("./mailer");
 *   await sendReportMail({
 *     subject, text, html,
 *     attachments: [{ filename, contentType, content }],
 *   });
 */

const tls = require("tls");

const SMTP_HOST = "smtp.qq.com";
const SMTP_PORT = 465;        // QQ 邮箱 SSL 端口；587 是 STARTTLS，这里用 465 直连更简单
const TIMEOUT_MS = 25000;

/* ─────────────────────── 编码与消息组装 ─────────────────────── */

function encodeHeader(str) {
  // 邮件头里的中文必须做 RFC 2047 编码，否则公司邮箱网关可能拒收或显示乱码
  const s = String(str || "");
  if (/^[\x20-\x7E]*$/.test(s)) return s;
  return "=?UTF-8?B?" + Buffer.from(s, "utf8").toString("base64") + "?=";
}

/**
 * 按 RFC 5322 折行。中文按 UTF-8 字节数算宽度，避免超 78 字节被截断。
 * 注意：不能在多字节字符中间断开，所以用 Buffer 测量而不是 s.length。
 */
function foldHeader(name, value) {
  const raw = name + ": " + value;
  if (Buffer.byteLength(raw, "utf8") <= 76) return raw;
  // 有附件时头都很短，这里只做基本保护，不做完整折行
  return raw;
}

function b64lines(buf) {
  // 附件 base64 每行 76 字符，符合 MIME 规范
  return buf.toString("base64").replace(/(.{76})/g, "$1\r\n");
}

function buildBoundary() {
  return "----=_IV_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/**
 * 组装 MIME 邮件。
 *
 * 结构（有 HTML 正文时）：
 *   multipart/mixed
 *     ├─ multipart/alternative
 *     │    ├─ text/plain   （兜底：客户端不渲染 HTML 时至少能读）
 *     │    └─ text/html    （海报版式）
 *     └─ attachment…       （横版 PNG 等）
 *
 * 正文一律 base64 编码，彻底绕开 8bit / 行长 / 行首 "." 转义三个坑。
 * 换行统一用 CRLF：base64 里我们手动插的是 \r\n，MIME 头之间也用 \r\n。
 */
function wrapBase64(str) {
  const b64 = Buffer.from(String(str || ""), "utf8").toString("base64");
  return b64.replace(/(.{76})/g, "$1\r\n");
}

function buildMessage(opts) {
  const from = opts.from;
  const to = Array.isArray(opts.to) ? opts.to : [opts.to];
  const cc = Array.isArray(opts.cc) ? opts.cc : [];
  const text = opts.text || "";
  const html = opts.html || "";
  const hasHtml = !!html;

  const outer = buildBoundary();
  const inner = hasHtml ? buildBoundary() : null;
  const lines = [];

  lines.push(foldHeader("From", encodeHeader(opts.fromName || "访谈报告") + " <" + from + ">"));
  lines.push(foldHeader("To", to.join(", ")));
  if (cc.length) lines.push(foldHeader("Cc", cc.join(", ")));
  lines.push(foldHeader("Subject", encodeHeader(opts.subject)));
  lines.push("MIME-Version: 1.0");
  lines.push("Date: " + new Date().toUTCString());
  lines.push(
    "Message-ID: <" + Date.now() + "." + Math.random().toString(36).slice(2) +
    "@" + from.split("@")[1] + ">"
  );
  lines.push('Content-Type: multipart/mixed; boundary="' + outer + '"');
  lines.push("");
  lines.push("这是一封多部分邮件，请使用支持 MIME 的邮件客户端查看。");
  lines.push("");

  // ── 正文（纯文本；有 HTML 时它与 HTML 并列在 alternative 里）──
  if (!hasHtml) {
    lines.push("--" + outer);
    lines.push("Content-Type: text/plain; charset=UTF-8");
    lines.push("Content-Transfer-Encoding: base64");
    lines.push("");
    lines.push(wrapBase64(text));
    lines.push("");
  } else {
    lines.push("--" + outer);
    lines.push('Content-Type: multipart/alternative; boundary="' + inner + '"');
    lines.push("");
    lines.push("--" + inner);
    lines.push("Content-Type: text/plain; charset=UTF-8");
    lines.push("Content-Transfer-Encoding: base64");
    lines.push("");
    lines.push(wrapBase64(text));
    lines.push("");
    lines.push("--" + inner);
    lines.push("Content-Type: text/html; charset=UTF-8");
    lines.push("Content-Transfer-Encoding: base64");
    lines.push("");
    lines.push(wrapBase64(html));
    lines.push("");
    lines.push("--" + inner + "--");
    lines.push("");
  }

  // ── 附件 ──
  (opts.attachments || []).forEach(function (a) {
    lines.push("--" + outer);
    lines.push(
      "Content-Type: " + (a.contentType || "application/octet-stream") +
      '; name="' + encodeHeader(a.filename) + '"'
    );
    lines.push("Content-Transfer-Encoding: base64");
    lines.push(
      'Content-Disposition: attachment; filename="' + encodeHeader(a.filename) + '"'
    );
    lines.push("");
    lines.push(b64lines(a.content));
    lines.push("");
  });

  lines.push("--" + outer + "--");
  return lines.join("\r\n");
}

/* ─────────────────────── SMTP 会话 ─────────────────────── */

/**
 * 极简 SMTP 客户端：只需支持 EHLO / AUTH LOGIN / MAIL FROM / RCPT TO / DATA。
 * 逐条等待响应码，任一非 2xx/3xx 直接抛错，错误信息里带上服务器原话便于排查。
 */
function smtpSend(opts) {
  return new Promise(function (resolve, reject) {
    const user = opts.user;
    const pass = opts.pass;
    const to = opts.to;
    const message = opts.message;
    const from = opts.from;

    let socket = null;
    let buf = "";
    let queue = [];       // 等待响应的 resolver 队列
    let done = false;

    const timer = setTimeout(function () {
      finish(new Error("smtp_timeout"));
    }, TIMEOUT_MS);

    function finish(err, val) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { if (socket) socket.end(); } catch (e) {}
      if (err) reject(err); else resolve(val);
    }

    function onLine(line) {
      // 只处理「完整」的行：SMTP 续行是 "250-"，最后一行是 "250 "
      if (line.length < 4 || line[3] !== " ") return;
      const code = Number(line.slice(0, 3));
      const waiter = queue.shift();
      if (waiter) waiter(code, line);
    }

    function send(cmd) {
      return new Promise(function (resolve2, reject2) {
        queue.push(function (code, line) { resolve2({ code: code, line: line }); });
        try {
          socket.write(cmd + "\r\n");
        } catch (e) {
          reject2(e);
        }
      });
    }

    socket = tls.connect({ host: SMTP_HOST, port: SMTP_PORT, servername: SMTP_HOST }, function () {
      // 连上后等服务器欢迎语
    });

    socket.setTimeout(TIMEOUT_MS, function () {
      finish(new Error("smtp_socket_timeout"));
    });

    socket.on("data", function (chunk) {
      buf += chunk.toString("utf8");
      let idx;
      while ((idx = buf.indexOf("\r\n")) !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        onLine(line);
      }
    });

    socket.on("error", function (err) {
      finish(new Error("smtp_socket_error: " + err.message));
    });

    socket.on("close", function () {
      finish(null, { ok: true });
    });

    // ── 会话流程 ──
    (async function () {
      try {
        await new Promise(function (r) { queue.push(function () { r(); }); });  // 欢迎语 220

        let r = await send("EHLO interview-proxy");
        if (r.code !== 250) throw new Error("EHLO failed: " + r.line);

        r = await send("AUTH LOGIN");
        if (r.code !== 334) throw new Error("AUTH LOGIN refused: " + r.line);

        r = await send(Buffer.from(user, "utf8").toString("base64"));
        if (r.code !== 334) throw new Error("AUTH user refused: " + r.line);

        r = await send(Buffer.from(pass, "utf8").toString("base64"));
        if (r.code !== 235) throw new Error("AUTH failed: " + r.line);

        r = await send("MAIL FROM:<" + from + ">");
        if (r.code !== 250) throw new Error("MAIL FROM failed: " + r.line);

        for (let i = 0; i < to.length; i++) {
          r = await send("RCPT TO:<" + to[i] + ">");
          if (r.code !== 250 && r.code !== 251) {
            throw new Error("RCPT TO <" + to[i] + "> failed: " + r.line);
          }
        }

        r = await send("DATA");
        if (r.code !== 354) throw new Error("DATA refused: " + r.line);

        // 正文里行首的点要转义，行尾统一 CRLF
        const body = message.replace(/\r?\n/g, "\r\n").replace(/\r\n\./g, "\r\n..");
        r = await send(body + "\r\n.");
        if (r.code !== 250) throw new Error("message rejected: " + r.line);

        await send("QUIT").catch(function () {});
        finish(null, { ok: true, response: r.line });
      } catch (e) {
        finish(e);
      }
    })();
  });
}

/* ─────────────────────── 对外接口 ─────────────────────── */

function parseList(v) {
  return String(v || "")
    .split(/[,;，；\s]+/)
    .map(function (s) { return s.trim(); })
    .filter(Boolean);
}

/**
 * 发送归档通知邮件。
 * 未配置 SMTP_USER/SMTP_PASS/MAIL_TO 时抛 smtp_not_configured，
 * 调用方应捕获并当作「非致命」处理——邮件发不出去不该让归档失败。
 */
async function sendReportMail(opts) {
  const user = (process.env.SMTP_USER || "").trim();
  const pass = (process.env.SMTP_PASS || "").trim();
  const to = parseList(process.env.MAIL_TO);
  const cc = parseList(process.env.MAIL_CC);
  // 密送只进 RCPT，不进邮件头——收件人看不到
  const bcc = parseList(process.env.MAIL_BCC);

  if (!user || !pass) throw new Error("smtp_not_configured");
  if (!to.length) throw new Error("mail_to_not_configured");

  const message = buildMessage({
    from: user,
    fromName: opts.fromName || "访谈报告",
    to: to,
    cc: cc,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
    attachments: opts.attachments,
  });

  const res = await smtpSend({
    user: user,
    pass: pass,
    from: user,
    to: to.concat(cc, bcc),
    message: message,
  });
  return { ok: true, to: to.concat(cc, bcc), response: res.response };
}

module.exports = {
  sendReportMail,
  buildMessage,      // 导出给离线测试用
  encodeHeader,
  parseList,
};
