/**
 * Panel + user definitions — the named "scoped views" system for b-panels.
 *
 * A "panel" is a named, hand-specified subset of areas/sections that a
 * particular physical device (iPad) boots into and stays within. The scope
 * keys MUST match the NavRail / HomeOverview / AreaView area keys exactly:
 *   home, pool, climate, security, lights, generator
 *
 * ACCESS MODEL — per USER, not per panel:
 *   - A USER (access profile) has a PIN and a list of panel ids they may access.
 *   - Panels themselves have NO pin. Any panel a device boots into is open.
 *   - Switching to a panel that isn't already unlocked prompts for a PIN. The
 *     entered PIN must match a user whose `panels` list includes the requested
 *     target panel. On success the WHOLE user is unlocked for the session —
 *     all of that user's panels become freely switchable until page reload.
 *
 * IMPORTANT: This is convenience-grade UI scoping, NOT a tamper-proof security
 * boundary. A sufficiently motivated user could reach out-of-scope routes
 * directly. The intent is per-room panel simplicity (a pool-room iPad only
 * shows pool) and optional PIN deterrence for casual switching, not access
 * control. Do not rely on this for anything security-critical.
 *
 * PIN storage: PINs are stored as plain strings here. They are compared with a
 * constant-time-like loop to avoid trivial timing attacks, but this is still
 * convenience-grade. Never log pins anywhere in this module or consumers.
 *
 * TODO: These definitions will later move to the b_panels integration's
 * options flow / a JSON config endpoint. This module is the interim source of
 * truth until that backend path is built.
 */

export interface PanelDef {
  /** Unique stable id. Used as localStorage key fragment. */
  id: string;
  /** Human-readable display name shown in the switcher. */
  name: string;
  /** Optional subtitle shown below the name in the switcher. */
  subtitle?: string;
  /** Lucide icon name as string key (rendered by the switcher). */
  icon?: string;
  /**
   * The area/section keys this panel may show.
   * Must be a subset of: home, pool, climate, security, lights, generator
   * "home" is always implicitly included when any areas are listed.
   */
  scope: string[];
  /**
   * If true, this panel may be offered as a device-default candidate on first
   * setup. All panels are candidates unless you want to hide some from setup.
   */
  isDefaultCandidate?: boolean;
}

/**
 * A USER is an access profile: a PIN plus the set of panels it can reach.
 * The PIN belongs to the user, never to a panel.
 */
export interface UserDef {
  /** Unique stable user id. */
  id: string;
  /** Human-readable name (shown after unlock, optional). */
  name: string;
  /** This user's PIN. Convenience-grade. Never log this value. */
  pin: string;
  /** Panel ids this user is allowed to access/switch to. */
  panels: string[];
}

/**
 * All area keys recognised by NavRail / HomeOverview / AreaView.
 * Referenced by scope arrays below.
 */
export const ALL_AREA_KEYS: string[] = [
  'home',
  'pool',
  'climate',
  'security',
  'lights',
  'generator',
];

const PANELS: PanelDef[] = [
  {
    id: 'full-home',
    name: 'Full Home',
    subtitle: 'All areas',
    icon: 'Home',
    scope: ALL_AREA_KEYS,
    isDefaultCandidate: true,
  },
  {
    id: 'pool',
    name: 'Pool',
    subtitle: 'Pool area only',
    icon: 'Waves',
    scope: ['home', 'pool'],
    isDefaultCandidate: true,
  },
  {
    id: 'entry',
    name: 'Entry',
    subtitle: 'Pool · Security · Lights',
    icon: 'DoorOpen',
    scope: ['home', 'pool', 'security', 'lights'],
    isDefaultCandidate: true,
  },
  {
    id: 'climate',
    name: 'Climate',
    subtitle: 'HVAC only',
    icon: 'Wind',
    scope: ['home', 'climate'],
    isDefaultCandidate: true,
  },
];

export default PANELS;

/**
 * Users (access profiles). The PIN belongs to the user. Never log pins.
 * Seeded with two example profiles so the model is reviewable.
 */
export const USERS: UserDef[] = [
  { id: 'owner', name: 'Owner', pin: '2580', panels: ['full-home', 'pool', 'entry', 'climate'] },
  { id: 'guest', name: 'Guest', pin: '1379', panels: ['pool'] },
];

/**
 * Constant-time-like PIN comparison. Not cryptographically guaranteed, but
 * avoids a trivially early exit that would leak information. Never log pins.
 */
export function pinsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    // eslint-disable-next-line no-bitwise
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Find the user whose PIN matches AND whose `panels` list includes the
 * requested target panel. Returns the matching user, or null.
 *
 *   - PIN matches a user that includes targetPanelId → that user.
 *   - PIN matches a user that does NOT include targetPanelId → null (denied).
 *   - No user matches the PIN → null.
 *
 * Never log the entered pin or the matched user's pin.
 */
export function findUserForPanel(enteredPin: string, targetPanelId: string): UserDef | null {
  for (const user of USERS) {
    if (pinsMatch(enteredPin, user.pin) && user.panels.includes(targetPanelId)) {
      return user;
    }
  }
  return null;
}
