/* 按体积探测 /api/asr，模拟浏览器带 Origin 的真实请求 */
const API = 'https://work-d1gs0jzrg2277d75e-1391683363.ap-shanghai.app.tcloudbase.com/api';
const ORIGIN = 'https://interview-work-d1gs0jzrg2277d75e.webapps.tcloudbase.com';

(async function () {
  const sizes = [1, 8, 64, 153, 512, 1024, 2048, 4096];
  for (let i = 0; i < sizes.length; i++) {
    const kb = sizes[i];
    const b64 = 'A'.repeat(Math.round(kb * 1024));
    const body = JSON.stringify({ audio_base64: b64, format: 'wav', duration_ms: 4000, sample_rate: 16000 });
    const t = Date.now();
    try {
      const r = await fetch(API + '/asr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
        body: body,
      });
      const txt = await r.text();
      const pad = ('     ' + kb).slice(-5);
      console.log('asr ' + pad + 'KB (JSON ' + (body.length / 1024).toFixed(0) + 'KB) -> HTTP ' + r.status + ' ' + (Date.now() - t) + 'ms  ' + txt.slice(0, 90));
    } catch (e) {
      const pad = ('     ' + kb).slice(-5);
      console.log('asr ' + pad + 'KB -> THROW ' + e.name + ' ' + e.message + ' ' + (Date.now() - t) + 'ms');
    }
  }
})();
