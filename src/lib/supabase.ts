import { createClient } from "@supabase/supabase-js";

// Browser/anon Supabase client. Uses the ANON public key ONLY — never the
// service-role key (CLAUDE.md security rule). Safe to import from client and
// server components. Stage 7 adds auth (magic link): the anonymous user side
// still works without signing in; RLS isolates the authed referral tables.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Surfaced clearly during dev if .env.local hasn't been filled in yet.
  throw new Error(
    "Missing Supabase env vars. Add NEXT_PUBLIC_SUPABASE_URL and " +
      "NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local, then restart `npm run dev`."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Persist the magic-link session in the browser and refresh it; detect the
    // session in the callback URL (PKCE) so sign-in completes client-side.
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "pkce",
  },
});
