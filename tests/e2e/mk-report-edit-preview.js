/* 渲染管理页详情里的「报告正文编辑」区，出图核对视觉。
   用真实线上数据（经 /api/admin 只读取出），jsdom 里跑页面的渲染函数。

   ★★★ 关键坑（本机 jsdom 的两个硬约束，踩了很久）：
   1) `runScripts:"outside-only"` 下，页面脚本里的 `let detailRow/currentId/origOpenState`
      只存在于**那一次 eval 自己**的词法作用域里。后续再 `w.eval("detailRow = ...")`
      是在另一个 eval 里赋值，页面函数读到的仍是 null —— 表现为
      `openReportEdit()` 静默早退（`if (!detailRow) return;`），rep-box 永远为空，
      而且**不抛错**，极难定位。
      ⇒ 必须把「赋值 + 调用」的桥接函数拼在**同一个 eval 的末尾**。
   2) `Element.prototype.scrollIntoView` jsdom 未实现，renderDetail/openReportEdit 末尾会调；
      3) renderDetail 第 1 行就写 `#d-title`，DOM 里缺这个节点会中途抛错。
*/
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
  const T = { token: tok.token, exp: tok.exp };

  const dClean = await post(Object.assign({ action: "detail", id: 15 }, T));
  const dEdited = await post(Object.assign({ action: "detail", id: 11 }, T));

  const dom = new JSDOM(ADM, { runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  const SRC = ADM.slice(ADM.indexOf("<script>") + 8, ADM.lastIndexOf("</script>"));

  // 桥接件必须与页面脚本在同一个 eval 里定义，才能共享词法作用域
  w.eval(SRC + "\n" + [
    'window.__setRow = function(r, openOrig){ detailRow = r; currentId = r.id; origOpenState = !!openOrig; };',
    'window.__render = function(){ renderDetail(detailRow); return document.getElementById("d-body").innerHTML; };',
    'window.__openRep = function(){ openReportEdit();',
    '  var b = document.getElementById("rep-box");',
    '  return { html: b.innerHTML, stat: (document.getElementById("rep-stat")||{}).textContent || "",',
    '           disabled: (document.getElementById("rep-save")||{}).disabled }; };',
    'window.__closeRep = function(){ closeReportEdit(); };',
  ].join("\n"));

  w.Element.prototype.scrollIntoView = function () {};

  function setupDom() {
    w.document.body.innerHTML =
      '<div id="drawer"><div id="d-title"></div><div id="d-body"></div></div><div id="d-actions"></div>';
  }

  function renderDetailOnly(row, openOrig) {
    setupDom();
    w.__setRow(row, openOrig);
    return w.__render();
  }

  const cleanHtml = renderDetailOnly(dClean.row, false);
  // #11 实际未被编辑过 → 用合成行演示留痕横幅与「查看模型原文」
  const editedRow = Object.assign({}, dEdited.row, {
    report_rev: 2,
    report_edited_at: new Date().toISOString(),
    report_edited_by: "管理员",
    report_orig: "【模型原文演示快照】\n" + String(dEdited.row.report_md || "").slice(0, 120) + "……",
  });
  const editedHtml = renderDetailOnly(editedRow, true);

  // 编辑器本体
  setupDom();
  w.__setRow(dClean.row, false);
  w.__render();
  const rep = w.__openRep();
  console.log("编辑器片段长度:", rep.html.length);
  console.log("分隔符统计行:", rep.stat);
  console.log("保存按钮 disabled?", rep.disabled);
  if (!rep.html) throw new Error("编辑器未渲染——桥接件是否与页面脚本同 eval？");

  // 顺带验一下「分隔符不足」时保存会被禁用
  const badRow = Object.assign({}, dClean.row, { report_md: "只有一节，没有分隔符" });
  setupDom();
  w.__setRow(badRow, false);
  w.__render();
  w.__openRep();
  const bad = w.__openRep(); // 再点一次会 toggle 关闭，这里重新点开
  const badCheck = (function () {
    setupDom(); w.__setRow(badRow, false); w.__render();
    return w.__openRep();
  })();
  console.log("分隔符不足时 stat:", badCheck.stat, "| disabled:", badCheck.disabled);

  function slice(html) {
    const b = html.indexOf('id="edit-box"');
    return b > 0 ? html.slice(0, b) : html;
  }

  const CSS = ADM.slice(ADM.indexOf("<style>") + 7, ADM.indexOf("</style>"));
  const out = `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}
body{background:#f5f5f7;padding:22px;margin:0;font-family:-apple-system,'PingFang SC',sans-serif}
h2{font:600 15px/1.4 sans-serif;margin:26px 0 10px;color:#1c1c1e}
.panel{background:#fff;border-radius:12px;padding:18px;max-width:900px}
</style></head><body>
<h2>① 从未编辑过的记录：只有「编辑报告正文」入口，无留痕横幅</h2>
<div class="panel">${slice(cleanHtml)}</div>
<h2>② 已被人工编辑过的记录：留痕横幅 + 可展开对照模型原文</h2>
<div class="panel">${slice(editedHtml)}</div>
<h2>③ 点开「编辑报告正文」后的编辑器（分隔符充足，可保存）</h2>
<div class="panel">${rep.html}</div>
<h2>④ 分隔符不足时：实时标红并禁用保存（防改废）</h2>
<div class="panel">${badCheck.html}</div>
</body></html>`;

  fs.writeFileSync(path.join(__dirname, "report-edit-preview.html"), out);
  console.log("wrote report-edit-preview.html", out.length, "chars");
  console.log("#15 report_rev =", dClean.row.report_rev, "| 演示行 report_rev = 2（合成）");
})();
