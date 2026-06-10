import React from 'react';
import { Device, TileConfig, OvenApplianceState } from '../../types';
import {
  IconFlame,
  IconDoorOpen,
  IconDoorClosed,
  IconThermometer,
  IconLightbulb,
  IconLock,
  IconAlertTriangle,
} from '../../components/icons';
import { fluidTextXs, fluidTextSm, fluidTextLg } from '../../components/tiles/tileScale';
import GlassCard from '../GlassCard';
import { projectOven, ovenControlGate, OVEN_GATE_NOTE, type OvenCavityProjection } from './applianceLogic';

// ---------------------------------------------------------------------------
// GlassOvenTile — the liquid-glass Wolf range / wall-oven surface.
//
// LIVE BINDING: renders the composite `OvenApplianceState` that `useDashboard`
// folds from a Wolf appliance's live HA entities (subzero_wolf integration):
// per-cavity measured temp + set-temp + cook-mode + probe temp, door/oven-on/
// preheat status, oven-light read-back.
//
// HARD SAFETY — OVEN CONTROLS ARE READ-ONLY. The Wolf oven set-temp / probe /
// light WRITES are equipment-gated in the integration (enable_oven_writes,
// default-off + inert + safety-ack; live control is human-enable only, pending
// Brent + hardware verification). This tile renders those controls as DISPLAY/
// DISABLED with the gating note and issues ZERO `callService` — there is no
// service-call code path here at all. `ovenControlGate()` always denies.
// ---------------------------------------------------------------------------

