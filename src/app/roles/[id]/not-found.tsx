import Link from "next/link";
import { Compass } from "lucide-react";

export default function RoleNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-4 py-20 text-center">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-surface-alt text-muted">
        <Compass className="h-6 w-6" aria-hidden />
      </span>
      <h1 className="mt-5 font-heading text-2xl font-bold text-ink">
        Role not found
      </h1>
      <p className="mt-2 max-w-sm text-sm text-muted">
        This role doesn’t exist or is no longer available.
      </p>
      <Link
        href="/roles"
        className="mt-6 inline-flex min-h-11 items-center rounded-btn bg-primary px-5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
      >
        Browse all roles
      </Link>
    </main>
  );
}
