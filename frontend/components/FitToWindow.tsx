import React, { useLayoutEffect, useRef, useState } from 'react';

interface FitToWindowProps {
    enabled: boolean;
    children: React.ReactNode;
}

// Uniform scale-to-fit, modeled on the (perfect) native iPad shell. The panel
// renders at its intrinsic *design* size (a fixed landscape grid of square
// cells — see Dashboard), and this wrapper scales that whole block by a single
// factor to fit the viewport, then centers it. Because both axes scale by the
// same factor, tile proportions are ALWAYS preserved — no tall-skinny squish on
// a phone, no distortion in any orientation.
//
//   scale = min(vw / naturalWidth, vh / naturalHeight)
//
// The factor can be <1 (shrink to fit a small/portrait screen) or >1 (grow to
// fill a large display). Any leftover space around the scaled panel is
// transparent — it shows the app/theme background, not letterbox bars (the
// wrapper sets no colour). This is what makes the dashboard look right in every
// mode: browser, phone, iPad, and the HA sidebar panel.
//
// Disabled (`enabled=false`) inside the native iPad app (window.__bpanelsNative,
// SwiftUI scales) and on non-dashboard routes (Admin/login scroll normally) —
// there we render children verbatim, no wrapper.
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
                // offsetWidth/Height are the untransformed layout size, so this
                // never feeds back through the scale transform.
                const w = el.offsetWidth;
                const h = el.offsetHeight;
                if (w > 0 && h > 0) {
                    const s = Math.min(window.innerWidth / w, window.innerHeight / h);
                    setScale(s > 0 && Number.isFinite(s) ? s : 1);
                }
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
        <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div
                ref={innerRef}
                style={{
                    flex: '0 0 auto',
                    transform: `scale(${scale})`,
                    transformOrigin: 'center center',
                }}
            >
                {children}
            </div>
        </div>
    );
};

export default FitToWindow;
