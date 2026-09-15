// Lutron HomeWorks QSX — domain model + service call layer.
//
// Discovers lights, covers, scenes, buttons, and keypad LED binary_sensors
// from the full HA entity set. Groups lights + covers by HA area. Scenes and
// keypads are collected separately.
//
// CONTRACT (ENTITY_CONTRACT.md "Lighting / shades / scenes / keypads", LOCKED):
//   light.<area>_<name>       — dimmable + optional CCT/color; light.turn_on/off
//   cover.<area>_<name>       — position shades + optional tilt blinds;
//                               cover.open/close/stop/set_cover_position +
//                               cover.set_cover_tilt_position / open/close/stop tilt
//   scene.<name>              — scene.turn_on (stateless)
//   button.<keypad>_<button>  — button.press
//   binary_sensor.<keypad>_<button>_led — display-only LED state (on=lit, off=unlit)
//   LED control: DEFERRED — do not wire it.
//
// All transport goes through services/haClient.ts. No polling — subscribeEntities only.

import type { HassEntities, HassEntity } from 'home-assistant-js-websocket';
import * as haClient from './haClient';

// ---- Entity classification ---------------------------------------------------

// A Lutron entity is identified by one of these heuristics (in priority order):
//   1. The entity's platform is `lutron_caseta` (attributes.platform or via integration manifest)
//   2. The entity is in a device whose integration is `lutron_caseta`
//   3. The entity id matches the QSX naming pattern `<domain>.<area>_<name>`
//      AND the friendly_name does not suggest another integration.
//
// In practice the lutron_caseta integration does NOT expose a platform attribute
// on entity state, so we can't gate on that without a registry call. We instead
// operate on whichever light/cover/scene/button/binary_sensor entities are
// present, grouped by area token — all are rendered. Non-Lutron entities that
// happen to use the same pattern will show up; that is acceptable (the surface
// is opt-in by placing the tile).

const LIGHT_DOMAINS = ['light'] as const;
const COVER_DOMAINS = ['cover'] as const;
const SCENE_DOMAINS = ['scene'] as const;
const BUTTON_DOMAINS = ['button'] as const;
const LED_RE = /^binary_sensor\..+_led$/;

function getDomain(entityId: string): string {
    return entityId.split('.')[0];
}

function getSlug(entityId: string): string {
    return entityId.split('.')[1] ?? '';
}

