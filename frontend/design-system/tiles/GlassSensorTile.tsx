import React from 'react';
import { Device, TileConfig, DeviceType } from '../../types';
import { IconGauge, IconThermometer, IconDroplets, IconActivity } from '../../components/icons';
import { fluidIcon, fluidText3xl, fluidTextSm } from '../../components/tiles/tileScale';
import GlassCard from '../GlassCard';

// ---------------------------------------------------------------------------
// GlassSensorTile — a clean, read-only liquid-glass readout for a sensor.
//
// Live binding: read-only, so there is no action wiring — it reflects the
// normalized `Device` the realtime layer keeps in sync (no callService). It
// reads the numeric value + `capabilityData.unit` (carried straight from HA's
// `unit_of_measurement`), or the typed-sensor `device.state` for temperature.
//
// CONVENTIONS (locked design): tabular-nums on the value, em-dash ("—") when
// the entity is unavailable OR has no real numeric reading (unknown/unavailable
// raw state) — never a fake 0.
// ---------------------------------------------------------------------------

const UNAVAILABLE_RAW = new Set(['unavailable', 'unknown', 'none', '', 'null']);

interface Reading {
  value: string;   // formatted numeric value, or '—'
  unit: string;
  available: boolean;
}

const readReading = (device: Device): Reading => {
  if (device.isOnline === false) return { value: '—', unit: '', available: false };

  const cap = (device.capabilityData || {}) as Record<string, any>;
  const unit: string = cap.unit || '';

  // Typed temperature sensor carries a number directly in device.state.
  if (device.type === DeviceType.TemperatureSensor) {
    const n = Number(device.state);
    if (Number.isFinite(n)) return { value: n.toFixed(1), unit: unit || '°', available: true };
    return { value: '—', unit: '', available: false };
  }

  // Generic / numeric sensor: prefer the numeric device.state, fall back to the
  // raw HA state string in capabilityData.
  const raw = cap.rawState;
  if (typeof raw === 'string' && UNAVAILABLE_RAW.has(raw.toLowerCase())) {
    return { value: '—', unit: '', available: false };
  }

  const candidate = typeof device.state === 'number' ? device.state : Number(raw);
  if (Number.isFinite(candidate)) {
    // Trim to at most 1 decimal, drop trailing .0 for integers.
    const rounded = Math.abs(candidate) >= 100 ? Math.round(candidate) : Math.round(candidate * 10) / 10;
    return { value: String(rounded), unit, available: true };
  }

  // Non-numeric enum state (e.g. "on"/"open"/a mode string) — show it as-is.
  if (typeof raw === 'string' && raw.length > 0) {
    return { value: raw, unit: '', available: true };
  }
  return { value: '—', unit: '', available: false };
};

const pickIcon = (device: Device) => {
  const cls = String((device.capabilityData as any)?.deviceClass || '').toLowerCase();
  const unit = String((device.capabilityData as any)?.unit || '').toLowerCase();
  if (device.type === DeviceType.TemperatureSensor || cls === 'temperature') return IconThermometer;
  if (cls === 'humidity' || unit === '%') return IconDroplets;
  if (cls === 'power' || cls === 'energy' || cls === 'current' || cls === 'voltage') return IconActivity;
  return IconGauge;
};

const GlassSensorTile = ({
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
  const reading = readReading(device);
  const Icon = pickIcon(device);
  const isUnavailable = device.isOnline === false;

  return (
    <GlassCard
      label={tile.label || ''}
      accent="climate"
      // A read-only sensor never lights the active glow.
      isActive={false}
      isUnavailable={isUnavailable}
      isEditor={isEditor}
      className={cornerClassName}
    >
      <div className="flex flex-col items-center justify-center" style={{ gap: 'clamp(0.2rem, 3cqmin, 0.55rem)' }}>
        <Icon style={{ ...fluidIcon(1.6), color: 'var(--bp-text-secondary)' }} />
        <div className="flex items-baseline justify-center" style={{ gap: '0.18em' }}>
          <span className="bp-readout" style={{ ...fluidText3xl }}>
            {reading.value}
          </span>
          {reading.unit && (
            <span className="bp-meta" style={{ ...fluidTextSm, color: 'var(--bp-text-secondary)' }}>
              {reading.unit}
            </span>
          )}
        </div>
      </div>
    </GlassCard>
  );
};

export default GlassSensorTile;
