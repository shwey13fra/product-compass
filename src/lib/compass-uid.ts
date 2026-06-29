// Anonymous identity for v1 (no auth). We store a UUID called `compass_uid`
// in localStorage and use it as `owner_key` for applications + briefs.
// Client-only: localStorage doesn't exist on the server.

const STORAGE_KEY = "compass_uid";

/**
 * Returns the existing compass_uid, or creates and stores a new one.
 * Returns null when called outside the browser (e.g. during SSR).
 */
export function getCompassUid(): string | null {
  if (typeof window === "undefined") return null;

  let uid = window.localStorage.getItem(STORAGE_KEY);
  if (!uid) {
    uid = crypto.randomUUID();
    window.localStorage.setItem(STORAGE_KEY, uid);
  }
  return uid;
}
