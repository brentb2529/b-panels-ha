import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDashboard } from '../../hooks/useDashboard';

// ---------------------------------------------------------------------------
// usePanelDefault — per-DEVICE "this panel's home" + idle-return (Increment 9).
//
// NAV MODEL v1.3: every physical panel lands on a CURATED DEFAULT view tied to
// its location and, after a period of inactivity, cross-fades back to it. This
// is curation, NOT restriction — the device can still navigate anywhere.
//
// ── WHY localStorage (per-DEVICE, NOT global) ──────────────────────────────
// The build-time rule (NAV_MODEL_v13 §7) is explicit: `defaultView` +
// idle-return are keyed PER PHYSICAL PANEL, never a global setting. The shared
// b_panels `.storage` config is the SAME object for every connected panel, so
// it cannot hold a per-device value. localStorage is per-device by
// construction (each iPad's WebView has its own store), so the device's home
// panel + idle seconds live there. The forward-looking server source is the
// per-DEVICE `/api/b_panels/idle_config` (keyed by installationId), wired by
// the coordinator's AdminFlowPlan; until that lands, localStorage is the
// source of truth and the only writer here.
// ---------------------------------------------------------------------------

const DEFAULT_VIEW_KEY = 'bPanelsDeviceDefaultPanel';   // -> panel id
const IDLE_SECONDS_KEY = 'bPanelsDeviceIdleSeconds';     // -> number (seconds)

// v1.3 mock copy shows a 2-minute idle return. Overridable per device (and the
// Playwright proof shortens it via the ?idle= override below).
const DEFAULT_IDLE_SECONDS = 120;

// Interactions that should reset the idle timer. Pointer + key + wheel covers
// touch (pointerdown), mouse, and keyboard; we deliberately do NOT reset on
// programmatic scroll so a live-updating panel can't keep itself awake.
const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;

const readNumberParam = (name: string): number | null => {
  try {
    // HashRouter keeps query after the hash; also check the raw search.
    const hash = window.location.hash || '';
    const qIdx = hash.indexOf('?');
    const fromHash = qIdx >= 0 ? new URLSearchParams(hash.slice(qIdx + 1)).get(name) : null;
    const raw = fromHash ?? new URLSearchParams(window.location.search).get(name);
    if (raw == null) return null;
    const n = parseFloat(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
};

export const getDeviceDefaultPanelId = (): string | null => {
  try { return localStorage.getItem(DEFAULT_VIEW_KEY); } catch { return null; }
};

export const setDeviceDefaultPanelId = (panelId: string | null): void => {
  try {
    if (panelId) localStorage.setItem(DEFAULT_VIEW_KEY, panelId);
    else localStorage.removeItem(DEFAULT_VIEW_KEY);
  } catch { /* ignore */ }
};

const getDeviceIdleSeconds = (): number => {
  // A ?idle=<seconds> query param wins (used by the Playwright proof to shorten
  // the 2-min timer); else the per-device stored value; else the 2-min default.
  const fromParam = readNumberParam('idle');
  if (fromParam != null) return fromParam;
  try {
    const raw = localStorage.getItem(IDLE_SECONDS_KEY);
    const n = raw != null ? parseFloat(raw) : NaN;
    if (Number.isFinite(n) && n > 0) return n;
  } catch { /* ignore */ }
  return DEFAULT_IDLE_SECONDS;
};

/**
 * Read-only: is the given panel this device's configured home? Does NOT start
 * an idle timer (the shell owns the single idle timer). Use this from a panel
 * body to drive the "⌂ THIS PANEL'S HOME" badge without double-arming idle.
 * Re-reads on storage events so a "set as home" elsewhere reflects live.
 */
export const useIsThisPanelHome = (currentPanelId: string | null): boolean => {
  const [defaultId, setDefaultId] = useState<string | null>(getDeviceDefaultPanelId);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === DEFAULT_VIEW_KEY) setDefaultId(getDeviceDefaultPanelId());
    };
    // also poll once on focus (same-tab writes don't fire 'storage')
    const refresh = () => setDefaultId(getDeviceDefaultPanelId());
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', refresh);
    return () => { window.removeEventListener('storage', onStorage); window.removeEventListener('focus', refresh); };
  }, []);
  return !!defaultId && defaultId === currentPanelId;
};

