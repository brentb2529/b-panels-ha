import React, { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { STHMState } from '../types';
import { IconShield, IconX } from './icons';
import { useAlarmCountdown } from '../hooks/useAlarmCountdown';
import { playDelayBeep } from '../services/alarmTones';

// Exit-delay banner. Shown while the alarm panel is `arming` (you've armed and
// are leaving). Deliberately a non-blocking top banner — not a full-screen
// modal — so the dashboard stays usable on the way out. Countdown is
// reconnect-safe (anchored on Alarmo delay + last_changed). A calm beep ticks
// each second. "Cancel" disarms (no PIN needed to cancel your own arming).
interface ExitDelayModalProps {
  sthmState: STHMState;
  onCancel: () => void;
}

const ExitDelayModal = ({ sthmState, onCancel }: ExitDelayModalProps) => {
  const { remaining } = useAlarmCountdown(sthmState);
  const armingFor = sthmState.armState === 'armedAway' ? 'Away' : sthmState.armState === 'armedStay' ? 'Stay' : '';

  const prevSecRef = useRef<number | null>(null);
  useEffect(() => {
    if (remaining == null) return;
    if (remaining > 0 && remaining !== prevSecRef.current) {
      prevSecRef.current = remaining;
      playDelayBeep(remaining <= 3);
    }
  }, [remaining]);

  return ReactDOM.createPortal(
    <div className="fixed top-0 inset-x-0 z-[95] flex justify-center p-3 pointer-events-none">
      <div
        className="pointer-events-auto flex items-center gap-4 rounded-tile bg-gray-800 border border-amber-500/60 shadow-2xl px-5 py-3"
        style={{ color: 'rgb(var(--text))', boxShadow: '0 12px 34px -10px rgba(0,0,0,0.55)' }}
      >
        <IconShield className="w-7 h-7 text-amber-500 flex-shrink-0" />
        <div className="text-left leading-tight">
          <p className="font-bold uppercase tracking-wide text-amber-500 text-sm">Arming {armingFor}</p>
          <p className="text-sm" style={{ opacity: 0.8 }}>
            {remaining != null ? <>Leave now — arms in <span className="font-black tabular-nums">{remaining}s</span></> : 'Exit delay…'}
          </p>
        </div>
        <button
          onClick={onCancel}
          className="ml-2 inline-flex items-center gap-1.5 rounded-control bg-gray-700 px-3 py-2 text-sm font-semibold active:scale-95 transition"
          style={{ color: 'rgb(var(--text))' }}
        >
          <IconX className="w-4 h-4" /> Cancel
        </button>
      </div>
    </div>,
    document.body
  );
};

export default ExitDelayModal;
