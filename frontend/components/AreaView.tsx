/**
 * AreaView — full-screen area compilation panel renderer.
 *
 * Route: /area/:areaKey
 *
 * Maps homeowner-friendly area keys to compilation DeviceTypes, finds (or creates)
 * the right virtual device, and renders the compilation tile full-screen.
 *
 * Area key mapping:
 *   pool      → DeviceType.PoolArea      → PoolCompilationTile
 *   climate   → DeviceType.ClimateArea   → ClimateCompilationTile
 *   security  → DeviceType.SecurityArea  → SecurityCompilationTile
 *   lights    → DeviceType.LutronSurface → LutronSurface
 *   generator → DeviceType.Generator    → GeneratorTile
 *
 * If a matching virtualDevice exists in saved config, it is used. Otherwise a
 * synthetic device is constructed inline (id based on area key so it's stable).
 * The tile renders as if it were placed on a dashboard — same TileProps contract.
 *
 * Back navigation: tap the area name / back button in the header to return to /home.
 */

import React, { useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDashboard } from '../hooks/useDashboard';
import { resolveTile } from './tileRegistry';
import { Device, DeviceService, DeviceType } from '../types';
import { IconArrowLeft, IconHome } from './icons';
import TileErrorBoundary from './TileErrorBoundary';

// ── Area key → DeviceType mapping ────────────────────────────────────────────

const AREA_DEVICE_TYPE: Record<string, DeviceType> = {
  pool: DeviceType.PoolArea,
  climate: DeviceType.ClimateArea,
  security: DeviceType.SecurityArea,
  lights: DeviceType.LutronSurface,
  generator: DeviceType.Generator,
};

const AREA_LABELS: Record<string, string> = {
  pool: 'Pool',
  climate: 'Heating & Cooling',
  security: 'Security',
  lights: 'Lights',
  generator: 'Generator',
};

/** Construct a stable synthetic device for an area when no virtualDevice exists. */
function makeSyntheticDevice(areaKey: string, deviceType: DeviceType): Device {
  return {
    id: `area-synthetic-${areaKey}`,
    name: AREA_LABELS[areaKey] || areaKey,
    type: deviceType,
    service: DeviceService.Virtual,
    state: {},
  };
}

// ── Back button ───────────────────────────────────────────────────────────────

const BackButton: React.FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => (
  <button
    onClick={onClick}
    className="flex items-center gap-2 transition-all"
    style={{
      padding: '8px 14px 8px 10px',
      borderRadius: 10,
      backgroundColor: 'rgb(var(--surface-control) / 0.7)',
      backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
      border: '1px solid var(--tile-border)',
      color: 'rgb(var(--text) / 0.8)',
      fontSize: 14,
      fontWeight: 600,
      cursor: 'pointer',
      outline: 'none',
    }}
    aria-label="Back to Home"
  >
    <IconArrowLeft className="w-4 h-4" />
    <span>{label}</span>
  </button>
);

// ── AreaView ──────────────────────────────────────────────────────────────────

const AreaView: React.FC = () => {
  const { areaKey = '' } = useParams<{ areaKey: string }>();
  const { virtualDevices } = useDashboard();
  const navigate = useNavigate();

  const deviceType = AREA_DEVICE_TYPE[areaKey];
  const areaLabel = AREA_LABELS[areaKey] || areaKey;

  // Find matching virtualDevice in saved config, or synthesize one
  const device = useMemo<Device | null>(() => {
    if (!deviceType) return null;
    // Prefer saved virtualDevice matching this type
    const saved = virtualDevices.find(d => d.type === deviceType);
    if (saved) return saved;
    // Fall back to synthetic
    return makeSyntheticDevice(areaKey, deviceType);
  }, [deviceType, virtualDevices, areaKey]);

  if (!deviceType || !device) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-gray-400 text-lg">Unknown area: {areaKey}</p>
        <BackButton label="Back to Home" onClick={() => navigate('/home')} />
      </div>
    );
  }

  const TileComponent = resolveTile(device);

  // Synthetic tile config — stable id, no grid position (irrelevant here)
  const tileConfig = useMemo(
    () => ({ id: `area-tile-${areaKey}`, deviceId: device.id }),
    [areaKey, device.id]
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Area sub-header: back nav + area title */}
      <div
        className="flex items-center gap-4 flex-none"
        style={{
          padding: '10px 16px 8px 12px',
          borderBottom: '1px solid var(--tile-border)',
          backgroundColor: 'rgb(var(--surface-raised) / 0.6)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
        }}
      >
        <BackButton label="Home" onClick={() => navigate('/home')} />
        <span
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: 'rgb(var(--text))',
            letterSpacing: '-0.01em',
          }}
        >
          {areaLabel}
        </span>
      </div>

      {/* Compilation tile — takes all remaining height */}
      <div className="flex-1 overflow-hidden">
        <TileErrorBoundary label={areaLabel}>
          <TileComponent tile={tileConfig} device={device} />
        </TileErrorBoundary>
      </div>
    </div>
  );
};

export default AreaView;
