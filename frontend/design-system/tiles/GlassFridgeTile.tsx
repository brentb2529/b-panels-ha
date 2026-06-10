import React from 'react';
import { Device, TileConfig, FridgeApplianceState } from '../../types';
import {
  IconSnowflake,
  IconDoorOpen,
  IconDoorClosed,
  IconDroplets,
  IconAlertTriangle,
} from '../../components/icons';
import { fluidTextXs, fluidTextSm, fluidTextLg } from '../../components/tiles/tileScale';
import GlassCard from '../GlassCard';
import { projectFridge } from './applianceLogic';

// ---------------------------------------------------------------------------
// GlassFridgeTile — the liquid-glass Sub-Zero fridge/freezer surface.
//
// LIVE BINDING: renders the composite `FridgeApplianceState` that `useDashboard`
// folds from a Sub-Zero appliance's live HA entities (subzero_wolf integration):
// per-zone set-point + measured temperature, door-ajar, water/air filter life,
// service-required alert. DISPLAY-ONLY — Sub-Zero set-points are read-only at
// the appliance, so this tile exposes NO writes and issues NO service call.
// Honest offline (em-dash, no actuation). All math lives in applianceLogic.ts.
// ---------------------------------------------------------------------------

// A cooling zone column: an animated "frost column" that fills from the bottom
// (deeper for colder set-points), the measured temp big, set-point + door below.
const ZoneColumn = ({
  name,
  tempStr,
  setStr,
  tone,
  doorAjar,
  online,
  cooling,
}: {
  name: string;
  tempStr: string;
  setStr: string;
  tone: string;
  doorAjar?: boolean;
  online: boolean;
  cooling: boolean;
}) => (
  <div className="flex flex-col items-center min-w-0" style={{ gap: '0.3rem', flex: 1 }}>
    <span className="uppercase font-semibold truncate w-full text-center" style={{ ...fluidTextXs, color: 'var(--bp-text-dim)', letterSpacing: '0.05em' }}>{name}</span>
    <div
      className="relative rounded-control overflow-hidden"
      style={{
        width: '100%',
        maxWidth: 'clamp(2.2rem, 22cqmin, 4rem)',
        height: 'clamp(2.6rem, 20cqmin, 4.4rem)',
        background: 'rgba(0,0,0,0.3)',
        border: '1px solid rgba(255,255,255,0.12)',
        boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.5)',
      }}
    >
      {/* frost fill — height encodes "how cold" (deeper = colder set-point) */}
      <div
        className="absolute bottom-0 left-0 right-0"
        style={{
          height: online ? '62%' : '0%',
          background: `linear-gradient(180deg, rgba(255,255,255,0.4), rgba(255,255,255,0) 55%), ${tone}`,
          opacity: 0.85,
          transition: 'height 0.6s cubic-bezier(0.4,0,0.2,1)',
        }}
      />
      {/* drifting frost shimmer when cooling */}
      {online && cooling && (
        <span
          className="absolute inset-x-0"
          style={{
            top: 0, height: '100%',
            background: 'radial-gradient(circle at 50% 90%, rgba(255,255,255,0.28), transparent 60%)',
            animation: 'bpFridgeShimmer 3.2s ease-in-out infinite',
          }}
        />
      )}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-bold tabular-nums leading-none" style={{ ...fluidTextLg, color: online ? '#fff' : 'var(--bp-text-dim)', textShadow: '0 1px 3px rgba(0,0,0,0.6)' }}>{online ? tempStr : '—'}</span>
      </div>
    </div>
    <span className="tabular-nums" style={{ ...fluidTextXs, color: 'var(--bp-text-secondary)' }}>Set {online ? setStr : '—'}</span>
    <span className="flex items-center" style={{ gap: '0.2rem', ...fluidTextXs, color: doorAjar ? '#fbbf24' : 'var(--bp-text-dim)' }}>
      {doorAjar
        ? <IconDoorOpen style={{ width: '0.8rem', height: '0.8rem' }} />
        : <IconDoorClosed style={{ width: '0.8rem', height: '0.8rem' }} />}
      {doorAjar ? 'Open' : 'Closed'}
    </span>
  </div>
);

