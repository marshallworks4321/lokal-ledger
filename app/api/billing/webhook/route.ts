import { createHmac, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  activateSubscriptionFromReference,
  getPaystackSecret,
  isRecord,
  updateSubscriptionFromProviderEvent,
} from "@/lib/billing/paystack";

export async function POST(request: Request) {
  const secret = getPaystackSecret();
  if (!secret) return Response.json({ message: "Billing webhook is not configured." }, { status: 503 });

  const signature = request.headers.get("x-paystack-signature") ?? "";
  const bodyText = await request.text();
  if (bodyText.length > 64_000) return Response.json({ message: "Webhook payload is too large." }, { status: 413 });

  const expected = createHmac("sha512", secret).update(bodyText).digest();
  let received: Buffer;
  try {
    received = Buffer.from(signature, "hex");
  } catch {
    return Response.json({ message: "Invalid webhook signature." }, { status: 401 });
  }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return Response.json({ message: "Invalid webhook signature." }, { status: 401 });
  }

  let event: unknown;
  try {
    event = JSON.parse(bodyText);
  } catch {
    return Response.json({ message: "Invalid webhook payload." }, { status: 400 });
  }
  if (!isRecord(event) || typeof event.event !== "string" || !isRecord(event.data)) {
    return Response.json({ message: "Invalid webhook payload." }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    if (event.event === "charge.success" && typeof event.data.reference === "string") {
      const matchedCheckout = await activateSubscriptionFromReference(admin, event.data.reference, secret);
      if (!matchedCheckout) {
        await updateSubscriptionFromProviderEvent(admin, event.event, event.data);
      }
    } else {
      await updateSubscriptionFromProviderEvent(admin, event.event, event.data);
    }
    return Response.json({ received: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ message: "Could not process the verified billing event." }, { status: 503 });
  }
}
