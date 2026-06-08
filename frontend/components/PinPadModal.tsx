import React, { useState, useEffect, useCallback } from 'react';
import Modal from './Modal';
import { swallowNextClick } from '../utils';

interface PinPadModalProps {
  onClose: () => void;
  onConfirm: (pin: string) => Promise<boolean>;
}

const PinPadModal = ({ onClose, onConfirm }: PinPadModalProps) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [attempts, setAttempts] = useState(0); // re-keys the dot row to replay the shake
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleKeyPress = useCallback((key: string) => {
    if (pin.length < 4 && !isSubmitting) {
      setError('');
      setPin(prev => {
        const next = prev + key;
        // 4th digit auto-submits + closes the modal; eat the tap's trailing
        // click so it can't fall through to the tile underneath.
        if (next.length === 4) swallowNextClick();
        return next;
      });
    }
  }, [pin.length, isSubmitting]);

  const handleBackspace = useCallback(() => {
    if (!isSubmitting) {
      setError('');
      setPin(prev => prev.slice(0, -1));
    }
  }, [isSubmitting]);

  const handleConfirm = useCallback(async () => {
    if (pin.length < 4 || isSubmitting) return;

    setIsSubmitting(true);
    const success = await onConfirm(pin);
    if (!success) {
      setError('Invalid PIN');
      setPin('');
      setAttempts(a => a + 1);
    }
    setIsSubmitting(false);
  }, [pin, isSubmitting, onConfirm]);

  const handleClear = useCallback(() => {
      if(!isSubmitting) {
          setPin('');
          setError('');
      }
  }, [isSubmitting]);

  // Auto-submit when PIN reaches 4 digits
  useEffect(() => {
    if (pin.length === 4 && !isSubmitting) {
      handleConfirm();
    }
  }, [pin, isSubmitting, handleConfirm]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key >= '0' && event.key <= '9') {
        handleKeyPress(event.key);
      } else if (event.key === 'Backspace') {
        handleBackspace();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyPress, handleBackspace]);

  const keypadButtons = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'];

  return (
    <Modal onClose={onClose} size="sm">
      <h2 className="text-xl text-center font-bold mb-3 -mt-2">Enter PIN</h2>
      <div
        key={attempts}
        className={`flex justify-center items-center gap-4 mb-2 h-12 bg-gray-900 rounded-control ${error ? 'animate-shake' : ''}`}
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={`w-5 h-5 rounded-full transition-all duration-150 ${i < pin.length ? 'bg-brand-blue scale-110' : 'bg-gray-600'}`} />
        ))}
      </div>
      <div className="h-5 text-center mb-3">
          {error && <p className="text-red-400 text-sm font-medium">{error}</p>}
          {isSubmitting && <p className="text-gray-400 text-sm animate-pulse">Verifying…</p>}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {keypadButtons.map(key => (
          <button
            key={key}
            // onPointerDown for instant touch response (no click delay on kiosks).
            onPointerDown={() => {
              if (key === 'C') handleClear();
              else if (key === '⌫') handleBackspace();
              else handleKeyPress(key);
            }}
            className="text-2xl font-semibold bg-gray-700 rounded-control p-4 aspect-square flex items-center justify-center hover:bg-gray-600 active:scale-95 transition-transform disabled:opacity-50"
            style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent', userSelect: 'none' }}
            disabled={isSubmitting}
          >
            {key}
          </button>
        ))}
      </div>
    </Modal>
  );
};

export default PinPadModal;
