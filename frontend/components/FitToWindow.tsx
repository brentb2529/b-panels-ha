import React, { useLayoutEffect, useRef, useState } from 'react';

interface FitToWindowProps {
    enabled: boolean;
    children: React.ReactNode;
}

// Browser / Fully-Kiosk fit-to-window, modeled on the (perfect) native
// iPad shell: the panel fills the full width and is squished vertically
// only as much as needed to fit the viewport height — so it fills the
// screen edge-to-edge with NO letterbox side bars, and translucent tiles
// composite over the app's own background (this wrapper is transparent,
// never a solid colour, so light/dark theme renders correctly).
//
// scale = min(1, vh / naturalHeight): when the panel already fits, scale
// is 1 and the grid's `1fr` rows stretch to fill the full width AND height
// (just like the iPad); when it's taller than the viewport, the WHOLE panel
// is scaled down UNIFORMLY (both axes by the same factor) so tile
// proportions are preserved — never squished. A uniform shrink can leave a
// little transparent room on the right; that shows the app's own background
// (the wrapper is transparent), not black bars. The earlier scaleY-only
// version filled the width but distorted every tile vertically.
//
// Gated by `enabled`: false inside the native iPad app
// (window.__bpanelsNative), where SwiftUI does the scaling — there we
// render children verbatim, no wrapper.
const FitToWindow: React.FC<FitToWindowProps> = ({ enabled, children }) => {
    const innerRef = useRef<HTMLDivElement>(null);
    const [scale, setScale] = useState(1);

    useLayoutEffect(() => {
        if (!enabled) {
            setScale(1);
            return;
        }
        const el = innerRef.current;
        if (!el) return;

        let raf = 0;
        const measure = () => {
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(() => {
                // scrollHeight is the content's full layout height and is
                // unaffected by the transform, so this never feeds back.
                const natural = el.scrollHeight;
                const vh = window.innerHeight;
                setScale(natural > 0 ? Math.min(1, vh / natural) : 1);
            });
        };

        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        window.addEventListener('resize', measure);
        window.addEventListener('orientationchange', measure);
        return () => {
            cancelAnimationFrame(raf);
            ro.disconnect();
            window.removeEventListener('resize', measure);
            window.removeEventListener('orientationchange', measure);
        };
    }, [enabled]);

    if (!enabled) return <>{children}</>;

    return (
        <div style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
            <div
                ref={innerRef}
                style={{
                    width: '100vw',
                    transform: `scale(${scale})`,
                    transformOrigin: 'top left',
                }}
            >
                {children}
            </div>
        </div>
    );
};

export default FitToWindow;
