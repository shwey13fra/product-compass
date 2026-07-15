"use client";

import { useEffect, useRef } from "react";
import { track, type EventName } from "@/lib/analytics";

// Fires a single analytics event once on mount. Lets a Server Component (e.g.
// the role detail page) emit a client-side, compass_uid-attached event without
// becoming a client component itself. Renders nothing.
export function TrackEvent({
  name,
  props,
}: {
  name: EventName;
  props?: Record<string, unknown>;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    track(name, props ?? {});
    // Intentionally fire once per mount — props identity changes don't re-fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