// Derive a human-readable area name from the entity slug.
// Convention: `light.living_room_overhead` → area = "Living Room"
// We look for a 2+ word prefix joined by underscores. If only one word, use it.
function areaFromSlug(slug: string): string {
    // Strip common domain prefixes already captured
    const parts = slug.split('_');
    // Last word is the device name; everything before is the area
    if (parts.length <= 1) return 'Default';
    const areaParts = parts.slice(0, -1);
    return areaParts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

function deviceNameFromSlug(slug: string): string {
    const parts = slug.split('_');
    if (parts.length === 0) return slug;
    const name = parts[parts.length - 1];
    return name.charAt(0).toUpperCase() + name.slice(1);
}

// ---- State types ------------------------------------------------------------

export interface LutronLightState {
    entityId: string;
    name: string;
    area: string;
    isOn: boolean;
    brightness: number;           // 0–100
    colorMode: string | null;
    colorTempKelvin: number | null;
    minColorTempKelvin: number | null;
    maxColorTempKelvin: number | null;
    hsColor: [number, number] | null;
    supportedColorModes: string[];
    supportsColorTemp: boolean;
    supportsColor: boolean;
    available: boolean;
}

export type CoverClass = 'shade' | 'blind' | 'curtain' | 'awning' | 'shutter' | 'unknown';

export interface LutronCoverState {
    entityId: string;
    name: string;
    area: string;
    state: 'open' | 'closed' | 'opening' | 'closing' | 'stopped' | 'unknown';
    currentPosition: number | null;       // 0–100, null if unknown
    isClosed: boolean | null;
    currentTiltPosition: number | null;   // 0–100, null if no tilt
    supportsTilt: boolean;
    coverClass: CoverClass;
    available: boolean;
}

export interface LutronSceneState {
    entityId: string;
    name: string;
    available: boolean;
}

export interface LutronButtonState {
    entityId: string;
    name: string;
    keypads: string;   // derived from entity id prefix
    available: boolean;
    // Corresponding LED entity_id, if discovered (binary_sensor.<…>_led).
    // LED control is DEFERRED; this is display-only.
    ledEntityId: string | null;
    ledOn: boolean | null;   // null = no LED entity found
}

// A keypad groups its buttons for the keypad activity section.
export interface LutronKeypad {
    name: string;   // humanized keypad name
    prefix: string; // raw slug prefix (e.g. "entry_keypad")
    buttons: LutronButtonState[];
}

export interface LutronArea {
    name: string;
    lights: LutronLightState[];
    covers: LutronCoverState[];
}

export interface LutronState {
    present: boolean;       // any Lutron entities found?
    areas: LutronArea[];    // sorted by name
    scenes: LutronSceneState[];
    keypads: LutronKeypad[];
    entityCount: number;
}

// ---- Helpers ----------------------------------------------------------------

function isAvailable(e: HassEntity): boolean {
    return e.state !== 'unavailable' && e.state !== 'unknown';
}

function friendlyName(e: HassEntity, fallback: string): string {
    return (e.attributes?.friendly_name as string | undefined) || fallback;
}

function parseColorModes(e: HassEntity): string[] {
    const v = e.attributes?.supported_color_modes;
    return Array.isArray(v) ? (v as string[]) : [];
}

function parseCoverClass(e: HassEntity): CoverClass {
    const dc = (e.attributes?.device_class as string | undefined) || '';
    const known: CoverClass[] = ['shade', 'blind', 'curtain', 'awning', 'shutter'];
    return (known as string[]).includes(dc) ? (dc as CoverClass) : 'unknown';
}

// Determine if a cover entity supports tilt (at least one tilt attribute present
// in entity state, or device_class is 'blind').
function coverSupportsTilt(e: HassEntity): boolean {
    const dc = (e.attributes?.device_class as string | undefined) || '';
    if (dc === 'blind') return true;
    return (
        e.attributes?.current_tilt_position != null ||
        e.attributes?.supported_features != null &&
        // HA cover supported_features: SUPPORT_SET_TILT_POSITION = 128
        ((e.attributes.supported_features as number) & 128) !== 0
    );
}

function buildLightState(e: HassEntity): LutronLightState {
    const slug = getSlug(e.entity_id);
    const colorModes = parseColorModes(e);
    const supportsColorTemp = colorModes.includes('color_temp');
    const supportsColor = colorModes.some(m => ['hs', 'rgb', 'rgbw', 'rgbww', 'xy'].includes(m));
    const isOn = e.state === 'on';
    const rawBrightness = e.attributes?.brightness;
    const brightness = isOn
        ? typeof rawBrightness === 'number' ? Math.round((rawBrightness / 255) * 100) : 100
        : 0;
    const hsRaw = e.attributes?.hs_color;
    return {
        entityId: e.entity_id,
        name: friendlyName(e, slug),
        area: areaFromSlug(slug),
        isOn,
        brightness,
        colorMode: (e.attributes?.color_mode as string | null) ?? null,
        colorTempKelvin: typeof e.attributes?.color_temp_kelvin === 'number' ? e.attributes.color_temp_kelvin as number : null,
        minColorTempKelvin: typeof e.attributes?.min_color_temp_kelvin === 'number' ? e.attributes.min_color_temp_kelvin as number : null,
        maxColorTempKelvin: typeof e.attributes?.max_color_temp_kelvin === 'number' ? e.attributes.max_color_temp_kelvin as number : null,
        hsColor: Array.isArray(hsRaw) && hsRaw.length >= 2 ? [hsRaw[0] as number, hsRaw[1] as number] : null,
        supportedColorModes: colorModes,
        supportsColorTemp,
        supportsColor,
        available: isAvailable(e),
    };
}

function buildCoverState(e: HassEntity): LutronCoverState {
    const slug = getSlug(e.entity_id);
    const rawState = e.state as string;
    const knownStates = ['open', 'closed', 'opening', 'closing', 'stopped'];
    const coverState = knownStates.includes(rawState) ? (rawState as LutronCoverState['state']) : 'unknown';
    const rawPos = e.attributes?.current_position;
    const currentPosition = typeof rawPos === 'number' ? rawPos : null;
    const isClosed = e.attributes?.is_closed != null ? Boolean(e.attributes.is_closed) : (currentPosition != null ? currentPosition <= 2 : null);
    const rawTilt = e.attributes?.current_tilt_position;
    return {
        entityId: e.entity_id,
        name: friendlyName(e, slug),
        area: areaFromSlug(slug),
        state: coverState,
        currentPosition,
        isClosed,
        currentTiltPosition: typeof rawTilt === 'number' ? rawTilt : null,
        supportsTilt: coverSupportsTilt(e),
        coverClass: parseCoverClass(e),
        available: isAvailable(e),
    };
}

function buildSceneState(e: HassEntity): LutronSceneState {
    return {
        entityId: e.entity_id,
        name: friendlyName(e, getSlug(e.entity_id).replace(/_/g, ' ')),
        available: isAvailable(e),
    };
}

// Derive keypad prefix from a button entity id.
// e.g. button.entry_keypad_raise → prefix = "entry_keypad"
function keyprefixFromButtonId(entityId: string): string {
    const slug = getSlug(entityId);
    const parts = slug.split('_');
    // Last word is the button name; everything before is the keypad
    return parts.length > 1 ? parts.slice(0, -1).join('_') : slug;
}

function humanizeKeypadName(prefix: string): string {
    return prefix.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Build the composite LutronState from a full HassEntities snapshot. Pure, no throws.
export function buildLutronState(entities: HassEntities): LutronState {
    const allIds = Object.keys(entities);

    // Lights
    const lightEntities = allIds
        .filter(id => LIGHT_DOMAINS.includes(getDomain(id) as any))
        .map(id => entities[id]);

    // Covers
    const coverEntities = allIds
        .filter(id => COVER_DOMAINS.includes(getDomain(id) as any))
        .map(id => entities[id]);

    // Scenes
    const sceneEntities = allIds
        .filter(id => SCENE_DOMAINS.includes(getDomain(id) as any))
        .map(id => entities[id]);

    // Buttons
    const buttonEntities = allIds
        .filter(id => BUTTON_DOMAINS.includes(getDomain(id) as any))
        .map(id => entities[id]);

    // LED binary_sensors (display-only)
    const ledMap = new Map<string, HassEntity>();
    allIds.filter(id => LED_RE.test(id)).forEach(id => ledMap.set(id, entities[id]));

    const present =
        lightEntities.length > 0 ||
        coverEntities.length > 0 ||
        sceneEntities.length > 0 ||
        buttonEntities.length > 0;

    // Group lights + covers by area
    const areaMap = new Map<string, { lights: LutronLightState[]; covers: LutronCoverState[] }>();

    for (const e of lightEntities) {
        const ls = buildLightState(e);
        const existing = areaMap.get(ls.area);
        if (existing) {
            existing.lights.push(ls);
        } else {
            areaMap.set(ls.area, { lights: [ls], covers: [] });
        }
    }

    for (const e of coverEntities) {
        const cs = buildCoverState(e);
        const existing = areaMap.get(cs.area);
        if (existing) {
            existing.covers.push(cs);
        } else {
            areaMap.set(cs.area, { lights: [], covers: [cs] });
        }
    }

    // Sort within each area
    const areas: LutronArea[] = Array.from(areaMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, { lights, covers }]) => ({
            name,
            lights: lights.sort((a, b) => a.name.localeCompare(b.name)),
            covers: covers.sort((a, b) => a.name.localeCompare(b.name)),
        }));

    // Scenes
    const scenes: LutronSceneState[] = sceneEntities
        .map(buildSceneState)
        .sort((a, b) => a.name.localeCompare(b.name));

    // Keypads: group buttons by prefix, attach LED state
    const keypadsMap = new Map<string, LutronButtonState[]>();
    for (const e of buttonEntities) {
        const prefix = keyprefixFromButtonId(e.entity_id);
        const buttonSlug = getSlug(e.entity_id);
        const lastPart = buttonSlug.split('_').pop() ?? buttonSlug;
        // Look for matching LED: binary_sensor.<same_slug>_led
        const ledId = `binary_sensor.${buttonSlug}_led`;
        const ledEntity = ledMap.get(ledId) ?? null;
        const btn: LutronButtonState = {
            entityId: e.entity_id,
            name: friendlyName(e, lastPart.replace(/_/g, ' ')).replace(/\b\w/g, c => c.toUpperCase()),
            keypads: prefix,
            available: isAvailable(e),
            ledEntityId: ledEntity ? ledId : null,
            ledOn: ledEntity ? (ledEntity.state === 'on' ? true : ledEntity.state === 'off' ? false : null) : null,
        };
        const existing = keypadsMap.get(prefix);
        if (existing) {
            existing.push(btn);
        } else {
            keypadsMap.set(prefix, [btn]);
        }
    }

    const keypads: LutronKeypad[] = Array.from(keypadsMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([prefix, buttons]) => ({
            name: humanizeKeypadName(prefix),
            prefix,
            buttons: buttons.sort((a, b) => a.name.localeCompare(b.name)),
        }));

    const entityCount = lightEntities.length + coverEntities.length + sceneEntities.length + buttonEntities.length + ledMap.size;

    return { present, areas, scenes, keypads, entityCount };
}

