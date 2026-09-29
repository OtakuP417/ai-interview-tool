/* 慢网模拟：用 Node 原生 https 手动分块写入 body，模拟手机上传速率
   验证网关在「上传中途断开」时的表现（对应用户 1s 失败的一种假设） */
const https = require('https');
const API_HOST = 'work-d1gs0jzrg2277d75e-1391683363.ap-shanghai.app.tcloudbase.com';
const ORIGIN = 'https://interview-work-d1gs0jzrg2277d75e.webapps.tcloudbase.com';

function slowPost(totalKB, chunkKB, delayMs) {
  return new Promise(function (resolve) {
    const bodyObj = JSON.stringify({ audio_base64: 'A'.repeat(totalKB * 1024), format: 'wav' });
    const buf = Buffer.from(bodyObj, 'utf8');
    const t = Date.now();
    const req = https.request({
      hostname: API_HOST,
      path: '/api/asr',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': ORIGIN,
        'Content-Length': buf.length,
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      },
      timeout: 30000,
    }, function (res) {
      let data = '';
      res.on('data', function (c) { data += c; if (data.length > 500) data = data.slice(0, 500); });
      res.on('end', function () {
        resolve(totalKB + 'KB slow(' + chunkKB + 'KB/' + delayMs + 'ms) -> HTTP ' + res.statusCode + ' ' + (Date.now() - t) + 'ms  ' + data.slice(0, 90));
      });
    });
    req.on('timeout', function () { req.destroy(new Error('TIMEOUT')); });
    req.on('error', function (e) {
      resolve(totalKB + 'KB slow -> ERROR ' + e.message + ' ' + (Date.now() - t) + 'ms');
    });
    /* 分块慢写 */
    let off = 0;
    const chunk = chunkKB * 1024;
    function writeNext() {
      if (off >= buf.length) { req.end(); return; }
      const piece = buf.slice(off, Math.min(off + chunk, buf.length));
      off += piece.length;
      req.write(piece);
      setTimeout(writeNext, delayMs);
    }
    writeNext();
  });
}

(async function () {
  /* 153KB，按 2G 上行速率约 20KB/s → 每 4KB 停 200ms，共约 7.6 秒发完 */
  console.log(await slowPost(153, 4, 200));
  /* 153KB，按 4G 正常速率 200KB/s → 每 8KB 停 40ms */
  console.log(await slowPost(153, 8, 40));
  /* 1MB 慢传，看网关会不会中途掐断长连接 */
  console.log(await slowPost(1024, 8, 40));
})();
