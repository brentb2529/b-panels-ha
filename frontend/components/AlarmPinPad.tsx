import React, { useState, useEffect, useCallback } from 'react';
import { IconBackspace } from './icons';

// Shared PIN pad for the alarm disarm flows (entry-delay + intrusion). Keeps the
// two modals visually and behaviourally identical. Theme-adaptive: surfaces use
// the var-mapped grays, text inherits --text, and the accent (amber for entry,
// red for triggered) tints the filled dots. Auto-submits at 4 digits; supports
// hardware keyboard. onDisarm resolves false for a bad PIN (we clear + shake).
interface AlarmPinPadProps {
  accent: string;       // hex for filled dot border/bg, e.g. '#f59e0b'
  onDisarm: (pin: string) => Promise<boolean>;
}

const AlarmPinPad = ({ accent, onDisarm }: AlarmPinPadProps) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  const handleDigit = useCallback((d: string) => { setPin(prev => (prev.length < 6 ? prev + d : prev)); setError(null); }, []);
  const handleBackspace = useCallback(() => { setPin(prev => prev.slice(0, -1)); setError(null); }, []);
  const handleClear = useCallback(() => { setPin(''); setError(null); }, []);

  const handleSubmit = useCallback(async (candidate?: string) => {
    const value = candidate ?? pin;
    if (value.length === 0) { setError('Enter your PIN'); return; }
    setIsVerifying(true); setError(null);
    try {
      const ok = await onDisarm(value);
      if (!ok) { setError('Invalid PIN'); setPin(''); }
    } catch {
      setError('Verification failed'); setPin('');
    } finally {
      setIsVerifying(false);
    }
  }, [pin, onDisarm]);

  useEffect(() => { if (pin.length === 4) handleSubmit(pin); }, [pin, handleSubmit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') handleDigit(e.key);
      else if (e.key === 'Backspace') handleBackspace();
      else if (e.key === 'Enter') handleSubmit();
      else if (e.key === 'Escape') handleClear();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleDigit, handleBackspace, handleSubmit, handleClear]);

  return (
    <div>
      <div className="flex justify-center gap-2 mb-1">
        {[0, 1, 2, 3].map(i => (
          <div key={i}
               className="w-11 h-12 rounded-control border-2 flex items-center justify-center text-2xl font-bold bg-gray-700"
               style={pin.length > i
                 ? { borderColor: accent, backgroundColor: `${accent}26` }
                 : { borderColor: 'var(--tile-border)' }}>
            {pin.length > i ? '•' : ''}
          </div>
        ))}
      </div>
      <p className={`text-sm font-medium h-5 mb-2 ${error ? 'text-red-500 animate-shake' : ''}`} style={{ opacity: error ? 1 : 0 }}>
        {error || '·'}
      </p>
      <div className="grid grid-cols-3 gap-2 max-w-xs mx-auto">
        {['1','2','3','4','5','6','7','8','9','CLR','0','DEL'].map(key => (
          <button
            key={key}
            onClick={() => { if (key === 'CLR') handleClear(); else if (key === 'DEL') handleBackspace(); else handleDigit(key); }}
            disabled={isVerifying}
            className={`h-14 rounded-control font-bold text-xl transition active:scale-95 disabled:opacity-50 ${key === 'CLR' || key === 'DEL' ? 'bg-gray-600 text-sm' : 'bg-gray-700'}`}
            style={{ color: 'rgb(var(--text))' }}
          >
            {key === 'DEL' ? <IconBackspace className="w-6 h-6 mx-auto" /> : key}
          </button>
        ))}
      </div>
      <p className="text-xs mt-3 text-center" style={{ opacity: 0.6 }}>
        {isVerifying ? 'Verifying…' : 'Enter your PIN to disarm'}
      </p>
    </div>
  );
};

export default AlarmPinPad;
