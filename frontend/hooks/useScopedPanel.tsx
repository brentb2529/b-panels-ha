/**
 * useScopedPanel — React context + hook for the scoped-panels system.
 *
 * Provides:
 *   activePanelDef   — the currently active PanelDef
 *   setActivePanel   — switch to a panel (by id). Does NOT persist as default.
 *   deviceDefault    — the device-default panel id (from localStorage, per-device)
 *   setDeviceDefault — persist a new device default (requires prior PIN check)
 *   isAreaAllowed    — check whether an area key is within the active scope
 *   sessionUnlocked  — Set of panel ids whose PIN was entered this session.
 *                      Resets on page reload (in-memory only, by design).
 *   addSessionUnlock — mark a panel as PIN-unlocked for this session
 *   needsDeviceSetup — true when no device default is stored (first launch)
 *
 * IMPORTANT: This is UI-level convenience scoping, NOT a security boundary.
 * See frontend/config/panels.ts for full rationale.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import PANELS, { type PanelDef } from '../config/panels';

// ── Storage key ───────────────────────────────────────────────────────────────

const DEVICE_DEFAULT_PANEL_KEY = 'bpanels_device_default_panel';

// ── Context shape ─────────────────────────────────────────────────────────────

interface ScopedPanelContextValue {
  activePanelDef: PanelDef;
  setActivePanel: (panelId: string) => void;
  deviceDefault: string | null;
  setDeviceDefault: (panelId: string) => void;
  isAreaAllowed: (areaKey: string) => boolean;
  sessionUnlocked: Set<string>;
  addSessionUnlock: (panelId: string) => void;
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

  // In-memory session unlock set — resets on page reload intentionally.
  const sessionUnlockedRef = useRef<Set<string>>(new Set<string>());
  const [sessionUnlockedSnapshot, setSessionUnlockedSnapshot] = useState<Set<string>>(
    new Set<string>()
  );

  const addSessionUnlock = useCallback((panelId: string) => {
    sessionUnlockedRef.current.add(panelId);
    // Re-render consumers by replacing the set reference.
    setSessionUnlockedSnapshot(new Set(sessionUnlockedRef.current));
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

  const needsDeviceSetup = !deviceDefault || !PANELS.find(p => p.id === deviceDefault);

  const value = useMemo<ScopedPanelContextValue>(
    () => ({
      activePanelDef,
      setActivePanel,
      deviceDefault,
      setDeviceDefault,
      isAreaAllowed,
      sessionUnlocked: sessionUnlockedSnapshot,
      addSessionUnlock,
      needsDeviceSetup,
      allPanels: PANELS,
    }),
    [
      activePanelDef,
      setActivePanel,
      deviceDefault,
      setDeviceDefault,
      isAreaAllowed,
      sessionUnlockedSnapshot,
      addSessionUnlock,
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
