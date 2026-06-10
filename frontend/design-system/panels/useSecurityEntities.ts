// Live entity feed for the Security hub compilation panel (Increment 7).
//
// A faithful, LIVE port of the locked exemplar
//   daily/2026-06-09/design-direction/exemplar-security-v12(-light).html
// (the recolored deep-indigo Security identity) into a real in-app panel.
//
// SAFETY POSTURE — the hardest gating of any panel so far:
//   • ONLY the arming STATE binds to a real entity. That is read through
//     useDashboard()'s alarmState/armingState (the REAL Alarmo
//     alarm_control_panel, e.g. alarm_control_panel.house), DISPLAY-ONLY.
//     This hook re-derives the same word/sub/icon for the LEFT card's big
//     "Disarmed / Ready to arm" hero from that same display-only state.
//   • EVERYTHING actionable (arm/disarm, lock/unlock, garage open/close, CLiC
//     toggle) is EQUIPMENT + SECURITY GATED or PROPOSED/GAP. They are rendered
//     faithfully but wire NO live actuation — there are NO callService arm_*/
//     disarm/lock/unlock/cover/switch paths in this hook AT ALL.
//   • Cameras (UniFi Protect, Surface 5) are NOT in dev → honest PROPOSED
//     posters + a defined "Feed unavailable" empty state. No faked live stream.
//   • Access/Locks (Surface 5a) + CLiC privacy glass (Surface 6, HC-108) are
//     NOT in dev → honest display-only GAP/PROPOSED rows.
//
// What this hook DOES read live (display-only, additive, low-hazard): a couple
// of DEMO binary_sensor door/motion contacts (provisioned for the dev "recent
// events" + "not ready" realism) and the Alarmo entity's changed_by /
// last_changed for the recent-events list. Nothing here actuates anything.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { HassEntities, HassEntity } from 'home-assistant-js-websocket';
import { subscribeEntities } from '../../services/haClient';

// ── Bound / referenced entities ────────────────────────────────────────────
// Note: ALL of these except the demo door/motion contacts are DISPLAY-ONLY and
// most are PROPOSED/GAP (not yet in dev). We never write to any of them.
export const SECURITY_ENTITIES = {
  // The REAL Alarmo panel — display-only. The arming bar + the left card's big
  // state read this; arm/disarm is NEVER called. The hub also reads changed_by.
  alarm: 'alarm_control_panel.house',

  // UniFi Protect cameras (Surface 5, PROPOSED — not in dev). Posters/empty
  // states are rendered honestly; no stream is fetched.
  cameras: [
    { id: 'camera.front_door', name: 'Front Door', poster: 'front-door' },
    { id: 'camera.driveway', name: 'Driveway', poster: 'driveway' },
    { id: 'camera.backyard', name: 'Backyard', poster: 'backyard' },
    { id: 'camera.garage', name: 'Garage', poster: 'garage' },
  ] as const,
  doorbell: 'binary_sensor.front_door_doorbell',

  // Access / Locks (Surface 5a — GAP, not in dev). Display-only.
  access: [
    { id: 'lock.front_door', name: 'Front Door', kind: 'lock', meta: 'lock.front_door · not yet wired' },
    { id: 'lock.side_gate', name: 'Side Gate', kind: 'lock', meta: 'lock.side_gate · not yet wired' },
    { id: 'cover.garage_door', name: 'Garage Door', kind: 'cover', meta: 'cover.garage_door · open/close' },
    { id: 'lock.pool_gate', name: 'Pool Gate', kind: 'lock', meta: 'lock.pool_gate · child-safety gated' },
  ] as const,

  // CLiC privacy glass (Surface 6, HC-108 — PROPOSED, not in dev). Display-only.
  glass: [
    { id: 'switch.clic_master_suite', name: 'Master Suite' },
    { id: 'switch.clic_office', name: 'Office' },
    { id: 'switch.clic_pool_cabana', name: 'Pool Cabana' },
    { id: 'switch.clic_global_override', name: 'Global Override' },
  ] as const,

  // DEMO door/motion contacts — provisioned in dev ONLY for honest "recent
  // events" + camera-motion realism. Marked demo; display-only.
  motionSensors: [
    { id: 'binary_sensor.driveway_motion', cam: 'camera.driveway', label: 'Driveway cam · Vehicle' },
  ] as const,
  doorSensors: [
    { id: 'binary_sensor.front_door_contact', label: 'Front door' },
  ] as const,
} as const;

const UNAVAILABLE = new Set(['unavailable', 'unknown', '']);
const isAvail = (e?: HassEntity) => !!e && !UNAVAILABLE.has(String(e.state).toLowerCase());

// ── arm-state projection (display-only) ─────────────────────────────────────
export type ArmWord = 'Disarmed' | 'Armed · Home' | 'Armed · Away' | 'Armed · Night' | 'Arming' | 'Pending' | 'Intrusion' | 'Unavailable';
export type ArmTone = 'ready' | 'notready' | 'away' | 'stay' | 'night' | 'pending' | 'triggered' | 'unavailable';

