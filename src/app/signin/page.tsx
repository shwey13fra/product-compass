"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Compass,
  Mail,
  KeyRound,
  AlertTriangle,
  Loader2,
  ArrowLeft,
} from "lucide-react";
import { signInWithEmail, verifyEmailOtp } from "@/lib/auth";

function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/roles";

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  // "email" = ask for email · "code" = code sent, ask for the 6 digits.
  const [phase, setPhase] = useState<
    "email" | "sending" | "code" | "verifying"
  >("email");
  const [error, setError] = useState<string | null>(null);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setPhase("sending");
    setError(null);
    const res = await signInWithEmail(email, next);
    if (res.ok) {
      setPhase("code");
    } else {
      setError(res.error);
      setPhase("email");
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setPhase("verifying");
    setError(null);
    const res = await verifyEmailOtp(email, code);
    if (res.ok) {
      // Session is set — go where they were headed (admins land on /roles and
      // then see the Admin link in the header).
      router.replace(next);
    } else {
      setError(res.error);
      setPhase("code");
    }
  }

  // Step 2 — enter the 6-digit code.
  if (phase === "code" || phase === "verifying") {
    return (
      <form
        onSubmit={verify}
        className="rounded-card border border-border bg-surface p-6 shadow-sm"
      >
        <div className="flex items-center gap-2 rounded-btn bg-success-soft px-3 py-2 text-sm text-ink">
          <Mail className="h-4 w-4 text-success" aria-hidden />
          Code sent to <span className="font-semibold">{email}</span>
        </div>

        <label
          htmlFor="code"
          className="mt-4 block text-sm font-semibold text-ink"
        >
          Sign-in code
        </label>
        <div className="mt-1.5 flex items-center gap-2 rounded-btn border border-border bg-bg px-3 focus-within:border-primary">
          <KeyRound className="h-4 w-4 text-muted" aria-hidden />
          <input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={10}
            required
            autoFocus
            value={code}
            onChange={(e) =>
              setCode(e.target.value.replace(/\D/g, "").slice(0, 10))
            }
            placeholder="Code from your email"
            className="min-h-[44px] w-full bg-transparent text-lg tracking-[0.3em] text-ink outline-none placeholder:text-base placeholder:tracking-normal placeholder:text-muted"
          />
        </div>

        {error ? (
          <p className="mt-2 flex items-center gap-1.5 text-sm text-danger">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={phase === "verifying" || code.length < 6}
          className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-btn bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
        >
          {phase === "verifying" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Verifying…
            </>
          ) : (
            "Verify & sign in"
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            setPhase("email");
            setCode("");
            setError(null);
          }}
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Use a different email
        </button>

        <p className="mt-3 text-xs text-muted">
          Same email also contains a one-tap link if you prefer — but the code is
          the most reliable (works even if Gmail pre-scans the link, or you open
          it in another browser).
        </p>
      </form>
    );
  }

  // Step 1 — enter email.
  return (
    <form
      onSubmit={sendCode}
      className="rounded-card border border-border bg-surface p-6 shadow-sm"
    >
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

      {error ? (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-danger">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={phase === "sending"}
        className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-btn bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
      >
        {phase === "sending" ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Sending code…
          </>
        ) : (
          "Send sign-in code"
        )}
      </button>

      <p className="mt-3 text-xs text-muted">
        Passwordless — we email you a 6-digit code (and a one-tap link). Sign-in
        is only needed for referral roles and the admin view; browsing,
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
        Enter your email and we’ll send you a 6-digit sign-in code.
      </p>
      <div className="mt-6">
        <Suspense
          fallback={
            <div className="h-48 rounded-card border border-border bg-surface" />
          }
        >
          <SignInForm />
        </Suspense>
      </div>
    </main>
  );
}
