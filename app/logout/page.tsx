"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LogoutPage() {
  const router = useRouter();
  useEffect(() => {
    const run = async () => {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push("/login");
    };
    run();
  }, [router]);
  return <p style={{ padding: 20 }}>Logging out...</p>;
}

