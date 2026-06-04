import React, { useEffect, useState, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { IconX } from './icons';

// Shared modal shell: portal + frosted backdrop + standardized elevation/radius
// + enter/exit transition + Escape/backdrop dismiss. Replaces the near-identical
// portal/backdrop/Escape scaffolding that every dialog used to hand-roll.
//
// Exit animation works even though parents conditionally render the modal:
// dismissals run through `requestClose`, which plays the out-transition and
// only calls `onClose` after it finishes.
type ModalSize = 'sm' | 'md' | 'lg';

type ModalProps = {
  /** Invoked after the close transition. Omit for a non-dismissable modal. */
  onClose?: () => void;
  title?: string;
  size?: ModalSize;
  /** Allow backdrop-tap / Escape / close-button dismissal. Default true. */
  dismissable?: boolean;
  /** Extra classes for the panel (e.g. colored alarm panels). */
  panelClassName?: string;
  /** Override the backdrop classes (e.g. colored alarm backdrops). */
  backdropClassName?: string;
  zClassName?: string;
  children: React.ReactNode;
};

const SIZE_CLASSES: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
};

const Modal = ({
  onClose,
  title,
  size = 'sm',
  dismissable = true,
  panelClassName = '',
  backdropClassName = 'bg-black/60 backdrop-blur-sm',
  zClassName = 'z-50',
  children,
}: ModalProps) => {
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Next frame so the enter transition runs from the initial (hidden) state.
    const id = requestAnimationFrame(() => setShow(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const requestClose = useCallback(() => {
    if (!dismissable || !onClose) return;
    setShow(false);
    window.setTimeout(onClose, 180);
  }, [dismissable, onClose]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [requestClose]);

  return ReactDOM.createPortal(
    <div
      className={`fixed inset-0 flex items-center justify-center p-4 transition-opacity duration-200 ${backdropClassName} ${zClassName} ${show ? 'opacity-100' : 'opacity-0'}`}
      onClick={requestClose}
    >
      <div
        className={`bg-gray-800 rounded-tile shadow-elev-2 border border-white/5 p-6 w-full ${SIZE_CLASSES[size]} transition-all duration-200 ease-out ${show ? 'opacity-100 scale-100' : 'opacity-0 scale-95'} ${panelClassName}`}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || (dismissable && onClose)) && (
          <div className="flex justify-between items-center mb-4">
            {title ? <h2 className="text-xl font-bold text-white">{title}</h2> : <span />}
            {dismissable && onClose && (
              <button
                type="button"
                onClick={requestClose}
                className="p-3 -m-1 text-gray-400 rounded-full hover:bg-gray-700 hover:text-white active:scale-95 transition-all"
                aria-label="Close"
              >
                <IconX className="w-5 h-5" />
              </button>
            )}
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body
  );
};

export default Modal;