// A disabled, equipment-gated control pill. Pure display — it has NO onClick,
// NO handler, NO service call. A tap does nothing (verified by the harness).
const GatedControl = ({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) => {
  // Re-assert the gate at render time as defense-in-depth (always denied).
  const gate = ovenControlGate();
  return (
    <div
      className="bp-oven-gated flex flex-col items-center"
      aria-disabled="true"
      title={gate.note}
      style={{ gap: '0.2rem', opacity: 0.55, cursor: 'not-allowed', flex: 1, minWidth: 0 }}
    >
      <span
        className="relative grid place-items-center"
        style={{
          width: 'clamp(1.8rem, 12cqmin, 2.6rem)',
          height: 'clamp(1.8rem, 12cqmin, 2.6rem)',
          borderRadius: '9999px',
          background: 'rgba(20,24,33,0.85)',
          border: '1px solid rgba(255,255,255,0.1)',
          color: 'var(--bp-text-secondary)',
        }}
      >
        {icon}
        {/* small lock badge marks the equipment-gate */}
        <span className="absolute" style={{ bottom: '-2px', right: '-2px', background: 'rgba(20,24,33,0.95)', borderRadius: '9999px', padding: '1px' }}>
          <IconLock style={{ width: '0.6rem', height: '0.6rem', color: 'var(--bp-text-dim)' }} />
        </span>
      </span>
      <span className="uppercase" style={{ ...fluidTextXs, color: 'var(--bp-text-dim)', letterSpacing: '0.04em' }}>{label}</span>
      <span className="font-semibold tabular-nums" style={{ ...fluidTextXs, color: 'var(--bp-text-secondary)' }}>{value}</span>
    </div>
  );
};

// One cavity block: a heating ring (preheat progress) around the measured temp,
// with the cook-mode + probe read-out. All READ-ONLY.
const CavityBlock = ({ cavity, online, multi }: { cavity: OvenCavityProjection; online: boolean; multi: boolean }) => {
  const on = !!cavity.ovenOn || (cavity.cookMode !== null && cavity.cookMode !== 'off');
  const ringDeg = Math.round((cavity.preheat ?? (on ? 1 : 0)) * 360);
  const ringColor = cavity.heating ? '#fbbf24' : on ? '#f87171' : 'rgba(255,255,255,0.12)';
  return (
    <div className="flex flex-col items-center min-w-0" style={{ gap: '0.3rem', flex: 1 }}>
      {multi && (
        <span className="uppercase font-semibold truncate w-full text-center" style={{ ...fluidTextXs, color: 'var(--bp-text-dim)', letterSpacing: '0.05em' }}>{cavity.name}</span>
      )}
      <div
        className="relative grid place-items-center"
        style={{
          width: 'clamp(3rem, 26cqmin, 5rem)',
          aspectRatio: '1 / 1',
          borderRadius: '9999px',
          background: `conic-gradient(${ringColor} ${online ? ringDeg : 0}deg, rgba(255,255,255,0.1) ${online ? ringDeg : 0}deg)`,
          transition: 'background 0.6s ease',
        }}
      >
        <div
          className="absolute grid place-items-center"
          style={{ inset: '5px', borderRadius: '9999px', background: 'rgba(16,20,28,0.9)' }}
        >
          {on && online && (
            <IconFlame
              style={{ position: 'absolute', top: '14%', width: '0.9rem', height: '0.9rem', color: '#fbbf24', animation: cavity.heating ? 'bpOvenFlame 1.4s ease-in-out infinite' : undefined }}
            />
          )}
          <span className="font-bold tabular-nums leading-none" style={{ ...fluidTextLg, color: online ? '#fff' : 'var(--bp-text-dim)' }}>{online ? cavity.tempStr : '—'}</span>
        </div>
      </div>
      <span style={{ ...fluidTextXs, color: online && on ? '#fbbf24' : 'var(--bp-text-secondary)' }}>{online ? cavity.modeStr : '—'}</span>
      <span className="flex items-center" style={{ gap: '0.2rem', ...fluidTextXs, color: cavity.doorAjar ? '#fbbf24' : 'var(--bp-text-dim)' }}>
        {cavity.doorAjar ? <IconDoorOpen style={{ width: '0.8rem', height: '0.8rem' }} /> : <IconDoorClosed style={{ width: '0.8rem', height: '0.8rem' }} />}
        {cavity.doorAjar ? 'Open' : 'Closed'}
      </span>
    </div>
  );
};

const GlassOvenTile = ({
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
  const state = device.state as OvenApplianceState;
  const proj = projectOven(state);
  const isLocked = !!tile.isLocked;

  if (!proj) {
    return (
      <GlassCard label={tile.label || device.name} accent="heat" isEditor={isEditor} isLocked={isLocked} className={cornerClassName}>
        <div className="flex flex-col items-center justify-center" style={{ gap: '0.4rem', color: 'var(--bp-text-dim)' }}>
          <IconFlame style={{ width: '1.75rem', height: '1.75rem', opacity: 0.5 }} />
          <span style={fluidTextSm}>—</span>
        </div>
      </GlassCard>
    );
  }

  const isUnavailable = !proj.online;
  const multi = proj.cavities.length > 1;
  // Primary cavity feeds the gated control read-outs (set-temp / probe / light).
  const primary = proj.cavities[0];

  return (
    <GlassCard
      label=""
      accent="heat"
      isActive={proj.status.active && !isUnavailable}
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
              {proj.serviceRequired && !isUnavailable && (
                <IconAlertTriangle style={{ width: '0.85rem', height: '0.85rem', color: '#f87171' }} />
              )}
            </div>
          </div>
        </div>

        {/* Cavities — heating rings */}
        <div className="flex items-stretch justify-around" style={{ gap: 'clamp(0.4rem, 4cqmin, 1rem)' }}>
          {proj.cavities.map((c) => (
            <CavityBlock key={c.name} cavity={c} online={proj.online} multi={multi} />
          ))}
        </div>

        {/* Gated, READ-ONLY controls. No onClick / no callService anywhere. */}
        <div className="mt-auto pt-1" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="flex items-center justify-around">
            <GatedControl icon={<IconThermometer style={{ width: '1rem', height: '1rem' }} />} label="Set" value={isUnavailable ? '—' : primary?.setStr ?? '—'} />
            {primary?.hasProbe && (
              <GatedControl icon={<IconThermometer style={{ width: '1rem', height: '1rem' }} />} label="Probe" value={isUnavailable ? '—' : primary.probeStr} />
            )}
            {primary && primary.lightOn !== null && primary.lightOn !== undefined && (
              <GatedControl icon={<IconLightbulb style={{ width: '1rem', height: '1rem' }} />} label="Light" value={isUnavailable ? '—' : (primary.lightOn ? 'On' : 'Off')} />
            )}
          </div>
          <p className="text-center flex items-center justify-center" style={{ ...fluidTextXs, color: 'var(--bp-text-dim)', gap: '0.25rem', marginTop: '0.2rem' }}>
            <IconLock style={{ width: '0.7rem', height: '0.7rem' }} />
            {OVEN_GATE_NOTE}
          </p>
        </div>
      </div>
    </GlassCard>
  );
};

export default GlassOvenTile;
