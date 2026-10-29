import { createAdminClient } from "@/lib/supabase/admin";
import { callPaystack, getNumber, getString, isRecord } from "@/lib/billing/paystack";
import { createAuthenticatedServerClient } from "@/lib/supabase/server";

function redirect(request: Request, result: "success" | "failed") {
  const destination = new URL("/", request.url);
  destination.searchParams.set("billing", result);
  return Response.redirect(destination, 303);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const reference = url.searchParams.get("reference")?.trim();
  if (!reference || reference.length > 100) return redirect(request, "failed");

  let supabase;
  try {
    supabase = await createAuthenticatedServerClient();
  } catch {
    return redirect(request, "failed");
  }
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return redirect(request, "failed");

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return redirect(request, "failed");
  }

  const { data: checkout, error: checkoutError } = await admin
    .from("subscription_checkouts")
    .select("reference, owner_id, amount_kobo, status")
    .eq("reference", reference)
    .eq("owner_id", authData.user.id)
    .maybeSingle();
  if (checkoutError || !checkout) return redirect(request, "failed");
  if (checkout.status === "completed") return redirect(request, "success");

  try {
    const result = await callPaystack<{ status: boolean; message: string; data?: Record<string, unknown> }>(
      `/transaction/verify/${encodeURIComponent(reference)}`,
      { method: "GET" },
    );
    const payment = result.data;
    if (!payment || payment.status !== "success" ||
      payment.reference !== reference ||
      payment.currency !== "NGN" ||
      getNumber(payment.amount) !== checkout.amount_kobo) {
      return redirect(request, "failed");
    }

    const customer = isRecord(payment.customer) ? payment.customer : null;
    const subscription = isRecord(payment.subscription) ? payment.subscription : null;
    const { error: completionError } = await admin.rpc("complete_subscription_checkout", {
      target_reference: reference,
      target_owner_id: authData.user.id,
      verified_amount_kobo: checkout.amount_kobo,
      verified_customer_code: getString(customer?.customer_code) ?? "",
      verified_subscription_code: getString(subscription?.subscription_code) ?? "",
      verified_email_token: getString(subscription?.email_token) ?? "",
    });
    if (completionError) return redirect(request, "failed");
    return redirect(request, "success");
  } catch {
    return redirect(request, "failed");
  }
}
