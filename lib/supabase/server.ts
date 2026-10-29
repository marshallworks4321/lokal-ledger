import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { authCookieOptions, getSupabaseConfig } from "@/lib/supabase/client";

export async function createAuthenticatedServerClient() {
  const config = getSupabaseConfig();
  if (!config) throw new Error("Supabase authentication is not configured on this server.");

  const cookieStore = await cookies();
  return createServerClient(config.url, config.publishableKey, {
    cookieOptions: authCookieOptions,
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
      },
    },
  });
}
