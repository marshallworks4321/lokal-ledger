import { createAdminClient } from "@/lib/supabase/admin";
import { activateSubscriptionFromReference, getPaystackSecret } from "@/lib/billing/paystack";
import { createRequestClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const reference = url.searchParams.get("reference") ?? url.searchParams.get("trxref") ?? "";
  const destination = new URL("/", request.url);

  if (!reference || reference.length > 100) {
    destination.searchParams.set("billing", "failed");
    return Response.redirect(destination, 303);
  }

  const supabase = await createRequestClient();
  const secret = getPaystackSecret();
  if (!supabase || !secret) {
    destination.searchParams.set("billing", "processing");
    return Response.redirect(destination, 303);
  }
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    destination.searchParams.set("billing", "processing");
    return Response.redirect(destination, 303);
  }

  try {
    const admin = createAdminClient();
    const { data: checkout } = await admin
      .from("owner_subscriptions")
      .select("owner_id")
      .eq("checkout_reference", reference)
      .maybeSingle();
    if (checkout?.owner_id === authData.user.id) {
      const activated = await activateSubscriptionFromReference(admin, reference, secret);
      destination.searchParams.set("billing", activated ? "success" : "processing");
    } else {
      destination.searchParams.set("billing", "processing");
    }
  } catch {
    destination.searchParams.set("billing", "processing");
  }

  return Response.redirect(destination, 303);
}
