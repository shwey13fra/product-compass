"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase";

function Callback() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/roles";
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    // With detectSessionInUrl + PKCE the client exchanges the code on load.
    // We just wait for the session to materialise, then forward to `next`.
    async function finish() {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        if (active) router.replace(next);
        return true;
      }
      return false;
    }

    finish();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session && active) router.replace(next);
    });

    // Fallback: if no session shows up, the link was bad or expired.
    const timer = setTimeout(async () => {
      if (!active) return;
      const ok = await finish();
      if (!ok && active) {
        setError(
          "This sign-in link is invalid or has expired. Request a new one."
        );
      }
    }, 4000);

    return () => {
      active = false;
      sub.subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, [next, router]);

  if (error) {
    return (
      <div className="rounded-card border border-danger/30 bg-danger-soft px-6 py-8 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-danger" aria-hidden />
        <p className="mt-3 text-sm text-ink">{error}</p>
        <Link
          href="/signin"
          className="mt-4 inline-block text-sm font-semibold text-primary hover:text-primary-hover"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <Loader2 className="h-7 w-7 animate-spin text-primary" aria-hidden />
      <p className="text-sm text-muted">Signing you in…</p>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12">
      <Suspense
        fallback={
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <Loader2 className="h-7 w-7 animate-spin text-primary" aria-hidden />
            <p className="text-sm text-muted">Signing you in…</p>
          </div>
        }
      >
        <Callback />
      </Suspense>
    </main>
  );
}
