function jsonResp(obj, status=200){return new Response(JSON.stringify(obj),{status,headers:{'Content-Type':'application/json'}})}
export default{
async fetch(request,env){
const url=new URL(request.url);
if(request.method!=='POST')return new Response('Method Not Allowed',{status:405});
if(url.pathname!=='/webhooks/payments/razorpay')return new Response('Not Found',{status:404});
const rawBody=await request.text();
const sig=request.headers.get('x-razorpay-signature')||'';
const enc=new TextEncoder();
const key=await crypto.subtle.importKey('raw',enc.encode(env.RAZORPAY_WEBHOOK_SECRET),{name:'HMAC',hash:'SHA-256'},!1,['sign']);
const buf=await crypto.subtle.sign('HMAC',key,enc.encode(rawBody));
const hex=Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
if(hex!==sig)return jsonResp({error:'INVALID_SIGNATURE'},401);
let parsed;try{parsed=JSON.parse(rawBody)}catch{return jsonResp({error:'INVALID_JSON'},400)}
const entity=parsed?.payload?.payment?.entity||parsed;
const ev={provider_event_id:(entity.id||parsed.event_id||'').toString(),amount_paise:Number(entity.amount??parsed.amount??0),currency:(entity.currency??parsed.currency??'INR').toUpperCase(),client_id:entity.notes?.client_id??parsed.notes?.client_id??null,invoice_id:entity.notes?.invoice_id??parsed.notes?.invoice_id??null};
if(!ev.provider_event_id.trim())return jsonResp({error:'INVALID_EVENT_ID'},400);
if(!ev.client_id||!ev.invoice_id)return jsonResp({error:'MISSING_MAPPING'},400);
const invoice=await env.DB.prepare('SELECT id,total_paise,currency FROM invoices WHERE id=? AND client_id=?').bind(ev.invoice_id,ev.client_id).first();
if(!invoice)return jsonResp({error:'INVOICE_NOT_FOUND'},404);
if(ev.amount_paise!==invoice.total_paise)return jsonResp({error:'AMOUNT_MISMATCH',expected:invoice.total_paise,got:ev.amount_paise},400);
if(ev.currency!==invoice.currency)return jsonResp({error:'CURRENCY_MISMATCH',expected:invoice.currency,got:ev.currency},400);
try{await env.DB.prepare('INSERT INTO payment_events (id,client_id,invoice_id,provider,provider_event_id,amount_paise,currency,status,payload_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,datetime("now"))').bind(crypto.randomUUID(),ev.client_id,ev.invoice_id,'razorpay',ev.provider_event_id.trim(),ev.amount_paise,ev.currency,'captured',rawBody).run();return jsonResp({ok:true,inserted:true},200)}catch(e){if((e.message||'').toLowerCase().includes('unique'))return jsonResp({ok:true,dedup:true},200);return jsonResp({error:'DB_ERROR',details:e.message},500)}
}
}
