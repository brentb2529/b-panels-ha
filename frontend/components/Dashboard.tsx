
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, Link, useLocation } from 'react-router-dom';
import { useDashboard } from '../hooks/useDashboard';
import Tile from './Tile';
import { IconArrowLeft, IconRefreshCw, IconAlertTriangle } from './icons';
import CameraControlModal from './CameraControlModal';
import { Device, DeviceType, DeviceService } from '../types';
import CameraGroupModal from './CameraGroupModal';
import IntrusionModal from './IntrusionModal';
import EntryDelayModal from './EntryDelayModal';
import ExitDelayModal from './ExitDelayModal';
import TileErrorBoundary from './TileErrorBoundary';
import { startSiren, stopSiren } from '../services/alarmTones';

// Bespoke design-system compilation panels (Increment 2+). Lazy so they never
// weigh on the generic-grid first paint. Rendered only for panels carrying a
// matching `compilationKind` — every existing grid panel is untouched.
const KitchenPanel = React.lazy(() => import('../design-system/panels/KitchenPanel'));
const HomePanel = React.lazy(() => import('../design-system/panels/HomePanel'));
const PoolPanel = React.lazy(() => import('../design-system/panels/PoolPanel'));
const ClimatePanel = React.lazy(() => import('../design-system/panels/ClimatePanel'));
const PrimarySuitePanel = React.lazy(() => import('../design-system/panels/PrimarySuitePanel'));
const SecurityPanel = React.lazy(() => import('../design-system/panels/SecurityPanel'));

// Helper to convert hex to rgba for glow effects
const hexToRgba = (hex: string, alpha: number) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? `rgba(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}, ${alpha})`
      : `rgba(255, 255, 255, ${alpha})`; // Fallback for invalid hex
};