// ---- Service calls ----------------------------------------------------------

// Light: turn on/off; with optional brightness (0–100), colorTempKelvin, hsColor.
export async function setLightBrightness(entityId: string, brightness: number): Promise<void> {
    if (brightness <= 0) {
        await haClient.callService('light', 'turn_off', {}, { entity_id: entityId });
    } else {
        await haClient.callService('light', 'turn_on', { brightness_pct: brightness }, { entity_id: entityId });
    }
}

export async function toggleLight(entityId: string, isOn: boolean): Promise<void> {
    await haClient.callService('light', isOn ? 'turn_off' : 'turn_on', {}, { entity_id: entityId });
}

export async function setLightColorTemp(entityId: string, kelvin: number, brightness?: number): Promise<void> {
    const data: Record<string, any> = { color_temp_kelvin: kelvin };
    if (brightness != null) data.brightness_pct = brightness;
    await haClient.callService('light', 'turn_on', data, { entity_id: entityId });
}

export async function setLightHsColor(entityId: string, hs: [number, number], brightness?: number): Promise<void> {
    const data: Record<string, any> = { hs_color: hs };
    if (brightness != null) data.brightness_pct = brightness;
    await haClient.callService('light', 'turn_on', data, { entity_id: entityId });
}

// Cover: position shades
export async function openCover(entityId: string): Promise<void> {
    await haClient.callService('cover', 'open_cover', {}, { entity_id: entityId });
}

