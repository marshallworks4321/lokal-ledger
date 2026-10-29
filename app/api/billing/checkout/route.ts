import { createAdminClient } from "@/lib/supabase/admin";
import { createRequestClient } from "@/lib/supabase/server";
import {
  activateSubscriptionFromReference,
  getPaystackSecret,
  isPlanTier,
  isRecord,
  paystackRequest,
  PLAN_AMOUNTS_KOBO,
} from "@/lib/billing/paystack";

const responseHeaders = { "Cache-Control": "no-store" };

function respond(message: string, status: number) {
  return Response.json({ message }, { status, headers: responseHeaders });
}

function isPaystackAuthorizationUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "paystack.com" || url.hostname.endsWith(".paystack.com"));
  } catch {
    return false;
  }
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
  if (body.planTier !== undefined && !isPlanTier(body.planTier)) {
    return respond("Choose a valid subscription plan.", 400);
  }

  const supabase = await createRequestClient();
  if (!supabase) return respond("Supabase authentication is not configured on this server.", 503);
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return respond("Sign in to manage your subscription.", 401);
  if (!authData.user.email) return respond("Add and verify an email address before subscribing.", 400);

  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("id, owner_id")
    .eq("id", body.businessId)
    .maybeSingle();
  if (businessError || !business) return respond("Business not found or you do not have access.", 404);
  if (business.owner_id !== authData.user.id) return respond("Only the business owner can manage this subscription.", 403);

  const { data: rows, error: summaryError } = await supabase.rpc("get_business_subscription_summary", {
    target_business_id: body.businessId,
  });
  const summary = Array.isArray(rows) ? rows[0] : null;
  if (summaryError || !isRecord(summary)) {
    return respond("Subscription setup is not ready. Apply the latest Lokal Ledger Supabase migration and try again.", 503);
  }
  const status = summary.status;
  const trialEndsAt = typeof summary.trial_ends_at === "string" ? Date.parse(summary.trial_ends_at) : 0;
  if (status === "trialing" && trialEndsAt > Date.now()) {
    return respond("Your free trial is still active. You can subscribe after it ends; no payment will be taken now.", 409);
  }
  const nextPaymentDate = typeof summary.next_payment_date === "string" ? Date.parse(summary.next_payment_date) : 0;
  const endedCanceledPeriod = status === "active" && summary.cancel_at_period_end === true && nextPaymentDate > 0 && nextPaymentDate <= Date.now();
  if (status === "active" && !endedCanceledPeriod) return respond("This subscription is already active.", 409);
  if (status === "past_due") return respond("A previous recurring payment needs attention. Stop the failed plan before starting another subscription.", 409);
  if (status !== "trialing" && status !== "canceled" && !endedCanceledPeriod) {
    return respond("This account is not ready to start a subscription.", 409);
  }

  const branchCount = Number(summary.branch_count);
  if (!Number.isSafeInteger(branchCount) || branchCount < 1) {
    return respond("Add a business location before choosing a subscription.", 409);
  }
  const planTier = branchCount === 1 ? "single" : "multi";
  if (body.planTier !== undefined && body.planTier !== planTier) {
    return respond("Subscription pricing is based on the owner's registered branch count.", 409);
  }
  const planCode = (planTier === "single"
    ? process.env.PAYSTACK_SINGLE_BRANCH_PLAN_CODE
    : process.env.PAYSTACK_MULTI_BRANCH_PLAN_CODE)?.trim();
  if (!planCode || !/^PLN_[A-Za-z0-9]+$/.test(planCode)) {
    return respond(`Configure the Paystack ${planTier === "single" ? "single-branch" : "multi-branch"} monthly plan code on the server.`, 503);
  }

  const secret = getPaystackSecret();
  if (!secret) return respond("Paystack is not configured. Add PAYSTACK_SECRET_KEY to the server environment.", 503);

  let configuredPlan: Record<string, unknown>;
  try {
    configuredPlan = await paystackRequest(`/plan/${encodeURIComponent(planCode)}`, secret);
  } catch {
    return respond("Could not verify this Paystack plan code. Check that it belongs to the configured test/live account.", 503);
  }
  if (
    configuredPlan.amount !== PLAN_AMOUNTS_KOBO[planTier] ||
    configuredPlan.interval !== "monthly" ||
    configuredPlan.currency !== "NGN"
  ) {
    return respond("The configured Paystack plan must be monthly, in NGN, and match the price shown in the app.", 503);
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return respond("Server-side Supabase billing is not configured. Add SUPABASE_SERVICE_ROLE_KEY on the server.", 503);
  }

  const { data: existingCheckout, error: existingCheckoutError } = await admin
    .from("owner_subscriptions")
    .select("checkout_reference, checkout_url, checkout_started_at, pending_plan_tier")
    .eq("owner_id", authData.user.id)
    .maybeSingle();
  if (existingCheckoutError || !existingCheckout) return respond("Could not check for an existing checkout. Try again shortly.", 503);

  let reference: string;
  if (existingCheckout.checkout_reference) {
    if (existingCheckout.pending_plan_tier !== planTier) {
      return respond("A different Paystack checkout is already pending. Finish it before changing plans.", 409);
    }
    if (isPaystackAuthorizationUrl(existingCheckout.checkout_url)) {
      return Response.json({ authorizationUrl: existingCheckout.checkout_url }, { headers: responseHeaders });
    }

    reference = existingCheckout.checkout_reference;
    try {
      const verified = await paystackRequest(`/transaction/verify/${encodeURIComponent(reference)}`, secret);
      if (verified.status === "success") {
        const activated = await activateSubscriptionFromReference(admin, reference, secret);
        return respond(
          activated
            ? "A previous Paystack payment was verified. Reload the workspace to refresh access."
            : "Paystack reports a completed payment, but the plan could not be reconciled. Do not pay again; contact support.",
          409,
        );
      }
      if (["failed", "abandoned", "reversed"].includes(String(verified.status))) {
        const replacementReference = `lokalledger-${crypto.randomUUID()}`;
        const replacementStartedAt = new Date().toISOString();
        const { data: replacement, error: replacementError } = await admin.rpc("reserve_owner_subscription_checkout", {
          target_owner_id: authData.user.id,
          target_reference: replacementReference,
          target_started_at: replacementStartedAt,
          target_email: authData.user.email,
          target_plan_tier: planTier,
          target_plan_code: planCode,
          target_expected_branch_count: branchCount,
          target_previous_reference: reference,
        });
        if (replacementError || replacement !== true) {
          return respond("The previous checkout changed while retrying. Reload billing and try again.", 409);
        }
        reference = replacementReference;
      }
    } catch {
      // A verify timeout is not proof that the previous charge failed. Keep and reuse its reference.
    }
  } else {
    reference = `lokalledger-${crypto.randomUUID()}`;
    const startedAt = new Date().toISOString();
    const { data: pendingRow, error: pendingError } = await admin.rpc("reserve_owner_subscription_checkout", {
      target_owner_id: authData.user.id,
      target_reference: reference,
      target_started_at: startedAt,
      target_email: authData.user.email,
      target_plan_tier: planTier,
      target_plan_code: planCode,
      target_expected_branch_count: branchCount,
      target_previous_reference: null,
    });
    if (pendingError) return respond("Could not prepare your billing checkout. Try again shortly.", 503);
    if (pendingRow !== true) return respond("Branch count or subscription status changed. Refresh billing and choose the current plan.", 409);
  }

  try {
    const callbackUrl = new URL("/api/billing/callback", request.url).toString();
    const checkout = await paystackRequest("/transaction/initialize", secret, {
      email: authData.user.email,
      amount: String(PLAN_AMOUNTS_KOBO[planTier]),
      currency: "NGN",
      plan: planCode,
      reference,
      callback_url: callbackUrl,
      metadata: {
        owner_id: authData.user.id,
        business_id: body.businessId,
        plan_tier: planTier,
        branch_count: branchCount,
      },
    });
    const authorizationUrl = checkout.authorization_url;
    if (!isPaystackAuthorizationUrl(authorizationUrl)) {
      return respond("Paystack returned no safe checkout link. The same checkout reference has been preserved; retry before starting another payment.", 502);
    }
    const { error: saveUrlError } = await admin
      .from("owner_subscriptions")
      .update({ checkout_url: authorizationUrl, updated_at: new Date().toISOString() })
      .eq("owner_id", authData.user.id)
      .eq("checkout_reference", reference);
    if (saveUrlError) {
      // The reference is still reserved, so this hosted link can be used without risking another transaction.
      return Response.json({ authorizationUrl }, { headers: responseHeaders });
    }
    return Response.json({ authorizationUrl }, { headers: responseHeaders });
  } catch {
    return respond("Paystack could not finish this checkout attempt. Its reference is preserved; retry this same checkout before starting another payment. If you already opened Paystack, continue there.", 502);
  }
}
