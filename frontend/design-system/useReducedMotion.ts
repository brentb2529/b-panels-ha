/**
 * useReducedMotion — tracks the `prefers-reduced-motion: reduce` media query.
 *
 * The app already has a global CSS killswitch (index.html) that neutralizes
 * decorative @keyframes loops + transitions when the user/panel asks for less
 * motion. This hook lets a JS-driven widget ALSO render a deliberate STATIC
 * variant (e.g. a fan with still blades + visible-but-frozen airflow) instead
 * of relying solely on the CSS killswitch, so reduced-motion still looks
 * intentional rather than "broken mid-animation".
 *
 * SSR/old-browser safe: defaults to false (motion on) when matchMedia is absent.
 */

import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

export function useReducedMotion(): boolean {
    const [reduced, setReduced] = useState<boolean>(() => {
        if (typeof window === 'undefined' || !window.matchMedia) return false;
        return window.matchMedia(QUERY).matches;
    });

    useEffect(() => {
        if (typeof window === 'undefined' || !window.matchMedia) return;
        const mql = window.matchMedia(QUERY);
        const onChange = () => setReduced(mql.matches);
        onChange();
        // addEventListener is the modern API; fall back to addListener for older WebKit.
        if (mql.addEventListener) {
            mql.addEventListener('change', onChange);
            return () => mql.removeEventListener('change', onChange);
        }
        mql.addListener(onChange);
        return () => mql.removeListener(onChange);
    }, []);

    return reduced;
}

export default useReducedMotion;
