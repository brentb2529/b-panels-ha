import React, { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { AlarmState } from '../types';
import { IconShieldAlert, IconX } from './icons';
import { useAlarmCountdown } from '../hooks/useAlarmCountdown';
import { playDelayBeep } from '../services/alarmTones';
import { playTextToSpeech } from '../services/audioPlayer';
import AlarmPinPad from './AlarmPinPad';

// Entry-delay "disarm now" modal. Shown while the alarm panel is in `pending`
// (entry delay). The countdown is reconnect-safe (anchored on Alarmo's delay +
// last_changed via useAlarmCountdown), NOT a local decrement. Escalation to the
// siren is owned by Alarmo: when its entry delay elapses it transitions to
// `triggered` and the parent swaps this for the intrusion modal — this component
// never fires the alarm itself.
//
// Theming: surfaces use the var-mapped grays (adapt to light/dark/ambient) and
// body text inherits --text; amber is the semantic "entry delay" accent in all
// themes. Security audio bypasses the panel Mute schedule by design.
interface EntryDelayModalProps {
  alarmState: AlarmState;
  // Warning-sound preference from Admin → Security. 'beep' uses the chosen beep
  // style; 'countdown' speaks the remaining seconds via TTS.
  sound?: { mode: 'beep' | 'countdown'; beepStyle?: 'single' | 'double' | 'pulse' };
  onDisarm: (pin: string) => Promise<boolean>;
  onCancel: () => void;
}

const RADIUS = 45;
const CIRC = 2 * Math.PI * RADIUS;
const AMBER = '#f59e0b';

const EntryDelayModal = ({ alarmState, sound, onDisarm, onCancel }: EntryDelayModalProps) => {
  const { remaining, total } = useAlarmCountdown(alarmState);
  const mode = sound?.mode || 'beep';
  const beepStyle = sound?.beepStyle || 'single';

  // Warn on each whole-second change. 'beep' → chosen style, rising pitch in the
  // final 5s; 'countdown' → speak the remaining seconds. With no countdown anchor
  // (generic panel without `delay`) fall back to a plain 1s beep.
  const prevSecRef = useRef<number | null>(null);
  useEffect(() => {
    const announce = (sec: number) => {
      if (mode === 'countdown') playTextToSpeech(String(sec));
      else playDelayBeep(sec <= 5, beepStyle);
    };
    if (remaining == null) {
      const id = window.setInterval(() => playDelayBeep(false, beepStyle), 1000);
      playDelayBeep(false, beepStyle);
      return () => window.clearInterval(id);
    }
    if (remaining > 0 && remaining !== prevSecRef.current) {
      prevSecRef.current = remaining;
      announce(remaining);
    }
  }, [remaining, mode, beepStyle]);

  const urgent = remaining != null && remaining <= 5;
  const progress = (remaining != null && total) ? remaining / total : 1;
  const dashoffset = CIRC - progress * CIRC;
  const triggerName = alarmState.trigger?.name || alarmState.violatingSensors?.[0]?.name || 'a sensor';

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 backdrop-blur-sm"
         style={{ backgroundColor: 'rgba(120, 53, 15, 0.55)' }}>
      <div
        className="w-full max-w-md text-center rounded-tile bg-gray-800 border-2 border-amber-500 p-6"
        style={{ color: 'rgb(var(--text))', boxShadow: '0 0 0 1px rgba(245,158,11,0.25), 0 24px 60px -12px rgba(0,0,0,0.6)' }}
      >
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-lg font-extrabold tracking-wide uppercase text-amber-500">Entry Delay</h1>
          <button
            onClick={onCancel}
            className="p-2 -m-1 rounded-full hover:bg-black/10 active:scale-95 transition"
            style={{ color: 'rgb(var(--text))', opacity: 0.6 }}
            title="Dismiss (alarm will continue)"
          >
            <IconX className="w-5 h-5" />
          </button>
        </div>

        {/* Circular countdown */}
        <div className="relative w-32 h-32 mx-auto mb-4">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 128 128">
            <circle cx="64" cy="64" r={RADIUS} fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="8" />
            <circle
              cx="64" cy="64" r={RADIUS} fill="none"
              stroke={urgent ? '#ef4444' : AMBER} strokeWidth="8" strokeLinecap="round"
              strokeDasharray={CIRC} strokeDashoffset={dashoffset}
              style={{ transition: 'stroke-dashoffset 0.25s linear' }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={`text-5xl font-black tabular-nums ${urgent ? 'text-red-500 animate-pulse' : 'text-amber-500'}`}>
              {remaining != null ? remaining : '•'}
            </span>
          </div>
        </div>

        {/* Triggering sensor */}
        <div className="rounded-control px-3 py-2 mb-4 inline-flex items-center gap-2 bg-amber-500/15">
          <IconShieldAlert className="w-5 h-5 text-amber-500 flex-shrink-0" />
          <span className="text-sm" style={{ opacity: 0.85 }}>Opened:</span>
          <span className="text-sm font-bold">{triggerName}</span>
        </div>

        <AlarmPinPad accent={AMBER} onDisarm={onDisarm} />
      </div>
    </div>,
    document.body
  );
};

export default EntryDelayModal;