export interface ArmView {
  available: boolean;
  word: ArmWord;
  sub: string;
  tone: ArmTone;
  changedBy: string | null;
  lastChanged: string | null; // ISO
}

// Map the raw alarm_control_panel state (+ open_sensors) into the display view.
export const projectArm = (e: HassEntity | undefined): ArmView => {
  if (!isAvail(e)) {
    return { available: false, word: 'Unavailable', sub: 'No alarm panel connected', tone: 'unavailable', changedBy: null, lastChanged: null };
  }
  const state = String(e!.state).toLowerCase();
  const attrs = (e!.attributes ?? {}) as Record<string, any>;
  const changedBy = attrs.changed_by != null ? String(attrs.changed_by) : null;
  const lastChanged = e!.last_changed ?? null;
  const open = attrs.open_sensors && typeof attrs.open_sensors === 'object'
    ? Object.keys(attrs.open_sensors as Record<string, unknown>) : [];

  switch (state) {
    case 'armed_home':
      return { available: true, word: 'Armed · Home', sub: 'Perimeter armed · home', tone: 'stay', changedBy, lastChanged };
    case 'armed_away':
      return { available: true, word: 'Armed · Away', sub: 'Perimeter + interior armed', tone: 'away', changedBy, lastChanged };
    case 'armed_night':
      return { available: true, word: 'Armed · Night', sub: 'Night zones armed', tone: 'night', changedBy, lastChanged };
    case 'arming':
      return { available: true, word: 'Arming', sub: 'Exit delay · leave now', tone: 'pending', changedBy, lastChanged };
    case 'pending':
      return { available: true, word: 'Pending', sub: 'Entry delay · disarm now', tone: 'pending', changedBy, lastChanged };
    case 'triggered':
      return {
        available: true, word: 'Intrusion',
        sub: open.length ? `Triggered · ${open.length} sensor${open.length === 1 ? '' : 's'}` : 'Alarm triggered',
        tone: 'triggered', changedBy, lastChanged,
      };
    default: {
      // disarmed → ready unless something is open
      const ready = open.length === 0;
      return {
        available: true,
        word: 'Disarmed',
        sub: ready ? 'All sensors clear · Ready to arm' : `${open.length} sensor${open.length === 1 ? '' : 's'} open · not ready`,
        tone: ready ? 'ready' : 'notready',
        changedBy, lastChanged,
      };
    }
  }
};

// ── camera projection (display-only, honest) ────────────────────────────────
export interface CameraView {
  id: string;
  name: string;
  poster: string;       // poster-frame class key
  available: boolean;   // a real, available camera entity present in HA?
  hasStream: boolean;   // LIVE chip only when a stream is genuinely available
  motion: boolean;      // motion badge
  asOf: string;         // "as of 7:42" / "last 7:18" display string
}

const clockOf = (e?: HassEntity): string => {
  const iso = e?.last_changed ?? e?.last_updated;
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`;
};

// ── recent events (display-only) ────────────────────────────────────────────
export interface SecurityEvent {
  text: string;
  time: string;       // display clock
  tone: 'positive' | 'neutral' | 'attention';
  ts: number;         // epoch ms for sorting
}

export interface AccessRowView {
  id: string;
  name: string;
  kind: 'lock' | 'cover';
  meta: string;
  available: boolean;  // present + available in HA? (false in dev → GAP look)
  // Honest display state: when not wired we present the contract's safe default
  // (locks→Locked, garage cover→Open per the exemplar) as a PLACEHOLDER label.
  stateLabel: string;
  open: boolean;       // cover open / lock unlocked (drives attention tint)
}

export interface GlassRowView {
  id: string;
  name: string;
  available: boolean;
  clear: boolean;      // ON = Clear, OFF = Private (HC-108 semantics)
  stateLabel: string;  // 'Clear' | 'Private' | 'Off' (override when off)
  isOverride: boolean;
}

export interface SecurityView {
  status: 'connecting' | 'live' | 'stale';
  arm: ArmView;
  cameras: CameraView[];
  camerasOnline: number;
  camerasTotal: number;
  motionCount: number;
  doorbell: { available: boolean; ringing: boolean; label: string };
  access: AccessRowView[];
  glass: GlassRowView[];
  events: SecurityEvent[];
}

const fmtClock = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`;
};

