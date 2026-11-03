export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/' ) return new Response('Ficus Flow LIVE ✅', { status: 200 });
    const isWebhook = url.pathname === '/webhook' || url.pathname === '/webhooks/payments/razorpay' || url.pathname.startsWith('/webhooks');
    if (!isWebhook) return new Response('Not Found: ' + url.pathname, { status: 404 });
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    const rawBody = await request.text();
    const signature = request.headers.get('x-razorpay-signature') || '';
    if (env.RAZORPAY_WEBHOOK_SECRET && signature) {
      try {
        const enc = new TextEncoder();
        const key = await crypto.subtle.importKey('raw', enc.encode(env.RAZORPAY_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
        const expected = [...new Uint8Array(sigBuf)].map(b => b.toString(16).padStart(2, '0')).join('');
        if (expected !== signature) {
          console.log('INVALID SIGNATURE');
          return new Response('Invalid signature', { status: 401 });
        }
      } catch (e) {
        console.error('Sig verify error', e.message);
      }
    }
    let payload; try { payload = JSON.parse(rawBody); } catch { return new Response('Bad JSON', { status: 400 }); }
    const eventType = payload.event || 'unknown';
    const pEnt = payload.payload?.payment?.entity || {};
    const lEnt = payload.payload?.payment_link?.entity || {};
    const ent = pEnt.id ? pEnt : lEnt.id ? lEnt : payload.payload?.order?.entity || {};
    const pid = ent.id || 'evt_' + Date.now();
    const paymentId = pEnt.id || null; // pay_TvgrQMKZS68Dv8
    const linkId = lEnt.id || pEnt.payment_link_id || null;
    const amount = Number(ent.amount || ent.amount_paid || payload.payload?.order?.entity?.amount || 0);
    const currency = (ent.currency || 'INR').toUpperCase();
    const notes = ent.notes || {};
    const clientId = notes.client_id || 'direct_link';
    const invoiceId = notes.invoice_id || 'direct_link';
    console.log(`WEBHOOK: ${eventType} ${pid} payment=${paymentId} link=${linkId} amount=${amount}`);
    try {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO payment_events (id, client_id, invoice_id, provider, provider_event_id, payment_id, payment_link_id, amount_paise, currency, status, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(crypto.randomUUID(), clientId, invoiceId, 'razorpay', pid.toString(), paymentId, linkId, amount, currency, 'captured', rawBody.substring(0,15000), new Date().toISOString()).run();
      console.log(`INSERTED: ${pid}`);
      return new Response(JSON.stringify({ ok: true, amount }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch (err) {
      console.error('DB ERROR:', err.message);
      return new Response(JSON.stringify({ ok: true, warning: err.message }), { status: 200 });
    }
  }
}
