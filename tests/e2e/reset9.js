const https = require("https");
const HOST = "work-d1gs0jzrg2277d75e-1391683363.ap-shanghai.app.tcloudbase.com";
function post(p){return new Promise((res,rej)=>{const b=JSON.stringify(p);const r=https.request({hostname:HOST,path:"/api/admin",method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(b)},timeout:60000},x=>{let d="";x.on("data",c=>d+=c);x.on("end",()=>{try{res({status:x.statusCode,body:JSON.parse(d)})}catch(e){rej(new Error(d.slice(0,200)))}})});r.on("error",rej);r.end(b)})}
(async()=>{
  const t = await post({action:"login",password:process.env.ADMIN_PASSWORD||require("fs").readFileSync(require("path").join(__dirname,"..","..","tools","fetch_reports.secret"),"utf8").trim()});
  const T = {token:t.body.token, exp:t.body.exp};
  const d = await post(Object.assign({action:"detail", id:9}, T));
  console.log("report_rev =", d.body.row.report_rev, "| orig 长度 =", (d.body.row.report_orig||"").length, "| md 长度 =", d.body.row.report_md.length);
  console.log("md === orig ?", d.body.row.report_md === d.body.row.report_orig);
})();
