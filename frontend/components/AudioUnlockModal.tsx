import React from 'react';

interface AudioUnlockModalProps {
    onUnlock: () => void;
}

const AudioUnlockModal = ({ onUnlock }: AudioUnlockModalProps) => {
    return (
        <div 
            className="fixed inset-0 bg-black/80 flex items-center justify-center z-[100] cursor-pointer"
            onClick={onUnlock}
        >
            <div className="text-center text-white p-8">
                <h2 className="text-3xl font-bold mb-4">Welcome to HomeTile</h2>
                <p className="text-lg animate-pulse">Tap anywhere to enable audio alerts.</p>
            </div>
        </div>
    );
};

export default AudioUnlockModal;
