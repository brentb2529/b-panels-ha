import React, { useState } from 'react';

interface AudioUnlockModalProps {
    onUnlock: () => void;
}

// Audio-unlock affordance (Polish #2).
//
// Was: a full-screen black overlay ("Tap anywhere to enable audio") that covered
// all content on every fresh kiosk load and swallowed the first click.
//
// Now: a small, non-blocking, dismissible pill in the bottom-left corner. Audio
// is ALSO auto-armed on the first real user interaction anywhere (see
// useDashboard's first-gesture effect), so this is purely an informative hint —
// it never blocks the dashboard. Tapping it explicitly unlocks (and primes TTS);
// the × dismisses the hint for this session without unlocking (the next real
// gesture will still arm audio). It does not regress the unlock it provides:
// pressing it runs the exact same `unlockAudio` gesture path as before.
const AudioUnlockModal = ({ onUnlock }: AudioUnlockModalProps) => {
    const [dismissed, setDismissed] = useState(false);
    if (dismissed) return null;

    return (
        <div
            className="fixed bottom-4 left-4 z-[100] flex items-center gap-3 rounded-full bg-black/70 backdrop-blur-md border border-white/15 pl-4 pr-2 py-2 shadow-lg text-white max-w-[80vw] animate-[fadeIn_0.4s_ease]"
            role="status"
            aria-live="polite"
        >
            <button
                type="button"
                onClick={onUnlock}
                className="flex items-center gap-2 text-sm font-medium cursor-pointer"
                aria-label="Enable audio alerts"
            >
                {/* speaker glyph */}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                </svg>
                <span className="whitespace-nowrap">Tap to enable audio alerts</span>
            </button>
            <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setDismissed(true); }}
                className="ml-1 flex h-7 w-7 items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                aria-label="Dismiss"
            >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
            </button>
        </div>
    );
};

export default AudioUnlockModal;
