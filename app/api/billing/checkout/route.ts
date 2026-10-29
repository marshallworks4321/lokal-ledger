import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { callPaystack, getString, isRecord } from "@/lib/billing/paystack";
import { createAuthenticatedServerClient } from "@/lib/supabase/server";

type CheckoutMode = "manual" | "automatic";
type PlanTier = "single" | "multi";

const responseHeaders = { "Cache-Control": "no-store" };

function respond(message: string, status: number) {
  return Response.json({ message }, { status, headers: responseHeaders });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return respond("This request is not allowed.", 403);
  }

  let body: unknown;
  try {
    const bodyText = await request.text();
    if (bodyText.length > 1024) return respond("Checkout request is too large.", 413);
    body = JSON.parse(bodyText);
  } catch {
    return respond("Send a valid subscription checkout request.", 400);
  }
  if (!isRecord(body) || (body.mode !== "manual" && body.mode !== "automatic") ||
    (body.tier !== "single" && body.tier !== "multi")) {
    return respond("Choose a valid monthly plan and payment method.", 400);
  }

  let supabase;
  try {
    supabase = await createAuthenticatedServerClient();
  } catch {
    return respond("Supabase authentication is not configured on this server.", 503);
  }
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError?.name === "AuthSessionMissingError") return respond("Sign in to subscribe.", 401);
  if (authError || !authData.user?.email) return respond("Could not verify your account. Sign in again.", 401);

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return respond("Subscription billing is not configured on this server.", 503);
  }

  const { count: businessCount, error: businessError } = await admin
    .from("businesses")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", authData.user.id);
  if (businessError) return respond("Could not check the businesses on your account.", 503);
  if (!businessCount) return respond("Create your first business before choosing a subscription.", 400);

  const mode = body.mode as CheckoutMode;
  const tier = body.tier as PlanTier;
  if (businessCount > 1 && tier !== "multi") {
    return respond("An account managing multiple businesses must use the ₦5,000 plan.", 400);
  }

  const amountKobo = tier === "multi" ? 500000 : 300000;
  const planCode = mode === "automatic"
    ? process.env[tier === "multi" ? "PAYSTACK_PLAN_MULTI" : "PAYSTACK_PLAN_SINGLE"]?.trim()
    : undefined;
  if (mode === "automatic" && !planCode) {
    return respond(`Set the Paystack ${tier === "multi" ? "multi-business" : "single-business"} monthly plan code on the server first.`, 503);
  }

  const reference = `lokal-${randomUUID()}`;
  const { error: checkoutError } = await admin.from("subscription_checkouts").insert({
    reference,
    owner_id: authData.user.id,
    customer_email: authData.user.email.toLocaleLowerCase(),
    plan_tier: tier,
    billing_mode: mode,
    amount_kobo: amountKobo,
  });
  if (checkoutError) {
    return respond("Could not prepare your secure subscription checkout. Try again shortly.", 503);
  }

  try {
    const callbackUrl = new URL("/api/billing/callback", request.url).toString();
    const result = await callPaystack<{ status: boolean; message: string; data?: Record<string, unknown> }>(
      "/transaction/initialize",
      {
        method: "POST",
        body: JSON.stringify({
          email: authData.user.email,
          amount: String(amountKobo),
          currency: "NGN",
          reference,
          callback_url: callbackUrl,
          metadata: {
            owner_id: authData.user.id,
            plan_tier: tier,
            billing_mode: mode,
          },
          ...(planCode ? { plan: planCode } : {}),
        }),
      },
    );
    const authorizationUrl = getString(result.data?.authorization_url);
    if (!authorizationUrl) {
      return respond("Paystack did not return a checkout link. Try again shortly.", 502);
    }
    const checkoutUrl = new URL(authorizationUrl);
    if (checkoutUrl.protocol !== "https:" || !checkoutUrl.hostname.endsWith("paystack.com")) {
      return respond("Paystack returned an invalid checkout link.", 502);
    }
    return Response.json({ authorizationUrl: checkoutUrl.toString() }, { headers: responseHeaders });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "Paystack could not start checkout.";
    const { error: cleanupError } = await admin.from("subscription_checkouts").delete().eq("reference", reference);
    if (cleanupError) {
      return respond("Paystack checkout failed, and its pending reference could not be cleared. Contact support before retrying.", 503);
    }
    return respond(message, 502);
  }
}
