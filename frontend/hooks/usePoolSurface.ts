/**
 * usePoolSurface — runtime entity resolver and live-state hook for the
 * Pool / Spa (Surface 1 — IntelliCenter) B-Panels surface.
 *
 * BINDING STRATEGY (per ENTITY_CONTRACT.md Surface 1 + CONTRACT_RECONCILIATION.md §0)
 * ===================================================================================
 * IntelliCenter entity_ids derive from the user's property name + equipment labels
 * and are NOT predictable. This hook resolves them at runtime by scanning every
 * entity whose domain belongs to the intellicenter integration and matching on:
 *   (1) HA domain
 *   (2) device_class / unit_of_measurement   (from the entity state)
 *   (3) OBJTYPE attribute in extra_state_attributes  (e.g. "BODY", "PUMP", "CHEM")
 *   (4) subsidiary attribute key presence    (e.g. "SALT", "PHVAL", "PWR", "RPM")
 *
 * Device detection: any entity whose entity_id contains "intellicenter" (the
 * integration's domain slug) OR whose attributes carry OBJTYPE/OBJNAM keys (the
 * integration's per-entity extra_state_attributes) is treated as an IntelliCenter
 * entity. We do NOT rely on the device registry (requires admin) — the attribute
 * probe works for non-admin / kiosk sessions too.
 *
 * Temperature unit: read dynamically from the entity's unit_of_measurement — the
 * panel may be in ENGLISH (°F) or METRIC (°C) mode. Never hardcode °F.
 *
 * Stale indicator: if the last entity update is > STALE_THRESHOLD_MS old, the
 * surface surfaces a "stale" flag. PoolSurfaceTile renders a dim indicator.
 *
 * Optimistic writes: callService is called immediately; the entity subscription
 * reconciles the real state on the next push (typically < 1 s from IntelliCenter).
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { subscribeEntities, callService } from '../services/haClient';
import type { HassEntities } from 'home-assistant-js-websocket';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PumpTelemetry {
  entityId: string;
  name: string;
  /** instantaneous watts, null if not reported */
  powerW: number | null;
  /** rotations per minute, null if not reported */
  rpm: number | null;
  /** gallons per minute (VSF only), null if not reported */
  gpm: number | null;
  /** true when binary_sensor.running == 'on' */
  isRunning: boolean;
  /** sparkline history — last N watt readings (push-on-change) */
  powerHistory: number[];
}

export interface BodyState {
  entityId: string;
  /** friendly_name from attributes, e.g. "Pool" / "Spa" */
  name: string;
  /** true when switch state === 'on' */
  isOn: boolean;
  /** current water temp — from standalone LSTTMP sensor if available */
  waterTempC: number | null;
  waterTempUnit: string;
  /** LOCKED: water_heater present for heating-only bodies */
  heaterId: string | null;
  heaterMode: string | null;    // water_heater operation_mode
  heaterTarget: number | null;  // water_heater temperature
  heaterIsOn: boolean;
  /** PROPOSED: climate present only for UltraTemp cooling-capable bodies */
  climateId: string | null;
  climateMode: string | null;
  climateTarget: number | null;
  /** body max temp setpoint number entity */
  maxTempId: string | null;
  maxTemp: number | null;
  maxTempUnit: string;
}

export interface LightState {
  entityId: string;
  name: string;
  isOn: boolean;
  effect: string | null;
  effectList: string[];
}

export interface WaterFeatureState {
  entityId: string;
  name: string;
  isOn: boolean;
}

export interface ChemState {
  salt: number | null;
  saltUnit: string;
  ph: number | null;
  orp: number | null;
  orpUnit: string;
  /** SWG output % numbers — one per body */
  swgOutputs: { entityId: string; name: string; value: number | null; bodyLabel: string }[];
}

export interface ProbeTempState {
  entityId: string;
  name: string;
  value: number | null;
  unit: string;
}

export interface SpeedSetpointState {
  entityId: string;
  name: string;
  value: number | null;
  min: number;
  max: number;
  unit: string;
}

