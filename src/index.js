export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/') return new Response('Ficus Flow LIVE ✅', { status: 200 });
    const isWebhook = url.pathname === '/webhook' || url.pathname === '/webhooks/payments/razorpay' || url.pathname.startsWith('/webhooks/');
    if (!isWebhook) return new Response('Not Found ' + url.pathname, { status: 404 });
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    const rawBody = await request.text();
    const signature = request.headers.get('x-razorpay-signature') || '';
    if (env.RAZORPAY_WEBHOOK_SECRET && signature) {
      try {
        const enc = new TextEncoder();
        const key = await crypto.subtle.importKey('raw', enc.encode(env.RAZORPAY_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
        const expected = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2,'0')).join('');
        if (expected !== signature) return new Response('Invalid signature', { status: 401 });
      } catch(e) { console.log('Sig check failed', e); }
    }
    let body;
    try { body = JSON.parse(rawBody); } catch { return new Response('Invalid JSON', { status: 400 }); }
    
    // FIX: Extract payment_id correctly
    const payment = body.payload?.payment?.entity || body.payload?.payment_link?.entity || {};
    const paymentId = payment.id || body.payload?.payment?.entity?.id || null;
    const linkId = body.payload?.payment_link?.entity?.id || body.payload?.payment_link?.entity?.payment_link_id || null;
    const amount = payment.amount || 0;
    const status = body.event || 'unknown';
    const email = payment.email || payment.contact || '';
    
    console.log(`WEBHOOK: ${status} payment=${paymentId} link=${linkId} amount=${amount}`);

    try {
      await env.DB.prepare(
        `INSERT INTO payment_events (id, payment_id, payment_link_id, event, amount_paise, email, raw_payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      ).bind(crypto.randomUUID(), paymentId, linkId, status, amount, email, rawBody).run();
    } catch (dbErr) {
      console.log('DB Error', dbErr);
      return new Response('DB Error: ' + dbErr.message, { status: 500 });
    }
    return new Response(JSON.stringify({ ok: true, payment_id: paymentId }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
}
