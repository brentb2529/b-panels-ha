/**
 * DeviceSetup — first-launch screen to pick this device's default panel.
 *
 * Shown once per physical device (iPad), keyed by localStorage. Once a
 * default is saved the device boots straight into its panel on every reload.
 *
 * The setup action is gated behind a valid PIN of a USER who has access to the
 * chosen panel (per-user access model — see config/panels.ts). On confirm we
 * show the generic "Enter your PIN" modal and accept it only if it matches a
 * user whose `panels` list includes the selected panel. This prevents a guest
 * from setting the device default to a panel they can't actually unlock.
 *
 * IMPORTANT: UI-level convenience only — not a security boundary. Never log pins.
 */

import React, { useState, useCallback } from 'react';
import { glassMaterial, glassMaterialActive } from '../design-system/theme';
import { useReducedMotion } from '../design-system/useReducedMotion';
import { useScopedPanel } from '../hooks/useScopedPanel';
import { findUserForPanel, type PanelDef } from '../config/panels';
import PanelPinModal from './PanelPinModal';
import {
  IconHome,
  IconWaves,
  IconWind,
  IconShieldAlert,
  IconLightbulb,
  IconDoorOpen,
} from './icons';

// ── Icon resolver ─────────────────────────────────────────────────────────────

function resolveIcon(iconName?: string): React.ReactNode {
  switch (iconName) {
    case 'Waves':        return <IconWaves className="w-5 h-5" />;
    case 'Wind':         return <IconWind className="w-5 h-5" />;
    case 'ShieldAlert':  return <IconShieldAlert className="w-5 h-5" />;
    case 'Lightbulb':    return <IconLightbulb className="w-5 h-5" />;
    case 'DoorOpen':     return <IconDoorOpen className="w-5 h-5" />;
    default:             return <IconHome className="w-5 h-5" />;
  }
}

// ── Panel card ────────────────────────────────────────────────────────────────

interface PanelCardProps {
  panel: PanelDef;
  selected: boolean;
  onSelect: () => void;
}

const PanelCard: React.FC<PanelCardProps> = ({ panel, selected, onSelect }) => {
  const reducedMotion = useReducedMotion();

  return (
    <button
      onClick={onSelect}
      style={{
        ...(selected
          ? glassMaterialActive(2, 'var(--accent)', { glowStrength: 0.16 })
          : glassMaterial(2)),
        borderRadius: 'var(--radius-card)',
        padding: '16px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        cursor: 'pointer',
        width: '100%',
        textAlign: 'left',
        transform: selected ? 'scale(1.015)' : 'scale(1)',
        transition: reducedMotion
          ? 'none'
          : 'transform 200ms cubic-bezier(0.22,1,0.36,1), box-shadow 200ms ease',
      }}
      aria-pressed={selected}
      aria-label={`Select ${panel.name} panel`}
    >
      {/* Icon badge */}
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          backgroundColor: selected
            ? 'rgb(var(--accent) / 0.2)'
            : 'rgb(var(--text) / 0.08)',
          border: `1px solid ${selected ? 'rgb(var(--accent) / 0.4)' : 'transparent'}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: selected ? 'rgb(var(--accent))' : 'rgb(var(--text) / 0.55)',
          flexShrink: 0,
        }}
      >
        {resolveIcon(panel.icon)}
      </div>

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: 'rgb(var(--text))',
            letterSpacing: '-0.01em',
            marginBottom: 2,
          }}
        >
          {panel.name}
        </div>
        {panel.subtitle && (
          <div
            style={{
              fontSize: 12,
              color: 'rgb(var(--text) / 0.45)',
              fontWeight: 500,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {panel.subtitle}
          </div>
        )}
      </div>

      {/* Selection indicator */}
      <div
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          border: selected
            ? '2px solid rgb(var(--accent))'
            : '2px solid rgb(var(--text) / 0.2)',
          backgroundColor: selected ? 'rgb(var(--accent))' : 'transparent',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {selected && (
          <div
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              backgroundColor: '#fff',
            }}
          />
        )}
      </div>
    </button>
  );
};

// ── Main DeviceSetup component ────────────────────────────────────────────────

const DeviceSetup: React.FC = () => {
  const { allPanels, setDeviceDefault } = useScopedPanel();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showPinModal, setShowPinModal] = useState(false);

  const candidatePanels = allPanels.filter(p => p.isDefaultCandidate !== false);

  const handleSave = useCallback(() => {
    if (!selectedId) return;
    // Setup is always gated behind a valid user PIN for the chosen panel.
    setShowPinModal(true);
  }, [selectedId]);

  const handlePinSuccess = useCallback(() => {
    setShowPinModal(false);
    if (selectedId) {
      setDeviceDefault(selectedId);
    }
  }, [selectedId, setDeviceDefault]);

  // Accept the PIN only if it belongs to a user who can access the selected
  // panel. Same outcome as a normal panel switch. Never log the entered pin.
  const validateSetupPin = useCallback(
    (entered: string): boolean => {
      if (!selectedId) return false;
      return findUserForPanel(entered, selectedId) !== null;
    },
    [selectedId]
  );

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 8000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        backgroundColor: 'rgb(var(--bg) / 0.92)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}
    >
      <div
        style={{
          ...glassMaterial(1),
          borderRadius: 'var(--radius-surface)',
          padding: '32px 28px 28px',
          width: '100%',
          maxWidth: 420,
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 14,
              backgroundColor: 'rgb(var(--accent) / 0.14)',
              border: '1px solid rgb(var(--accent) / 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
              color: 'rgb(var(--accent))',
            }}
          >
            <IconHome className="w-6 h-6" />
          </div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: 'rgb(var(--text))',
              letterSpacing: '-0.02em',
              marginBottom: 6,
            }}
          >
            Set Up This Device
          </h1>
          <p
            style={{
              fontSize: 13,
              color: 'rgb(var(--text) / 0.5)',
              fontWeight: 500,
              lineHeight: 1.5,
            }}
          >
            Choose which view this iPad will show by default. Your PIN will be
            required to confirm.
          </p>
        </div>

        {/* Panel selection list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
          {candidatePanels.map(panel => (
            <PanelCard
              key={panel.id}
              panel={panel}
              selected={selectedId === panel.id}
              onSelect={() => setSelectedId(panel.id)}
            />
          ))}
        </div>

        {/* Save button */}
        <button
          onClick={handleSave}
          disabled={!selectedId}
          style={{
            width: '100%',
            padding: '14px 0',
            borderRadius: 'var(--radius-control)',
            backgroundColor:
              selectedId
                ? 'rgb(var(--accent))'
                : 'rgb(var(--text) / 0.1)',
            color: selectedId ? '#fff' : 'rgb(var(--text) / 0.3)',
            fontSize: 15,
            fontWeight: 700,
            letterSpacing: '0.01em',
            border: 'none',
            cursor: selectedId ? 'pointer' : 'not-allowed',
            transition: 'background-color 160ms ease, color 160ms ease',
          }}
        >
          Confirm with PIN
        </button>
      </div>

      {showPinModal && (
        <PanelPinModal
          subtitle="Enter your PIN to set this default"
          onSuccess={handlePinSuccess}
          onCancel={() => setShowPinModal(false)}
          validatePin={validateSetupPin}
        />
      )}
    </div>
  );
};

export default DeviceSetup;
