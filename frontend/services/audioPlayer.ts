
/**
 * Handles audio playback for Text-to-Speech and URL-based audio files.
 * Detects if running inside Fully Kiosk Browser and uses its native API
 * to prevent WebView black-screen issues caused by standard HTML5 Audio/TTS
 * blocking the render thread on some Android devices.
 */

// Helper to safely find the Fully Kiosk object, even if nested in iframes
export const getFully = (): any => {
    try {
        if (typeof (window as any).fully !== 'undefined') return (window as any).fully;
        if (window.top && typeof (window.top as any).fully !== 'undefined') return (window.top as any).fully;
    } catch (e) {
        // Accessing window.top might fail if cross-origin, though rare in this setup
        console.warn("Could not check window.top for Fully Kiosk object", e);
    }
    return undefined;
};

export const playTextToSpeech = (text: string, voiceURI?: string): string => {
    // Check for Fully Kiosk Browser Object
    const fully = getFully();

    if (typeof fully !== 'undefined') {
        if (typeof fully.textToSpeech === 'function') {
            try {
                console.log(`[Audio] Using Fully Kiosk TTS: "${text}"`);
                // Force string conversion to avoid Java type errors on the Android side
                fully.textToSpeech(String(text));
                
                // Debug helper: Show visual toast on tablet to confirm code execution
                if (typeof fully.showToast === 'function') {
                    fully.showToast(`Speaking: ${text}`);
                }
                return "Success: Sent to Fully Kiosk TTS";
            } catch (e: any) {
                console.error("[Audio] Fully Kiosk TTS failed", e);
                // Fallthrough to standard API is risky if Fully failed but exists, but let's keep behavior simple.
                return `Error: Fully Kiosk failed - ${e.message}`;
            }
        } else {
            console.warn("[Audio] window.fully is defined but textToSpeech function is missing.");
        }
    } 

    // Standard Web API Fallback
    // We execute this immediately without setTimeout to ensure it stays attached to any 
    // potential user activation context, and to minimize latency.
    try {
        console.log(`[Audio] Standard TTS: "${text}"`);
        
        // Cancel any pending speech to prevent queue buildup and force immediate playback
        window.speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        if (voiceURI) {
            const voice = window.speechSynthesis.getVoices().find(v => v.voiceURI === voiceURI);
            if (voice) {
                utterance.voice = voice;
            }
        }
        window.speechSynthesis.speak(utterance);
        return "Standard Browser TTS Triggered";
    } catch (e: any) {
        console.error("[Audio] Standard TTS failed", e);
        return `Error: Standard TTS failed - ${e.message}`;
    }
};

export const playAudioUrl = (url: string) => {
    const fully = getFully();

    if (typeof fully !== 'undefined' && typeof fully.playSound === 'function') {
        try {
            console.log(`[Audio] Using Fully Kiosk Audio: ${url}`);
            fully.playSound(String(url));
            return;
        } catch (e) {
             console.error("[Audio] Fully Kiosk Audio failed", e);
        }
    }

    // Standard Web Audio
    try {
        console.log(`[Audio] Standard Audio: ${url}`);
        const audio = new Audio(url);
        audio.play().catch(e => console.error("[Audio] Standard Audio playback failed:", e));
    } catch (e) {
        console.error("[Audio] Standard Audio init failed", e);
    }
};
