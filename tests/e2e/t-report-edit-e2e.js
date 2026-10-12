/* 报告正文编辑：真实链路端到端验证（会真的改一条记录，随后还原）
   走一次编辑 → 校验留痕 → 再编辑一次 → 校验快照不被覆盖 → 还原。

   重点验证：
     ① 能改正文，且返回 reportEdited
     ② report_rev 累加
     ③ report_orig 存的是「编辑前的模型原文」
     ④ 二次编辑不覆盖 report_orig（这是留痕的核心）
     ⑤ 分隔符不足被拒（防改废）
     ⑥ 空正文被拒
     ⑦ transcript 仍不可改
     ⑧ 还原后与原始正文逐字一致

   ★ 两个必须注意的点：
     - 合成正文要从 ORIGINAL 里**剥掉**分隔符再截断，否则残留的 ---SECTION--- 会窜进首节；
     - report_rev / report_orig 的基线必须取「从未被编辑过」的值（report_orig 为 null 时，
       report_md 就是模型原文），不能用上一次跑测试留下的中间态当基准。
*/
const https = require("https");

const HOST = "work-d1gs0jzrg2277d75e-1391683363.ap-shanghai.app.tcloudbase.com";
const ID = 9;

function post(payload) {
  return new Promise((res, rej) => {
    const body = JSON.stringify(payload);
    const r = https.request({
      hostname: HOST, path: "/api/admin", method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      timeout: 60000,
    }, x => { let d = ""; x.on("data", c => d += c); x.on("end", () => {
      let j; try { j = JSON.parse(d); } catch (e) { rej(new Error("bad json: " + d.slice(0, 200))); return; }
      res({ status: x.statusCode, body: j });
    }); });
    r.on("timeout", () => r.destroy(new Error("timeout")));
    r.on("error", rej);
    r.end(body);
  });
}

let fail = 0;
function ok(name, cond, extra) {
  if (cond) console.log("  ✓ " + name);
  else { fail++; console.log("  ✗ " + name + (extra !== undefined ? "  → " + extra : "")); }
}

/* 合成一份合法的 6 节正文（5 个分隔符）。
   先把 ORIGINAL 里的分隔符换成换行再截断，避免把 ---SECTION--- 当普通文字抄进首节。 */
function buildValid(original, prefix) {
  const body = String(original).replace(/---SECTION---/g, "\n").replace(/\s+/g, " ").trim().slice(0, 200);
  const secs = [
    (prefix || "背景与挑战") + "\n" + body,
    "核心做法\n按步骤还原当时的动作，保留关键原话。",
    "结果与数据\n拿到可量化的结果，并给出团队参照。",
    "判断与取舍\n说清选择依据，以及被否掉的那条路为什么不行。",
    "可复用方法\n把动作抽象成别人能照做的步骤。",
    "避坑提示\n触发信号与哪些情况不适用。",
    "海报摘要\n一句话判断句。",
  ];
  return secs.join("\n---SECTION---\n");
}

