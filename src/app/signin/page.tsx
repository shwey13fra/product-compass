"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Compass, Mail, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { signInWithEmail } from "@/lib/auth";

function SignInForm() {
  const params = useSearchParams();
  const next = params.get("next") ?? undefined;

  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">(
    "idle"
  );
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    setError(null);
    const res = await signInWithEmail(email, next);
    if (res.ok) {
      setState("sent");
    } else {
      setError(res.error);
      setState("error");
    }
  }

  if (state === "sent") {
    return (
      <div className="rounded-card border border-success/30 bg-success-soft px-6 py-8 text-center">
        <CheckCircle2 className="mx-auto h-9 w-9 text-success" aria-hidden />
        <h2 className="mt-3 font-heading text-xl font-bold text-ink">
          Check your inbox
        </h2>
        <p className="mt-1.5 text-sm text-muted">
          We sent a one-tap sign-in link to{" "}
          <span className="font-semibold text-ink">{email}</span>. Open it on
          this device to finish signing in.
        </p>
        <button
          type="button"
          onClick={() => setState("idle")}
          className="mt-4 text-sm font-semibold text-primary hover:text-primary-hover"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="rounded-card border border-border bg-surface p-6 shadow-sm">
      <label htmlFor="email" className="block text-sm font-semibold text-ink">
        Email address
      </label>
      <div className="mt-1.5 flex items-center gap-2 rounded-btn border border-border bg-bg px-3 focus-within:border-primary">
        <Mail className="h-4 w-4 text-muted" aria-hidden />
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="min-h-[44px] w-full bg-transparent text-sm text-ink outline-none placeholder:text-muted"
        />
      </div>

      {state === "error" && error ? (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-danger">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={state === "sending"}
        className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-btn bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
      >
        {state === "sending" ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Sending link…
          </>
        ) : (
          "Send sign-in link"
        )}
      </button>

      <p className="mt-3 text-xs text-muted">
        Passwordless — we email you a one-tap link, no password to remember.
        Sign-in is only needed for referral roles and the admin view; browsing,
        positioning, and personal tracking work without it.
      </p>
    </form>
  );
}

export default function SignInPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-12 sm:py-16">
      <Link
        href="/roles"
        className="inline-flex items-center gap-2 text-sm font-medium text-primary"
      >
        <Compass className="h-4 w-4" aria-hidden />
        Product Compass
      </Link>
      <h1 className="mt-4 font-heading text-3xl font-extrabold tracking-tight text-ink">
        Sign in with email
      </h1>
      <p className="mt-2 text-sm text-muted">
        Enter your email and we’ll send you a one-tap sign-in link.
      </p>
      <div className="mt-6">
        <Suspense fallback={<div className="h-48 rounded-card border border-border bg-surface" />}>
          <SignInForm />
        </Suspense>
      </div>
    </main>
  );
}