const FilterChip = ({ icon, label, pct, low }: { icon: React.ReactNode; label: string; pct: number; low: boolean }) => (
  <div className="flex items-center" style={{ gap: '0.3rem', padding: '0.15rem 0.45rem', borderRadius: '9999px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}>
    <span style={{ color: low ? '#f87171' : 'var(--bp-text-secondary)', display: 'grid', placeItems: 'center' }}>{icon}</span>
    <span style={{ ...fluidTextXs, color: 'var(--bp-text-dim)' }}>{label}</span>
    <span className="font-semibold tabular-nums" style={{ ...fluidTextXs, color: low ? '#f87171' : 'var(--bp-text-primary)' }}>{pct}%</span>
  </div>
);

const GlassFridgeTile = ({
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
  const state = device.state as FridgeApplianceState;
  const proj = projectFridge(state);
  const isLocked = !!tile.isLocked;

  if (!proj) {
    return (
      <GlassCard label={tile.label || device.name} accent="climate" isEditor={isEditor} isLocked={isLocked} className={cornerClassName}>
        <div className="flex flex-col items-center justify-center" style={{ gap: '0.4rem', color: 'var(--bp-text-dim)' }}>
          <IconSnowflake style={{ width: '1.75rem', height: '1.75rem', opacity: 0.5 }} />
          <span style={fluidTextSm}>—</span>
        </div>
      </GlassCard>
    );
  }

  const isUnavailable = !proj.online;
  const cooling = proj.status.active && !isUnavailable;

  return (
    <GlassCard
      label=""
      accent={proj.status.accent === 'heat' ? 'warning' : proj.status.accent}
      isActive={cooling}
      isUnavailable={isUnavailable}
      isLocked={isLocked}
      isEditor={isEditor}
      className={cornerClassName}
    >
      <div className="w-full h-full flex flex-col" style={{ gap: 'clamp(0.3rem, 2.5cqmin, 0.7rem)' }}>
        {/* Header: name + status pill + filter chips */}
        <div className="flex items-start w-full" style={{ gap: '0.5rem' }}>
          <div className="flex-1 min-w-0 flex flex-col" style={{ gap: '0.2rem' }}>
            <h2 className="font-bold truncate leading-tight text-left" style={{ ...fluidTextLg, color: 'var(--bp-text-primary)' }}>{tile.label || device.name}</h2>
            <div className="flex items-center" style={{ gap: '0.4rem' }}>
              <span className="rounded-full shrink-0" style={{ width: '0.55rem', height: '0.55rem', background: proj.status.color, boxShadow: `0 0 8px ${proj.status.color}` }} />
              <span className="truncate" style={{ ...fluidTextSm, color: 'var(--bp-text-secondary)' }}>{isUnavailable ? 'Offline' : proj.status.label}</span>
              {proj.serviceRequired && !isUnavailable && (
                <span className="flex items-center" style={{ gap: '0.2rem', color: '#f87171' }}>
                  <IconAlertTriangle style={{ width: '0.85rem', height: '0.85rem' }} />
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Zone columns — animated frost fills */}
        <div className="flex items-stretch justify-around" style={{ gap: 'clamp(0.4rem, 4cqmin, 1rem)', flex: 1 }}>
          {proj.zones.map((z) => (
            <ZoneColumn
              key={z.name}
              name={z.name}
              tempStr={z.tempStr}
              setStr={z.setStr}
              tone={z.tone}
              doorAjar={z.doorAjar}
              online={proj.online}
              cooling={cooling}
            />
          ))}
        </div>

        {/* Footer: filter chips */}
        {(proj.waterFilterPct !== null || proj.airFilterPct !== null) && (
          <div className="flex flex-wrap items-center justify-center mt-auto pt-1" style={{ gap: '0.35rem', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
            {proj.waterFilterPct !== null && (
              <FilterChip icon={<IconDroplets style={{ width: '0.8rem', height: '0.8rem' }} />} label="Water" pct={isUnavailable ? 0 : proj.waterFilterPct} low={!isUnavailable && proj.waterFilterPct <= 10} />
            )}
            {proj.airFilterPct !== null && (
              <FilterChip icon={<IconSnowflake style={{ width: '0.8rem', height: '0.8rem' }} />} label="Air" pct={isUnavailable ? 0 : proj.airFilterPct} low={!isUnavailable && proj.airFilterPct <= 10} />
            )}
          </div>
        )}
      </div>
    </GlassCard>
  );
};

export default GlassFridgeTile;