const Dashboard = () => {
  const { panels, deviceMap, loading, isDeviceLoading, devices, alarmState, setActivePanelId, configLoadError, retryConfigLoad, serviceError, requestPin, setAlarmStatus, dismissServiceError, addNotification, users, connectionState, connectionRetryCountdown, retryConnection, activeDevicePanel, closeDevicePanel, haWsState, lastHaEventAt, primaryAlarmProvider, entryDelaySound } = useDashboard();
  const { panelId } = useParams<{ panelId: string }>();
  const location = useLocation();
  const [enlargedCamera, setEnlargedCamera] = useState<Device | null>(null);
  const [enlargedCameraGroup, setEnlargedCameraGroup] = useState<Device | null>(null);
  const [enlargedSonosPlayer, setEnlargedSonosPlayer] = useState<Device | null>(null);

  // Tick every 30s so stale-data warnings re-evaluate without waiting for a re-render trigger
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // Delay showing the reconnecting banner to avoid flashing on brief disconnections
  const [showReconnecting, setShowReconnecting] = useState(false);
  const reconnectTimerRef = useRef<number | undefined>();

  useEffect(() => {
    if (connectionState === 'reconnecting') {
      // Only show the banner after 8 seconds of sustained disconnection
      // Brief reconnects (network hiccups, proxy resets) recover silently
      reconnectTimerRef.current = window.setTimeout(() => {
        setShowReconnecting(true);
      }, 8000);
    } else {
      // Clear timer and hide banner immediately when connected
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = undefined;
      }
      setShowReconnecting(false);
    }
    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
    };
  }, [connectionState]);

  // Alarm flow is driven entirely by the alarm panel's `phase` (from Alarmo):
  //   arming    -> exit-delay banner
  //   pending   -> entry-delay disarm modal
  //   triggered -> full intrusion modal + siren
  // Alarmo owns the delay timers (we anchor countdowns on its delay/last_changed
  // and never run our own escalation timer — pending->triggered is Alarmo's call).
  const phase = alarmState?.phase ?? 'idle';
  // Identifies one alarm "episode" so dismissals/announcements reset per event.
  const episodeKey = `${phase}:${alarmState?.trigger?.name ?? ''}:${alarmState?.haDelayStartedAt ?? ''}`;
  const [entryDismissedKey, setEntryDismissedKey] = useState<string | null>(null);

  // Per-panel WebAudio siren while triggered, so EVERY panel sounds — not only
  // ones running Fully Kiosk or driving Sonos (those are layered on by the
  // hook's escalateToFullAlarm). Security audio ignores the panel Mute schedule
  // by design: an armed-system trigger must always be audible.
  useEffect(() => {
    if (phase === 'triggered') {
      startSiren();
      return () => stopSiren();
    }
    stopSiren();
  }, [phase]);

  // One-shot intrusion toast per episode.
  const announcedRef = useRef<string | null>(null);
  useEffect(() => {
    if (phase === 'triggered') {
      if (announcedRef.current !== episodeKey) {
        announcedRef.current = episodeKey;
        const name = alarmState?.trigger?.name || alarmState?.violatingSensors?.[0]?.name || 'Unknown sensor';
        addNotification(`INTRUSION: ${name} triggered the alarm!`, 'error');
      }
    } else if (phase === 'idle') {
      announcedRef.current = null;
    }
  }, [phase, episodeKey, alarmState, addNotification]);

  // Latest alarm state, for confirming a disarm without stale closure capture.
  const alarmStateRef = useRef(alarmState);
  useEffect(() => { alarmStateRef.current = alarmState; }, [alarmState]);

  // Disarm shared by every alarm modal. The entered PIN is the ALARMO CODE —
  // Alarmo validates it server-side, so we don't gate it against the dashboard
  // Users list. We confirm success by the panel actually reaching 'disarmed'
  // (a wrong code leaves the state unchanged), so the PIN pad shows "Invalid PIN"
  // only when Alarmo actually rejected it.
  const handleDisarmAttempt = useCallback(async (pin: string): Promise<boolean> => {
    await setAlarmStatus('DISARMED', pin);
    const disarmed = await new Promise<boolean>(resolve => {
      const start = Date.now();
      const iv = window.setInterval(() => {
        if (alarmStateRef.current?.armState === 'disarmed') { clearInterval(iv); resolve(true); }
        else if (Date.now() - start > 2500) { clearInterval(iv); resolve(false); }
      }, 150);
    });
    if (disarmed) { addNotification('System disarmed', 'success'); return true; }
    return false;
  }, [setAlarmStatus, addNotification]);

  // Cancel arming (exit delay): disarm via the PIN pad. validate:false → the PIN
  // is sent to Alarmo as the code (Alarmo validates), not checked locally.
  const cancelArming = useCallback(() => {
    requestPin((pin) => { setAlarmStatus('DISARMED', pin); }, { validate: false });
  }, [requestPin, setAlarmStatus]);

  useEffect(() => {
    if (panelId) {
        setActivePanelId(panelId);
    }
    return () => {
        setActivePanelId(null);
    }
  }, [panelId, setActivePanelId]);

  const activePanel = panels.find(p => p.id === panelId);
  const parentPanel = activePanel?.parentId ? panels.find(p => p.id === activePanel.parentId) : null;

  // Dynamic resize: fill the screen edge-to-edge with no scroll and no bands —
  // fluid columns + rows that divide the available height (minmax(0,1fr)), so
  // the whole panel stretches to fit the viewport. On everywhere EXCEPT the
  // native iPad shell (which scales itself with fixed rowHeight rows).
  const isNativeShell = typeof window !== 'undefined' && (window as any).__bpanelsNative === true;
  const fillScreen = !isNativeShell;


  // Precompute rounded-corner classes for tiles inside highlight regions.
  // MUST stay above the early returns below — moving it after them caused the
  // hook count to change between the "loading" render and the loaded render
  // (rules-of-hooks violation → blank screen), which HA's slower async device
  // load reliably triggered.
  const cornerStyles = useMemo(() => {
    const styles = new Map<string, string>();
    if (!activePanel?.highlights || activePanel.highlights.length === 0) {
        return styles;
    }

    for (const highlight of activePanel.highlights) {
        for (const tile of activePanel.tiles) {
            const tileX = tile.x ?? 0;
            const tileY = tile.y ?? 0;
            const tileW = tile.width || 1;
            const tileH = tile.height || 1;

            let tileCornerClasses = '';

            // Check if tile is inside highlight bounds
            const isInside = tileX >= highlight.x &&
                             (tileX + tileW) <= (highlight.x + highlight.width) &&
                             tileY >= highlight.y &&
                             (tileY + tileH) <= (highlight.y + highlight.height);

            if (!isInside) continue;

            // Corner tiles of a highlight group adopt the SAME radius token as
            // standalone tiles (`rounded-*-tile` = --radius-tile, 16px) so a
            // grouped tile and a single tile read as one consistent shape. (The
            // previous `rounded-*-3xl` = 24px made groups look more rounded than
            // singles.) The group background radius is set to 16+offset to nest.
            // Check Top-Left corner
            if (tileX === highlight.x && tileY === highlight.y) {
                tileCornerClasses += ' rounded-tl-tile';
            }
            // Check Top-Right corner
            if ((tileX + tileW) === (highlight.x + highlight.width) && tileY === highlight.y) {
                tileCornerClasses += ' rounded-tr-tile';
            }
            // Check Bottom-Left corner
            if (tileX === highlight.x && (tileY + tileH) === (highlight.y + highlight.height)) {
                tileCornerClasses += ' rounded-bl-tile';
            }
            // Check Bottom-Right corner
            if ((tileX + tileW) === (highlight.x + highlight.width) && (tileY + tileH) === (highlight.y + highlight.height)) {
                tileCornerClasses += ' rounded-br-tile';
            }

            if (tileCornerClasses) {
                const existingStyles = styles.get(tile.id) || '';
                styles.set(tile.id, existingStyles + tileCornerClasses);
            }
        }
    }
    return styles;
  }, [activePanel?.tiles, activePanel?.highlights]);

  // Stable identity so React.memo'd tiles aren't re-rendered by a new callback
  // on every parent render. Declared above the early returns (with cornerStyles)
  // so the hook order is invariant across panel kinds (rules-of-hooks).
  const handleEnlarge = useCallback((device: Device) => {
      if (device.type === DeviceType.Camera) {
        setEnlargedCamera(device);
      } else if (device.type === DeviceType.CameraGroup) {
        setEnlargedCameraGroup(device);
      } else if (device.type === DeviceType.SonosPlayer) {
        setEnlargedSonosPlayer(device);
      }
  }, []);

  if (configLoadError) {
      return (
          <div className="flex flex-col items-center justify-center h-[calc(100vh-100px)] text-center p-8">
              <div className="bg-gray-800 p-8 rounded-lg shadow-lg max-w-md w-full border border-red-500/30">
                  <IconAlertTriangle className="w-16 h-16 mx-auto text-red-500 mb-4" />
                  <h2 className="text-2xl font-bold text-white mb-2">Configuration Error</h2>
                  <p className="text-gray-300 mb-6">{configLoadError}</p>
                  <button 
                      onClick={retryConfigLoad}
                      className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-brand-blue hover:bg-blue-600 text-white rounded-md font-medium transition-colors"
                  >
                      <IconRefreshCw className="w-5 h-5" />
                      Retry
                  </button>
              </div>
          </div>
      );
  }

  // Only show full loading state if we are loading config OR if devices are loading for the first time (empty list)
  // This allows background refreshes without blocking the UI.
  if (loading || (isDeviceLoading && devices.length === 0)) {
    return <div className="text-center text-gray-400 pt-20">Loading devices...</div>;
  }
  
  if (!activePanel) {
      return (
        <div className="text-center text-gray-400 p-8 bg-gray-800 rounded-lg max-w-md mx-auto mt-20">
            <h2 className="text-xl font-bold mb-2">Panel Not Found</h2>
            <p>Go to the <Link to="/admin" className="text-brand-blue underline">Admin page</Link> to create or select a panel.</p>
        </div>
      );
  }
  
  // Bespoke compilation panel kinds render their own full-bleed design-system
  // surface instead of the tile grid. Additive: only fires when the panel
  // explicitly opts in via `compilationKind` (no existing panel does). The alarm
  // flow modals above still apply on every panel; the compilation surface owns
  // the rest of the viewport. NOTE: this early return is placed AFTER every
  // hook in this component (handleEnlarge was hoisted above the guards) so the
  // hook count is identical whether or not the active panel is a compilation
  // panel — navigating grid<->compilation must not change hook order.
  if (activePanel.compilationKind === 'kitchen') {
    return (
      <div className="relative h-full">
        <React.Suspense fallback={<div className="text-center text-gray-400 pt-20">Loading Kitchen…</div>}>
          <KitchenPanel />
        </React.Suspense>
      </div>
    );
  }
  if (activePanel.compilationKind === 'home') {
    return (
      <div className="relative h-full">
        <React.Suspense fallback={<div className="text-center text-gray-400 pt-20">Loading Home…</div>}>
          <HomePanel />
        </React.Suspense>
      </div>
    );
  }
  if (activePanel.compilationKind === 'pool') {
    return (
      <div className="relative h-full">
        <React.Suspense fallback={<div className="text-center text-gray-400 pt-20">Loading Pool &amp; Spa…</div>}>
          <PoolPanel />
        </React.Suspense>
      </div>
    );
  }
  if (activePanel.compilationKind === 'climate') {
    return (
      <div className="relative h-full">
        <React.Suspense fallback={<div className="text-center text-gray-400 pt-20">Loading Climate…</div>}>
          <ClimatePanel />
        </React.Suspense>
      </div>
    );
  }
  if (activePanel.compilationKind === 'primary-suite') {
    return (
      <div className="relative h-full">
        <React.Suspense fallback={<div className="text-center text-gray-400 pt-20">Loading Primary Suite…</div>}>
          <PrimarySuitePanel />
        </React.Suspense>
      </div>
    );
  }
  if (activePanel.compilationKind === 'security') {
    return (
      <div className="relative h-full">
        <React.Suspense fallback={<div className="text-center text-gray-400 pt-20">Loading Security…</div>}>
          <SecurityPanel />
        </React.Suspense>
      </div>
    );
  }

  if (activePanel.tiles.length === 0 && !parentPanel) {
    return (
        <div className="text-center text-gray-400 p-8 bg-gray-800 rounded-lg max-w-md mx-auto mt-20">
            <h2 className="text-xl font-bold mb-2">Welcome to {activePanel.name}!</h2>
            <p>This panel is empty. Go to the <Link to="/admin" className="text-brand-blue underline">Admin page</Link> to add your first tile.</p>
        </div>
    );
  }

  return (
    <div className="relative h-full flex flex-col">
      {/* Alarm flow — driven by the panel phase, shown on every panel. */}
      {phase === 'arming' && alarmState && (
          <ExitDelayModal alarmState={alarmState} onCancel={cancelArming} />
      )}
      {phase === 'pending' && alarmState && entryDismissedKey !== episodeKey && (
          <EntryDelayModal
            alarmState={alarmState}
            sound={entryDelaySound}
            onDisarm={handleDisarmAttempt}
            onCancel={() => setEntryDismissedKey(episodeKey)}
          />
      )}
      {phase === 'triggered' && alarmState && (
          <IntrusionModal alarmState={alarmState} onDisarm={handleDisarmAttempt} />
      )}

      {/* Connection Status Banner - shows after sustained disconnection or on error */}
      {(showReconnecting || serviceError) && (
        <div className={`mb-2 p-2 rounded text-sm flex items-center justify-between ${
          showReconnecting
            ? 'bg-yellow-900/50 border border-yellow-500/50 text-yellow-200'
            : 'bg-red-900/50 border border-red-500/50 text-red-200'
        }`}>
            <span className="flex items-center gap-2">
              {showReconnecting ? (
                <>
                  <IconRefreshCw className="w-4 h-4 animate-spin" />
                  <span>
                    Reconnecting to server
                    {connectionRetryCountdown !== null && connectionRetryCountdown > 0 && (
                      <span className="text-yellow-300"> ({connectionRetryCountdown}s)</span>
                    )}
                    ...
                  </span>
                </>
              ) : (
                <>
                  <IconAlertTriangle className="w-4 h-4" />
                  <span>{serviceError}</span>
                </>
              )}
            </span>
            <div className="flex gap-3">
                <button
                  onClick={retryConnection}
                  className="px-2 py-1 bg-white/10 hover:bg-white/20 rounded text-xs font-medium transition-colors"
                >
                  Retry Now
                </button>
                <button
                  onClick={dismissServiceError}
                  className="text-gray-300 hover:text-white hover:underline text-xs"
                >
                  Dismiss
                </button>
            </div>
        </div>
      )}

      {/* HA WebSocket disconnect warning (shown when HA is the active alarm/device provider) */}
      {primaryAlarmProvider === 'ha' && haWsState === 'disconnected' && (
        <div className="mb-2 p-2 rounded text-sm flex items-center gap-2 bg-yellow-900/50 border border-yellow-500/50 text-yellow-200">
          <IconRefreshCw className="w-4 h-4 animate-spin flex-shrink-0" />
          <span>Home Assistant: reconnecting… Device states may be stale.</span>
        </div>
      )}
      {/* HA stale data warning (connected but no event in >5 min) */}
      {primaryAlarmProvider === 'ha' && haWsState === 'connected' && lastHaEventAt !== null && (Date.now() - lastHaEventAt.getTime()) > 5 * 60 * 1000 && (
        <div className="mb-2 p-2 rounded text-sm flex items-center gap-2 bg-yellow-900/50 border border-yellow-500/50 text-yellow-200">
          <IconAlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>Home Assistant: no events in over 5 minutes — device states may be stale.</span>
        </div>
      )}

      {parentPanel && (
        <div className="flex items-center gap-3 mb-6">
            <Link
              to={`/dashboard/${parentPanel.id}${location.search}`}
              className="p-2 -ml-2 text-white rounded-full hover:bg-gray-700 transition-colors"
              aria-label={`Back to ${parentPanel.name}`}
            >
              <IconArrowLeft className="w-6 h-6" />
            </Link>
            <h1 className="text-3xl font-bold text-white truncate">
              {activePanel?.name}
            </h1>
        </div>
      )}

      {enlargedCamera && <CameraControlModal device={enlargedCamera} onClose={() => setEnlargedCamera(null)} />}
      {enlargedCameraGroup && <CameraGroupModal device={enlargedCameraGroup} onClose={() => setEnlargedCameraGroup(null)} />}
      {!activeDevicePanel && activePanel.tiles.length === 0 && (
         <div className="text-center text-gray-400 p-8 bg-gray-800 rounded-lg">
            <p>This folder is empty. Go to the <Link to="/admin" className="text-brand-blue underline">Admin page</Link> to add tiles.</p>
        </div>
      )}

      {!activeDevicePanel && <div
        className={`grid gap-2.5 flex-1 min-h-0 ${fillScreen ? 'overflow-hidden' : 'overflow-y-auto'}`}
        style={{
            // Fill the screen: fluid columns always. Rows divide the available
            // height (minmax(0,1fr)) so the panel stretches edge-to-edge with no
            // scroll and no letterbox bands. Native shell keeps fixed-rowHeight
            // rows (it does its own scaling) and scrolls if taller than the view.
            gridTemplateColumns: `repeat(${activePanel.columns || 8}, minmax(0, 1fr))`,
            gridAutoRows: fillScreen
                ? 'minmax(0, 1fr)'
                : `${activePanel.rowHeight || 120}px`,
        }}
      >
        {/* Render Highlight Sections */}
        {activePanel.highlights?.map(highlight => {
            const PADDING_OFFSET = '4px';

            const outerStyle: React.CSSProperties = {
                gridColumn: `${highlight.x + 1} / span ${highlight.width}`,
                gridRow: `${highlight.y + 1} / span ${highlight.height}`,
                zIndex: 0,
            };
            
            const backgroundStyle: React.CSSProperties = {
                position: 'absolute',
                top: `-${PADDING_OFFSET}`,
                left: `-${PADDING_OFFSET}`,
                right: `-${PADDING_OFFSET}`,
                bottom: `-${PADDING_OFFSET}`,
                // Group background sits PADDING_OFFSET (4px) outside the corner
                // tiles, which are rounded to --radius-tile (16px). 16 + 4 = 20px
                // keeps the background's rounded corners concentric with the
                // tiles' corners instead of looking like a separate, rounder shape.
                borderRadius: 'calc(var(--radius-tile) + 4px)', // 20px
            };
            
            let backgroundClasses = "bg-gray-700/50";
            
            if (highlight.backgroundStyle === 'glow') {
                const color = highlight.glowColor || '#ffffff';
                const innerGlow = hexToRgba(color, 0.7);
                const outerGlow = hexToRgba(color, 0.25);
                
                backgroundStyle.boxShadow = `
                    inset 0 0 0.5px 1px ${innerGlow},
                    0 0 0.5px 1px ${innerGlow},
                    0 0 7px 2px ${outerGlow}
                `;
                backgroundStyle.background = `radial-gradient(ellipse at center, ${hexToRgba(color, 0.08)} 0%, transparent 80%)`;
                backgroundClasses = "";
            } else {
                 backgroundStyle.border = `1px solid rgba(255, 255, 255, 0.15)`
            }

            return (
                <div
                    key={highlight.id}
                    className="pointer-events-none relative"
                    style={outerStyle}
                >
                    <div style={backgroundStyle} className={backgroundClasses} />
                    {highlight.label && (
                        <span 
                            className="absolute left-4 text-sm font-semibold text-gray-300 bg-gray-900 px-2 rounded z-10"
                            style={{ top: '-17px' }}
                        >
                            {highlight.label}
                        </span>
                    )}
                </div>
            );
        })}
        
        {/* Render Tiles */}
        {activePanel.tiles.map((tile) => {
          let device: Device | undefined = deviceMap.get(tile.deviceId);

          // Special handling for the STHM tile, which is not a regular device
          if (tile.deviceId === 'hometile-sthm-panel') {
              if (alarmState) {
                  device = {
                      id: 'hometile-sthm-panel',
                      name: alarmState.locationName ? `${alarmState.locationName} Monitor` : 'STHM Monitor',
                      type: DeviceType.AlarmPanel,
                      service: DeviceService.Virtual,
                      state: alarmState,
                      location: 'SmartThings',
                  };
              } else {
                  // If tile exists but state is not available, render it as 'not found'
                  device = undefined;
              }
          }
          
          const cornerClassName = cornerStyles.get(tile.id) || '';

          return (
            <div
              key={tile.id}
              className="relative"
              style={{
                gridColumn: `${(tile.x ?? 0) + 1} / span ${tile.width || 1}`,
                gridRow: `${(tile.y ?? 0) + 1} / span ${tile.height || 1}`,
                zIndex: 1,
                // Size container: lets a tile's inner content (e.g. the
                // alarm buttons) scale with the tile's actual rendered height
                // via cqh units, so it shrinks when fit mode compresses rows.
                containerType: 'size',
              }}
            >
              <TileErrorBoundary label={tile.label || device?.name} cornerClassName={cornerClassName}>
                <Tile tile={tile} device={device} onEnlarge={handleEnlarge} cornerClassName={cornerClassName} />
              </TileErrorBoundary>
            </div>
          );
        })}
      </div>}
    </div>
  );
};

export default Dashboard;
