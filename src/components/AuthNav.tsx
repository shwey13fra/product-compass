"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogIn, LogOut, Shield, Users } from "lucide-react";
import { useUser, signOut, isAdminEmail } from "@/lib/auth";
import { getUnread } from "@/lib/referrals";

// Auth-aware nav controls. Drop into any page header. Signed out → "Sign in".
// Signed in → email + Referrals (with unread dot) + Admin (if admin) + Sign out.
export function AuthNav() {
  const { user, loading } = useUser();
  const pathname = usePathname();
  const [hasUnread, setHasUnread] = useState(false);

  const admin = isAdminEmail(user?.email);

  useEffect(() => {
    if (!user) {
      setHasUnread(false);
      return;
    }
    let active = true;
    getUnread(user.id).then((r) => {
      if (active) setHasUnread(r.any);
    });
    return () => {
      active = false;
    };
  }, [user, pathname]);

  if (loading) {
    return <div className="h-[44px] w-24 animate-pulse rounded-btn bg-surface-alt" />;
  }

  if (!user) {
    // Landing page ("/") has no per-page context to return to, so sign-in
    // lands everyone on /roles. Every other page returns you to where you were
    // (e.g. a referral role keeps its own next → back to that role).
    const signInNext = pathname === "/" ? "/roles" : pathname;
    return (
      <Link
        href={`/signin?next=${encodeURIComponent(signInNext)}`}
        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-btn px-3 text-sm font-semibold text-muted transition-colors hover:bg-surface hover:text-primary"
      >
        <LogIn className="h-4 w-4" aria-hidden />
        Sign in
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Link
        href="/referrals"
        className="relative inline-flex min-h-[44px] items-center gap-1.5 rounded-btn px-3 text-sm font-semibold text-muted transition-colors hover:bg-surface hover:text-primary"
      >
        <Users className="h-4 w-4" aria-hidden />
        Referrals
        {hasUnread ? (
          <span
            className="absolute right-1.5 top-2 h-2 w-2 rounded-full bg-primary"
            aria-label="Unread updates"
          />
        ) : null}
      </Link>

      {admin ? (
        <Link
          href="/admin"
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-btn px-3 text-sm font-semibold text-muted transition-colors hover:bg-surface hover:text-primary"
        >
          <Shield className="h-4 w-4" aria-hidden />
          Admin
        </Link>
      ) : null}

      <span
        className="hidden max-w-[14ch] truncate px-2 text-xs text-muted sm:inline"
        title={user.email ?? ""}
      >
        {user.email}
      </span>

      <button
        type="button"
        onClick={() => signOut()}
        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-btn px-3 text-sm font-semibold text-muted transition-colors hover:bg-surface hover:text-danger"
      >
        <LogOut className="h-4 w-4" aria-hidden />
        <span className="hidden sm:inline">Sign out</span>
      </button>
    </div>
  );
}
