import Link from "next/link";
import { Compass, AlertTriangle, Inbox, ListChecks } from "lucide-react";
import { getRoles } from "@/lib/roles";
import { RolesBrowser } from "@/components/RolesBrowser";

export const metadata = {
  title: "Roles — Product Compass",
};

// Always fetch fresh on request; roles are shared/seeded data.
export const dynamic = "force-dynamic";

export default async function RolesPage() {
  const result = await getRoles();

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-8">
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 text-sm font-medium text-primary">
            <Compass className="h-4 w-4" aria-hidden />
            Product Compass
          </span>
          <Link
            href="/tracking"
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-btn px-3 text-sm font-semibold text-muted transition-colors hover:bg-surface hover:text-primary"
          >
            <ListChecks className="h-4 w-4" aria-hidden />
            Tracking
          </Link>
        </div>
        <h1 className="mt-2 font-heading text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
          Curated PM roles
        </h1>
        <p className="mt-2 max-w-2xl text-base text-muted">
          Real-PM roles scored 0–100 for whether they own discovery and outcomes
          (genuine) or just delivery and coordination (disguised). Filter by
          archetype and skip the disguised ones.
        </p>
      </header>

      {!result.ok ? (
        <ErrorState message={result.error} />
      ) : result.roles.length === 0 ? (
        <EmptyState />
      ) : (
        <RolesBrowser roles={result.roles} />
      )}
    </main>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-card border border-danger/30 bg-danger-soft px-6 py-16 text-center">
      <AlertTriangle className="h-8 w-8 text-danger" aria-hidden />
      <h2 className="mt-4 font-heading text-lg font-bold text-ink">
        Couldn’t load roles
      </h2>
      <p className="mt-1.5 max-w-md text-sm text-muted">{message}</p>
      <p className="mt-1 text-xs text-muted">
        Check the Supabase env vars and that the <code>roles</code> table is
        reachable, then reload.
      </p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-card border border-dashed border-border bg-surface-alt px-6 py-16 text-center">
      <Inbox className="h-8 w-8 text-muted" aria-hidden />
      <h2 className="mt-4 font-heading text-lg font-bold text-ink">
        No roles yet
      </h2>
      <p className="mt-1.5 max-w-md text-sm text-muted">
        The roles table is empty. Seed it (see <code>seed.sql</code>) and reload
        this page.
      </p>
    </div>
  );
}