export interface PoolSurfaceState {
  /** True once at least one IntelliCenter entity has been seen */
  detected: boolean;
  /** True if no entities resolved (integration not installed / no hardware) */
  absent: boolean;
  /** True if data is older than STALE_THRESHOLD_MS */
  stale: boolean;
  lastUpdatedAt: Date | null;

  bodies: BodyState[];
  pumps: PumpTelemetry[];
  lights: LightState[];
  waterFeatures: WaterFeatureState[];
  chem: ChemState;
  probeTemps: ProbeTempState[];
  speedSetpoints: SpeedSetpointState[];

  /** binary_sensor.cold for freeze protection (DIAGNOSTIC) */
  freezeActive: boolean;
  freezeEntityId: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STALE_THRESHOLD_MS = 90_000; // 90 s — one IntelliCenter keepalive interval
const POWER_HISTORY_LEN = 20;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** True if the entity looks like it belongs to the IntelliCenter integration. */
function isIntelliCenterEntity(entityId: string, attrs: Record<string, any>): boolean {
  // The integration slug is "intellicenter". entity_ids are
  // slugify(prop_name)_slugify(sname), so we can't hardcode the prefix.
  // Instead, every IntelliCenter entity exposes OBJNAM + OBJTYPE in its
  // extra_state_attributes (PoolEntity.__init__.py lines 485-488).
  return (
    typeof attrs['OBJNAM'] === 'string' && typeof attrs['OBJTYPE'] === 'string'
  ) || entityId.includes('intellicenter');
}

function num(v: any): number | null {
  if (v === null || v === undefined || v === 'unavailable' || v === 'unknown') return null;
  const n = parseFloat(String(v));
  return Number.isNaN(n) ? null : n;
}

function str(v: any): string {
  return (v === null || v === undefined) ? '' : String(v);
}

// ── Main hook ─────────────────────────────────────────────────────────────────

const EMPTY_CHEM: ChemState = {
  salt: null, saltUnit: 'ppm',
  ph: null,
  orp: null, orpUnit: 'mV',
  swgOutputs: [],
};

const EMPTY_STATE: PoolSurfaceState = {
  detected: false,
  absent: true,
  stale: false,
  lastUpdatedAt: null,
  bodies: [],
  pumps: [],
  lights: [],
  waterFeatures: [],
  chem: EMPTY_CHEM,
  probeTemps: [],
  speedSetpoints: [],
  freezeActive: false,
  freezeEntityId: null,
};

export function usePoolSurface() {
  const [surface, setSurface] = useState<PoolSurfaceState>(EMPTY_STATE);
  // Per-pump power history (entityId -> circular buffer)
  const powerHistoryRef = useRef<Record<string, number[]>>({});
  // Last time we received any IntelliCenter entity change
  const lastUpdateRef = useRef<Date | null>(null);

  // Stale-detection ticker: re-derive `stale` flag every 15 s without waiting
  // for a new entity push (so the indicator appears even when pushes stop).
  useEffect(() => {
    const tick = () => {
      setSurface(prev => {
        const stale = lastUpdateRef.current !== null
          ? Date.now() - lastUpdateRef.current.getTime() > STALE_THRESHOLD_MS
          : false;
        if (stale === prev.stale) return prev;
        return { ...prev, stale };
      });
    };
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    let cancelled = false;

    const handleEntities = (entities: HassEntities) => {
      if (cancelled) return;

      // ── Pass 1: bucket all IntelliCenter entities by role ───────────────────
      const bodySwitches: Record<string, any>  = {};   // OBJTYPE=BODY, domain=switch
      const bodyTempSensors: Record<string, any> = {}; // OBJTYPE=BODY, attr LSTTMP, domain=sensor
      const waterHeaters: Record<string, any>  = {};   // domain=water_heater + IC
      const climates: Record<string, any>      = {};   // domain=climate + IC
      const pumpPowerSensors: Record<string, any> = {};
      const pumpRpmSensors: Record<string, any>   = {};
      const pumpGpmSensors: Record<string, any>   = {};
      const pumpRunBinaries: Record<string, any>  = {};
      const lightEntities: Record<string, any>    = {};
      const circuitSwitches: Record<string, any>  = {}; // featured + CIRCGRP
      const saltSensors: Record<string, any>      = {};
      const phSensors: Record<string, any>        = {};
      const orpSensors: Record<string, any>       = {};
      const swgNumbers: Record<string, any>       = {}; // PRIM/SEC SWG output %
      const maxTempNumbers: Record<string, any>   = {}; // HITMP body max temp
      const speedNumbers: Record<string, any>     = {}; // PMPCIRC speed setpoints
      const probeTempSensors: Record<string, any> = {}; // OBJTYPE=SENSE
      const freezeBinaries: Record<string, any>   = {}; // device_class=cold

      let anyIC = false;

      for (const [eid, entity] of Object.entries(entities)) {
        const attrs = entity.attributes || {};
        if (!isIntelliCenterEntity(eid, attrs)) continue;
        anyIC = true;

        const [domain] = eid.split('.');
        const objtype: string = str(attrs['OBJTYPE']).toUpperCase();
        const attrKey: string = str(attrs['attribute_key'] ?? attrs['ATTRIBUTE_KEY']).toUpperCase();
        const dc: string = str(attrs['device_class']).toLowerCase();
        const unit: string = str(attrs['unit_of_measurement']);
        const state: string = str(entity.state);
        const isUnavail = state === 'unavailable' || state === 'unknown';

        // ── Bodies ────────────────────────────────────────────────────────────
        if (domain === 'switch' && objtype === 'BODY') {
          bodySwitches[eid] = entity;
        }
        // Standalone LSTTMP body temp sensor (NEW this loop per CONTRACT_RECONCILIATION §7)
        if (domain === 'sensor' && objtype === 'BODY' &&
            (attrKey === 'LSTTMP' || str(attrs['attribute_key']) === 'LSTTMP' ||
             eid.toLowerCase().includes('lsttmp'))) {
          bodyTempSensors[eid] = entity;
        }
        if (domain === 'water_heater') {
          waterHeaters[eid] = entity;
        }
        if (domain === 'climate' && objtype === 'BODY') {
          climates[eid] = entity;
        }

        // ── Max temp setpoint (number.HITMP) ─────────────────────────────────
        if (domain === 'number' && objtype === 'BODY' &&
            (attrKey === 'HITMP' || str(attrs['attribute_key']) === 'HITMP' ||
             eid.toLowerCase().includes('hitmp') || eid.toLowerCase().includes('max'))) {
          maxTempNumbers[eid] = entity;
        }

        // ── Pumps ─────────────────────────────────────────────────────────────
        if (domain === 'sensor' && objtype === 'PUMP') {
          if (dc === 'power' || unit === 'W') pumpPowerSensors[eid] = entity;
          else if (unit === 'rpm') pumpRpmSensors[eid] = entity;
          else if (unit === 'gpm') pumpGpmSensors[eid] = entity;
        }
        if (domain === 'binary_sensor' && objtype === 'PUMP' && dc === 'running') {
          pumpRunBinaries[eid] = entity;
        }

        // ── Speed setpoints (PMPCIRC numbers) ────────────────────────────────
        if (domain === 'number' && objtype === 'PMPCIRC') {
          speedNumbers[eid] = entity;
        }

        // ── Lights ────────────────────────────────────────────────────────────
        if (domain === 'light') {
          lightEntities[eid] = entity;
        }

        // ── Featured water-feature circuits + circuit groups ──────────────────
        // Body switches (OBJTYPE=BODY) are already captured above. Only
        // CIRCUIT / CIRCGRP switches reach here (the outer condition enforces it).
        if (domain === 'switch' && (objtype === 'CIRCUIT' || objtype === 'CIRCGRP') && !isUnavail) {
          circuitSwitches[eid] = entity;
        }

        // ── Chemistry ─────────────────────────────────────────────────────────
        if (domain === 'sensor' && (objtype === 'CHEM' || objtype === 'ICHLOR' || objtype === 'ICHEM')) {
          if (unit === 'ppm' || eid.toLowerCase().includes('salt')) saltSensors[eid] = entity;
          else if (dc === 'ph' || eid.toLowerCase().includes('ph')) phSensors[eid] = entity;
          else if (unit === 'mV' || eid.toLowerCase().includes('orp')) orpSensors[eid] = entity;
        }
        if (domain === 'number' && (objtype === 'CHEM' || objtype === 'ICHLOR') && unit === '%') {
          swgNumbers[eid] = entity;
        }

        // ── SENSE probes (air/water/solar temp) ───────────────────────────────
        if (domain === 'sensor' && objtype === 'SENSE' && dc === 'temperature') {
          probeTempSensors[eid] = entity;
        }

        // ── Freeze protection (binary_sensor.cold DIAGNOSTIC) ─────────────────
        if (domain === 'binary_sensor' && dc === 'cold') {
          freezeBinaries[eid] = entity;
        }
      }

      if (!anyIC) {
        setSurface(prev => ({ ...prev, detected: false, absent: true }));
        return;
      }

      lastUpdateRef.current = new Date();
      const stale = false; // fresh update resets stale

      // ── Pass 2: build BodyState[] ─────────────────────────────────────────
      const bodiesList: BodyState[] = Object.entries(bodySwitches).map(([eid, entity]) => {
        const attrs = entity.attributes || {};
        const bodyName: string = str(attrs.friendly_name || eid.split('.')[1]);

        // Find matching water heater / climate by fuzzy-matching the body name
        const bodySlug = bodyName.toLowerCase();
        const matchHeater = Object.entries(waterHeaters).find(([hid]) =>
          hid.toLowerCase().includes(bodySlug.split(' ')[0]));
        const matchClimate = Object.entries(climates).find(([cid]) =>
          cid.toLowerCase().includes(bodySlug.split(' ')[0]));
        const matchMaxTemp = Object.entries(maxTempNumbers).find(([mid]) =>
          mid.toLowerCase().includes(bodySlug.split(' ')[0]));
        // Standalone water-temp sensor (LSTTMP body sensor)
        const matchTempSensor = Object.entries(bodyTempSensors).find(([tid]) =>
          tid.toLowerCase().includes(bodySlug.split(' ')[0]));

        const heater = matchHeater?.[1];
        const climate = matchClimate?.[1];
        const maxTempEnt = matchMaxTemp?.[1];
        const tempSensor = matchTempSensor?.[1];

        // Water temp: prefer standalone LSTTMP sensor, fall back to water_heater current_temperature
        let waterTempC: number | null = null;
        let waterTempUnit = '°F';
        if (tempSensor) {
          waterTempC = num(tempSensor.state);
          waterTempUnit = str(tempSensor.attributes?.unit_of_measurement) || '°F';
        } else if (heater) {
          waterTempC = num(heater.attributes?.current_temperature);
          waterTempUnit = str(heater.attributes?.unit_of_measurement) || '°F';
        }

        return {
          entityId: eid,
          name: bodyName,
          isOn: entity.state === 'on',
          waterTempC,
          waterTempUnit,
          heaterId: heater ? matchHeater![0] : null,
          heaterMode: heater ? str(heater.state) : null,
          heaterTarget: heater ? num(heater.attributes?.temperature) : null,
          heaterIsOn: heater ? (heater.state !== 'off' && heater.state !== 'unavailable') : false,
          climateId: climate ? matchClimate![0] : null,
          climateMode: climate ? str(climate.state) : null,
          climateTarget: climate ? num(climate.attributes?.temperature) : null,
          maxTempId: maxTempEnt ? matchMaxTemp![0] : null,
          maxTemp: maxTempEnt ? num(maxTempEnt.state) : null,
          maxTempUnit: maxTempEnt ? (str(maxTempEnt.attributes?.unit_of_measurement) || '°F') : '°F',
        } satisfies BodyState;
      });

      // Sort: Pool before Spa, then alpha
      bodiesList.sort((a, b) => {
        const pri = (n: string) => n.toLowerCase().includes('pool') ? 0 : n.toLowerCase().includes('spa') ? 1 : 2;
        return pri(a.name) - pri(b.name) || a.name.localeCompare(b.name);
      });

      // ── Pass 3: build PumpTelemetry[] ─────────────────────────────────────
      // Group pump entities by pump-slug (the part of entity_id after "sensor.")
      // e.g. sensor.pool_pump_power → slug "pool_pump"
      const pumpSlugs = new Set<string>();
      const slugOf = (eid: string): string => {
        const parts = eid.split('.')[1]?.split('_') ?? [];
        // Heuristic: drop trailing known suffixes
        return parts.filter(p => !['power', 'rpm', 'gpm', 'speed', 'running', 'watts', 'flow'].includes(p)).join('_');
      };
      for (const eid of [...Object.keys(pumpPowerSensors), ...Object.keys(pumpRpmSensors), ...Object.keys(pumpGpmSensors), ...Object.keys(pumpRunBinaries)]) {
        pumpSlugs.add(slugOf(eid));
      }

      const pumpsList: PumpTelemetry[] = Array.from(pumpSlugs).map(slug => {
        const powerEnt = Object.entries(pumpPowerSensors).find(([e]) => slugOf(e) === slug)?.[1];
        const rpmEnt   = Object.entries(pumpRpmSensors).find(([e]) => slugOf(e) === slug)?.[1];
        const gpmEnt   = Object.entries(pumpGpmSensors).find(([e]) => slugOf(e) === slug)?.[1];
        const runEnt   = Object.entries(pumpRunBinaries).find(([e]) => slugOf(e) === slug)?.[1];
        const powerEid = Object.keys(pumpPowerSensors).find(e => slugOf(e) === slug) ?? '';
        const powerW   = powerEnt ? num(powerEnt.state) : null;

        // Update history
        if (powerEid && powerW !== null) {
          if (!powerHistoryRef.current[powerEid]) powerHistoryRef.current[powerEid] = [];
          const hist = powerHistoryRef.current[powerEid];
          hist.push(powerW);
          if (hist.length > POWER_HISTORY_LEN) hist.shift();
        }

        const nameAttrs = powerEnt?.attributes || rpmEnt?.attributes || gpmEnt?.attributes || {};
        const rawName = str(nameAttrs.friendly_name || slug);

        return {
          entityId: powerEid || Object.keys(pumpRpmSensors).find(e => slugOf(e) === slug) || slug,
          name: rawName,
          powerW,
          rpm: rpmEnt ? num(rpmEnt.state) : null,
          gpm: gpmEnt ? num(gpmEnt.state) : null,
          isRunning: runEnt ? runEnt.state === 'on' : false,
          powerHistory: powerEid ? [...(powerHistoryRef.current[powerEid] ?? [])] : [],
        } satisfies PumpTelemetry;
      });

      // ── Pass 4: lights ─────────────────────────────────────────────────────
      const lightsList: LightState[] = Object.entries(lightEntities).map(([eid, entity]) => ({
        entityId: eid,
        name: str(entity.attributes?.friendly_name || eid.split('.')[1]),
        isOn: entity.state === 'on',
        effect: entity.attributes?.effect ?? null,
        effectList: Array.isArray(entity.attributes?.effect_list) ? entity.attributes.effect_list : [],
      }));

      // ── Pass 5: water features (featured circuit switches, not body switches) ──
      const waterFeaturesList: WaterFeatureState[] = Object.entries(circuitSwitches).map(([eid, entity]) => ({
        entityId: eid,
        name: str(entity.attributes?.friendly_name || eid.split('.')[1]),
        isOn: entity.state === 'on',
      }));

      // ── Pass 6: chemistry ──────────────────────────────────────────────────
      const saltEnt = Object.values(saltSensors)[0];
      const phEnt   = Object.values(phSensors)[0];
      const orpEnt  = Object.values(orpSensors)[0];
      const swgOutputsList = Object.entries(swgNumbers).map(([eid, entity]) => ({
        entityId: eid,
        name: str(entity.attributes?.friendly_name || eid.split('.')[1]),
        value: num(entity.state),
        bodyLabel: eid.toLowerCase().includes('spa') ? 'Spa' :
                   eid.toLowerCase().includes('sec') ? 'Sec' : 'Pool',
      }));
      const chem: ChemState = {
        salt: saltEnt ? num(saltEnt.state) : null,
        saltUnit: saltEnt ? str(saltEnt.attributes?.unit_of_measurement) || 'ppm' : 'ppm',
        ph: phEnt ? num(phEnt.state) : null,
        orp: orpEnt ? num(orpEnt.state) : null,
        orpUnit: orpEnt ? str(orpEnt.attributes?.unit_of_measurement) || 'mV' : 'mV',
        swgOutputs: swgOutputsList,
      };

      // ── Pass 7: SENSE probe temps ──────────────────────────────────────────
      const probeList: ProbeTempState[] = Object.entries(probeTempSensors).map(([eid, entity]) => ({
        entityId: eid,
        name: str(entity.attributes?.friendly_name || eid.split('.')[1]),
        value: num(entity.state),
        unit: str(entity.attributes?.unit_of_measurement) || '°F',
      }));

      // ── Pass 8: speed setpoints ────────────────────────────────────────────
      const speedList: SpeedSetpointState[] = Object.entries(speedNumbers).map(([eid, entity]) => ({
        entityId: eid,
        name: str(entity.attributes?.friendly_name || eid.split('.')[1]),
        value: num(entity.state),
        min: num(entity.attributes?.min) ?? 0,
        max: num(entity.attributes?.max) ?? 3450,
        unit: str(entity.attributes?.unit_of_measurement) || 'rpm',
      }));

      // ── Pass 9: freeze protection ──────────────────────────────────────────
      const freezeEnt = Object.entries(freezeBinaries)[0];

      setSurface({
        detected: true,
        absent: false,
        stale,
        lastUpdatedAt: lastUpdateRef.current,
        bodies: bodiesList,
        pumps: pumpsList,
        lights: lightsList,
        waterFeatures: waterFeaturesList,
        chem,
        probeTemps: probeList,
        speedSetpoints: speedList,
        freezeActive: freezeEnt ? freezeEnt[1].state === 'on' : false,
        freezeEntityId: freezeEnt?.[0] ?? null,
      });
    };

    subscribeEntities(handleEntities).then(unsubFn => {
      if (cancelled) { unsubFn(); return; }
      unsub = unsubFn;
    }).catch(err => {
      console.error('[usePoolSurface] subscribeEntities failed:', err);
    });

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, []);

  // ── Service call wrappers ──────────────────────────────────────────────────

  const toggleBody = useCallback(async (entityId: string, on: boolean) => {
    await callService('switch', on ? 'turn_on' : 'turn_off', { entity_id: entityId });
  }, []);

  const toggleLight = useCallback(async (entityId: string, on: boolean) => {
    await callService('light', on ? 'turn_on' : 'turn_off', { entity_id: entityId });
  }, []);

  const setLightEffect = useCallback(async (entityId: string, effect: string) => {
    await callService('light', 'turn_on', { entity_id: entityId, effect });
  }, []);

  const toggleWaterFeature = useCallback(async (entityId: string, on: boolean) => {
    await callService('switch', on ? 'turn_on' : 'turn_off', { entity_id: entityId });
  }, []);

  const setWaterHeaterMode = useCallback(async (entityId: string, mode: string) => {
    // water_heater.set_operation_mode (on=normal/performance, off=off)
    const service = mode === 'off' ? 'turn_off' : 'turn_on';
    if (mode === 'off') {
      await callService('water_heater', 'turn_off', { entity_id: entityId });
    } else {
      await callService('water_heater', 'set_operation_mode', { entity_id: entityId, operation_mode: mode });
    }
  }, []);

  const setWaterHeaterTemp = useCallback(async (entityId: string, temp: number) => {
    await callService('water_heater', 'set_temperature', { entity_id: entityId, temperature: temp });
  }, []);

  const setClimateMode = useCallback(async (entityId: string, mode: string) => {
    await callService('climate', 'set_hvac_mode', { entity_id: entityId, hvac_mode: mode });
  }, []);

  const setClimateTemp = useCallback(async (entityId: string, temp: number) => {
    await callService('climate', 'set_temperature', { entity_id: entityId, temperature: temp });
  }, []);

  const setNumberValue = useCallback(async (entityId: string, value: number) => {
    await callService('number', 'set_value', { entity_id: entityId, value });
  }, []);

  return {
    surface,
    toggleBody,
    toggleLight,
    setLightEffect,
    toggleWaterFeature,
    setWaterHeaterMode,
    setWaterHeaterTemp,
    setClimateMode,
    setClimateTemp,
    setNumberValue,
  };
}
