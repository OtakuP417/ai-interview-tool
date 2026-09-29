/* 渲染管理页列表 + 详情里的 AI 主题与标签，出图核对视觉。
   用真实线上数据（经 /api/admin 只读取出），jsdom 里跑页面的渲染函数。 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const https = require("https");

const ADM = fs.readFileSync(path.join(__dirname, "..", "..", "web", "admin.html"), "utf8");

function post(payload) {
  return new Promise((res, rej) => {
    const body = JSON.stringify(payload);
    const r = https.request({
      hostname: "work-d1gs0jzrg2277d75e-1391683363.ap-shanghai.app.tcloudbase.com",
      path: "/api/admin", method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    }, x => { let d = ""; x.on("data", c => d += c); x.on("end", () => res(JSON.parse(d))); });
    r.on("error", rej); r.end(body);
  });
}

(async function () {
  const tok = await post({ action: "login", password: process.env.ADMIN_PASSWORD || require("fs").readFileSync(require("path").join(__dirname, "..", "..", "tools", "fetch_reports.secret"), "utf8").trim() });
  const list = await post({ action: "list", pageSize: 5, token: tok.token, exp: tok.exp });
  const detail = await post({ action: "detail", id: 15, token: tok.token, exp: tok.exp });

  const dom = new JSDOM(ADM, { runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.eval(ADM.slice(ADM.indexOf("<script>") + 8, ADM.lastIndexOf("</script>")));

  /* 只取渲染函数所需的片段，构造一个最小页面 */
  const out = `<!doctype html><html><head><meta charset="utf-8">
<style>${ADM.slice(ADM.indexOf("<style>") + 7, ADM.indexOf("</style>"))}
body{background:#f5f5f7;padding:20px;margin:0}
h2{font:600 15px/1.4 -apple-system,'PingFang SC',sans-serif;margin:22px 0 10px;color:#1c1c1e}
table{border-collapse:collapse;width:100%;background:#fff;border-radius:10px;overflow:hidden}
.meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;background:#fff;padding:16px;border-radius:10px}
.meta-label{font-size:11.5px;color:#8e8e93;margin-bottom:3px}
.meta-value{font-size:13px;color:#1c1c1e;line-height:1.5}
.meta-hint{font-size:11.5px;color:#8e8e93;margin-left:6px}
</style></head><body>
<h2>① 归档列表（主题列下方新增「AI 归纳」副行）</h2>
<table><tbody id="rows"></tbody></table>
<h2>② 详情面板（口述原文 vs AI 归纳主题 + 自动标签）</h2>
<div class="meta-grid" id="detail"></div>
</body></html>`;

  /* 直接调用页面里的渲染逻辑：列表行 */
  const rowsHtml = list.rows.map((r, i) => {
    const doc = new JSDOM(`<table><tbody></tbody></table>`);
    // 用页面内定义好的 renderRows 逻辑不便隔离，这里复用同样模板
    return null;
  });

  /* 简化：直接用页面函数生成（renderRows 写 DOM，故在临时容器里调用） */
  w.document.body.innerHTML = `<table><tbody id="rows"></tbody></table>`;
  w.currentRows = list.rows;
  w.eval("renderRows(" + JSON.stringify(list.rows) + ")");
  const rowsOut = w.document.getElementById("rows").innerHTML;

  /* 详情头部：复用 renderDetail 的 meta 区块片段 */
  w.eval("detailRow = " + JSON.stringify(detail.row));
  w.eval("currentId = 15");
  w.document.body.insertAdjacentHTML("beforeend", '<div id="d-body"></div><div id="drawer"></div><div id="d-title"></div>');
  w.eval("renderDetail(detailRow)");
  const dbody = w.document.getElementById("d-body").innerHTML;
  const metaOnly = dbody.slice(0, dbody.indexOf('<div id="edit-box"'));

  const final = out.replace('<tbody id="rows"></tbody>', '<tbody id="rows">' + rowsOut + '</tbody>')
    .replace('<div class="meta-grid" id="detail"></div>', '<div class="meta-grid" id="detail">' + metaOnly + '</div>');
  fs.writeFileSync(path.join(__dirname, "tag-admin-preview.html"), final);
  console.log("wrote tag-admin-preview.html", final.length, "chars");
  console.log("rows:", list.rows.length, "| tags on #15:", (detail.row.tags || []).length);
})();