(async function () {
  const tok = await post({ action: "login", password: process.env.ADMIN_PASSWORD || require("fs").readFileSync(require("path").join(__dirname, "..", "..", "tools", "fetch_reports.secret"), "utf8").trim() });
  const T = { token: tok.body.token, exp: tok.body.exp };

  const d0 = await post(Object.assign({ action: "detail", id: ID }, T));
  const row0 = d0.body.row;
  // 模型原文：有快照就用快照，没有（从未被编辑过）则当前正文即原文
  const MODEL_ORIG = row0.report_orig || row0.report_md;
  const BASE_REV = Number.isFinite(Number(row0.report_rev)) ? Math.trunc(Number(row0.report_rev)) : 0;
  const CLEAN = BASE_REV === 0;
  console.log("目标记录 #" + ID + "（" + row0.interviewee_name + "）");
  console.log("模型原文 " + MODEL_ORIG.length + " 字；基线 report_rev=" + BASE_REV +
    "，report_orig=" + (row0.report_orig ? "已有快照" : "null"));
  if (!CLEAN) console.log("（该记录此前已被编辑测试过：本轮只验证「累加 / 快照不被覆盖」这两条相对不等式）\n");
  else console.log("");

  let cleaned = false;
  try {
    console.log("[1] 护栏：不合格的提交必须被拒");
    let r = await post(Object.assign({ action: "update", id: ID, fields: { report_md: "太短了没有任何分隔符" } }, T));
    ok("分隔符不足 → 400 report_sections_invalid",
       r.status === 400 && r.body.error === "report_sections_invalid", r.status + " " + r.body.error);
    ok("拒绝信息里带当前分隔符个数", /当前只有 0 个/.test(r.body.detail || ""), r.body.detail);

    r = await post(Object.assign({ action: "update", id: ID, fields: { report_md: "" } }, T));
    ok("空正文 → 400 report_md_required",
       r.status === 400 && r.body.error === "report_md_required", r.status + " " + r.body.error);

    r = await post(Object.assign({ action: "update", id: ID, fields: { transcript: [{ role: "user", content: "HACK" }] } }, T));
    ok("transcript 仍不可改（→ no_editable_field）",
       r.status === 400 && r.body.error === "no_editable_field", r.status + " " + r.body.error);

    r = await post(Object.assign({ action: "update", id: ID, fields: { report_rev: 0, report_orig: null } }, T));
    ok("留痕字段不可由前端篡改（→ no_editable_field）",
       r.status === 400 && r.body.error === "no_editable_field", r.status + " " + r.body.error);

    console.log("\n[2] 正常编辑一次");
    const edited1 = buildValid(MODEL_ORIG, "背景与挑战\n【人工编辑测试】这是被编辑过的正文首节。");
    const secN1 = (edited1.match(/---SECTION---/g) || []).length;
    console.log("     （合成正文 " + edited1.length + " 字，分隔符 " + secN1 + " 个）");
    r = await post(Object.assign({ action: "update", id: ID, fields: { report_md: edited1 } }, T));
    ok("编辑成功", r.status === 200 && r.body.ok === true, r.status + " " + (r.body.error || r.body.detail || ""));
    if (r.status !== 200 || !r.body.row) {
      throw new Error("编辑未成功，无法继续：HTTP " + r.status + " " + JSON.stringify(r.body).slice(0, 300));
    }
    const R1 = Number(r.body.row.report_rev);
    ok("回传 reportEdited=true 提示重出图", r.body.reportEdited === true);
    ok("report_rev 递增 1（" + BASE_REV + " → " + (BASE_REV + 1) + "）", R1 === BASE_REV + 1, "实际 " + R1);
    ok("report_edited_at 已写入", !!r.body.row.report_edited_at, r.body.row.report_edited_at);
    ok("report_edited_by 已写入", !!r.body.row.report_edited_by, r.body.row.report_edited_by);
    ok("★ report_orig = 模型原文（逐字一致）",
       r.body.row.report_orig === MODEL_ORIG,
       "orig " + (r.body.row.report_orig || "").length + " vs 原 " + MODEL_ORIG.length);
    ok("report_md 已是新内容", r.body.row.report_md === edited1);
    ok("topic 未被碰（口述原文保留）", r.body.row.topic === row0.topic);

    console.log("\n[3] 再编辑一次：修订累加，但快照不被覆盖");
    const edited2 = edited1.replace("【人工编辑测试】", "【第二次编辑】");
    r = await post(Object.assign({ action: "update", id: ID, fields: { report_md: edited2 } }, T));
    ok("第二次编辑成功", r.status === 200, r.status + " " + (r.body.error || ""));
    ok("report_rev 再 +1（→ " + (BASE_REV + 2) + "）",
       r.body.row && r.body.row.report_rev === BASE_REV + 2, "实际 " + (r.body.row && r.body.row.report_rev));
    ok("★★ report_orig 仍是最初的模型原文（不被中间版本顶掉）",
       r.body.row && r.body.row.report_orig === MODEL_ORIG,
       "orig 现在是 " + String(r.body.row && r.body.row.report_orig).slice(0, 40) + "…");
    ok("正文是第二次编辑的内容", r.body.row && r.body.row.report_md === edited2);

    console.log("\n[4] 正文未变时不记修订次数");
    r = await post(Object.assign({ action: "update", id: ID, fields: { report_md: edited2, city: "西安市" } }, T));
    ok("只改城市、正文原样传回 → 次数不再涨（仍是 " + (BASE_REV + 2) + "）",
       r.status === 200 && r.body.row && r.body.row.report_rev === BASE_REV + 2,
       "实际 " + (r.body.row && r.body.row.report_rev));

    console.log("\n[5] 还原为模型原文");
    r = await post(Object.assign({ action: "update", id: ID, fields: { report_md: MODEL_ORIG } }, T));
    ok("还原成功", r.status === 200, r.status + " " + (r.body.error || r.body.detail || ""));
    ok("正文与模型原文逐字一致", r.body.row && r.body.row.report_md === MODEL_ORIG);
    ok("修订次数继续累加（留痕不因还原而抹去）",
       r.body.row && r.body.row.report_rev === BASE_REV + 3, "实际 " + (r.body.row && r.body.row.report_rev));
    cleaned = true;
  } finally {
    if (!cleaned) {
      console.log("\n!! 未能正常还原，强制回写模型原文");
      await post(Object.assign({ action: "update", id: ID, fields: { report_md: MODEL_ORIG } }, T)).catch(() => {});
    }
  }

  console.log("");
  if (fail) { console.log("FAIL: " + fail + " 项未通过"); process.exit(1); }
  console.log("全部通过（记录正文已还原；report_rev 因留痕会持续累加，属预期）");
})();
