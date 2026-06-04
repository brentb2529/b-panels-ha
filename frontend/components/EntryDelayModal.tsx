import React, { useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { STHMState } from '../types';
import { IconShieldAlert, IconBackspace, IconX } from './icons';
import { playTextToSpeech } from '../services/audioPlayer';

interface EntryDelayModalProps {
  sthmState: STHMState;
  entryDelaySeconds: number;
  soundMode?: 'beep' | 'countdown';
  beepStyle?: 'single' | 'double' | 'pulse';
  onDisarm: (pin: string) => Promise<boolean>;
  onExpired: () => void;
  onCancel: () => void;
}

const EntryDelayModal = ({ sthmState, entryDelaySeconds, soundMode = 'beep', beepStyle = 'single', onDisarm, onExpired, onCancel }: EntryDelayModalProps) => {
  const [timeRemaining, setTimeRemaining] = useState(entryDelaySeconds);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  // Countdown timer
  useEffect(() => {
    if (timeRemaining <= 0) {
      onExpired();
      return;
    }

    const timer = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [timeRemaining, onExpired]);

  // Warning sound. Starts the instant the modal appears (the moment the alarm
  // is triggered) and repeats every second until the PIN is entered — at which
  // point the parent unmounts this modal, stopping the sound. Configurable as a
  // beep style or a spoken countdown.
  useEffect(() => {
    if (timeRemaining <= 0) return;

    if (soundMode === 'countdown') {
      // Speak the remaining seconds via the existing TTS pipeline.
      playTextToSpeech(String(timeRemaining));
      return;
    }

    // Beep mode — pitch rises in the final 5 seconds.
    let ctx: AudioContext | null = null;
    try {
      ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const freq = timeRemaining <= 5 ? 880 : 440;
      const beepAt = (offset: number, dur: number) => {
        const osc = ctx!.createOscillator();
        const gain = ctx!.createGain();
        osc.connect(gain);
        gain.connect(ctx!.destination);
        osc.frequency.value = freq;
        osc.type = 'sine';
        gain.gain.value = 0.3;
        osc.start(ctx!.currentTime + offset);
        osc.stop(ctx!.currentTime + offset + dur);
      };
      if (beepStyle === 'pulse') {
        beepAt(0, 0.05); beepAt(0.08, 0.05); beepAt(0.16, 0.05);
      } else if (beepStyle === 'double') {
        beepAt(0, 0.08); beepAt(0.14, 0.08);
      } else {
        beepAt(0, 0.1);
      }
    } catch (e) { /* audio unavailable — non-fatal */ }

    // Close the context shortly after the beep finishes to avoid leaks.
    const closeTimer = window.setTimeout(() => { try { ctx?.close(); } catch {} }, 700);
    return () => { window.clearTimeout(closeTimer); try { ctx?.close(); } catch {} };
  }, [timeRemaining, soundMode, beepStyle]);

  const handlePinDigit = useCallback((digit: string) => {
    if (pin.length < 6) {
      setPin(prev => prev + digit);
      setError(null);
    }
  }, [pin]);

  const handleBackspace = useCallback(() => {
    setPin(prev => prev.slice(0, -1));
    setError(null);
  }, []);

  const handleClear = useCallback(() => {
    setPin('');
    setError(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (pin.length === 0) {
      setError('Enter your PIN');
      return;
    }

    setIsVerifying(true);
    setError(null);

    try {
      const success = await onDisarm(pin);
      if (!success) {
        setError('Invalid PIN');
        setPin('');
      }
    } catch (e) {
      setError('Verification failed');
      setPin('');
    } finally {
      setIsVerifying(false);
    }
  }, [pin, onDisarm]);

  // Auto-submit when PIN reaches expected length (4 digits)
  useEffect(() => {
    if (pin.length === 4) {
      handleSubmit();
    }
  }, [pin, handleSubmit]);

  // Keyboard support
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        handlePinDigit(e.key);
      } else if (e.key === 'Backspace') {
        handleBackspace();
      } else if (e.key === 'Enter') {
        handleSubmit();
      } else if (e.key === 'Escape') {
        handleClear();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlePinDigit, handleBackspace, handleSubmit, handleClear]);

  // Calculate progress for circular timer
  const progress = (timeRemaining / entryDelaySeconds) * 100;
  const circumference = 2 * Math.PI * 45; // radius = 45
  const strokeDashoffset = circumference - (progress / 100) * circumference;

  const triggerName = sthmState.trigger?.name || sthmState.violatingSensors?.[0]?.name || 'Unknown Sensor';

  return ReactDOM.createPortal(
    <div className="fixed inset-0 bg-yellow-900/90 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
      <div className="bg-gray-800 rounded-lg shadow-2xl p-6 w-full max-w-md text-center border-4 border-yellow-500">
        {/* Header with countdown */}
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-yellow-400 uppercase">Entry Delay</h1>
          <button
            onClick={onCancel}
            className="text-gray-400 hover:text-white p-3 -m-1 rounded-full hover:bg-white/10 active:scale-95 transition-all"
            title="Cancel (will trigger alarm)"
          >
            <IconX className="w-5 h-5" />
          </button>
        </div>

        {/* Circular Countdown Timer */}
        <div className="relative w-32 h-32 mx-auto mb-4">
          <svg className="w-full h-full transform -rotate-90">
            {/* Background circle */}
            <circle
              cx="64"
              cy="64"
              r="45"
              fill="none"
              stroke="#374151"
              strokeWidth="8"
            />
            {/* Progress circle */}
            <circle
              cx="64"
              cy="64"
              r="45"
              fill="none"
              stroke={timeRemaining <= 5 ? '#ef4444' : '#eab308'}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              className="transition-all duration-1000 ease-linear"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={`text-4xl font-bold ${timeRemaining <= 5 ? 'text-red-400 animate-pulse' : 'text-yellow-400'}`}>
              {timeRemaining}
            </span>
          </div>
        </div>

        {/* Trigger Info */}
        <div className="bg-yellow-900/30 rounded-lg p-3 mb-4">
          <div className="flex items-center justify-center gap-2 text-yellow-300">
            <IconShieldAlert className="w-5 h-5" />
            <span className="text-sm font-medium">Triggered by:</span>
          </div>
          <p className="text-white font-bold text-lg mt-1">{triggerName}</p>
        </div>

        {/* PIN Display */}
        <div className="mb-4">
          <div className="flex justify-center gap-2 mb-2">
            {[0, 1, 2, 3].map(i => (
              <div
                key={i}
                className={`w-12 h-12 rounded-lg border-2 flex items-center justify-center text-2xl font-bold
                  ${pin.length > i ? 'border-yellow-500 bg-yellow-500/20 text-white' : 'border-gray-600 bg-gray-700'}`}
              >
                {pin.length > i ? '•' : ''}
              </div>
            ))}
          </div>
          {error && (
            <p className="text-red-400 text-sm font-medium animate-pulse">{error}</p>
          )}
        </div>

        {/* PIN Pad */}
        <div className="grid grid-cols-3 gap-2 max-w-xs mx-auto">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'CLR', '0', 'DEL'].map(key => (
            <button
              key={key}
              onClick={() => {
                if (key === 'CLR') handleClear();
                else if (key === 'DEL') handleBackspace();
                else handlePinDigit(key);
              }}
              disabled={isVerifying}
              className={`h-14 rounded-lg font-bold text-xl transition-all
                ${key === 'CLR' || key === 'DEL'
                  ? 'bg-gray-600 hover:bg-gray-500 text-gray-300 text-sm'
                  : 'bg-gray-700 hover:bg-gray-600 text-white'}
                disabled:opacity-50 active:scale-95`}
            >
              {key === 'DEL' ? <IconBackspace className="w-6 h-6 mx-auto" /> : key}
            </button>
          ))}
        </div>

        {/* Status message */}
        <div className="mt-4 h-6 text-center">
          {isVerifying && <p className="text-yellow-300 font-medium">Verifying...</p>}
        </div>

        <p className="text-gray-400 text-xs mt-2">
          Enter 4-digit PIN to disarm
        </p>
      </div>
    </div>,
    document.body
  );
};

export default EntryDelayModal;
