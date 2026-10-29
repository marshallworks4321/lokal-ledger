import type { SupabaseClient } from "@supabase/supabase-js";

export type PlanTier = "single" | "multi";
export type PaystackRecord = Record<string, unknown>;

export const PLAN_AMOUNTS_KOBO: Record<PlanTier, number> = {
  single: 300_000,
  multi: 500_000,
};

export function isRecord(value: unknown): value is PaystackRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isPlanTier(value: unknown): value is PlanTier {
  return value === "single" || value === "multi";
}

export function getPaystackSecret() {
  return process.env.PAYSTACK_SECRET_KEY?.trim() || null;
}

export async function paystackRequest(path: string, secret: string, body?: PaystackRecord) {
  const response = await fetch(`https://api.paystack.co${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${secret}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Paystack returned an unreadable response.");
  }

  if (!response.ok || !isRecord(payload) || payload.status !== true) {
    throw new Error("Paystack could not complete the billing request. Check the secret key, plan code and Paystack account mode.");
  }

  return isRecord(payload.data) ? payload.data : {};
}

export function nextMonthlyPaymentDate(startValue: unknown) {
  const start = typeof startValue === "string" || typeof startValue === "number"
    ? new Date(startValue)
    : new Date();
  const source = Number.isNaN(start.getTime()) ? new Date() : start;
  const targetYear = source.getUTCFullYear() + Math.floor((source.getUTCMonth() + 1) / 12);
  const targetMonth = (source.getUTCMonth() + 1) % 12;
  const targetMonthLastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const sourceMonthLastDay = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + 1, 0)).getUTCDate();
  const targetDay = source.getUTCDate() === sourceMonthLastDay
    ? targetMonthLastDay
    : Math.min(source.getUTCDate(), targetMonthLastDay);
  return new Date(Date.UTC(
    targetYear,
    targetMonth,
    targetDay,
    source.getUTCHours(),
    source.getUTCMinutes(),
    source.getUTCSeconds(),
  )).toISOString();
}

export async function activateSubscriptionFromReference(
  admin: SupabaseClient,
  reference: string,
  secret: string,
) {
  const transaction = await paystackRequest(
    `/transaction/verify/${encodeURIComponent(reference)}`,
    secret,
  );
  if (transaction.reference !== reference || transaction.status !== "success" || transaction.currency !== "NGN") {
    return false;
  }

  const { data: pending, error: pendingError } = await admin
    .from("owner_subscriptions")
    .select("owner_id, checkout_reference, checkout_email, pending_plan_tier, pending_plan_code, next_payment_date")
    .eq("checkout_reference", reference)
    .maybeSingle();
  if (pendingError) throw new Error("Could not read the pending subscription checkout.");
  if (!pending || !isPlanTier(pending.pending_plan_tier)) return false;

  const expectedAmount = PLAN_AMOUNTS_KOBO[pending.pending_plan_tier];
  if (transaction.amount !== expectedAmount) return false;

  const customer = isRecord(transaction.customer) ? transaction.customer : null;
  const paidEmail = typeof customer?.email === "string" ? customer.email.trim().toLowerCase() : "";
  const expectedEmail = typeof pending.checkout_email === "string"
    ? pending.checkout_email.trim().toLowerCase()
    : "";
  if (paidEmail && expectedEmail && paidEmail !== expectedEmail) return false;

  const metadata = isRecord(transaction.metadata) ? transaction.metadata : null;
  if (metadata?.owner_id && metadata.owner_id !== pending.owner_id) return false;
  if (metadata?.plan_tier && metadata.plan_tier !== pending.pending_plan_tier) return false;

  const { data: ownedBusinesses, error: businessesError } = await admin
    .from("businesses")
    .select("id")
    .eq("owner_id", pending.owner_id);
  if (businessesError) throw new Error("Could not recheck the owner's branches before activation.");
  const businessIds = (ownedBusinesses ?? []).map((row) => row.id).filter((id): id is string => typeof id === "string");
  if (businessIds.length === 0) return false;
  const { count: branchCount, error: branchCountError } = await admin
    .from("locations")
    .select("id", { count: "exact", head: true })
    .in("business_id", businessIds);
  if (branchCountError) throw new Error("Could not recheck the owner's branch count before activation.");
  const currentPlanTier = branchCount === 1 ? "single" : branchCount !== null && branchCount > 1 ? "multi" : null;
  if (currentPlanTier !== pending.pending_plan_tier) {
    throw new Error("The registered branch count no longer matches this paid plan; manual billing reconciliation is required.");
  }

  const customerCode = typeof customer?.customer_code === "string" ? customer.customer_code : null;
  const paymentStart = typeof transaction.paid_at === "string" ? transaction.paid_at : new Date().toISOString();
  const providerNextPaymentDate = typeof pending.next_payment_date === "string" &&
    Date.parse(pending.next_payment_date) > Date.parse(paymentStart)
    ? pending.next_payment_date
    : nextMonthlyPaymentDate(paymentStart);
  const { error: updateError } = await admin
    .from("owner_subscriptions")
    .update({
      status: "active",
      plan_tier: pending.pending_plan_tier,
      next_payment_date: providerNextPaymentDate,
      paystack_customer_code: customerCode,
      last_payment_reference: reference,
      last_invoice_code: null,
      last_invoice_due_date: null,
      last_invoice_paid: false,
      cancel_at_period_end: false,
      checkout_reference: null,
      checkout_url: null,
      updated_at: new Date().toISOString(),
    })
    .eq("owner_id", pending.owner_id)
    .eq("checkout_reference", reference);

  if (updateError) throw new Error("Could not activate the verified subscription payment.");
  return true;
}

export async function updateSubscriptionFromProviderEvent(
  admin: SupabaseClient,
  event: string,
  data: PaystackRecord,
) {
  if (event === "subscription.create") {
    const customer = isRecord(data.customer) ? data.customer : null;
    const plan = isRecord(data.plan) ? data.plan : null;
    const customerEmail = typeof customer?.email === "string" ? customer.email.trim().toLowerCase() : "";
    const planCode = typeof plan?.plan_code === "string" ? plan.plan_code : "";
    const subscriptionCode = typeof data.subscription_code === "string" ? data.subscription_code : "";
    const emailToken = typeof data.email_token === "string" ? data.email_token : "";
    const nextPaymentDate = typeof data.next_payment_date === "string" ? data.next_payment_date : null;
    if (!customerEmail || !planCode || !subscriptionCode) return;

    const { data: matched, error: matchError } = await admin
      .from("owner_subscriptions")
      .select("owner_id, checkout_started_at, pending_plan_tier")
      .eq("checkout_email", customerEmail)
      .eq("pending_plan_code", planCode)
      .not("checkout_started_at", "is", null)
      .maybeSingle();
    if (matchError || !matched) return;

    const providerStart = typeof data.start === "number" ? data.start * 1000 : Date.now();
    const checkoutStarted = matched.checkout_started_at ? new Date(matched.checkout_started_at).getTime() : 0;
    if (checkoutStarted && providerStart < checkoutStarted - 120_000) return;

    const { error: subscriptionError } = await admin.from("owner_subscriptions").update({
      paystack_customer_code: typeof customer?.customer_code === "string" ? customer.customer_code : null,
      paystack_subscription_code: subscriptionCode,
      paystack_email_token: emailToken || null,
      ...(nextPaymentDate ? { next_payment_date: nextPaymentDate } : {}),
      updated_at: new Date().toISOString(),
    }).eq("owner_id", matched.owner_id);
    if (subscriptionError) throw new Error("Could not store the Paystack subscription details.");
    return;
  }

  const subscription = isRecord(data.subscription) ? data.subscription : null;
  const subscriptionCode = typeof data.subscription_code === "string"
    ? data.subscription_code
    : typeof subscription?.subscription_code === "string"
      ? subscription.subscription_code
      : "";
  if (!subscriptionCode) return;

  if (event === "invoice.payment_failed" || (event === "invoice.update" && data.paid === true)) {
    const dueValue = typeof data.due_date === "string"
      ? data.due_date
      : typeof data.period_end === "string"
        ? data.period_end
        : "";
    const dueDate = dueValue && !Number.isNaN(Date.parse(dueValue))
      ? new Date(dueValue).toISOString()
      : null;
    if (!dueDate) return;
    const invoiceCode = typeof data.invoice_code === "string" ? data.invoice_code : dueDate;
    const nextPaymentDate = typeof subscription?.next_payment_date === "string" &&
      !Number.isNaN(Date.parse(subscription.next_payment_date))
      ? new Date(subscription.next_payment_date).toISOString()
      : null;
    const { error } = await admin.rpc("record_paystack_invoice_status", {
      target_subscription_code: subscriptionCode,
      target_invoice_code: invoiceCode,
      target_due_date: dueDate,
      target_paid: event === "invoice.update",
      target_next_payment_date: nextPaymentDate,
    });
    if (error) throw new Error("Could not store the ordered Paystack invoice status.");
    return;
  }

  if (event === "subscription.not_renew") {
    const { error } = await admin.from("owner_subscriptions").update({
      cancel_at_period_end: true,
      ...(typeof subscription?.next_payment_date === "string"
        ? { next_payment_date: subscription.next_payment_date }
        : {}),
      checkout_reference: null,
      checkout_url: null,
      checkout_started_at: null,
      checkout_email: null,
      pending_plan_tier: null,
      pending_plan_code: null,
      updated_at: new Date().toISOString(),
    }).eq("paystack_subscription_code", subscriptionCode);
    if (error) throw new Error("Could not store the cancellation status.");
    return;
  }

  if (event === "subscription.disable") {
    const { error } = await admin.from("owner_subscriptions").update({
      status: "canceled",
      cancel_at_period_end: false,
      paystack_subscription_code: null,
      paystack_email_token: null,
      paystack_customer_code: null,
      next_payment_date: null,
      checkout_reference: null,
      checkout_url: null,
      checkout_started_at: null,
      checkout_email: null,
      pending_plan_tier: null,
      pending_plan_code: null,
      updated_at: new Date().toISOString(),
    }).eq("paystack_subscription_code", subscriptionCode);
    if (error) throw new Error("Could not store the canceled subscription status.");
    return;
  }
}
