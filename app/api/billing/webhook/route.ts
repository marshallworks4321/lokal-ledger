import { createHmac, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getNumber, getString, isRecord } from "@/lib/billing/paystack";

type SubscriptionAccount = {
  owner_id: string;
  billing_mode: string | null;
};

const responseHeaders = { "Cache-Control": "no-store" };

function respond(status: number) {
  return Response.json({ received: status < 400 }, { status, headers: responseHeaders });
}

function getNestedString(value: unknown, key: string) {
  return isRecord(value) ? getString(value[key]) : null;
}

function validSignature(payload: string, signature: string, secret: string) {
  if (!/^[a-f0-9]{128}$/i.test(signature)) return false;
  const expected = createHmac("sha512", secret).update(payload).digest();
  const supplied = Buffer.from(signature, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function findSubscriptionAccount(
  admin: ReturnType<typeof createAdminClient>,
  subscriptionCode: string | null,
  customerCode: string | null,
) {
  if (subscriptionCode) {
    const { data, error } = await admin.from("account_subscriptions")
      .select("owner_id, billing_mode")
      .eq("paystack_subscription_code", subscriptionCode)
      .maybeSingle();
    if (error) throw new Error("Could not locate the automatic subscription.");
    if (data) return data as SubscriptionAccount;
  }
  if (customerCode) {
    const { data, error } = await admin.from("account_subscriptions")
      .select("owner_id, billing_mode")
      .eq("paystack_customer_code", customerCode)
      .maybeSingle();
    if (error) throw new Error("Could not locate the automatic subscription.");
    if (data) return data as SubscriptionAccount;
  }
  return null;
}

export async function POST(request: Request) {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) return respond(503);

  const signature = request.headers.get("x-paystack-signature") ?? "";
  const body = await request.text();
  if (body.length > 256_000) return respond(413);
  if (!validSignature(body, signature, secret)) return respond(401);

  let event: unknown;
  try {
    event = JSON.parse(body);
  } catch {
    return respond(400);
  }
  if (!isRecord(event) || typeof event.event !== "string" || !isRecord(event.data)) {
    return respond(400);
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return respond(503);
  }

  const data = event.data;
  const customerCode = getNestedString(data.customer, "customer_code");
  const subscriptionCode = getNestedString(data.subscription, "subscription_code") ??
    getString(data.subscription_code);

  try {
    if (event.event === "subscription.create") {
      const customerEmail = getNestedString(data.customer, "email")?.toLocaleLowerCase();
      const emailToken = getString(data.email_token);
      if (!customerEmail || !emailToken || !subscriptionCode || !customerCode) {
        return respond(200);
      }

      const { data: checkout, error: checkoutError } = await admin
        .from("subscription_checkouts")
        .select("owner_id")
        .eq("customer_email", customerEmail)
        .eq("billing_mode", "automatic")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (checkoutError) throw new Error("Could not associate the Paystack subscription.");
      if (!checkout) return respond(200);

      const { error: accountError } = await admin
        .from("account_subscriptions")
        .update({
          paystack_customer_code: customerCode,
          paystack_subscription_code: subscriptionCode,
          auto_renew: true,
          updated_at: new Date().toISOString(),
        })
        .eq("owner_id", checkout.owner_id);
      if (accountError) throw new Error("Could not save the Paystack subscription link.");

      const { error: secretError } = await admin.from("paystack_subscription_secrets").upsert({
        owner_id: checkout.owner_id,
        subscription_code: subscriptionCode,
        email_token: emailToken,
        updated_at: new Date().toISOString(),
      });
      if (secretError) throw new Error("Could not securely save the subscription cancellation token.");
      return respond(200);
    }

    if (event.event === "subscription.disable" || event.event === "subscription.not_renew") {
      const account = await findSubscriptionAccount(admin, subscriptionCode, customerCode);
      if (!account) return respond(200);
      const { error: updateError } = await admin
        .from("account_subscriptions")
        .update({ auto_renew: false, updated_at: new Date().toISOString() })
        .eq("owner_id", account.owner_id);
      if (updateError) throw new Error("Could not update subscription renewal status.");
      if (event.event === "subscription.disable") {
        const { error: secretError } = await admin
          .from("paystack_subscription_secrets")
          .delete()
          .eq("owner_id", account.owner_id);
        if (secretError) throw new Error("Could not remove the cancelled subscription token.");
      }
      return respond(200);
    }

    if (event.event !== "charge.success") return respond(200);

    const reference = getString(data.reference);
    const amount = getNumber(data.amount);
    if (!reference || amount === null || data.currency !== "NGN") return respond(400);

    const { data: checkout, error: checkoutError } = await admin
      .from("subscription_checkouts")
      .select("owner_id, amount_kobo")
      .eq("reference", reference)
      .maybeSingle();
    if (checkoutError) throw new Error("Could not verify the subscription checkout.");

    if (checkout) {
      if (checkout.amount_kobo !== amount) return respond(400);
      const { error: completionError } = await admin.rpc("complete_subscription_checkout", {
        target_reference: reference,
        target_owner_id: checkout.owner_id,
        verified_amount_kobo: amount,
        verified_customer_code: customerCode ?? "",
        verified_subscription_code: subscriptionCode ?? "",
        verified_email_token: getString(data.email_token) ?? "",
      });
      if (completionError) throw new Error("Could not record the verified subscription payment.");
      return respond(200);
    }

    const account = await findSubscriptionAccount(admin, subscriptionCode, customerCode);
    if (!account || account.billing_mode !== "automatic") return respond(200);
    const { error: renewalError } = await admin.rpc("record_subscription_renewal", {
      target_reference: reference,
      target_owner_id: account.owner_id,
      verified_amount_kobo: amount,
      verified_customer_code: customerCode ?? "",
    });
    if (renewalError) throw new Error("Could not record the verified subscription renewal.");
    return respond(200);
  } catch {
    return respond(500);
  }
}
