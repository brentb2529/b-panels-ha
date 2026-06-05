// Centralized alarm audio: exit/entry delay beeps and a self-contained WebAudio
// siren. These are SECURITY sounds — they deliberately bypass the panel Mute
// schedule (an armed-system event must always be audible). Mute is applied by
// callers to non-security audio only; nothing here consults it.
//
// The siren here is a universal fallback so EVERY panel sounds, not just ones
// running Fully Kiosk or driving Sonos. It plays through the Web Audio API in
// any browser. Fully/Sonos annunciation (escalateToFullAlarm) layers on top.
//
// Web Audio needs a resumed AudioContext, which requires one prior user gesture.
// The dashboard's audio-unlock (first tap) satisfies this on kiosks; we also
// attempt resume() on every call in case the context was suspended.

let ctx: AudioContext | null = null;

const getCtx = (): AudioContext | null => {
    try {
        if (!ctx) {
            const Ctor = (window.AudioContext || (window as any).webkitAudioContext);
            if (!Ctor) return null;
            ctx = new Ctor();
        }
        if (ctx.state === 'suspended') {
            // Fire-and-forget; resolves once a gesture has unlocked audio.
            ctx.resume().catch(() => {});
        }
        return ctx;
    } catch {
        return null;
    }
};

// A short delay beep. `urgent` (final seconds of a countdown) raises the pitch.
export const playDelayBeep = (urgent = false): void => {
    const c = getCtx();
    if (!c) return;
    try {
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.connect(gain);
        gain.connect(c.destination);
        osc.type = 'sine';
        osc.frequency.value = urgent ? 880 : 440;
        // Quick attack/decay envelope so it reads as a clean "beep" not a click.
        const t = c.currentTime;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.35, t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + (urgent ? 0.18 : 0.12));
        osc.start(t);
        osc.stop(t + (urgent ? 0.2 : 0.14));
    } catch {
        /* non-fatal */
    }
};

// --- WebAudio siren (looping until stopped) -------------------------------
let sirenOsc: OscillatorNode | null = null;
let sirenGain: GainNode | null = null;
let sirenTimer: number | null = null;

export const startSiren = (): void => {
    const c = getCtx();
    if (!c || sirenOsc) return; // already running
    try {
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = 'sawtooth';
        osc.connect(gain);
        gain.connect(c.destination);
        gain.gain.value = 0.0001;
        gain.gain.exponentialRampToValueAtTime(0.4, c.currentTime + 0.05);
        osc.start();
        sirenOsc = osc;
        sirenGain = gain;

        // Two-tone wail: sweep the frequency between two pitches on an interval.
        let high = false;
        const sweep = () => {
            if (!sirenOsc || !ctx) return;
            const now = ctx.currentTime;
            const from = high ? 800 : 500;
            const to = high ? 500 : 800;
            sirenOsc.frequency.setValueAtTime(from, now);
            sirenOsc.frequency.linearRampToValueAtTime(to, now + 0.5);
            high = !high;
        };
        sweep();
        sirenTimer = window.setInterval(sweep, 500);
    } catch {
        /* non-fatal */
    }
};

export const stopSiren = (): void => {
    try {
        if (sirenTimer != null) { window.clearInterval(sirenTimer); sirenTimer = null; }
        if (sirenGain && ctx) {
            sirenGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.08);
        }
        if (sirenOsc) {
            const osc = sirenOsc;
            window.setTimeout(() => { try { osc.stop(); } catch {} }, 120);
        }
    } catch {
        /* non-fatal */
    } finally {
        sirenOsc = null;
        sirenGain = null;
    }
};
