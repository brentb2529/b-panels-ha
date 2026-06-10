// ---------------------------------------------------------------------------
// panelScoping — PURE helpers for the OPTIONAL per-user PIN scoping layer
// (Admin Stage 4, Increment 13). No React, no DOM — fully unit-testable.
//
// RECONCILIATION with the v13 local-first nav model (memory: bpanels-
// navigation-ia, usePanelDefault):
//   • MOST panels are OPEN, trusted, full-house panels. They carry no
//     `visibleToUsers` and are reachable by anyone, with NO PIN. This is the
//     default and stays the default — Stage 4 does not lock anything that
//     wasn't explicitly scoped by an admin.
//   • A panel is SCOPED only when `visibleToUsers` is present AND non-empty.
//     Switching to a scoped panel requires unlocking a `User` whose id is in
//     that list (via the user's PIN), UNLESS the panel is the device's own
//     configured default — the local-first landing is always open on its own
//     device (you can't lock a panel out from under the iPad that lives on it).
//   • A life-safety takeover ALWAYS overrides scoping. It is enforced ABOVE the
//     router and these helpers are never consulted for it; the comments here
//     just record the invariant. `panelRequiresUnlock` returns false for the
//     device default so idle-return (which navigates to the default) is never
//     blocked either.
//
// This is convenience-grade UI scoping, NOT tamper-proof. A motivated user can
// reach a route directly; the integration's own auth is the real boundary.
// Never log PINs.
// ---------------------------------------------------------------------------

import type { DashboardPanel, User } from '../types';

/** True when a panel is scoped (has a non-empty allow-list of user ids). */
export function isPanelScoped(panel: Pick<DashboardPanel, 'visibleToUsers'>): boolean {
  return Array.isArray(panel.visibleToUsers) && panel.visibleToUsers.length > 0;
}

/**
 * Does navigating to `panel` require a PIN unlock right now?
 *
 *   false (open) when ANY of:
 *     • the panel is not scoped (no/empty visibleToUsers) — the common case;
 *     • the panel is this device's configured default (local-first landing);
 *     • one of the panel's allowed users is already unlocked this session.
 *   true otherwise.
 *
 * `deviceDefaultPanelId` is the per-device localStorage default (usePanelDefault).
 * `unlockedUserIds` is the in-memory set of users unlocked this session.
 */
export function panelRequiresUnlock(
  panel: Pick<DashboardPanel, 'id' | 'visibleToUsers'>,
  opts: { deviceDefaultPanelId: string | null; unlockedUserIds: ReadonlySet<string> },
): boolean {
  if (!isPanelScoped(panel)) return false;                       // open panel
  if (opts.deviceDefaultPanelId && panel.id === opts.deviceDefaultPanelId) return false; // local-first landing
  const allowed = panel.visibleToUsers ?? [];
  for (const uid of allowed) {
    if (opts.unlockedUserIds.has(uid)) return false;             // already unlocked
  }
  return true;
}

/**
 * Constant-time-ish PIN compare — avoids a trivial early-exit timing leak.
 * Convenience-grade only. Never log either argument.
 */
export function pinsMatch(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    // eslint-disable-next-line no-bitwise
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Find the `User` that an entered PIN unlocks FOR a given target panel: the PIN
 * must match a user AND that user must be in the panel's `visibleToUsers`.
 * Returns the matched user id, or null (denied / no match). Never log the PIN.
 */
export function findUnlockingUser(
  enteredPin: string,
  panel: Pick<DashboardPanel, 'visibleToUsers'>,
  users: User[],
): string | null {
  const allowed = new Set(panel.visibleToUsers ?? []);
  for (const u of users) {
    if (allowed.has(u.id) && pinsMatch(enteredPin, u.pin)) return u.id;
  }
  return null;
}

/**
 * The visibility filter for nav surfaces (Go Anywhere sheet, switcher): which
 * panels should be OFFERED to this device right now. Open panels and the device
 * default are always shown; scoped panels are shown only if already unlocked OR
 * if `showLocked` (we still SHOW them with a lock affordance so the homeowner
 * can choose to PIN in — hiding them entirely would be confusing). Default
 * `showLocked: true` preserves "show but gate", matching the curation-not-
 * restriction model. Pass `showLocked: false` for surfaces that must hide
 * out-of-scope panels entirely.
 */
export function visiblePanels(
  panels: DashboardPanel[],
  opts: {
    deviceDefaultPanelId: string | null;
    unlockedUserIds: ReadonlySet<string>;
    showLocked?: boolean;
  },
): DashboardPanel[] {
  const showLocked = opts.showLocked ?? true;
  return panels.filter((p) => {
    if (!isPanelScoped(p)) return true;
    if (opts.deviceDefaultPanelId && p.id === opts.deviceDefaultPanelId) return true;
    const unlocked = !panelRequiresUnlock(p, opts);
    return unlocked || showLocked;
  });
}
