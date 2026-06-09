/**
 * PanelSwitcher — flyout in the NavRail footer for switching scoped panels.
 *
 * Renders a small button in the NavRail that opens a panel picker list.
 * Selecting a panel:
 *   - No pin → switches immediately.
 *   - Has pin, not yet unlocked this session → shows PanelPinModal.
 *   - Has pin, already unlocked this session → switches immediately (no re-prompt).
 *
 * IMPORTANT: UI-level convenience only. See config/panels.ts for the disclaimer.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { glassMaterial, glassMaterialActive } from '../design-system/theme';
import { useReducedMotion } from '../design-system/useReducedMotion';
import { useScopedPanel } from '../hooks/useScopedPanel';
import { pinsMatch, type PanelDef } from '../config/panels';
import PanelPinModal from './PanelPinModal';
import {
  IconHome,
  IconWaves,
  IconWind,
  IconShieldAlert,
  IconLightbulb,
  IconDoorOpen,
  IconLock,
  IconLockOpen,
  IconLayers,
  IconChevronRight,
} from './icons';

// ── Icon resolver ─────────────────────────────────────────────────────────────

function resolveIcon(iconName?: string, small = false): React.ReactNode {
  const cls = small ? 'w-4 h-4' : 'w-5 h-5';
  switch (iconName) {
    case 'Waves':       return <IconWaves className={cls} />;
    case 'Wind':        return <IconWind className={cls} />;
    case 'ShieldAlert': return <IconShieldAlert className={cls} />;
    case 'Lightbulb':   return <IconLightbulb className={cls} />;
    case 'DoorOpen':    return <IconDoorOpen className={cls} />;
    default:            return <IconHome className={cls} />;
  }
}

// ── PanelSwitcher ─────────────────────────────────────────────────────────────

const PanelSwitcher: React.FC = () => {
  const {
    activePanelDef,
    allPanels,
    setActivePanel,
    sessionUnlocked,
    addSessionUnlock,
  } = useScopedPanel();
  const reducedMotion = useReducedMotion();

  const [open, setOpen] = useState(false);
  const [pendingPanel, setPendingPanel] = useState<PanelDef | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handlePanelSelect = useCallback(
    (panel: PanelDef) => {
      setOpen(false);
      const needsPin = !!panel.pin && !sessionUnlocked.has(panel.id);
      if (needsPin) {
        setPendingPanel(panel);
      } else {
        setActivePanel(panel.id);
      }
    },
    [sessionUnlocked, setActivePanel]
  );

  const handlePinSuccess = useCallback(() => {
    if (!pendingPanel) return;
    addSessionUnlock(pendingPanel.id);
    setActivePanel(pendingPanel.id);
    setPendingPanel(null);
  }, [pendingPanel, addSessionUnlock, setActivePanel]);

  const handlePinCancel = useCallback(() => {
    setPendingPanel(null);
  }, []);

  const validatePin = useCallback(
    (entered: string): boolean => {
      if (!pendingPanel?.pin) return true;
      return pinsMatch(entered, pendingPanel.pin);
    },
    [pendingPanel]
  );

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(o => !o)}
        title={`Panel: ${activePanelDef.name}`}
        aria-label={`Switch panel (current: ${activePanelDef.name})`}
        aria-expanded={open}
        style={{
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 3,
          padding: '8px 4px',
          borderRadius: 10,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: open ? 'rgb(var(--accent))' : 'rgb(var(--text) / 0.45)',
          transition: reducedMotion ? 'none' : 'color 160ms ease',
        }}
      >
        <IconLayers className="w-5 h-5" />
        <span
          style={{
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: '0.02em',
            lineHeight: 1,
            maxWidth: 56,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {activePanelDef.name}
        </span>
      </button>

      {/* Flyout panel list — opens to the right of the NavRail */}
      {open && (
        <div
          style={{
            position: 'absolute',
            // Anchor to the bottom of the button, offset right past the 72px NavRail
            bottom: 0,
            left: 76,
            zIndex: 200,
            ...glassMaterial(2),
            borderRadius: 'var(--radius-card)',
            padding: '8px 6px',
            width: 220,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            animation: reducedMotion
              ? 'none'
              : 'switcher-enter 180ms cubic-bezier(0.22,1,0.36,1) both',
          }}
        >
          <style>{`
            @keyframes switcher-enter {
              from { opacity: 0; transform: translateX(-8px) scale(0.97); }
              to   { opacity: 1; transform: translateX(0) scale(1); }
            }
            @media (prefers-reduced-motion: reduce) {
              @keyframes switcher-enter { from { opacity: 0; } to { opacity: 1; } }
            }
          `}</style>

          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'rgb(var(--text) / 0.35)',
              padding: '4px 10px 6px',
            }}
          >
            Switch Panel
          </div>

          {allPanels.map(panel => {
            const isActive = panel.id === activePanelDef.id;
            const isUnlocked = sessionUnlocked.has(panel.id);
            const hasPin = !!panel.pin;

            return (
              <button
                key={panel.id}
                onClick={() => handlePanelSelect(panel)}
                style={{
                  ...(isActive
                    ? glassMaterialActive(3, 'var(--accent)', { glowStrength: 0.12 })
                    : glassMaterial(3)),
                  borderRadius: 'var(--radius-control)',
                  padding: '9px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  cursor: 'pointer',
                  border: isActive
                    ? '1px solid rgb(var(--accent) / 0.3)'
                    : '1px solid transparent',
                  color: isActive ? 'rgb(var(--accent))' : 'rgb(var(--text) / 0.8)',
                  fontSize: 13,
                  fontWeight: isActive ? 700 : 500,
                  width: '100%',
                  textAlign: 'left',
                  transition: reducedMotion ? 'none' : 'all 120ms ease',
                }}
                aria-current={isActive ? 'true' : undefined}
              >
                <span style={{ flexShrink: 0 }}>
                  {resolveIcon(panel.icon, true)}
                </span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {panel.name}
                </span>
                {hasPin && (
                  <span style={{ flexShrink: 0, opacity: 0.5 }}>
                    {isUnlocked
                      ? <IconLockOpen className="w-3 h-3" />
                      : <IconLock className="w-3 h-3" />}
                  </span>
                )}
                {isActive && (
                  <span style={{ flexShrink: 0 }}>
                    <IconChevronRight className="w-3 h-3" style={{ opacity: 0.4 }} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* PIN modal for pending panel switch */}
      {pendingPanel && (
        <PanelPinModal
          panelName={pendingPanel.name}
          onSuccess={handlePinSuccess}
          onCancel={handlePinCancel}
          validatePin={validatePin}
        />
      )}
    </div>
  );
};

export default PanelSwitcher;
