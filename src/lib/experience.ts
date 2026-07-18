// Stage 3 — the PM's saved "My Experience" profile.
// Filled once, persisted to localStorage, reused for every positioning prompt.
// Client-only: localStorage doesn't exist on the server. NO AI calls here.

import type { Archetype } from "@/lib/types";

export type ExperienceProfile = {
  version: 1;
  name: string;
  headline: string; // one-line "who I am" (e.g. "PM, 4 yrs, fintech")
  experience: string; // free-text: roles, wins, metrics
  archetype: Archetype | null; // the PM's own preferred archetype
  updatedAt: string; // ISO
};

const KEY = "compass_experience";

export function emptyExperience(): ExperienceProfile {
  return {
    version: 1,
    name: "",
    headline: "",
    experience: "",
    archetype: null,
    updatedAt: new Date().toISOString(),
  };
}

// A profile is usable for positioning once it has some experience text.
export function isExperienceReady(p: ExperienceProfile | null): p is ExperienceProfile {
  return !!p && p.experience.trim().length > 0;
}

export function loadExperience(): ExperienceProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as ExperienceProfile;
    if (p?.version !== 1) return null;
    return p;
  } catch {
    return null;
  }
}

export function saveExperience(p: ExperienceProfile): void {
  if (typeof window === "undefined") return;
  const next: ExperienceProfile = { ...p, version: 1, updatedAt: new Date().toISOString() };
  window.localStorage.setItem(KEY, JSON.stringify(next));
}

// Stage 14 — write a profile to localStorage WITHOUT re-stamping updatedAt.
// Used when hydrating from the server (the remote copy already carries its own,
// possibly-newer timestamp); re-stamping here would corrupt the newest-wins
// comparison on the next reconcile. saveExperience() stays the door for user edits.
export function writeExperienceRaw(p: ExperienceProfile): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify({ ...p, version: 1 }));
}
