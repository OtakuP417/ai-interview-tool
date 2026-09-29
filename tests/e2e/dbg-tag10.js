/* 诊断 #10 打标失败：把原始返回打出来看。 */
const fs = require("fs");
const path = require("path");
const http = require("http");
const tagger = require(path.join(__dirname, "..", "..", "cloudfunctions/interview-proxy", "tagger.js"));

const HOST = "work-d1gs0jzrg2277d75e-1391683363.ap-shanghai.app.tcloudbase.com";
const row = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "tmp", "full-reports.json"), "utf8"))
  .find(r => r.id === Number(process.argv[2] || 10));

const prompt = tagger.buildTagPrompt(row.report_md, { topic: row.topic, position: row.interviewee_position });
console.log("report_md 长度:", row.report_md.length, " prompt 长度:", prompt.length);

const body = JSON.stringify({
  model: "deepseek-v4-flash",
  messages: [
    { role: "system", content: "你只输出严格 JSON，不写任何解释。" },
    { role: "user", content: prompt },
  ],
  stream: false, max_tokens: 1600, temperature: 0.2,
});

const req = http.request({
  hostname: HOST, path: "/api/chat", method: "POST",
  headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
  timeout: 120000,
}, function (res) {
  let data = "";
  res.on("data", c => (data += c));
  res.on("end", function () {
    const j = JSON.parse(data);
    const ch = (j.choices || [])[0] || {};
    console.log("finish_reason:", ch.finish_reason);
    console.log("usage:", JSON.stringify(j.usage));
    const c = ch.message && ch.message.content;
    console.log("--- raw content (len " + (c ? c.length : 0) + ") ---");
    console.log(JSON.stringify(c));
    console.log("--- parsed ---");
    console.log(JSON.stringify(tagger.parseJsonLoose(c), null, 1));
    console.log("--- normalized ---");
    console.log(JSON.stringify(tagger.normalizeTagResult(tagger.parseJsonLoose(c)), null, 1));
  });
});
req.on("error", e => console.error("ERR", e.message));
req.end(body);