export interface PanelDefaultState {
  /** The device's configured home panel id, or null if unset. */
  deviceDefaultPanelId: string | null;
  /** True when the CURRENTLY rendered panel IS the device's home panel. */
  isThisPanelHome: boolean;
  /** Persist the currently rendered panel as this device's home (per-device). */
  setThisPanelAsHome: () => void;
}

/**
 * Drives per-device default + 2-min idle-return for a compilation panel.
 *
 * @param currentPanelId  the panel id currently rendered (from useDashboard.activePanelId)
 * @param suppressIdle    LIFE-SAFETY HOOK — when true, idle-return is suppressed.
 *                        A later increment's life-safety takeover overlay (fire/CO/
 *                        intrusion) MUST pass true here so an idle timer can never
 *                        navigate away from an active life-safety annunciation.
 *                        Idle-return must never outrank a takeover.
 */
export const usePanelDefault = (
  currentPanelId: string | null,
  suppressIdle = false,
): PanelDefaultState => {
  const navigate = useNavigate();
  const { panels, alarmState } = useDashboard();
  const [deviceDefaultPanelId, setDefault] = useState<string | null>(getDeviceDefaultPanelId);

  const timerRef = useRef<number | null>(null);
  const lastActivityRef = useRef<number>(Date.now());

  const setThisPanelAsHome = useCallback(() => {
    if (!currentPanelId) return;
    setDeviceDefaultPanelId(currentPanelId);
    setDefault(currentPanelId);
  }, [currentPanelId]);

  const isThisPanelHome = !!deviceDefaultPanelId && deviceDefaultPanelId === currentPanelId;

  // ── Idle-return timer ──────────────────────────────────────────────────────
  // Returns to the device's home panel after `idleSeconds` of no interaction.
  // Hard guards (it must NEVER fire mid-interaction or outrank life-safety):
  //   • only arms when a device default exists AND we're not already on it
  //   • any pointer/key/touch resets the clock (checked on a coarse interval so
  //     we never navigate within the idle window of a real interaction)
  //   • suppressed while `suppressIdle` is set (life-safety takeover hook) or
  //     while the alarm is mid-flow (arming/pending/triggered) — a homeowner
  //     dealing with the alarm must not have the view yanked away.
  useEffect(() => {
    // Nothing to return to, or we're already home — no timer needed.
    if (!deviceDefaultPanelId || deviceDefaultPanelId === currentPanelId) return;

    const idleMs = getDeviceIdleSeconds() * 1000;
    const phase = alarmState?.phase ?? 'idle';
    const alarmBusy = phase === 'arming' || phase === 'pending' || phase === 'triggered';

    const markActive = () => { lastActivityRef.current = Date.now(); };
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, markActive, { passive: true }));

    // Poll on a coarse cadence (1/4 of the window, min 1s). On each tick, if the
    // panel has been idle for >= the window AND nothing suppresses us, go home.
    const tick = Math.max(1000, Math.min(idleMs / 4, 30000));
    timerRef.current = window.setInterval(() => {
      if (suppressIdle || alarmBusy) return;            // life-safety / alarm guard
      const idleFor = Date.now() - lastActivityRef.current;
      if (idleFor < idleMs) return;                     // still within an interaction window
      const target = panels.find((p) => p.id === deviceDefaultPanelId);
      if (!target) return;                              // default panel no longer exists
      navigate(`/dashboard/${deviceDefaultPanelId}`);
    }, tick);

    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, markActive));
      if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    };
  }, [deviceDefaultPanelId, currentPanelId, suppressIdle, alarmState?.phase, panels, navigate]);

  return { deviceDefaultPanelId, isThisPanelHome, setThisPanelAsHome };
};
