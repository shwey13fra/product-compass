"use client";

// Stage 15 — account dropdown off the header: shows the signed-in email, a
// notifications toggle (default on, respected server-side before every send), and
// sign out. Replaces the inline email + sign-out cluster in AuthNav.

import { useEffect, useRef, useState } from "react";
import { ChevronDown, LogOut, Bell, BellOff, Loader2 } from "lucide-react";
import { signOut } from "@/lib/auth";
import { getMyEmailPref, setMyEmailPref } from "@/lib/notificationPrefs";

export function AccountMenu({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState<boolean | null>(null); // null = loading
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Load the pref once the menu is first opened (avoids a query on every page).
  useEffect(() => {
    if (!open || enabled !== null) return;
    let active = true;
    getMyEmailPref(email).then((v) => {
      if (active) setEnabled(v);
    });
    return () => {
      active = false;
    };
  }, [open, enabled, email]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function toggle() {
    if (enabled === null || saving) return;
    const next = !enabled;
    setEnabled(next); // optimistic
    setSaving(true);
    const ok = await setMyEmailPref(email, next);
    setSaving(false);
    if (!ok) setEnabled(!next); // revert on failure
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-btn px-3 text-sm font-semibold text-muted transition-colors hover:bg-surface hover:text-primary"
      >
        <span className="hidden max-w-[16ch] truncate sm:inline" title={email}>
          {email}
        </span>
        <ChevronDown className="h-4 w-4" aria-hidden />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1 w-64 rounded-card border border-border bg-surface p-2 shadow-[var(--shadow-warm)]"
        >
          <div className="px-2 py-1.5 text-xs text-muted sm:hidden" title={email}>
            {email}
          </div>

          <div className="flex items-center justify-between gap-3 rounded-btn px-2 py-2">
            <span className="flex items-center gap-2 text-sm font-medium text-ink">
              {enabled === false ? (
                <BellOff className="h-4 w-4 text-muted" aria-hidden />
              ) : (
                <Bell className="h-4 w-4 text-primary" aria-hidden />
              )}
              Email notifications
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={enabled === true}
              aria-label="Toggle email notifications"
              disabled={enabled === null || saving}
              onClick={toggle}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
                enabled ? "bg-primary" : "bg-border"
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                  enabled ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>
          {enabled === null && (
            <p className="flex items-center gap-1.5 px-2 pb-1 text-xs text-muted">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              Loading preference…
            </p>
          )}

          <div className="my-1 h-px bg-border" />

          <button
            type="button"
            role="menuitem"
            onClick={() => signOut()}
            className="flex w-full items-center gap-2 rounded-btn px-2 py-2 text-sm font-semibold text-muted transition-colors hover:bg-surface-alt hover:text-danger"
          >
            <LogOut className="h-4 w-4" aria-hidden />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
