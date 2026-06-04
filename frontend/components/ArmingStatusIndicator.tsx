import React from 'react';
import { useDashboard } from '../hooks/useDashboard';
import { IconShield, IconShieldCheck, IconShieldAlert, IconShieldOff } from './icons';

// Header chrome for the alarm: an arm-state badge (Disarmed / Armed Stay /
// Armed Away / Intrusion) plus, while disarmed, a zone-readiness badge
// (Ready / Not Ready) derived from the alarm's sensor list. HA-only: driven
// entirely by the live alarm state from the websocket — no per-panel toggle or
// configured "status device" required. Renders nothing until an
// alarm_control_panel is present.
const ArmingStatusIndicator = () => {
  const { sthmState, armingState } = useDashboard();

  if (!sthmState || typeof sthmState.armState === 'undefined') {
    return null;
  }

  const isViolation = sthmState.securityState === 'VIOLATION';

  const badge = 'flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium';

  // --- Intrusion takes over the whole indicator ---
  if (isViolation) {
    return (
      <div title="Intrusion detected" className={`${badge} bg-red-500/25 text-red-200 animate-pulse`}>
        <IconShieldAlert className="w-5 h-5" />
        <span className="hidden sm:inline">Intrusion</span>
      </div>
    );
  }

  const armConfig = {
    disarmed: { text: 'Disarmed', icon: <IconShieldCheck className="w-5 h-5" />, className: 'bg-green-500/20 text-green-300' },
    armedStay: { text: 'Armed Stay', icon: <IconShield className="w-5 h-5" />, className: 'bg-orange-500/20 text-orange-300' },
    armedAway: { text: 'Armed Away', icon: <IconShieldAlert className="w-5 h-5" />, className: 'bg-red-500/20 text-red-300' },
  }[sthmState.armState] || { text: 'Unknown', icon: <IconShield className="w-5 h-5" />, className: 'bg-gray-600/50 text-gray-300' };

  // Readiness is only meaningful while disarmed and when the alarm reports a
  // sensor list (armingState is 'no_sensors' otherwise — show nothing then).
  const showReadiness = sthmState.armState === 'disarmed' && (armingState === 'ready' || armingState === 'not_ready');
  const readyConfig = armingState === 'ready'
    ? { text: 'Ready', icon: <IconShieldCheck className="w-5 h-5" />, className: 'bg-green-500/20 text-green-300' }
    : { text: 'Not Ready', icon: <IconShieldOff className="w-5 h-5" />, className: 'bg-orange-500/20 text-orange-300' };

  return (
    <div className="flex items-center gap-2">
      <div title={`Alarm: ${armConfig.text}`} className={`${badge} ${armConfig.className}`}>
        {armConfig.icon}
        <span className="hidden sm:inline">{armConfig.text}</span>
      </div>
      {showReadiness && (
        <div title={`Zone: ${readyConfig.text}`} className={`${badge} ${readyConfig.className}`}>
          {readyConfig.icon}
          <span className="hidden sm:inline">{readyConfig.text}</span>
        </div>
      )}
    </div>
  );
};

export default ArmingStatusIndicator;