export async function closeCover(entityId: string): Promise<void> {
    await haClient.callService('cover', 'close_cover', {}, { entity_id: entityId });
}

export async function stopCover(entityId: string): Promise<void> {
    await haClient.callService('cover', 'stop_cover', {}, { entity_id: entityId });
}

export async function setCoverPosition(entityId: string, position: number): Promise<void> {
    await haClient.callService('cover', 'set_cover_position', { position }, { entity_id: entityId });
}

// Cover: tilt blinds
export async function openCoverTilt(entityId: string): Promise<void> {
    await haClient.callService('cover', 'open_cover_tilt', {}, { entity_id: entityId });
}

export async function closeCoverTilt(entityId: string): Promise<void> {
    await haClient.callService('cover', 'close_cover_tilt', {}, { entity_id: entityId });
}

export async function stopCoverTilt(entityId: string): Promise<void> {
    await haClient.callService('cover', 'stop_cover_tilt', {}, { entity_id: entityId });
}

export async function setCoverTiltPosition(entityId: string, tiltPosition: number): Promise<void> {
    await haClient.callService('cover', 'set_cover_tilt_position', { tilt_position: tiltPosition }, { entity_id: entityId });
}

// Scene: activate
export async function activateScene(entityId: string): Promise<void> {
    await haClient.callService('scene', 'turn_on', {}, { entity_id: entityId });
}

// Button: press
export async function pressButton(entityId: string): Promise<void> {
    await haClient.callService('button', 'press', {}, { entity_id: entityId });
}
