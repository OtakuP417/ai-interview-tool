const https = require("https");
const HOST = "work-d1gs0jzrg2277d75e-1391683363.ap-shanghai.app.tcloudbase.com";
function post(p){return new Promise((res,rej)=>{const b=JSON.stringify(p);const r=https.request({hostname:HOST,path:"/api/admin",method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(b)},timeout:60000},x=>{let d="";x.on("data",c=>d+=c);x.on("end",()=>{try{res({status:x.statusCode,body:JSON.parse(d)})}catch(e){rej(new Error(d.slice(0,200)))}})});r.on("error",rej);r.end(b)})}
(async()=>{
  const t = await post({action:"login",password:process.env.ADMIN_PASSWORD||require("fs").readFileSync(require("path").join(__dirname,"..","..","tools","fetch_reports.secret"),"utf8").trim()});
  const T = {token:t.body.token, exp:t.body.exp};
  const d = await post(Object.assign({action:"detail", id:9}, T));
  const md = d.body.row.report_md, orig = d.body.row.report_orig;
  let i=0; while(i<Math.min(md.length,orig.length) && md[i]===orig[i]) i++;
  console.log("首个不同位置:", i, "/ md", md.length, "orig", orig.length);
  console.log("md   前:", JSON.stringify(md.slice(Math.max(0,i-30), i+40)));
  console.log("orig 前:", JSON.stringify(orig.slice(Math.max(0,i-30), i+40)));
  console.log("md   尾:", JSON.stringify(md.slice(-60)));
  console.log("orig 尾:", JSON.stringify(orig.slice(-60)));
  console.log("--- 逐段 ---");
  console.log(JSON.stringify(md.slice(0,120)));
  console.log(JSON.stringify(orig.slice(0,120)));
})();
