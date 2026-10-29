import { createAdminClient } from "@/lib/supabase/admin";
import { getPaystackSecret, isRecord, paystackRequest } from "@/lib/billing/paystack";
import { createRequestClient } from "@/lib/supabase/server";

function respond(message: string, status: number) {
  return Response.json({ message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return respond("This request is not allowed.", 403);

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > 2048) return respond("Billing request is too large.", 413);
    body = JSON.parse(text);
  } catch {
    return respond("Send a valid billing request.", 400);
  }
  if (!isRecord(body) || typeof body.businessId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.businessId)) {
    return respond("Choose a valid business to manage billing for.", 400);
  }

  const supabase = await createRequestClient();
  if (!supabase) return respond("Supabase authentication is not configured on this server.", 503);
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return respond("Sign in to manage your subscription.", 401);

  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("owner_id")
    .eq("id", body.businessId)
    .maybeSingle();
  if (businessError || !business) return respond("Business not found or you do not have access.", 404);
  if (business.owner_id !== authData.user.id) return respond("Only the business owner can manage this subscription.", 403);

  const secret = getPaystackSecret();
  if (!secret) return respond("Paystack is not configured on the server.", 503);
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return respond("Server-side Supabase billing is not configured.", 503);
  }

  const { data: billing, error: billingError } = await admin
    .from("owner_subscriptions")
    .select("paystack_subscription_code, paystack_email_token, status, cancel_at_period_end")
    .eq("owner_id", authData.user.id)
    .maybeSingle();
  if (billingError || !billing) return respond("Subscription record not found.", 404);
  if ((billing.status !== "active" && billing.status !== "past_due") || billing.cancel_at_period_end) {
    return respond("There is no active renewal to cancel.", 409);
  }
  if (!billing.paystack_subscription_code || !billing.paystack_email_token) {
    return respond("Paystack has not finished setting up subscription management. Try again shortly.", 409);
  }

  try {
    await paystackRequest("/subscription/disable", secret, {
      code: billing.paystack_subscription_code,
      token: billing.paystack_email_token,
    });
  } catch {
    return respond("Paystack could not cancel renewal. Try again or contact support.", 502);
  }

  const wasPastDue = billing.status === "past_due";
  const { error: updateError } = await admin
    .from("owner_subscriptions")
    .update({
      ...(wasPastDue ? {
        status: "canceled",
        cancel_at_period_end: false,
        paystack_subscription_code: null,
        paystack_email_token: null,
        paystack_customer_code: null,
        next_payment_date: null,
      } : { cancel_at_period_end: true }),
      checkout_reference: null,
      checkout_url: null,
      checkout_started_at: null,
      checkout_email: null,
      pending_plan_tier: null,
      pending_plan_code: null,
      updated_at: new Date().toISOString(),
    })
    .eq("owner_id", authData.user.id);
  if (updateError) return respond("Paystack accepted the cancellation, but the app could not update its billing status. The webhook will reconcile it shortly.", 503);

  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
