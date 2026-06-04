import { Capability } from '../types';

// ---------------------------------------------------------------------------
// Home Assistant capability inference
// ---------------------------------------------------------------------------
// Home Assistant normalizes every entity as `domain.object_id` plus a `state`
// and an `attributes` bag (device_class, supported_features, supported_color_
// modes, current_position, ...). Rather than hand-mapping each new domain, we
// infer a small, stable set of capabilities from that metadata. The mapper
// (hooks/useDashboard.tsx) uses this to give EVERY entity a renderable device
// instead of dropping unrecognized domains, and later phases use the same
// profile to drive generic command routing and the Admin discovery list.

export interface CapabilityProfile {
  /** Everything the entity can do, in no particular order. */
  capabilities: Capability[];
  /** The capability that should drive the default tile/presentation. */
  primary: Capability;
  /** Whether the entity accepts commands (vs. a read-only sensor/diagnostic). */
  controllable: boolean;
  /** HA device_class, when present (e.g. 'temperature', 'motion', 'power'). */
  deviceClass?: string;
  /** Unit of measurement for read-only values (e.g. '°C', 'W', '%'). */
  unit?: string;
}

// HA entity object as seen by the frontend: `{ entity_id, state, attributes }`.
export interface HaEntityLike {
  entity_id: string;
  state?: any;
  attributes?: Record<string, any>;
}

// Domains that are inherently read-only (no service calls that change them in
// a tile-meaningful way). Anything here renders as an informational value.
const READONLY_DOMAINS = new Set([
  'sensor',
  'binary_sensor',
  'device_tracker',
  'person',
  'weather',
  'sun',
  'air_quality',
  'calendar',
  'image',
  'camera',
  'update',
  'zone',
  'stt',
  'tts',
  'event',
]);

const domainOf = (entityId: string): string => entityId.split('.')[0] || '';

// Light color/brightness support is advertised via supported_color_modes.
const COLOR_MODES = new Set(['hs', 'rgb', 'rgbw', 'rgbww', 'xy']);

/**
 * Infer what an entity can do from its HA metadata. Never throws and never
 * returns null — an unknown domain falls back to a read-only sensor profile so
 * the entity is always renderable.
 */
export function inferCapabilityProfile(entity: HaEntityLike): CapabilityProfile {
  const domain = domainOf(entity.entity_id || '');
  const attrs = entity.attributes || {};
  const deviceClass: string | undefined = attrs.device_class;
  const unit: string | undefined = attrs.unit_of_measurement;

  const readonly = (): CapabilityProfile => ({
    capabilities: ['sensor-readonly'],
    primary: 'sensor-readonly',
    controllable: false,
    deviceClass,
    unit,
  });

  if (READONLY_DOMAINS.has(domain)) {
    return readonly();
  }

  const caps: Capability[] = [];
  let primary: Capability | null = null;

  switch (domain) {
    case 'light': {
      caps.push('toggle');
      const modes: string[] = attrs.supported_color_modes || [];
      const hasBrightness =
        'brightness' in attrs || modes.includes('brightness') || modes.some((m) => COLOR_MODES.has(m) || m === 'color_temp');
      if (hasBrightness) caps.push('brightness');
      if (modes.some((m) => COLOR_MODES.has(m))) caps.push('color');
      if (modes.includes('color_temp')) caps.push('colorTemp');
      primary = hasBrightness ? 'brightness' : 'toggle';
      break;
    }
    case 'switch':
    case 'input_boolean':
    case 'fan':
    case 'siren':
    case 'humidifier':
      caps.push('toggle');
      primary = 'toggle';
      break;
    case 'cover': {
      const hasPosition = typeof attrs.current_position === 'number';
      if (hasPosition) caps.push('position');
      caps.push('toggle');
      primary = hasPosition ? 'position' : 'toggle';
      break;
    }
    case 'valve': {
      const hasPosition = typeof attrs.current_position === 'number';
      if (hasPosition) caps.push('position');
      caps.push('toggle');
      primary = hasPosition ? 'position' : 'toggle';
      break;
    }
    case 'lock':
      caps.push('lock');
      primary = 'lock';
      break;
    case 'climate':
    case 'water_heater':
      caps.push('setpoint', 'mode-select');
      primary = 'setpoint';
      break;
    case 'media_player':
      caps.push('media-transport');
      primary = 'media-transport';
      break;
    case 'alarm_control_panel':
      caps.push('alarm');
      primary = 'alarm';
      break;
    case 'scene':
    case 'script':
    case 'automation':
    case 'button':
    case 'input_button':
      // Momentary activation reads as a toggle in tile terms.
      caps.push('toggle');
      primary = 'toggle';
      break;
    case 'select':
    case 'input_select':
      caps.push('mode-select');
      primary = 'mode-select';
      break;
    default:
      // Unknown/niche domain: render its value rather than guess a control.
      return readonly();
  }

  return {
    capabilities: caps,
    primary: primary as Capability,
    controllable: true,
    deviceClass,
    unit,
  };
}
