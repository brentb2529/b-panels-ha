// takeoverSignal — a tiny global signal bridging the top-of-tree
// LifeSafetyTakeover (which knows when a non-dismissible annunciation is active)
// to the PanelShell's `suppressIdleReturn` hook (Inc9), WITHOUT prop-drilling
// through every panel.
//
// The takeover mounts ABOVE the scoped router (App.tsx), while the shell mounts
// inside each panel BELOW it. Rather than thread a prop down through 7 panels,
// the takeover publishes its active flag here and the shell subscribes. This is
// pure UI state — no entity, no service, no persistence.
//
// WHY this is sound: idle-return must NEVER outrank a life-safety annunciation
// (FIRE_LIFE_SAFETY_REVIEW §4/§5). When a takeover is active, the shell reads
// `true` here and passes it to usePanelDefault(suppressIdle), which halts the
// idle timer. usePanelDefault ALSO independently suppresses on alarm phase
// (arming/pending/triggered) — this is the belt to that suspenders, covering the
// signal-lost / reconnect path and any future non-alarm life-safety source.

import { useEffect, useState } from 'react';

let active = false;
const listeners = new Set<(v: boolean) => void>();

export const setTakeoverActive = (v: boolean): void => {
  if (v === active) return;
  active = v;
  listeners.forEach((l) => l(active));
};

export const isTakeoverActive = (): boolean => active;

/** Subscribe to the global takeover-active flag (used by the shell). */
export const useTakeoverActive = (): boolean => {
  const [v, setV] = useState<boolean>(active);
  useEffect(() => {
    const l = (next: boolean) => setV(next);
    listeners.add(l);
    setV(active); // sync on mount
    return () => { listeners.delete(l); };
  }, []);
  return v;
};
