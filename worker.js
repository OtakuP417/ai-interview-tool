/**
 * AI 案例访谈助手 — Cloudflare Worker 代理
 *
 * 部署后，把 Worker 地址填入 interview_app.html 顶部的 PROXY_URL 变量。
 * API Key 通过 Cloudflare 环境变量 DEEPSEEK_API_KEY 注入，不会出现在前端源码中。
 *
 * 环境变量（在 Cloudflare Dashboard → Worker → Settings → Variables 中添加）：
 *   DEEPSEEK_API_KEY  =  sk-xxxxxxxxxxxxxxxx
 *   ALLOWED_ORIGIN    =  https://your-app.pages.dev   （留空则允许所有来源）
 */

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';

export default {
  async fetch(request, env) {
    // ── CORS 预检 ──────────────────────────────────────────────────
    const origin = request.headers.get('Origin') || '';
    const allowedOrigin = env.ALLOWED_ORIGIN || '*';
    const corsHeaders = {
      'Access-Control-Allow-Origin': allowedOrigin === '*' ? '*' : (origin || '*'),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // ── 仅接受 POST ────────────────────────────────────────────────
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
    }

    // ── 检查 API Key 是否已配置 ────────────────────────────────────
    const apiKey = env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: { message: 'Server not configured: DEEPSEEK_API_KEY missing.' } }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── 转发请求到 DeepSeek ────────────────────────────────────────
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(
        JSON.stringify({ error: { message: 'Invalid JSON body.' } }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const upstream = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    // ── 把响应（含流式 SSE）原样返回给前端 ─────────────────────────
    const responseHeaders = new Headers(corsHeaders);
    responseHeaders.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json');

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  },
};
