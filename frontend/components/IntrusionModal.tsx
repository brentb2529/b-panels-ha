import React from 'react';
import ReactDOM from 'react-dom';
import { AlarmState } from '../types';
import { IconShieldAlert } from './icons';
import AlarmPinPad from './AlarmPinPad';

// Full-screen intrusion overlay shown while the alarm panel is `triggered`
// (siren active). Driven by the Home Assistant / Alarmo alarm path. Lists the
// triggering sensor(s) from open_sensors and disarms via the shared PIN pad.
//
// Theming: the backdrop pulses red (semantic urgency, identical in light/dark);
// the card surface adapts via the var-mapped grays and body text inherits
// --text so it stays legible in every theme.
interface IntrusionModalProps {
  alarmState: AlarmState;
  onDisarm: (pin: string) => Promise<boolean>;
}

const RED = '#ef4444';

const IntrusionModal = ({ alarmState, onDisarm }: IntrusionModalProps) => {
  const sensors = alarmState.violatingSensors?.length
    ? alarmState.violatingSensors
    : (alarmState.trigger?.name ? [{ name: alarmState.trigger.name }] : []);

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 backdrop-blur-sm animate-pulse-bg">
      <style>{`
        @keyframes pulse-bg { 0%,100%{background-color:rgba(127,29,29,0.82)} 50%{background-color:rgba(153,27,27,0.82)} }
        .animate-pulse-bg { animation: pulse-bg 2s infinite; }
        @keyframes ping-slow { 75%,100%{transform:scale(1.25);opacity:0} }
        .animate-ping-slow { animation: ping-slow 2s cubic-bezier(0,0,0.2,1) infinite; }
      `}</style>
      <div
        className="w-full max-w-md text-center rounded-tile bg-gray-800 border-2 border-red-500 p-6"
        style={{ color: 'rgb(var(--text))', boxShadow: '0 0 0 1px rgba(239,68,68,0.3), 0 24px 60px -12px rgba(0,0,0,0.7)' }}
      >
        <div className="relative inline-flex mb-3">
          <span className="absolute inset-0 rounded-full bg-red-500/30 animate-ping-slow" />
          <IconShieldAlert className="relative w-16 h-16 text-red-500" />
        </div>
        <h1 className="text-3xl font-black uppercase tracking-wide text-red-500 mb-1">Intrusion</h1>
        <p className="text-sm mb-4" style={{ opacity: 0.75 }}>Alarm triggered — enter your PIN to disarm</p>

        {sensors.length > 0 && (
          <div className="rounded-control bg-red-500/12 px-3 py-2 mb-4">
            <p className="text-xs uppercase tracking-wide font-bold text-red-500 mb-1">Triggered by</p>
            <ul className="text-sm font-semibold space-y-0.5">
              {sensors.map((s, i) => <li key={i}>{s.name}</li>)}
            </ul>
          </div>
        )}

        <AlarmPinPad accent={RED} onDisarm={onDisarm} />
      </div>
    </div>,
    document.body
  );
};

export default IntrusionModal;
