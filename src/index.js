function jsonResp(obj, status=200){return new Response(JSON.stringify(obj),{status,headers:{'Content-Type':'application/json'}})}

export default{
 async fetch(request,env){
  const url=new URL(request.url);
  if(request.method!=='POST' && url.pathname==='/webhooks/payments/razorpay'){
    return new Response('FICUS Flow Payment LIVE ✅ - POST /webhooks/payments/razorpay',{status:200})
  }
  if(url.pathname!=='/webhooks/payments/razorpay')return new Response('Not Found - use /webhooks/payments/razorpay',{status:404});
  if(request.method!=='POST')return new Response('Method Not Allowed',{status:405});

  const rawBody=await request.text();
  const sig=request.headers.get('x-razorpay-signature')||'';
  const enc=new TextEncoder();
  const key=await crypto.subtle.importKey('raw',enc.encode(env.RAZORPAY_WEBHOOK_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const buf=await crypto.subtle.sign('HMAC',key,enc.encode(rawBody));
  const hex=Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
  if(hex!==sig)return jsonResp({error:'INVALID_SIGNATURE'},401);

  let parsed;try{parsed=JSON.parse(rawBody)}catch{return jsonResp({error:'INVALID_JSON'},400)}
  const entity=parsed?.payload?.payment?.entity||parsed?.payload?.payment_link?.entity||parsed;

  const ev={
    provider_event_id:(entity.id||parsed.event_id||'').toString(),
    amount_paise:Number(entity.amount||entity.amount_paid||entity.amount_due||parsed.amount||0),
    currency:(entity.currency||parsed.currency||'INR').toUpperCase(),
    client_id:entity.notes?.client_id||parsed.notes?.client_id||entity.notes?.client_id||null,
    invoice_id:entity.notes?.invoice_id||parsed.notes?.invoice_id||null
  };

  if(!ev.provider_event_id.trim())return jsonResp({error:'INVALID_EVENT_ID'},400);

  // FALLBACK for direct Payment Links (your ₹10 tests)
  if(!ev.client_id || !ev.invoice_id){
   try{
    await env.DB.prepare(`INSERT INTO payment_events (id,client_id,invoice_id,provider,provider_event_id,amount_paise,currency,status,payload_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(), 'direct_link', 'direct_link', 'razorpay', ev.provider_event_id, ev.amount_paise, ev.currency, 'captured', rawBody, new Date().toISOString()).run();
    return jsonResp({ok:true,inserted:'direct_link',amount:ev.amount_paise},200);
   }catch(e){return jsonResp({error:e.message},500)}
  }

  // Normal flow with client/invoice
  try{
   await env.DB.prepare(`INSERT INTO payment_events (id,client_id,invoice_id,provider,provider_event_id,amount_paise,currency,status,payload_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
   .bind(crypto.randomUUID(), ev.client_id, ev.invoice_id, 'razorpay', ev.provider_event_id, ev.amount_paise, ev.currency, 'captured', rawBody, new Date().toISOString()).run();
   return jsonResp({ok:true,amount:ev.amount_paise},200);
  }catch(e){return jsonResp({error:e.message},500)}
 }
}
