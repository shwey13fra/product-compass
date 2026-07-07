import { ArrowUpRight } from "lucide-react";

// Stage 8 — ingested roles link OUT to the real posting (no fake apply).
export function ApplyOutButton({ url, source }: { url: string; source: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-5 inline-flex min-h-[44px] items-center gap-2 rounded-btn bg-primary px-5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
    >
      Apply on {source}
      <ArrowUpRight className="h-4 w-4" aria-hidden />
    </a>
  );
}
