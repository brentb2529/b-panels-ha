/**
 * DeviceSetup — first-launch screen to pick this device's default panel.
 *
 * Shown once per physical device (iPad), keyed by localStorage. Once a
 * default is saved the device boots straight into its panel on every reload.
 *
 * If any panel has a PIN, the setup screen itself requires the admin/setup PIN
 * before letting the user save a default. The setup PIN is resolved from
 * config/panels.ts (getSetupPin). This prevents an untrusted user from
 * setting up the device on first boot.
 *
 * IMPORTANT: UI-level convenience only — not a security boundary.
 */

import React, { useState, useCallback } from 'react';
import { glassMaterial, glassMaterialActive } from '../design-system/theme';
import { useReducedMotion } from '../design-system/useReducedMotion';
import { useScopedPanel } from '../hooks/useScopedPanel';
import { getSetupPin, pinsMatch, type PanelDef } from '../config/panels';
import PanelPinModal from './PanelPinModal';
import {
  IconHome,
  IconWaves,
  IconWind,
  IconShieldAlert,
  IconLightbulb,
  IconDoorOpen,
  IconLock,
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
          {panel.pin && (
            <IconLock
              className="w-3 h-3"
              style={{ display: 'inline', marginLeft: 6, opacity: 0.5 }}
            />
          )}
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
  const [pinVerified, setPinVerified] = useState(false);

  const setupPin = getSetupPin();
  const requiresPin = !!setupPin;
  const candidatePanels = allPanels.filter(p => p.isDefaultCandidate !== false);

  const handleSave = useCallback(() => {
    if (!selectedId) return;
    if (requiresPin && !pinVerified) {
      setShowPinModal(true);
      return;
    }
    setDeviceDefault(selectedId);
  }, [selectedId, requiresPin, pinVerified, setDeviceDefault]);

  const handlePinSuccess = useCallback(() => {
    setPinVerified(true);
    setShowPinModal(false);
    if (selectedId) {
      setDeviceDefault(selectedId);
    }
  }, [selectedId, setDeviceDefault]);

  const validateSetupPin = useCallback(
    (entered: string): boolean => {
      if (!setupPin) return true;
      return pinsMatch(entered, setupPin);
    },
    [setupPin]
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
            Choose which view this iPad will show by default.
            {requiresPin && (
              <> A setup PIN will be required to confirm.</>
            )}
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
          {requiresPin ? 'Confirm with PIN' : 'Set as Default'}
        </button>
      </div>

      {showPinModal && (
        <PanelPinModal
          panelName="Setup"
          onSuccess={handlePinSuccess}
          onCancel={() => setShowPinModal(false)}
          validatePin={validateSetupPin}
        />
      )}
    </div>
  );
};

export default DeviceSetup;
