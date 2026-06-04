import React, { useEffect, useState } from 'react';

// Tiny corner badge showing the deployed version, fetched from /version.txt
// (dist/version.txt). deployv3.sh stamps that file on each deploy as
// "<tag> (<short-sha>)" — the same string api-server reads to trigger panel
// reloads, so there's one source of truth. Fixed-position so it never shifts
// panel layout; pointer-events-none so it can't steal kiosk taps.
const VersionFooter: React.FC = () => {
    const [version, setVersion] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        fetch('/version.txt', { cache: 'no-store' })
            .then(r => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
            .then(text => { if (!cancelled) setVersion(text.trim()); })
            .catch(() => { /* dev env or missing file — render nothing */ });
        return () => { cancelled = true; };
    }, []);

    if (!version) return null;

    return (
        <div
            className="fixed bottom-1 right-2 z-50 pointer-events-none select-none text-[10px] font-mono text-gray-500/70"
            aria-hidden="true"
        >
            v{version}
        </div>
    );
};

export default VersionFooter;