// Pure projection — exported for unit testing. No side effects.
export const projectSecurity = (ents: HassEntities): Omit<SecurityView, 'status'> => {
  const arm = projectArm(ents[SECURITY_ENTITIES.alarm]);

  const cameras: CameraView[] = SECURITY_ENTITIES.cameras.map((c) => {
    const e = ents[c.id];
    const available = isAvail(e);
    // A stream is "available" only if the camera entity is present AND not
    // explicitly marked unavailable. UniFi Protect is not in dev → typically
    // false → honest "Feed unavailable" empty state, never a faked LIVE chip.
    const hasStream = available;
    // Motion: a related demo motion sensor (display) or a camera motion attr.
    const motionSensor = SECURITY_ENTITIES.motionSensors.find((m) => m.cam === c.id);
    const motion = (motionSensor ? ents[motionSensor.id]?.state === 'on' : false)
      || e?.attributes?.motion_detected === true;
    return {
      id: c.id,
      name: c.name,
      poster: c.poster,
      available,
      hasStream,
      motion: !!motion,
      asOf: available ? (clockOf(e) ? `as of ${clockOf(e)}` : 'live') : (clockOf(e) ? `last ${clockOf(e)}` : 'offline'),
    };
  });
  const camerasOnline = cameras.filter((c) => c.available).length;
  const motionCount = cameras.filter((c) => c.motion).length;

  const doorbellE = ents[SECURITY_ENTITIES.doorbell];
  const doorbell = {
    available: isAvail(doorbellE),
    ringing: doorbellE?.state === 'on',
    label: doorbellE?.state === 'on' ? 'Doorbell · Ringing now' : 'Doorbell · Clear · No recent ring',
  };

  const access: AccessRowView[] = SECURITY_ENTITIES.access.map((a) => {
    const e = ents[a.id];
    const available = isAvail(e);
    if (a.kind === 'cover') {
      const open = available ? e!.state === 'open' : true; // placeholder: exemplar shows Open
      return { id: a.id, name: a.name, kind: 'cover', meta: a.meta, available, stateLabel: open ? 'Open' : 'Closed', open };
    }
    const unlocked = available ? e!.state === 'unlocked' : false; // placeholder: Locked
    return { id: a.id, name: a.name, kind: 'lock', meta: a.meta, available, stateLabel: unlocked ? 'Unlocked' : 'Locked', open: unlocked };
  });

  const glass: GlassRowView[] = SECURITY_ENTITIES.glass.map((g) => {
    const e = ents[g.id];
    const available = isAvail(e);
    const isOverride = g.id.includes('global_override');
    const clear = available ? e!.state === 'on' : (isOverride ? false : g.name === 'Pool Cabana' ? false : true);
    return {
      id: g.id,
      name: g.name,
      available,
      clear,
      stateLabel: isOverride ? (clear ? 'On' : 'Off') : (clear ? 'Clear' : 'Private'),
      isOverride,
    };
  });

  // Recent events (display-only): derive from the Alarmo last change + the demo
  // door/motion contacts' last_changed. Newest first, capped to 3 like exemplar.
  const events: SecurityEvent[] = [];
  const alarmE = ents[SECURITY_ENTITIES.alarm];
  if (isAvail(alarmE)) {
    const who = arm.changedBy ? ` · ${arm.changedBy}` : '';
    const verb = arm.word === 'Disarmed' ? 'System disarmed' : `System ${arm.word.toLowerCase()}`;
    events.push({
      text: `${verb}${who}`,
      time: fmtClock(arm.lastChanged),
      tone: arm.tone === 'triggered' ? 'attention' : 'positive',
      ts: arm.lastChanged ? new Date(arm.lastChanged).getTime() : 0,
    });
  }
  for (const d of SECURITY_ENTITIES.doorSensors) {
    const e = ents[d.id];
    if (!isAvail(e)) continue;
    events.push({
      text: `${d.label} ${e!.state === 'on' ? 'opened' : 'closed'}`,
      time: fmtClock(e!.last_changed ?? null),
      tone: 'neutral',
      ts: e!.last_changed ? new Date(e!.last_changed).getTime() : 0,
    });
  }
  for (const m of SECURITY_ENTITIES.motionSensors) {
    const e = ents[m.id];
    if (!isAvail(e) || e!.state !== 'on') continue;
    events.push({
      text: m.label,
      time: fmtClock(e!.last_changed ?? null),
      tone: 'attention',
      ts: e!.last_changed ? new Date(e!.last_changed).getTime() : 0,
    });
  }
  events.sort((a, b) => b.ts - a.ts);

  return {
    arm,
    cameras,
    camerasOnline,
    camerasTotal: cameras.length,
    motionCount,
    doorbell,
    access,
    glass,
    events: events.slice(0, 4),
  };
};

export function useSecurityEntities(): SecurityView {
  const [view, setView] = useState<Omit<SecurityView, 'status'>>(() => projectSecurity({}));
  const [status, setStatus] = useState<SecurityView['status']>('connecting');
  const entsRef = useRef<HassEntities>({});

  useEffect(() => {
    let unsub: (() => void) | null = null;
    let cancelled = false;
    let staleTimer: ReturnType<typeof setTimeout> | null = null;
    const armStale = () => {
      if (staleTimer) clearTimeout(staleTimer);
      staleTimer = setTimeout(() => setStatus('stale'), 45000);
    };
    (async () => {
      try {
        unsub = await subscribeEntities((ents) => {
          if (cancelled) return;
          entsRef.current = ents;
          setStatus('live');
          armStale();
          setView(projectSecurity(ents));
        });
      } catch {
        if (!cancelled) setStatus('stale');
      }
    })();
    return () => {
      cancelled = true;
      if (staleTimer) clearTimeout(staleTimer);
      if (unsub) unsub();
    };
  }, []);

  // NOTE: no `actions` are returned. This panel intentionally exposes NO live
  // actuation — every control is gated/PROPOSED/GAP and display-only.
  return { status, ...view };
}
