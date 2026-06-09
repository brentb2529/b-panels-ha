/**
 * PanelPinModal — PIN entry modal for switching to a PIN-gated scoped panel.
 *
 * Glass-styled numeric keypad consistent with the liquid-glass design system.
 * Rendered via React createPortal into document.body to avoid being clipped
 * by any backdrop-filter ancestor.
 *
 * IMPORTANT: This is convenience-grade security, NOT a hard access boundary.
 * PINs live in config/panels.ts. See that module for the full disclaimer.
 * Do NOT log the entered PIN.
 *
 * Props:
 *   panelName — displayed in the header so the user knows what they're unlocking
 *   onSuccess — called after the correct PIN is entered
 *   onCancel  — called when the user dismisses without entering the correct PIN
 *   validatePin — callback that checks the entered pin; returns true if correct
 */

import React, { useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { glassMaterial } from '../design-system/theme';
import { useReducedMotion } from '../design-system/useReducedMotion';
import { IconX, IconLock } from './icons';

interface PanelPinModalProps {
  panelName: string;
  onSuccess: () => void;
  onCancel: () => void;
  validatePin: (pin: string) => boolean;
}

const KEYPAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'];
const PIN_LENGTH = 4;

const PanelPinModal: React.FC<PanelPinModalProps> = ({
  panelName,
  onSuccess,
  onCancel,
  validatePin,
}) => {
  const [pin, setPin] = useState('');
  const [errorShake, setErrorShake] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [visible, setVisible] = useState(false);
  const reducedMotion = useReducedMotion();

  // Enter animation: next frame after mount.
  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const dismiss = useCallback(() => {
    setVisible(false);
    window.setTimeout(onCancel, 180);
  }, [onCancel]);

  const handleSuccess = useCallback(() => {
    setVisible(false);
    window.setTimeout(onSuccess, 120);
  }, [onSuccess]);

  const handleKeyPress = useCallback(
    (key: string) => {
      if (errorShake) return;
      setErrorMsg('');
      setPin(prev => {
        if (prev.length >= PIN_LENGTH) return prev;
        return prev + key;
      });
    },
    [errorShake]
  );

  const handleBackspace = useCallback(() => {
    if (errorShake) return;
    setErrorMsg('');
    setPin(prev => prev.slice(0, -1));
  }, [errorShake]);

  const handleClear = useCallback(() => {
    setPin('');
    setErrorMsg('');
    setErrorShake(false);
  }, []);

  // Auto-submit when PIN is fully entered.
  useEffect(() => {
    if (pin.length === PIN_LENGTH) {
      if (validatePin(pin)) {
        handleSuccess();
      } else {
        // Wrong PIN — shake, clear, show error. Do NOT log the pin.
        setErrorMsg('Incorrect PIN');
        setErrorShake(true);
        const t = window.setTimeout(() => {
          setPin('');
          setErrorShake(false);
        }, 600);
        return () => clearTimeout(t);
      }
    }
  }, [pin, validatePin, handleSuccess]);

  // Physical keyboard support.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') handleKeyPress(e.key);
      else if (e.key === 'Backspace') handleBackspace();
      else if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleKeyPress, handleBackspace, dismiss]);

  const shakeStyle: React.CSSProperties = errorShake && !reducedMotion
    ? { animation: 'panelpin-shake 0.5s ease' }
    : {};

  return ReactDOM.createPortal(
    <>
      {/* Keyframe for shake — injected once per render, harmless */}
      <style>{`
        @keyframes panelpin-shake {
          0%, 100% { transform: translateX(0); }
          15%       { transform: translateX(-6px); }
          30%       { transform: translateX(6px); }
          45%       { transform: translateX(-5px); }
          60%       { transform: translateX(5px); }
          75%       { transform: translateX(-3px); }
          90%       { transform: translateX(3px); }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes panelpin-shake { 0%, 100% { transform: none; } }
        }
      `}</style>

      {/* Backdrop */}
      <div
        onClick={dismiss}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9000,
          background: 'rgba(0,0,0,0.62)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
          opacity: visible ? 1 : 0,
          transition: 'opacity 180ms ease',
        }}
      >
        {/* Modal panel */}
        <div
          onClick={e => e.stopPropagation()}
          style={{
            ...glassMaterial(2),
            borderRadius: 'var(--radius-surface)',
            padding: '28px 24px 24px',
            width: '100%',
            maxWidth: 340,
            transform: visible
              ? 'translateY(0) scale(1)'
              : 'translateY(12px) scale(0.96)',
            opacity: visible ? 1 : 0,
            transition: reducedMotion
              ? 'opacity 180ms ease'
              : 'opacity 200ms ease, transform 220ms cubic-bezier(0.22,1,0.36,1)',
          }}
        >
          {/* Close button */}
          <button
            onClick={dismiss}
            aria-label="Cancel"
            style={{
              position: 'absolute',
              top: 12,
              right: 12,
              padding: 8,
              borderRadius: 8,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'rgb(var(--text) / 0.45)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <IconX className="w-4 h-4" />
          </button>

          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                backgroundColor: 'rgb(var(--accent) / 0.14)',
                border: '1px solid rgb(var(--accent) / 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 12px',
                color: 'rgb(var(--accent))',
              }}
            >
              <IconLock className="w-5 h-5" />
            </div>
            <div
              style={{
                fontSize: 17,
                fontWeight: 700,
                color: 'rgb(var(--text))',
                letterSpacing: '-0.01em',
                marginBottom: 4,
              }}
            >
              {panelName}
            </div>
            <div
              style={{
                fontSize: 13,
                color: 'rgb(var(--text) / 0.45)',
                fontWeight: 500,
              }}
            >
              Enter PIN to continue
            </div>
          </div>

          {/* PIN dots */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              gap: 14,
              marginBottom: 6,
              padding: '12px 0',
              borderRadius: 10,
              backgroundColor: 'rgb(var(--surface) / 0.5)',
              border: errorShake
                ? '1px solid rgb(var(--accent-alert) / 0.5)'
                : '1px solid transparent',
              ...shakeStyle,
            }}
          >
            {Array.from({ length: PIN_LENGTH }).map((_, i) => (
              <div
                key={i}
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  backgroundColor:
                    i < pin.length
                      ? 'rgb(var(--accent))'
                      : 'rgb(var(--text) / 0.2)',
                  transform: i < pin.length ? 'scale(1.15)' : 'scale(1)',
                  transition: reducedMotion
                    ? 'none'
                    : 'background-color 120ms ease, transform 120ms cubic-bezier(0.34,1.56,0.64,1)',
                }}
              />
            ))}
          </div>

          {/* Error message */}
          <div
            style={{
              height: 20,
              textAlign: 'center',
              marginBottom: 16,
            }}
          >
            {errorMsg && (
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'rgb(var(--accent-alert))',
                  letterSpacing: '0.02em',
                }}
              >
                {errorMsg}
              </span>
            )}
          </div>

          {/* Keypad grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 8,
            }}
          >
            {KEYPAD_KEYS.map(key => (
              <button
                key={key}
                onPointerDown={e => {
                  e.preventDefault();
                  if (key === 'C') handleClear();
                  else if (key === '⌫') handleBackspace();
                  else handleKeyPress(key);
                }}
                style={{
                  ...glassMaterial(3),
                  border: '1px solid rgb(var(--text) / 0.1)',
                  borderRadius: 'var(--radius-control)',
                  height: 56,
                  fontSize: 20,
                  fontWeight: 600,
                  color:
                    key === 'C'
                      ? 'rgb(var(--accent-warn))'
                      : key === '⌫'
                      ? 'rgb(var(--text) / 0.6)'
                      : 'rgb(var(--text))',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  touchAction: 'manipulation',
                  WebkitTapHighlightColor: 'transparent',
                  userSelect: 'none',
                  transition: reducedMotion
                    ? 'none'
                    : 'transform 80ms cubic-bezier(0.34,1.56,0.64,1), opacity 80ms ease',
                }}
                onMouseDown={e => {
                  if (!reducedMotion) {
                    (e.currentTarget as HTMLButtonElement).style.transform =
                      'scale(0.92)';
                  }
                }}
                onMouseUp={e => {
                  (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)';
                }}
                aria-label={key === '⌫' ? 'Backspace' : key === 'C' ? 'Clear' : key}
              >
                {key}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>,
    document.body
  );
};

export default PanelPinModal;
