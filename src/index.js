export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/') {
      return new Response('Ficus Flow LIVE ✅ - ' + url.pathname, { status: 200 });
    }

    // FIX: Accept /webhook AND /webhooks/payments/razorpay
    const isWebhook = url.pathname === '/webhook' 
                   || url.pathname.startsWith('/webhooks/') 
                   || url.pathname.includes('razorpay');
    
    if (!isWebhook) {
      return new Response('Not Found: ' + url.pathname, { status: 404 });
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const rawBody = await request.text();
    let body;
    try { body = JSON.parse(rawBody); } 
    catch { return new Response('Bad JSON', { status: 400 }); }

    const payment = body.payload?.payment?.entity;
    const link = body.payload?.payment_link?.entity;

    const paymentId = payment?.id || null;  // pay_xxxxx
    const linkId = link?.id || null;
    const amount = payment?.amount || link?.amount || 0;
    const event = body.event || 'payment.captured';
    const email = payment?.email || link?.customer?.email || '';

    try {
      await env.DB.prepare(
        `INSERT INTO payment_events (id, payment_id, payment_link_id, event, amount_paise, email, raw_payload, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      ).bind(crypto.randomUUID(), paymentId, linkId, event, amount, email, rawBody).run();
    } catch (e) {
      return new Response('DB Error: ' + e.message, { status: 500 });
    }

    return new Response(JSON.stringify({ ok: true, payment_id: paymentId }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
