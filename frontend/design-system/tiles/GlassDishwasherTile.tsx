import React from 'react';
import { Device, TileConfig, DishwasherApplianceState } from '../../types';
import {
  IconDroplets,
  IconDoorOpen,
  IconDoorClosed,
  IconClock,
  IconCheckCircle,
  IconAlertTriangle,
} from '../../components/icons';
import { fluidTextXs, fluidTextSm, fluidTextLg } from '../../components/tiles/tileScale';
import GlassCard from '../GlassCard';
import { projectDishwasher } from './applianceLogic';

// ---------------------------------------------------------------------------
// GlassDishwasherTile — the liquid-glass Cove dishwasher surface.
//
// LIVE BINDING: renders the composite `DishwasherApplianceState` that
// `useDashboard` folds from a Cove appliance's live HA entities (subzero_wolf
// integration): wash status / cycle, time-remaining, door-ajar, running,
// rinse-aid-low. DISPLAY-ONLY — no writes in scope, issues NO service call.
// The centerpiece is an animated wash/progress ring (fills as the cycle runs,
// gentle water shimmer while washing). Honest offline (em-dash, no actuation).
// ---------------------------------------------------------------------------

const R = 42;
const C = 2 * Math.PI * R;

const ProgressRing = ({ fraction, color, active, online, centerLabel, centerSub }: {
  fraction: number;
  color: string;
  active: boolean;
  online: boolean;
  centerLabel: string;
  centerSub: string;
}) => {
  const dash = C * (online ? Math.max(0, Math.min(1, fraction)) : 0);
  return (
    <div className="relative grid place-items-center" style={{ width: 'clamp(4.5rem, 38cqmin, 7.5rem)', aspectRatio: '1 / 1' }}>
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
        <circle cx="50" cy="50" r={R} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="7" />
        <circle
          cx="50" cy="50" r={R} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={`${dash} ${C}`}
          style={{ transition: 'stroke-dasharray 0.7s cubic-bezier(0.4,0,0.2,1), stroke 0.4s ease' }}
        />
      </svg>
      {/* water shimmer while washing */}
      {online && active && (
        <span
          className="absolute rounded-full pointer-events-none"
          style={{ inset: '18%', background: `radial-gradient(circle at 50% 80%, ${color}33, transparent 65%)`, animation: 'bpDishWash 2.6s ease-in-out infinite' }}
        />
      )}
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-1">
        <span className="font-bold leading-none truncate w-full" style={{ ...fluidTextLg, color: online ? 'var(--bp-text-primary)' : 'var(--bp-text-dim)' }}>{online ? centerLabel : '—'}</span>
        <span className="truncate w-full" style={{ ...fluidTextXs, color: 'var(--bp-text-dim)', marginTop: '0.15rem' }}>{online ? centerSub : 'Offline'}</span>
      </div>
    </div>
  );
};

const Chip = ({ icon, label, value, color }: { icon?: React.ReactNode; label: string; value: string; color?: string }) => (
  <div className="flex items-center" style={{ gap: '0.3rem', padding: '0.15rem 0.45rem', borderRadius: '9999px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}>
    {icon && <span style={{ color: color || 'var(--bp-text-secondary)', display: 'grid', placeItems: 'center' }}>{icon}</span>}
    <span style={{ ...fluidTextXs, color: 'var(--bp-text-dim)' }}>{label}</span>
    <span className="font-semibold tabular-nums" style={{ ...fluidTextXs, color: color || 'var(--bp-text-primary)' }}>{value}</span>
  </div>
);

const GlassDishwasherTile = ({
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
  const state = device.state as DishwasherApplianceState;
  const proj = projectDishwasher(state);
  const isLocked = !!tile.isLocked;

  if (!proj) {
    return (
      <GlassCard label={tile.label || device.name} accent="climate" isEditor={isEditor} isLocked={isLocked} className={cornerClassName}>
        <div className="flex flex-col items-center justify-center" style={{ gap: '0.4rem', color: 'var(--bp-text-dim)' }}>
          <IconDroplets style={{ width: '1.75rem', height: '1.75rem', opacity: 0.5 }} />
          <span style={fluidTextSm}>—</span>
        </div>
      </GlassCard>
    );
  }

  const isUnavailable = !proj.online;
  const active = proj.status.active && !isUnavailable;
  const pct = Math.round(proj.fraction * 100);
  const centerLabel = proj.run === 'clean' ? 'Clean' : (active ? `${pct}%` : proj.status.label);
  const centerSub = proj.cycleStr !== '—' ? proj.cycleStr : proj.statusStr;

  return (
    <GlassCard
      label=""
      accent={proj.status.accent === 'heat' ? 'warning' : proj.status.accent}
      isActive={active}
      isUnavailable={isUnavailable}
      isLocked={isLocked}
      isEditor={isEditor}
      className={cornerClassName}
    >
      <div className="w-full h-full flex flex-col" style={{ gap: 'clamp(0.3rem, 2.5cqmin, 0.6rem)' }}>
        {/* Header */}
        <div className="flex items-start w-full" style={{ gap: '0.5rem' }}>
          <div className="flex-1 min-w-0 flex flex-col" style={{ gap: '0.2rem' }}>
            <h2 className="font-bold truncate leading-tight text-left" style={{ ...fluidTextLg, color: 'var(--bp-text-primary)' }}>{tile.label || device.name}</h2>
            <div className="flex items-center" style={{ gap: '0.4rem' }}>
              <span className="rounded-full shrink-0" style={{ width: '0.55rem', height: '0.55rem', background: proj.status.color, boxShadow: `0 0 8px ${proj.status.color}` }} />
              <span className="truncate" style={{ ...fluidTextSm, color: 'var(--bp-text-secondary)' }}>{isUnavailable ? 'Offline' : proj.status.label}</span>
              {proj.rinseAidLow && !isUnavailable && (
                <IconAlertTriangle style={{ width: '0.85rem', height: '0.85rem', color: '#fbbf24' }} />
              )}
            </div>
          </div>
        </div>

        {/* Progress ring */}
        <div className="flex items-center justify-center" style={{ flex: 1 }}>
          <ProgressRing
            fraction={proj.fraction}
            color={proj.status.color}
            active={active}
            online={proj.online}
            centerLabel={centerLabel}
            centerSub={centerSub}
          />
        </div>

        {/* Footer chips: time-remaining, door */}
        <div className="flex flex-wrap items-center justify-center mt-auto pt-1" style={{ gap: '0.35rem', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          {(active || proj.run === 'clean') && (
            <Chip
              icon={proj.run === 'clean' ? <IconCheckCircle style={{ width: '0.8rem', height: '0.8rem' }} /> : <IconClock style={{ width: '0.8rem', height: '0.8rem' }} />}
              label={proj.run === 'clean' ? 'Done' : 'Remaining'}
              value={proj.run === 'clean' ? 'Ready' : (isUnavailable ? '—' : proj.timeStr)}
              color={proj.run === 'clean' ? '#34d399' : undefined}
            />
          )}
          <Chip
            icon={proj.doorAjar ? <IconDoorOpen style={{ width: '0.8rem', height: '0.8rem' }} /> : <IconDoorClosed style={{ width: '0.8rem', height: '0.8rem' }} />}
            label="Door"
            value={isUnavailable ? '—' : (proj.doorAjar ? 'Open' : 'Closed')}
            color={proj.doorAjar ? '#fbbf24' : undefined}
          />
        </div>
      </div>
    </GlassCard>
  );
};

export default GlassDishwasherTile;
