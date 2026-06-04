import React, { useState, useEffect, useMemo } from 'react';
import { Device, TileConfig, DeviceService } from '../../types';
import { useDashboard } from '../../hooks/useDashboard';
import TileWrapper from './TileWrapper';
import { IconRefreshCw, IconLink } from '../icons';
import { fluidIcon, fluidTextXs } from './tileScale';

// Phase 6 — custom Home Assistant card escape hatch.
//
// Embeds a Lovelace view / HACS card (or any URL) in a sandboxed iframe so
// integrations B-Panels doesn't model natively can still be surfaced. It is
// HA-aware: when configured with a relative path (e.g. "/lovelace/kiosk") it
// resolves against the enabled Home Assistant connection's base URL, so the
// user doesn't paste the host (and it stays correct if the HA URL changes). An
// absolute http(s) URL is used verbatim.
//
// HA-side requirements (documented for the deployment, not enforceable here):
//   - HA must allow being framed: set http.use_x_forwarded_for appropriately
//     and serve a `frame-ancestors` / X-Frame-Options policy that permits the
//     panel origin (e.g. via a reverse proxy), otherwise the browser blanks
//     the frame.
//   - The kiosk webview needs an authenticated HA session (trusted-network
//     auth or an existing login), since Lovelace requires auth.

const HACustomCardTile = ({
    device,
    tile,
    isEditor,
    cornerClassName,
}: {
    device: Device;
    tile: TileConfig;
    isEditor?: boolean;
    cornerClassName?: string;
}) => {
    const { connections } = useDashboard();

    const haBase = useMemo(() => {
        const haConn = (connections || []).find(c => c.id === DeviceService.HomeAssistant && c.enabled);
        return (haConn?.cloudEndpoint || '').replace(/\/+$/, '');
    }, [connections]);

    // state can be a string (legacy/url) or { url?, path?, refresh? }.
    const { rawUrl, path, refresh } = useMemo(() => {
        const s = device.state;
        if (typeof s === 'string') return { rawUrl: s, path: '', refresh: 0 };
        if (s && typeof s === 'object') {
            const obj = s as any;
            return { rawUrl: obj.url || '', path: obj.path || '', refresh: obj.refresh || 0 };
        }
        return { rawUrl: '', path: '', refresh: 0 };
    }, [device.state]);

    // Resolve the final src: absolute url wins; otherwise base + relative path.
    const { src, missingBase } = useMemo(() => {
        const abs = rawUrl && /^https?:\/\//i.test(rawUrl) ? rawUrl : '';
        if (abs) return { src: abs, missingBase: false };
        const rel = (path || rawUrl || '').trim();
        if (!rel) return { src: null as string | null, missingBase: false };
        if (!haBase) return { src: null as string | null, missingBase: true };
        return { src: `${haBase}/${rel.replace(/^\/+/, '')}`, missingBase: false };
    }, [rawUrl, path, haBase]);

    const [iframeKey, setIframeKey] = useState(Date.now());
    const [isLoaded, setIsLoaded] = useState(false);

    useEffect(() => {
        if (isEditor) return; // never auto-refresh in the editor
        if (refresh && refresh > 0) {
            const interval = setInterval(() => {
                setIsLoaded(false);
                setIframeKey(Date.now());
            }, refresh * 1000);
            return () => clearInterval(interval);
        }
    }, [refresh, isEditor]);

    const placeholder = (text: string) => (
        <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-gray-300 text-center px-3"
            style={{ background: 'radial-gradient(circle at 50% 45%, rgb(0 0 0 / 0.4), rgb(0 0 0 / 0.7))' }}
        >
            <IconLink style={fluidIcon(2)} />
            <p className="font-semibold" style={fluidTextXs}>{text}</p>
        </div>
    );

    return (
        <TileWrapper label="" isLocked={tile.isLocked} isEditor={isEditor} className={`!bg-black ${cornerClassName || ''}`}>
            <div className="w-full flex-1 relative">
                {src ? (
                    <iframe
                        key={iframeKey}
                        title={tile.label || device.name}
                        src={src}
                        onLoad={() => setIsLoaded(true)}
                        className="w-full h-full border-0 rounded-control absolute inset-0"
                        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                    />
                ) : (
                    placeholder(missingBase ? 'Home Assistant URL not configured' : 'No card URL configured')
                )}

                {/* Loading overlay until the frame paints */}
                {src && !isLoaded && (
                    <div
                        className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 z-10 pointer-events-none"
                        style={{ background: 'radial-gradient(circle at 50% 45%, rgb(0 0 0 / 0.45), rgb(0 0 0 / 0.75))' }}
                    >
                        <div
                            className="flex items-center justify-center rounded-full"
                            style={{
                                width: 'clamp(2.25rem, 30cqmin, 4rem)',
                                aspectRatio: '1 / 1',
                                background: 'radial-gradient(circle at 38% 30%, rgb(59 130 246 / 0.30), rgb(59 130 246 / 0.06) 70%, transparent)',
                                border: '1px solid rgb(59 130 246 / 0.5)',
                                boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 0.16), 0 0 18px -4px #3b82f6',
                            }}
                        >
                            <IconRefreshCw className="text-blue-300 animate-spin" style={fluidIcon(1.75)} />
                        </div>
                        <p className="font-semibold text-blue-200" style={{ ...fluidTextXs, textShadow: '0 1px 2px rgb(0 0 0 / 0.8)' }}>Loading…</p>
                    </div>
                )}

                {/* Name label over a readable bottom scrim */}
                {tile.label && (
                    <div className="absolute inset-x-0 bottom-0 z-10 pointer-events-none px-2 pb-1.5 pt-5" style={{ background: 'linear-gradient(to top, rgb(0 0 0 / 0.7), transparent)' }}>
                        <span className="text-white font-semibold truncate block" style={{ ...fluidTextXs, textShadow: '0 1px 3px rgb(0 0 0 / 0.9)' }}>{tile.label}</span>
                    </div>
                )}
            </div>
        </TileWrapper>
    );
};

export default HACustomCardTile;
