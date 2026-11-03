export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Accept requests only at the Razorpay webhook endpoint.
    if (url.pathname !== "/webhooks/payments/razorpay") {
      return new Response("Not Found", { status: 404 });
    }

    // Health check.
    if (request.method === "GET") {
      return new Response("FICUS Flow Payment Webhook is running", {
        status: 200
      });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    try {
      // Check required Cloudflare bindings.
      if (!env.DB || !env.RAZORPAY_WEBHOOK_SECRET) {
        console.error("Missing DB binding or webhook secret");

        return new Response("Server configuration error", {
          status: 500
        });
      }

      // Read the original request body.
      // Do not parse or modify it before signature verification.
      const rawBytes = await request.arrayBuffer();

      const signature = request.headers.get("X-Razorpay-Signature");

      if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) {
        return new Response("Invalid signature header", {
          status: 401
        });
      }

      // Generate HMAC SHA-256 signature.
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(env.RAZORPAY_WEBHOOK_SECRET),
        {
          name: "HMAC",
          hash: "SHA-256"
        },
        false,
        ["sign"]
      );

      const expectedSignature = await crypto.subtle.sign(
        "HMAC",
        key,
        rawBytes
      );

      const expectedHex = Array.from(
        new Uint8Array(expectedSignature)
      )
        .map(byte => byte.toString(16).padStart(2, "0"))
        .join("");

      const suppliedHex = signature.toLowerCase();

      // Constant-time comparison.
      let difference = 0;

      for (let i = 0; i < expectedHex.length; i++) {
        difference |=
          expectedHex.charCodeAt(i) ^ suppliedHex.charCodeAt(i);
      }

      if (difference !== 0) {
        console.error("Webhook signature verification failed");

        return new Response("Invalid webhook signature", {
          status: 401
        });
      }

      // Parse JSON only after signature verification.
      const raw = new TextDecoder().decode(rawBytes);

      let body;

      try {
        body = JSON.parse(raw);
      } catch {
        return new Response("Invalid JSON payload", {
          status: 400
        });
      }

      if (!body || typeof body.event !== "string" || !body.event) {
        return new Response("Missing webhook event", {
          status: 400
        });
      }

      // Get Razorpay's unique webhook delivery ID.
      const eventId = (
        request.headers.get("x-razorpay-event-id") || ""
      ).trim();

      if (!eventId) {
        console.error("Missing Razorpay event ID");

        return new Response("Missing Razorpay event ID", {
          status: 400
        });
      }

      // Extract Razorpay entities.
      const payment = body.payload?.payment?.entity ?? null;
      const link = body.payload?.payment_link?.entity ?? null;
      const order = body.payload?.order?.entity ?? null;
      const invoice = body.payload?.invoice?.entity ?? null;
      const subscription =
        body.payload?.subscription?.entity ?? null;

      // Keep payment, order and payment-link IDs separate.
      const paymentId = payment?.id ?? null;

      const paymentLinkId = link?.id ?? null;

      const orderId =
        order?.id ??
        payment?.order_id ??
        link?.order_id ??
        null;

      const razorpayOrderId =
        payment?.order_id ??
        order?.id ??
        link?.order_id ??
        null;

      // Razorpay amounts are stored in paise.
      const amount =
        payment?.amount ??
        link?.amount_paid ??
        invoice?.amount_paid ??
        invoice?.amount ??
        link?.amount ??
        order?.amount ??
        null;

      const amountDue =
        link?.amount_due ??
        order?.amount_due ??
        null;

      const currency =
        payment?.currency ??
        link?.currency ??
        invoice?.currency ??
        order?.currency ??
        "INR";

      const status =
        payment?.status ??
        link?.status ??
        invoice?.status ??
        order?.status ??
        null;

      const method = payment?.method ?? null;
      const email = payment?.email ?? null;
      const contact = payment?.contact ?? null;

      const invoiceId =
        payment?.invoice_id ??
        invoice?.id ??
        null;

      const subscriptionId =
        payment?.subscription_id ??
        subscription?.id ??
        null;

      // Save the webhook event.
      // The database automatically generates:
      // 1. Integer primary key (id)
      // 2. created_at timestamp
      //
      // The unique index protects against duplicate event IDs.
      const result = await env.DB.prepare(`
        INSERT OR IGNORE INTO payment_events (
          provider,
          event,
          order_id,
          payment_id,
          payment_link_id,
          invoice_id,
          subscription_id,
          amount,
          currency,
          status,
          method,
          email,
          contact,
          raw_payload,
          amount_paise,
          amount_due,
          razorpay_order_id,
          razorpay_event_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
        .bind(
          "razorpay",
          body.event,
          orderId,
          paymentId,
          paymentLinkId,
          invoiceId,
          subscriptionId,
          amount,
          currency,
          status,
          method,
          email,
          contact,
          raw,
          amount,
          amountDue,
          razorpayOrderId,
          eventId
        )
        .run();

      const changes = result.meta?.changes ?? 0;

      // A duplicate event is already safely stored.
      if (changes === 0) {
        console.log(`DUPLICATE WEBHOOK: ${eventId}`);

        return new Response(
          JSON.stringify({
            ok: true,
            duplicate: true,
            event_id: eventId
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json"
            }
          }
        );
      }

      console.log(
        `WEBHOOK SAVED: ${body.event}, event_id=${eventId}, payment_id=${paymentId ?? "none"}`
      );

      return new Response(
        JSON.stringify({
          ok: true,
          duplicate: false,
          event: body.event,
          event_id: eventId,
          payment_id: paymentId
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );

    } catch (error) {
      console.error(
        "WEBHOOK PROCESSING ERROR:",
        error?.message || "Unknown error"
      );

      // A server error allows Razorpay to retry delivery.
      return new Response("Webhook processing failed", {
        status: 500
      });
    }
  }
};
