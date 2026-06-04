import React from 'react';
import { useDashboard } from '../hooks/useDashboard';
import { IconHome, IconShieldAlert, IconInfo } from './icons';

const ArmingStatusIndicator = () => {
  const { panels, armingState, armingStatusDeviceId } = useDashboard();

  // The header is global chrome, so the indicator stays consistent across every
  // panel/sub-page: show it whenever the feature is enabled on ANY panel (the
  // per-panel Admin toggles still act as a global on/off) rather than gating on
  // whichever panel happens to be open.
  const enabledSomewhere = panels.some(p => p.showArmingStatus);
  if (!enabledSomewhere) {
    return null;
  }

  // Show "N/A" if the feature is enabled for the panel but no global source device is configured.
  if (!armingStatusDeviceId) {
    return (
        <div title="Arming status source not configured in Admin > Alerts & Automations" className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium bg-gray-600/50 text-gray-400">
            <IconInfo className="w-5 h-5" />
            <span className="hidden sm:inline">Arming: N/A</span>
        </div>
    );
  }

  const config = {
    ready: {
      text: 'Ready to Arm',
      icon: <IconHome className="w-5 h-5" />,
      className: 'bg-green-500/20 text-green-300',
    },
    not_ready: {
      text: 'Not Ready',
      icon: <IconShieldAlert className="w-5 h-5" />,
      className: 'bg-orange-500/20 text-orange-300',
    },
    // Adding no_sensors case to be exhaustive
    no_sensors: null,
  }[armingState];

  // This case handles when a device is configured but not found, or another unknown state.
  if (!config) {
      return null;
  }

  return (
    <div title={config.text} className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${config.className}`}>
      {config.icon}
      <span className="hidden sm:inline">{config.text.replace(' to Arm', '')}</span>
    </div>
  );
};

export default ArmingStatusIndicator;