import { callPaystack } from "@/lib/billing/paystack";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAuthenticatedServerClient } from "@/lib/supabase/server";

const responseHeaders = { "Cache-Control": "no-store" };

function respond(message: string, status: number) {
  return Response.json({ message }, { status, headers: responseHeaders });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return respond("This request is not allowed.", 403);
  }

  let supabase;
  try {
    supabase = await createAuthenticatedServerClient();
  } catch {
    return respond("Supabase authentication is not configured on this server.", 503);
  }
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError?.name === "AuthSessionMissingError") return respond("Sign in to manage your subscription.", 401);
  if (authError || !authData.user) return respond("Could not verify your account. Sign in again.", 401);

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return respond("Subscription billing is not configured on this server.", 503);
  }

  const { data: secret, error: secretError } = await admin
    .from("paystack_subscription_secrets")
    .select("subscription_code, email_token")
    .eq("owner_id", authData.user.id)
    .maybeSingle();
  if (secretError) return respond("Could not load automatic renewal settings.", 503);
  if (!secret) return respond("Automatic renewal details are not ready yet. Try again after checkout completes.", 409);

  try {
    await callPaystack("/subscription/disable", {
      method: "POST",
      body: JSON.stringify({
        code: secret.subscription_code,
        token: secret.email_token,
      }),
    });
  } catch (reason) {
    return respond(reason instanceof Error ? reason.message : "Paystack could not cancel automatic renewal.", 502);
  }

  const { error: updateError } = await admin
    .from("account_subscriptions")
    .update({ auto_renew: false, updated_at: new Date().toISOString() })
    .eq("owner_id", authData.user.id);
  if (updateError) return respond("Automatic renewal was cancelled, but the app could not refresh its status. Reload shortly.", 503);

  const { error: deleteError } = await admin
    .from("paystack_subscription_secrets")
    .delete()
    .eq("owner_id", authData.user.id);
  if (deleteError) return respond("Automatic renewal was cancelled, but its stored cancellation token could not be removed.", 503);

  return Response.json(
    { message: "Automatic renewal cancelled. Your current paid access remains available until its expiry date." },
    { headers: responseHeaders },
  );
}
