// Streamed loading state for the roles list (Next.js App Router convention).
export default function RolesLoading() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
      <div className="mb-8 space-y-3">
        <div className="h-4 w-32 animate-pulse rounded-full bg-surface-alt" />
        <div className="h-9 w-72 animate-pulse rounded-lg bg-surface-alt" />
        <div className="h-5 w-full max-w-2xl animate-pulse rounded bg-surface-alt" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-44 animate-pulse rounded-card border border-border bg-surface"
          />
        ))}
      </div>
    </main>
  );
}
