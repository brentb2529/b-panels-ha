/**
 * useScopedPanel — React context + hook for the scoped-panels system.
 *
 * ACCESS MODEL — per USER, not per panel. See config/panels.ts.
 *
 * Provides:
 *   activePanelDef     — the currently active PanelDef
 *   setActivePanel     — switch to a panel (by id). Does NOT persist as default.
 *   deviceDefault      — the device-default panel id (from localStorage, per-device)
 *   setDeviceDefault   — persist a new device default (requires prior PIN check)
 *   isAreaAllowed      — check whether an area key is within the active scope
 *   unlockedPanels     — Set of panel ids reachable without a (re-)prompt this
 *                        session: the device default + every panel belonging to
 *                        any unlocked user. Resets on page reload (in-memory).
 *   isPanelUnlocked    — convenience: is this panel id currently reachable?
 *   unlockUser         — mark a whole USER as unlocked for the session (all of
 *                        their panels become freely switchable).
 *   needsDeviceSetup   — true when no device default is stored (first launch)
 *   allPanels          — the panel definitions
 *
 * IMPORTANT: This is UI-level convenience scoping, NOT a security boundary.
 * See frontend/config/panels.ts for full rationale. Never log pins.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import PANELS, { USERS, type PanelDef, type UserDef } from '../config/panels';

// ── Storage key ───────────────────────────────────────────────────────────────

const DEVICE_DEFAULT_PANEL_KEY = 'bpanels_device_default_panel';

// ── Context shape ─────────────────────────────────────────────────────────────

interface ScopedPanelContextValue {
  activePanelDef: PanelDef;
  setActivePanel: (panelId: string) => void;
  deviceDefault: string | null;
  setDeviceDefault: (panelId: string) => void;
  isAreaAllowed: (areaKey: string) => boolean;
  unlockedPanels: Set<string>;
  isPanelUnlocked: (panelId: string) => boolean;
  unlockUser: (user: UserDef) => void;
  needsDeviceSetup: boolean;
  allPanels: PanelDef[];
}

const ScopedPanelContext = createContext<ScopedPanelContextValue | null>(null);

// ── Helpers ───────────────────────────────────────────────────────────────────

function getFallbackPanel(): PanelDef {
  return PANELS[0];
}

function resolvePanel(id: string | null): PanelDef {
  if (!id) return getFallbackPanel();
  return PANELS.find(p => p.id === id) ?? getFallbackPanel();
}

// ── Provider ──────────────────────────────────────────────────────────────────

export const ScopedPanelProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  // Read device default from localStorage once on mount.
  const storedDefault = localStorage.getItem(DEVICE_DEFAULT_PANEL_KEY);
  const [deviceDefault, setDeviceDefaultState] = useState<string | null>(storedDefault);

  // Determine the initial active panel:
  //   1. If a device default is stored and valid → use it.
  //   2. Otherwise → null means "needs setup", active falls back to first panel.
  const initialPanelId = storedDefault && PANELS.find(p => p.id === storedDefault)
    ? storedDefault
    : null;

  const [activePanelId, setActivePanelId] = useState<string | null>(initialPanelId);

  // In-memory unlocked-USER set — resets on page reload intentionally.
  // Unlocking a user grants free access to ALL of their panels for the session.
  const unlockedUsersRef = useRef<Set<string>>(new Set<string>());
  const [unlockedUsersSnapshot, setUnlockedUsersSnapshot] = useState<Set<string>>(
    new Set<string>()
  );

  const unlockUser = useCallback((user: UserDef) => {
    unlockedUsersRef.current.add(user.id);
    // Re-render consumers by replacing the set reference.
    setUnlockedUsersSnapshot(new Set(unlockedUsersRef.current));
  }, []);

  const setActivePanel = useCallback((panelId: string) => {
    setActivePanelId(panelId);
  }, []);

  const setDeviceDefault = useCallback((panelId: string) => {
    localStorage.setItem(DEVICE_DEFAULT_PANEL_KEY, panelId);
    setDeviceDefaultState(panelId);
    setActivePanelId(panelId);
  }, []);

  const activePanelDef = useMemo(
    () => resolvePanel(activePanelId),
    [activePanelId]
  );

  const isAreaAllowed = useCallback(
    (areaKey: string) => activePanelDef.scope.includes(areaKey),
    [activePanelDef]
  );

  // The set of panels reachable without a (re-)prompt this session:
  //   - The device default panel (the open landing).
  //   - Every panel belonging to any unlocked user.
  const unlockedPanels = useMemo(() => {
    const set = new Set<string>();
    if (deviceDefault) set.add(deviceDefault);
    for (const user of USERS) {
      if (unlockedUsersSnapshot.has(user.id)) {
        for (const pid of user.panels) set.add(pid);
      }
    }
    return set;
  }, [deviceDefault, unlockedUsersSnapshot]);

  const isPanelUnlocked = useCallback(
    (panelId: string) => unlockedPanels.has(panelId),
    [unlockedPanels]
  );

  const needsDeviceSetup = !deviceDefault || !PANELS.find(p => p.id === deviceDefault);

  const value = useMemo<ScopedPanelContextValue>(
    () => ({
      activePanelDef,
      setActivePanel,
      deviceDefault,
      setDeviceDefault,
      isAreaAllowed,
      unlockedPanels,
      isPanelUnlocked,
      unlockUser,
      needsDeviceSetup,
      allPanels: PANELS,
    }),
    [
      activePanelDef,
      setActivePanel,
      deviceDefault,
      setDeviceDefault,
      isAreaAllowed,
      unlockedPanels,
      isPanelUnlocked,
      unlockUser,
      needsDeviceSetup,
    ]
  );

  return (
    <ScopedPanelContext.Provider value={value}>
      {children}
    </ScopedPanelContext.Provider>
  );
};

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useScopedPanel(): ScopedPanelContextValue {
  const ctx = useContext(ScopedPanelContext);
  if (!ctx) {
    throw new Error('useScopedPanel must be used inside <ScopedPanelProvider>');
  }
  return ctx;
}
