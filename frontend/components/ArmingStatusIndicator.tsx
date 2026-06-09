import React, { useState } from 'react';
import { useDashboard } from '../hooks/useDashboard';
import { IconShield, IconShieldCheck, IconShieldAlert, IconShieldOff } from './icons';
import SecurityModal from './SecurityModal';

// Header chrome for the alarm: an arm-state badge (Disarmed / Armed Stay /
// Armed Away / Intrusion) plus, while disarmed, a zone-readiness badge
// (Ready / Not Ready) derived from the alarm's sensor list. HA-only: driven
// entirely by the live alarm state from the websocket — no per-panel toggle or
// configured "status device" required. Renders nothing until an
// alarm_control_panel is present.
//
// Tapping the badge opens SecurityModal, which is portal-rendered into
// document.body to avoid being clipped by the Header's backdrop-filter ancestor
// (Chromium makes backdrop-filter elements the containing block for position:fixed
// children, which would clip the modal to the 64px header bar).
const ArmingStatusIndicator = () => {
  const { alarmState, armingState } = useDashboard();
  const [showModal, setShowModal] = useState(false);

  if (!alarmState || typeof alarmState.armState === 'undefined') {
    return null;
  }

  const isViolation = alarmState.securityState === 'VIOLATION';

  const badge = 'flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium cursor-pointer select-none transition-opacity hover:opacity-80 active:opacity-60';

  // --- Intrusion takes over the whole indicator ---
  if (isViolation) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          title="Intrusion detected — tap for details"
          className={`${badge} bg-red-500/25 text-red-200 animate-pulse`}
          aria-haspopup="dialog"
          aria-expanded={showModal}
        >
          <IconShieldAlert className="w-5 h-5" />
          <span className="hidden sm:inline">Intrusion</span>
        </button>
        {showModal && <SecurityModal onClose={() => setShowModal(false)} />}
      </>
    );
  }

  const armConfig = {
    disarmed: { text: 'Disarmed', icon: <IconShieldCheck className="w-5 h-5" />, className: 'bg-green-500/20 text-green-300' },
    armedStay: { text: 'Armed Stay', icon: <IconShield className="w-5 h-5" />, className: 'bg-orange-500/20 text-orange-300' },
    armedAway: { text: 'Armed Away', icon: <IconShieldAlert className="w-5 h-5" />, className: 'bg-red-500/20 text-red-300' },
  }[alarmState.armState] || { text: 'Unknown', icon: <IconShield className="w-5 h-5" />, className: 'bg-gray-600/50 text-gray-300' };

  // Readiness is only meaningful while disarmed and when the alarm reports a
  // sensor list (armingState is 'no_sensors' otherwise — show nothing then).
  const showReadiness = alarmState.armState === 'disarmed' && (armingState === 'ready' || armingState === 'not_ready');
  const readyConfig = armingState === 'ready'
    ? { text: 'Ready', icon: <IconShieldCheck className="w-5 h-5" />, className: 'bg-green-500/20 text-green-300' }
    : { text: 'Not Ready', icon: <IconShieldOff className="w-5 h-5" />, className: 'bg-orange-500/20 text-orange-300' };

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setShowModal(true)}
          title={`Alarm: ${armConfig.text} — tap for details`}
          className={`${badge} ${armConfig.className}`}
          aria-haspopup="dialog"
          aria-expanded={showModal}
        >
          {armConfig.icon}
          <span className="hidden sm:inline">{armConfig.text}</span>
        </button>
        {showReadiness && (
          <div title={`Zone: ${readyConfig.text}`} className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${readyConfig.className}`}>
            {readyConfig.icon}
            <span className="hidden sm:inline">{readyConfig.text}</span>
          </div>
        )}
      </div>
      {showModal && <SecurityModal onClose={() => setShowModal(false)} />}
    </>
  );
};

export default ArmingStatusIndicator;
