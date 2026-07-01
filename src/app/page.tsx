import Link from "next/link";
import { Compass, ArrowRight, Target, Gauge, MessagesSquare } from "lucide-react";
import { APP_NAME } from "@/config";
import { AuthNav } from "@/components/AuthNav";

// Landing page. Shared entry point for everyone — signed out, signed in, or
// admin. The AuthNav header carries the auth state: signed out shows "Sign in"
// (→ /roles after login); signed in shows Referrals / Admin (if admin) / Sign
// out. No auto-redirect — admins reach the dashboard via the Admin nav link.

const pillars = [
  {
    icon: Target,
    title: "Position for the context",
    body: "Turn your experience into a tailored brief for one specific role — lead story, re-angled metrics, and a 60-second pitch.",
  },
  {
    icon: Gauge,
    title: "Real-PM, not disguised",
    body: "Every curated role is scored 0–100 on whether it owns discovery and outcomes — or just delivery and coordination.",
  },
  {
    icon: MessagesSquare,
    title: "Warm path when you have one",
    body: "Referral roles open a private status strip and thread with the person who can refer you — status, never the contents, visible to admins.",
  },
];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-14 flex items-center justify-between gap-3 sm:mb-20">
        <span className="inline-flex items-center gap-2 text-sm font-medium text-primary">
          <Compass className="h-4 w-4" aria-hidden />
          {APP_NAME}
        </span>
        <AuthNav />
      </header>

      <section className="flex flex-col items-center text-center">
        <span className="inline-flex items-center gap-2 rounded-full bg-surface-alt px-3 py-1 text-xs font-medium text-muted">
          For product managers
        </span>

        <h1 className="mt-5 max-w-3xl font-heading text-4xl font-extrabold leading-[1.1] tracking-tight text-ink sm:text-6xl">
          Position yourself for the role&apos;s context — not just the job title.
        </h1>

        <p className="mt-5 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
          The gap no job platform fills. Pick a curated real-PM role, and{" "}
          {APP_NAME} turns your experience into a positioning brief tailored to
          what that team actually needs.
        </p>

        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
          <Link
            href="/roles"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-btn bg-primary px-6 text-sm font-semibold text-white shadow-[var(--shadow-warm)] transition-colors hover:bg-primary-hover"
          >
            Browse curated PM roles
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          <Link
            href="/tracking"
            className="inline-flex min-h-11 items-center justify-center rounded-btn px-5 text-sm font-semibold text-muted transition-colors hover:bg-surface hover:text-primary"
          >
            View your tracking
          </Link>
        </div>

        <p className="mt-4 text-xs text-muted">
          No sign-up needed to browse, position, and track. Sign in only for
          referral roles and the admin view.
        </p>
      </section>

      <section className="mt-16 grid gap-4 sm:mt-24 sm:grid-cols-3">
        {pillars.map(({ icon: Icon, title, body }) => (
          <div
            key={title}
            className="rounded-card border border-border bg-surface p-5 shadow-[var(--shadow-warm)]"
          >
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary-soft text-primary">
              <Icon className="h-5 w-5" aria-hidden />
            </span>
            <h2 className="mt-4 font-heading text-lg font-bold text-ink">
              {title}
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
