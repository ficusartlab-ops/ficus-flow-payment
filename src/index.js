export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // FIX: Accept BOTH old and new path - this is what broke at 22:58
    const isWebhookPath = url.pathname === '/webhook' || url.pathname === '/webhooks/payments/razorpay';
    
    if (url.pathname === '/' || url.pathname === '/favicon.ico') {
      return new Response('FICUS Flow Payment LIVE ✅ - ' + url.pathname, { status: 200 });
    }

    if (!isWebhookPath) {
      return new Response('Not Found', { status: 404 });
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const rawBody = await request.text();
    const signature = request.headers.get('x-razorpay-signature') || '';

    // Verify signature
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(env.RAZORPAY_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
    const expectedSig = [...new Uint8Array(sigBuf)].map(b => b.toString(16).padStart(2, '0')).join('');

    if (expectedSig !== signature) {
      console.log('INVALID SIGNATURE');
      return new Response(JSON.stringify({ error: 'INVALID_SIGNATURE' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    const eventType = payload.event || 'unknown';
    const entity = payload.payload?.payment?.entity || payload.payload?.payment_link?.entity || payload.payload?.order?.entity || payload;
    const paymentId = entity.id || payload.event_id || 'evt_' + Date.now();

    // Log like 18:25 version - you saw this in your screenshot
    console.log(`WEBHOOK: ${eventType} ${paymentId}`);

    const amount = Number(entity.amount || entity.amount_paid || entity.amount_due || 0);
    const currency = (entity.currency || 'INR').toUpperCase();
    const clientId = entity.notes?.client_id || payload.payload?.payment_link?.entity?.notes?.client_id || 'direct_link';
    const invoiceId = entity.notes?.invoice_id || payload.payload?.payment_link?.entity?.notes?.invoice_id || 'direct_link';

    try {
      await env.DB.prepare(
        `INSERT INTO payment_events (id, client_id, invoice_id, provider, provider_event_id, amount_paise, currency, status, payload_json, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        crypto.randomUUID(),
        clientId,
        invoiceId,
        'razorpay',
        paymentId.toString(),
        amount, // Razorpay already sends in paise (1000 = ₹10) - don't multiply
        currency,
        'captured',
        rawBody,
        new Date().toISOString()
      ).run();

      console.log(`INSERTED: ${paymentId} amount=${amount}`);
      
      return new Response(JSON.stringify({ ok: true, event: eventType, amount }), { 
        status: 200, 
        headers: { 'Content-Type': 'application/json' } 
      });

    } catch (err) {
      console.error('DB ERROR:', err.message);
      return new Response(JSON.stringify({ error: err.message }), { 
        status: 500, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }
  }
}
