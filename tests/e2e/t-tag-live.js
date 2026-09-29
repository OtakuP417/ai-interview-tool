/* 用真实报告正文跑打标，看实际效果。
   走线上 /api/chat 转发（云函数持有 Key，本地不需要配）——
   与生产环境同一条 DeepSeek 通道，只是模型调用绕了一层。

   注意：这验证的是「提示词 + 规整逻辑」的效果，
   与 tagger.js 里 callDeepseek 的实际代码路径不同（那边是直连），
   所以最终还要靠部署后的 retag 端到端再确认一次。

   用法：node tests/e2e/out/t-tag-live.js [报告id ...]
   不给 id 就打前 4 份。产出 tests/e2e/out/tag-live-result.json
*/
const fs = require("fs");
const path = require("path");
const http = require("http");
const tagger = require(path.join(__dirname, "..", "..", "cloudfunctions/interview-proxy", "tagger.js"));

const HOST = "work-d1gs0jzrg2277d75e-1391683363.ap-shanghai.app.tcloudbase.com";

function chat(prompt) {
  return new Promise(function (resolve, reject) {
    const body = JSON.stringify({
      model: "deepseek-v4-flash",
      messages: [
        { role: "system", content: "你只输出严格 JSON，不写任何解释。" },
        { role: "user", content: prompt },
      ],
      stream: false,
      max_tokens: 1600,
      temperature: 0.2,
    });
    const req = http.request({
      hostname: HOST, path: "/api/chat", method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      timeout: 120000,
    }, function (res) {
      let data = "";
      res.on("data", c => (data += c));
      res.on("end", function () {
        let j;
        try { j = JSON.parse(data); } catch (e) { reject(new Error("bad json: " + data.slice(0, 200))); return; }
        const c = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
        if (typeof c !== "string") { reject(new Error("no content: " + JSON.stringify(j).slice(0, 200))); return; }
        resolve({ content: c, model: j.model || "?" });
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end(body);
  });
}

const rows = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "tmp", "full-reports.json"), "utf8"));
const wantIds = process.argv.slice(2).map(Number).filter(Boolean);
const picked = (wantIds.length ? rows.filter(r => wantIds.indexOf(Number(r.id)) >= 0) : rows.slice(0, 4))
  .filter(r => r.report_md);

console.log("样本 " + picked.length + " 份（走线上 /api/chat）\n");

(async function () {
  const out = [];
  for (const r of picked) {
    const t0 = Date.now();
    try {
      const res = await chat(tagger.buildTagPrompt(r.report_md, {
        topic: r.topic, position: r.interviewee_position,
      }));
      const norm = tagger.normalizeTagResult(tagger.parseJsonLoose(res.content));
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      console.log("── #" + r.id + " " + (r.interviewee_name || "") + " ──");
      console.log("  口述主题：" + (r.topic || "—"));
      console.log("  AI 主题：" + (norm.ai_topic || "（未产出）"));
      console.log("  标签　　：" + ((norm.tags || []).join("  |  ") || "（未产出）"));
      console.log("  理由　　：" + (norm.reason || "—"));
      console.log("  用时 " + secs + "s");
      const free = (norm.tags || []).filter(t => t.indexOf("自由:") >= 0);
      if (free.length) console.log("  ⚠ 新造词（待人工归并）：" + free.join("  |  "));
      if (!norm.ai_topic || !norm.tags) console.log("  ⚠ 有字段未产出");
      console.log("");
      out.push({ id: r.id, topic_original: r.topic, ai_topic: norm.ai_topic, tags: norm.tags, reason: norm.reason, secs: Number(secs) });
    } catch (e) {
      console.log("── #" + r.id + " 失败：" + (e && e.message) + "\n");
      out.push({ id: r.id, error: String(e && e.message) });
    }
  }
  fs.writeFileSync(path.join(__dirname, "tag-live-result.json"), JSON.stringify(out, null, 1));
  const okCount = out.filter(x => x.ai_topic && x.tags).length;
  console.log("产出完整 " + okCount + "/" + out.length + "  → tests/e2e/out/tag-live-result.json");
})();
