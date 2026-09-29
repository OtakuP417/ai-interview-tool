/* 对照实验：从「页面同域」与「跨域」两个角度分别打 chat 与 asr，看差异
   目的：确认 chat 是否也跨域 + 是否可用；asr 是否只在某条件下失败 */
const API = 'https://work-d1gs0jzrg2277d75e-1391683363.ap-shanghai.app.tcloudbase.com/api';
const ORIGINS = [
  'https://interview-work-d1gs0jzrg2277d75e.webapps.tcloudbase.com',
  'https://work-d1gs0jzrg2277d75e-1391683363.tcloudbaseapp.com',
];

(async function () {
  for (const origin of ORIGINS) {
    console.log('\n===== Origin: ' + origin + ' =====');
    /* 1. OPTIONS 预检 asr */
    for (const p of ['/asr', '/chat']) {
      try {
        const r = await fetch(API + p, {
          method: 'OPTIONS',
          headers: {
            Origin: origin,
            'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'content-type',
          },
        });
        console.log('[OPTIONS ' + p + '] ' + r.status
          + ' allow-origin=' + (r.headers.get('access-control-allow-origin') || '-')
          + ' allow-methods=' + (r.headers.get('access-control-allow-methods') || '-')
          + ' allow-headers=' + (r.headers.get('access-control-allow-headers') || '-'));
      } catch (e) {
        console.log('[OPTIONS ' + p + '] THROW ' + e.name + ' ' + e.message);
      }
    }
    /* 2. 真实 POST asr（1KB 假音频） */
    try {
      const r = await fetch(API + '/asr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: origin },
        body: JSON.stringify({ audio_base64: 'A'.repeat(1024), format: 'wav' }),
      });
      console.log('[POST /asr] ' + r.status + ' allow-origin=' + (r.headers.get('access-control-allow-origin') || '-'));
    } catch (e) {
      console.log('[POST /asr] THROW ' + e.name + ' ' + e.message);
    }
    /* 3. 真实 POST chat（最小体，只为看连通性） */
    try {
      const r = await fetch(API + '/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: origin },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
      });
      console.log('[POST /chat] ' + r.status + ' allow-origin=' + (r.headers.get('access-control-allow-origin') || '-'));
      try { await r.text(); } catch (e) {}
    } catch (e) {
      console.log('[POST /chat] THROW ' + e.name + ' ' + e.message);
    }
  }
})();
