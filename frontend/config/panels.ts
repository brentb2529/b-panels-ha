/**
 * Panel definitions — the named "scoped views" system for b-panels.
 *
 * A "panel" is a named, hand-specified subset of areas/sections that a
 * particular physical device (iPad) boots into and stays within. The scope
 * keys MUST match the NavRail / HomeOverview / AreaView area keys exactly:
 *   home, pool, climate, security, lights, generator
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
   * Optional PIN string. If set, switching TO this panel requires this PIN.
   * Leave undefined for panels that can be freely selected (no prompt).
   * Never log this value.
   */
  pin?: string;
  /**
   * If true, this panel may be offered as a device-default candidate on first
   * setup. All panels are candidates unless you want to hide some from setup.
   */
  isDefaultCandidate?: boolean;
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

/**
 * The admin/setup PIN used to protect the device-setup screen itself.
 * Reuses the Full Home panel's pin for simplicity. Override here if you want
 * a different setup pin independent of any panel pin.
 */
export const SETUP_PIN_OVERRIDE: string | undefined = undefined; // undefined = use Full Home pin

const PANELS: PanelDef[] = [
  {
    id: 'full-home',
    name: 'Full Home',
    subtitle: 'All areas',
    icon: 'Home',
    scope: ALL_AREA_KEYS,
    // The owner / admin panel. PIN-gated so guests can't casually reach it.
    pin: '2580',
    isDefaultCandidate: true,
  },
  {
    id: 'pool',
    name: 'Pool',
    subtitle: 'Pool area only',
    icon: 'Waves',
    scope: ['home', 'pool'],
    // No PIN — pool-room iPad can be used freely.
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
 * Resolve the setup PIN: use SETUP_PIN_OVERRIDE if set, otherwise fall back to
 * the Full Home panel's pin, or undefined if neither is configured.
 */
export function getSetupPin(): string | undefined {
  if (SETUP_PIN_OVERRIDE !== undefined) return SETUP_PIN_OVERRIDE;
  const adminPanel = PANELS.find(p => p.id === 'full-home');
  return adminPanel?.pin;
}

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
