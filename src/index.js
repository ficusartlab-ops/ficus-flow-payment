export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    if (request.method !== 'POST') {
      return new Response('OK', { status: 200 });
    }

    const raw = await request.text();
    const body = JSON.parse(raw);

    const payment = body.payload?.payment?.entity;
    const link = body.payload?.payment_link?.entity;
    const order = body.payload?.order?.entity;

    const paymentId = payment?.id || order?.id || null; // pay_Tvgr...
    const linkId = link?.id || null;
    const amount = payment?.amount || order?.amount || 0;

    console.log(`WEBHOOK: ${body.event} ${paymentId} amount=${amount}`);

    await env.DB.prepare(
      `INSERT INTO payment_events (id, payment_id, payment_link_id, event, amount_paise, raw_payload, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
    ).bind(crypto.randomUUID(), paymentId, linkId, body.event, amount, raw).run();

    console.log(`INSERTED: ${paymentId}`);

    return new Response(JSON.stringify({ ok: true, payment_id: paymentId }), { 
      status: 200, 
      headers: { 'Content-Type': 'application/json' } 
    });
  }
}
