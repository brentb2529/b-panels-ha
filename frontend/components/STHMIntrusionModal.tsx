import React, { useEffect } from 'react';
import ReactDOM from 'react-dom';
import { STHMState } from '../types';
import { IconShieldAlert } from './icons';

// Generic intrusion overlay. Originally SmartThings-Home-Monitor specific; now
// driven entirely by the Home Assistant / Alarmo alarm path (sthmState.source
// === 'ha'). Kept as a neutral, integration-agnostic full-screen alert.
interface IntrusionModalProps {
  sthmState: STHMState;
  onClose: () => void;
}

const STHMIntrusionModal = ({ sthmState, onClose }: IntrusionModalProps) => {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return ReactDOM.createPortal(
    <div className="fixed inset-0 bg-red-900/80 backdrop-blur-sm flex items-center justify-center z-[100] p-4 animate-pulse-bg">
      <style>{`
        @keyframes pulse-bg {
          0%, 100% { background-color: rgba(127, 29, 29, 0.8); }
          50% { background-color: rgba(153, 27, 27, 0.8); }
        }
        .animate-pulse-bg { animation: pulse-bg 2s infinite; }
        @keyframes ping-slow {
            75%, 100% {
                transform: scale(1.2);
                opacity: 0;
            }
        }
        .animate-ping-slow {
            animation: ping-slow 2s cubic-bezier(0, 0, 0.2, 1) infinite;
        }
      `}</style>
      <div className="bg-gray-800 rounded-lg shadow-2xl p-6 sm:p-8 w-full max-w-lg text-center border-4 border-red-500">
        <IconShieldAlert className="w-20 h-20 text-red-400 mx-auto mb-4 animate-ping-slow" />
        <h1 className="text-4xl sm:text-5xl font-extrabold text-white mb-2 uppercase">Intrusion Detected</h1>
        <p className="text-lg text-gray-300 mb-6">
          At location: <span className="font-bold text-white">{sthmState.locationName}</span>
        </p>

        {sthmState.violatingSensors.length > 0 && (
          <div className="bg-gray-900/50 rounded-md p-4 mb-6">
            <h2 className="text-xl font-semibold text-red-300 mb-2">Triggering Devices</h2>
            <ul className="text-white text-lg space-y-1">
              {sthmState.violatingSensors.map((sensor, index) => (
                <li key={index}>{sensor.name}</li>
              ))}
            </ul>
          </div>
        )}

        <button
          onClick={onClose}
          className="bg-red-600 text-white font-bold py-3 px-8 rounded-lg hover:bg-red-500 transition-colors text-lg"
        >
          Disarm &amp; Dismiss
        </button>
      </div>
    </div>,
    document.body
  );
};

export default STHMIntrusionModal;
