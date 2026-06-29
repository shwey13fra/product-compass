import Link from "next/link";
import { Compass } from "lucide-react";
import { APP_NAME } from "@/config";

// Stage 1 landing page. Proves the app runs and that the "Warm Clay" tokens
// + Inter/Plus Jakarta Sans fonts are applied. No job list / positioning /
// tracking yet (those are later stages).

const swatches = [
  { name: "primary", className: "bg-primary" },
  { name: "accent", className: "bg-accent" },
  { name: "success", className: "bg-success" },
  { name: "danger", className: "bg-danger" },
  { name: "info", className: "bg-info" },
  { name: "surface-alt", className: "bg-surface-alt border border-border" },
];

export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center px-5 py-16">
      <section className="w-full max-w-xl rounded-card bg-surface border border-border shadow-[var(--shadow-warm)] p-8 sm:p-10 text-center">
        <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-primary-soft text-primary">
          <Compass className="h-7 w-7" aria-hidden />
        </span>

        <h1 className="mt-6 font-heading text-4xl sm:text-5xl font-extrabold tracking-tight text-ink">
          {APP_NAME}
        </h1>

        <p className="mt-4 text-base sm:text-lg text-muted leading-relaxed">
          Position yourself for a specific role&apos;s context — the gap no job
          platform fills. This is Stage&nbsp;1: the app runs and the Warm Clay
          styling is live.
        </p>

        {/* Palette proof — confirms theme tokens resolve */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {swatches.map((s) => (
            <div key={s.name} className="flex flex-col items-center gap-1.5">
              <span className={`h-9 w-9 rounded-full ${s.className}`} />
              <span className="text-xs text-muted">{s.name}</span>
            </div>
          ))}
        </div>

        {/* One terracotta primary action per view (CLAUDE.md) */}
        <Link
          href="/roles"
          className="mt-8 inline-flex min-h-11 items-center justify-center rounded-btn bg-primary px-6 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
        >
          Browse curated PM roles
        </Link>

        <p className="mt-6 text-xs text-muted">
          If the heading looks distinctly different from this body text, both
          fonts (Plus Jakarta Sans + Inter) are loading correctly.
        </p>
      </section>
    </main>
  );
}
