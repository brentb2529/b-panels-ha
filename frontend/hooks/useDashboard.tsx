
import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode, useMemo, useRef } from 'react';
import { Device, TileConfig, DeviceService, DeviceType, DashboardPanel, ServiceConnection, User, MediaItem, AllowedIP, STHMState, AppNotification, HighlightSectionConfig, ArmingEvent, SonosNotification, SonosNotificationEventType, InternetMonitorConfig, CheckEndpoint, FishingReportConfig, BatteryReportConfig, BatteryTypeMappings, BatteryQuantityMappings, BatteryTypeDefault, BatteryHistoryData } from '../types';
import { produce } from 'immer';
import { homeAssistantService } from '../services/homeassistant';
import { inferCapabilityProfile } from '../services/haCapabilities';
import * as haClient from '../services/haClient';
import PinPadModal from '../components/PinPadModal';
import ConfirmModal from '../components/ConfirmModal';
import InputModal from '../components/InputModal';
import { apiGetConfig, apiSaveConfig } from '../services/api';
import { playTextToSpeech, getFully } from '../services/audioPlayer';
import { apiHomeAssistantArm } from '../services/api';

// --- HA-only stubs for removed non-HA integrations ---------------------------
// This dashboard was ported from a multi-integration app. SmartThings, Sonos,
// Lutron, Whisker/LitterRobot, Hayward, Flair, CoolMaster, PoolFloor,
// EnergyTrak, Noonlight and the demo/SSE relay are gone. The call sites are
// retained but routed to these inert stubs so the HA path is unaffected.
const noopAsync = async (..._args: any[]): Promise<any> => undefined;
const emptyArrayAsync = async (..._args: any[]): Promise<any[]> => [];
const demoService = {
    getDevices: emptyArrayAsync,
    getDeviceUpdates: async (current: Device[]) => current,
    setDeviceState: async (_id: string, _state: any) => null,
};
const smartThingsService: any = {
    getDeviceStatus: noopAsync,
    getLocations: emptyArrayAsync,
    getDevices: emptyArrayAsync,
    getInitialState: async () => ({ devices: [], sthm: [] }),
    getDeviceCapabilityStatus: noopAsync,
    setDeviceState: noopAsync,
    sendBroadcast: noopAsync,
};
const sonosService: any = {
    getPlayers: emptyArrayAsync,
    say: noopAsync,
    sendCommand: noopAsync,
    getFavorites: emptyArrayAsync,
    getPlaylists: emptyArrayAsync,
    getZoneState: async () => ({}),
};
const noonlightService: any = { createAlarm: noopAsync };
const energyTrakService: any = { getDevices: emptyArrayAsync, getEventsUrl: () => '' };
const litterRobotService: any = { getDevices: emptyArrayAsync, setDeviceState: noopAsync };
const haywardPoolService: any = { getDevices: emptyArrayAsync, sendCommand: noopAsync };
const flairService: any = { getDevices: emptyArrayAsync, sendCommand: noopAsync };
const coolMasterService: any = { getDevices: emptyArrayAsync, sendCommand: noopAsync };
const poolFloorService: any = { getDevices: emptyArrayAsync, sendCommand: noopAsync, getEventsUrl: () => '' };
const apiGetLutronDevices = emptyArrayAsync;
const apiSendLutronCommand = noopAsync;
const apiReportSTHMState = noopAsync;

// SSE relay is gone (api-server only). These inert shims keep the old
// connection-status plumbing compiling; HA realtime uses haClient subscriptions.
type SSEConnectionState = 'connected' | 'connecting' | 'disconnected' | 'reconnecting';
interface SSEState {
    connectionState: SSEConnectionState;
    retryCountdown: number | null;
}
const useSSE = (
    _url: string | null,
    _onMessage: (e: MessageEvent) => void,
    _onError: () => void,
    _onOpen: () => void
): { state: SSEState; retryNow: () => void } => ({
    state: { connectionState: 'connected', retryCountdown: null },
    retryNow: () => {},
});

// Virtual device types tied to removed api-server services (see INTEGRATIONS.md).
// These have no HA data source and no tile, so they're filtered out of the
// device list rather than surfacing as "Unsupported Type" tiles. Their data is
// expected to come from HA entities (core/HACS) going forward.
const DEAD_VIRTUAL_TYPES = new Set<DeviceType>([
  DeviceType.InternetMonitor,
  DeviceType.FishingReport,
  DeviceType.Generator,
  DeviceType.LitterRobot,
  DeviceType.HaywardPool,
  DeviceType.Flair,
  DeviceType.CoolMaster,
  DeviceType.PoolFloor,
  DeviceType.RSSFeed,
  DeviceType.AlarmHistory,
]);

// Export StoredConfig for the API service to use
export interface StoredConfig {
    panels: DashboardPanel[];
    connections: ServiceConnection[];
    useDemoMode: boolean;
    users: User[];
    virtualDevices: Device[];
    mediaItems: MediaItem[];
    dashboardTitle: string;
    ipFilterEnabled: boolean;
    allowedIPs: AllowedIP[];
    notifyingSensorIds?: string[];
    // Sensors that, when activated while armed, raise the intrusion alert.
    // In ST mode this is user-managed (Security tab). In HA mode it's unused
    // (Alarmo owns the alarm trigger list). Migrated from notifyingSensorIds
    // on first load to preserve existing behavior.
    alarmTriggerSensorIds?: string[];
    sensorAliases?: Record<string, string>;
    // Entry-delay warning sound: either a beep style or a spoken countdown.
    // The beep starts the instant the alarm is triggered and stops when the PIN
    // is entered (EntryDelayModal).
    entryDelaySound?: { mode: 'beep' | 'countdown'; beepStyle?: 'single' | 'double' | 'pulse' };
    // When on, the api-server traces the full armed-sensor event path (sensor
    // event -> filters -> intrusion -> disarm propagation) to its console and a
    // rotating logs/alarm-debug.log file. Server-side only; for field testing.
    alarmDebug?: boolean;
    ttsNotificationsEnabled?: boolean; // Deprecated in favor of local state, kept for compat
    sonosNotifications?: SonosNotification[];
    armingStatusDeviceId?: string | null;
    weatherZipCode?: string;
    monitoringEnabled?: boolean;
    monitoringWebhookUrl?: string;
    mediamtxConfig?: Record<string, any>;
    sthmHistory?: ArmingEvent[];
    internetMonitorConfig?: InternetMonitorConfig;
    fishingReportConfig?: FishingReportConfig;
    batteryReportConfig?: BatteryReportConfig;
    batteryTypeMappings?: BatteryTypeMappings;
    batteryQuantityMappings?: BatteryQuantityMappings;
    batteryTypeDefaults?: BatteryTypeDefault[];
    batteryHistory?: BatteryHistoryData;
    customBatteryTypes?: string[];
    primaryAlarmProvider?: 'st' | 'ha';
}

const getDefaultConfig = (): StoredConfig => ({
  panels: [{id: 'default-panel', name: 'Main Dashboard', tiles: [], highlights: [], columns: 8, rowHeight: 120, showSTHMAlerts: false, showArmingStatus: false, themeMode: 'dark', showTileBorders: true }],
  connections: [
      {id: DeviceService.Lutron, cloudEndpoint: '', enabled: false},
      {id: DeviceService.SmartThings, cloudEndpoint: 'http://localhost:8080', enabled: false, selectedLocations: [], sthmMappings: { armedStay: null, armedAway: null, disarmed: null }},
      {id: DeviceService.Sonos, cloudEndpoint: 'http://localhost:5005', enabled: false},
      {id: DeviceService.HomeAssistant, cloudEndpoint: 'http://homeassistant.local:8123', apiKey: '', enabled: false},
      {id: DeviceService.Noonlight, cloudEndpoint: 'https://api-sandbox.noonlight.com/dispatch/v1/alarms', enabled: false, apiToken: '', address: '', city: '', state: '', zip: '', name: '', phone: ''},
      {id: DeviceService.RTSP, cloudEndpoint: 'http://localhost:8888', enabled: false},
      {id: DeviceService.EnergyTrak, cloudEndpoint: '', enabled: false, energytrakEmail: '', energytrakMagicLink: ''},
      {id: DeviceService.Whisker, cloudEndpoint: '', enabled: false, whiskerEmail: '', whiskerPassword: ''},
      {id: DeviceService.Tempest, cloudEndpoint: '', enabled: false, tempestApiToken: '', tempestStationId: ''},
      {id: DeviceService.HaywardPool, cloudEndpoint: '', enabled: false, haywardEmail: '', haywardPassword: '', haywardControllerIp: '', haywardConnectionMode: 'local'},
      {id: DeviceService.Flair, cloudEndpoint: '', enabled: false, flairClientId: '', flairClientSecret: '', flairConnectionMode: 'cloud'},
      {id: DeviceService.CoolMaster, cloudEndpoint: '', enabled: false, coolmasterConnectionMode: 'demo', coolmasterLocalIp: '', coolmasterLocalDeviceId: '', coolmasterUsername: '', coolmasterPassword: '', coolmasterUnitAliases: {}},
      {id: DeviceService.PoolFloor, cloudEndpoint: '', enabled: false, poolFloorConnectionMode: 'demo', poolFloorIp: '172.20.1.100', poolFloorPort: 502, poolFloorUnitId: 1},
  ],
  useDemoMode: false,
  users: [{ id: 'user-default', name: 'Admin', pin: '1234' }],
  virtualDevices: [],
  mediaItems: [],
  dashboardTitle: 'HomeTile',
  ipFilterEnabled: false,
  allowedIPs: [],
  notifyingSensorIds: [],
  alarmTriggerSensorIds: [],
  sensorAliases: {},
  entryDelaySound: { mode: 'beep', beepStyle: 'single' },
  alarmDebug: false,
  primaryAlarmProvider: 'ha',
  ttsNotificationsEnabled: false,
  sonosNotifications: [],
  armingStatusDeviceId: null,
  weatherZipCode: '',
  monitoringEnabled: false,
  monitoringWebhookUrl: '',
  mediamtxConfig: {
    logLevel: 'info',
    // API settings
    api: true,
    apiAddress: ':9997',
    apiAllowOrigin: '*',
    // HLS settings
    hlsVariant: 'fmp4',
    hlsAllowOrigin: '*',
    hlsSegmentCount: 3,
    hlsSegmentDuration: '2s',
    // Paths
    paths: {},
  },
  sthmHistory: [],
  internetMonitorConfig: {
    enabled: false,
    checkIntervalSeconds: 60,
    failureThreshold: 3,
    rebootCooldownMinutes: 30,
    postRebootWaitMinutes: 5,
    smartPlugIp: '',
    smartPlugEmail: '',
    smartPlugPassword: '',
    checkEndpoints: [
      { type: 'https', target: 'https://www.google.com', description: 'Google HTTPS' },
      { type: 'https', target: 'https://www.cloudflare.com', description: 'Cloudflare HTTPS' },
      { type: 'dns', target: 'google.com', description: 'Google DNS' },
      { type: 'dns', target: 'cloudflare.com', description: 'Cloudflare DNS' },
      { type: 'ping', target: '8.8.8.8', description: 'Google DNS Ping' },
      { type: 'ping', target: '1.1.1.1', description: 'Cloudflare DNS Ping' },
    ],
    endpointTimeout: 5,
    notifyOnFailure: true,
    notifyOnReboot: true,
    notifyOnRecovery: true,
  },
  batteryTypeMappings: {},
  batteryQuantityMappings: {},
  batteryTypeDefaults: [
    // Samsung SmartThings sensors
    { pattern: 'smartthings motion sensor', batteryType: 'CR2450', description: 'SmartThings Motion Sensor' },
    { pattern: 'smartthings multipurpose sensor', batteryType: 'CR2450', description: 'SmartThings Multipurpose Sensor' },
    { pattern: 'smartthings water leak sensor', batteryType: 'CR2450', description: 'SmartThings Water Leak Sensor' },
    { pattern: 'smartthings button', batteryType: 'CR2450', description: 'SmartThings Button' },
    // Aeotec sensors (common SmartThings-compatible)
    { pattern: 'aeotec multipurpose sensor', batteryType: 'CR2450', description: 'Aeotec Multipurpose Sensor' },
    { pattern: 'aeotec motion sensor', batteryType: 'CR2450', description: 'Aeotec Motion Sensor' },
    { pattern: 'aeotec water leak sensor', batteryType: 'CR2450', description: 'Aeotec Water Leak Sensor' },
    // Centralite sensors
    { pattern: 'centralite', batteryType: 'CR2450', description: 'Centralite Sensors' },
    // Generic Zigbee contact sensors (most use CR2032)
    { pattern: 'contact sensor', batteryType: 'CR2032', description: 'Generic Contact Sensor' },
    { pattern: 'door sensor', batteryType: 'CR2032', description: 'Generic Door Sensor' },
    { pattern: 'window sensor', batteryType: 'CR2032', description: 'Generic Window Sensor' },
    // Smoke/CO detectors (typically CR123A)
    { pattern: 'smoke', batteryType: 'CR123A', description: 'Smoke Detector' },
    { pattern: 'carbon monoxide', batteryType: 'CR123A', description: 'CO Detector' },
    // Locks (typically AA)
    { pattern: 'lock', batteryType: 'AA', description: 'Smart Lock' },
    // Thermostats (typically AA)
    { pattern: 'thermostat', batteryType: 'AA', description: 'Thermostat' },
  ],
  batteryHistory: {
    devices: {},
    maxReadingsPerDevice: 90, // ~3 months of daily readings
    recordingIntervalHours: 24, // Record once per day
  },
  customBatteryTypes: [],
});

// #region Helper functions for mapping data

/**
 * Iteratively resolves collisions within a set of tiles. When a collision is found,
 * it pushes the colliding tile (not the one that was actively being modified)
 * to the right, wrapping to the next row if necessary. This process repeats until
 * no collisions remain.
 * @param tiles The array of tiles, with one tile already updated (moved or resized).
 * @param updatedTileId The ID of the tile that triggered the potential collisions.
 * @param columns The number of columns in the grid.
 * @returns A new array of tiles with all collisions resolved.
 */
const resolveTileCollisions = (
    tiles: TileConfig[],
    updatedTileId: string,
    columns: number
): TileConfig[] => {
    return produce(tiles, draft => {
        let hasCollisions = true;
        let safetyNet = 0;

        while (hasCollisions && safetyNet < 100) {
            hasCollisions = false;
            safetyNet++;

            for (const tileA of draft) {
                for (const tileB of draft) {
                    if (tileA.id === tileB.id) continue;

                    const aX = tileA.x ?? 0;
                    const aY = tileA.y ?? 0;
                    const aW = tileA.width || 1;
                    const aH = tileA.height || 1;
                    
                    const bX = tileB.x ?? 0;
                    const bY = tileB.y ?? 0;
                    const bW = tileB.width || 1;
                    const bH = tileB.height || 1;

                    // Bounding box collision check
                    if (aX < bX + bW && aX + aW > bX && aY < bY + bH && aY + aH > bY) {
                        hasCollisions = true;
                        
                        // The tile being resized/moved (updatedTileId) is "static". Push the other one.
                        let tileToMove: TileConfig;
                        if (tileA.id === updatedTileId) {
                            tileToMove = tileB;
                        } else if (tileB.id === updatedTileId) {
                            tileToMove = tileA;
                        } else {
                            // Secondary collision. Push the one that is "lower" on the grid for deterministic results.
                            tileToMove = (aY > bY) || (aY === bY && aX > bX) ? tileA : tileB;
                        }
                        
                        // Push right by one column
                        tileToMove.x = (tileToMove.x ?? 0) + 1;
                        
                        // If it goes off the edge, wrap to the next row
                        if (tileToMove.x + (tileToMove.width || 1) > columns) {
                            tileToMove.x = 0;
                            tileToMove.y = (tileToMove.y ?? 0) + 1;
                        }
                        
                        // Break and restart the checks since the layout has changed
                        break; 
                    }
                }
                if (hasCollisions) break;
            }
        }
        if (safetyNet >= 100) console.warn("Collision resolution aborted after 100 iterations.");
    });
};


const findCapability = (stDevice: any, capabilityId: string) => {
    if (!stDevice.components) return undefined;
    for (const component of stDevice.components) {
        const capability = component.capabilities?.find((c: any) => c.id === capabilityId);
        if (capability) return capability;
    }
    return undefined;
};

const getInitialStateForType = (type: DeviceType): Device['state'] => {
    switch (type) {
        // boolean states (off/closed/inactive)
        case DeviceType.Switch:
        case DeviceType.Light:
        case DeviceType.SmartPlug:
        case DeviceType.Siren:
        case DeviceType.MotionSensor:
        case DeviceType.ContactSensor:
        case DeviceType.OccupancySensor:
        case DeviceType.Scene:
        case DeviceType.Lock: // false = unlocked
        case DeviceType.Valve: // false = closed
        case DeviceType.SmokeDetector:
        case DeviceType.CarbonMonoxideDetector:
        case DeviceType.Virtual:
            return false;

        // numeric states
        case DeviceType.Dimmer:
        case DeviceType.Shade:
        case DeviceType.TemperatureSensor:
            return 0;

        // object states
        case DeviceType.Thermostat:
            return { mode: 'off', currentTemp: 0, setpoint: 0, fan: 'auto' };
        
        case DeviceType.WaterSensor:
            return { leak: false, temperature: null };
        
        case DeviceType.SonosPlayer:
            return {
                playbackState: 'STOPPED',
                volume: 0,
                currentTrack: {},
                roomName: '',
                playMode: { repeat: false, shuffle: false, crossfade: false }
            };

        case DeviceType.PanicButton:
            return 'IDLE';

        // These have complex state objects that are usually populated from other sources
        // or require user configuration. An empty object is a safe default.
        case DeviceType.Keypad:
        case DeviceType.AlarmPanel:
        case DeviceType.WebFrame:
        case DeviceType.Folder:
        case DeviceType.Camera:
        case DeviceType.CameraGroup:
        case DeviceType.AlarmHistory:
        case DeviceType.RSSFeed:
        case DeviceType.Generator:
        case DeviceType.LitterRobot:
            return {};

        // Generic HA entities carry their own value from the mapper; an empty
        // string is a safe default until that real state arrives.
        case DeviceType.Generic:
            return '';

        default:
            return {};
    }
};

const mapStDeviceToInternalDevice = (stDevice: any, locationMap: Map<string, string>): Device | null => {
    if (!stDevice.deviceId) return null;
    const id = stDevice.deviceId;
    const name = stDevice.label || stDevice.name || 'Unknown ST Device';
    
    const alarmCap = findCapability(stDevice, 'alarm');
    const switchCap = findCapability(stDevice, 'switch');
    const switchLevelCap = findCapability(stDevice, 'switchLevel');
    const tempCap = findCapability(stDevice, 'temperatureMeasurement');
    const motionCap = findCapability(stDevice, 'motionSensor');
    const contactCap = findCapability(stDevice, 'contactSensor');
    const lockCap = findCapability(stDevice, 'lock');
    const thermostatCap = findCapability(stDevice, 'thermostatMode');
    const shadeLevelCap = findCapability(stDevice, 'windowShadeLevel');
    const waterCap = findCapability(stDevice, 'waterSensor');
    const valveCap = findCapability(stDevice, 'valve');
    const smokeCap = findCapability(stDevice, 'smokeDetector');
    const coCap = findCapability(stDevice, 'carbonMonoxideDetector');
    
    let type: DeviceType | null = null;

    if (thermostatCap) type = DeviceType.Thermostat;
    else if (switchLevelCap) type = DeviceType.Dimmer;
    else if (shadeLevelCap) type = DeviceType.Shade;
    else if (valveCap) type = DeviceType.Valve; // Check before Switch because valves often have switch cap
    else if (switchCap) type = DeviceType.Switch;
    else if (alarmCap) type = DeviceType.Siren;
    else if (smokeCap) type = DeviceType.SmokeDetector;
    else if (coCap) type = DeviceType.CarbonMonoxideDetector;
    else if (waterCap) type = DeviceType.WaterSensor;
    else if (motionCap) type = DeviceType.MotionSensor;
    else if (contactCap) type = DeviceType.ContactSensor;
    else if (tempCap) type = DeviceType.TemperatureSensor;
    else if (lockCap) type = DeviceType.Lock;
    else return null;

    const locationName = locationMap.get(stDevice.locationId) || 'Unknown Location';

    return { 
        id, 
        name, 
        service: DeviceService.SmartThings, 
        type, 
        state: getInitialStateForType(type), 
        location: locationName, 
        locationId: stDevice.locationId,
        battery: undefined // Will be populated via relay state or live fetch
    };
};

const getNumericValue = (val: any): number | null => {
    if (val === null || val === undefined) return null;
    if (typeof val === 'number') return val;
    if (typeof val === 'object' && val !== null && typeof val.value === 'number') return val.value;
    const parsed = parseFloat(String(val));
    return isNaN(parsed) ? null : parsed;
};

const parseRelayState = (type: DeviceType, relayState: Record<string, any>): Partial<Device> => {
    const updates: Partial<Device> = {};
    
    // Extract battery
    if (relayState['battery.battery'] !== undefined) {
        updates.battery = getNumericValue(relayState['battery.battery']) ?? undefined;
    }

    switch (type) {
        case DeviceType.Switch:
        case DeviceType.Light:
        case DeviceType.SmartPlug:
            if (relayState['switch.switch'] !== undefined) {
                updates.state = relayState['switch.switch'] === 'on';
            }
            break;
        case DeviceType.Siren:
            if (relayState['alarm.alarm'] !== undefined) {
                updates.state = relayState['alarm.alarm'] !== 'off';
            }
            break;
        case DeviceType.Dimmer:
            const level = getNumericValue(relayState['switchLevel.level']);
            if (level !== null) {
                updates.state = level;
            }
            break;
        case DeviceType.Lock:
            if (relayState['lock.lock'] !== undefined) {
                updates.state = relayState['lock.lock'] === 'locked';
            }
            break;
        case DeviceType.Valve:
            if (relayState['valve.valve'] !== undefined) {
                updates.state = relayState['valve.valve'] === 'open'; // True if open/flowing
            }
            break;
        case DeviceType.Shade: {
            const numericLevel = getNumericValue(relayState['windowShadeLevel.shadeLevel']) ?? getNumericValue(relayState['windowShadeLevel.level']);
            if (numericLevel !== null) {
                updates.state = numericLevel;
                break;
            }
            const textStateRaw = relayState['windowShade.windowShade'];
            const textState = typeof textStateRaw === 'object' && textStateRaw !== null && typeof textStateRaw.value === 'string'
                ? textStateRaw.value
                : (typeof textStateRaw === 'string' ? textStateRaw : null);
                
            if (textState) {
                const s = textState.toLowerCase();
                if (s.includes('open')) updates.state = 100;
                else if (s.includes('close')) updates.state = 0;
                else if (s.includes('partially')) updates.state = 50;
            } else if (relayState['switch.switch'] !== undefined) {
                if (relayState['switch.switch'] === 'on') {
                    updates.state = 100;
                } else if (relayState['switch.switch'] === 'off') {
                    updates.state = 0;
                }
            }
            break;
        }
        case DeviceType.MotionSensor:
            if (relayState['motionSensor.motion'] !== undefined) {
                updates.state = relayState['motionSensor.motion'] === 'active';
            }
            break;
        case DeviceType.ContactSensor:
            if (relayState['contactSensor.contact'] !== undefined) {
                updates.state = relayState['contactSensor.contact'] === 'open';
            }
            break;
        case DeviceType.TemperatureSensor:
            const temp = getNumericValue(relayState['temperatureMeasurement.temperature']);
            if (temp !== null) {
                updates.state = temp;
            }
            break;
        case DeviceType.SmokeDetector:
            if (relayState['smokeDetector.smoke'] !== undefined) {
                updates.state = relayState['smokeDetector.smoke'] === 'detected';
            }
            break;
        case DeviceType.CarbonMonoxideDetector:
            if (relayState['carbonMonoxideDetector.carbonMonoxide'] !== undefined) {
                updates.state = relayState['carbonMonoxideDetector.carbonMonoxide'] === 'detected';
            }
            break;
        case DeviceType.WaterSensor:
            const leakValue = relayState['waterSensor.water'];
            const tempValue = getNumericValue(relayState['temperatureMeasurement.temperature']);
            
            if (leakValue !== undefined || tempValue !== null) {
                updates.state = {
                    leak: leakValue === 'wet',
                    temperature: tempValue
                };
            }
            break;
        case DeviceType.Thermostat:
             const mode = relayState['thermostatMode.thermostatMode'];
             const currentTemp = getNumericValue(relayState['temperatureMeasurement.temperature']);
             
             if (mode !== undefined) {
                 let setpoint = 0;
                 if (mode === 'cool') {
                    setpoint = getNumericValue(relayState['thermostatCoolingSetpoint.coolingSetpoint']) ?? 0;
                 } else if (mode === 'heat') {
                    setpoint = getNumericValue(relayState['thermostatHeatingSetpoint.heatingSetpoint']) ?? 0;
                 }
                 updates.state = {
                     mode,
                     currentTemp: currentTemp ?? 0,
                     setpoint,
                     fan: relayState['thermostatFanMode.thermostatFanMode'] ?? 'auto'
                 };
             }
             break;
        default:
            break;
    }
    return updates;
};

const normalizeArmState = (raw?: string): STHMState['armState'] => {
    const a = String(raw || '').toLowerCase();
    // Alarmo / HA-specific modes
    if (a === 'armed_home' || a === 'armed_night' || a === 'armed_custom_bypass') return 'armedStay';
    if (a === 'armed_vacation') return 'armedAway';
    // Generic matching (covers ST strings like 'ARMED_STAY', 'armedStay', and HA 'armed_away')
    if (a.includes('armed') && (a.includes('stay') || a.includes('home') || a.includes('night'))) return 'armedStay';
    if (a.includes('armed') && (a.includes('away') || a.includes('vacation'))) return 'armedAway';
    return 'disarmed';
};

const getMessageLocationId = (message: any): string | undefined => {
    return message?.locationId
        ?? message?.deviceEvent?.locationId
        ?? message?.event?.deviceEvent?.locationId
        ?? message?.data?.deviceEvent?.locationId;
};

const mapHaEntityToInternalDevice = (entity: any): Device | null => {
    const { entity_id, state, attributes } = entity;
    if (!entity_id || !attributes || attributes.hidden) return null;

    const [domain] = entity_id.split('.');
    const name = attributes.friendly_name || entity_id;

    let type: DeviceType | null = null;
    let internalState: Device['state'] = {};
    // Allow both 'battery_level' (common) and 'battery' (less common but possible)
    let batteryLevel: number | undefined = getNumericValue(attributes.battery_level) ?? getNumericValue(attributes.battery) ?? undefined;

    switch (domain) {
        case 'light':
            const supportedModes = attributes.supported_color_modes || [];
            if (supportedModes.includes('brightness')) {
                type = DeviceType.Dimmer;
                internalState = state === 'on' ? Math.round((attributes.brightness / 255) * 100) : 0;
            } else {
                type = DeviceType.Light;
                internalState = state === 'on';
            }
            break;
        case 'switch':
            type = DeviceType.Switch;
            internalState = state === 'on';
            break;
        case 'lock':
            type = DeviceType.Lock;
            internalState = state === 'locked';
            break;
        case 'cover':
            type = DeviceType.Shade;
            if (typeof attributes.current_position === 'number') {
                internalState = attributes.current_position;
            } else {
                internalState = state === 'open' ? 100 : 0;
            }
            break;
        case 'scene':
            type = DeviceType.Scene;
            internalState = false; // Scenes are stateless
            break;
        case 'fan':
        case 'input_boolean':
            type = DeviceType.Switch;
            internalState = state === 'on';
            break;
        case 'valve':
            type = DeviceType.Valve;
            internalState = state === 'open';
            break;
        case 'siren':
            type = DeviceType.Siren;
            internalState = state === 'on';
            break;
        case 'automation':
        case 'script':
            type = DeviceType.Scene;
            internalState = false;
            break;
        case 'input_number':
            type = DeviceType.Dimmer;
            internalState = parseFloat(state) || 0;
            break;
        case 'alarm_control_panel':
            type = DeviceType.AlarmPanel;
            internalState = normalizeArmState(state);
            break;
        case 'sensor':
            if (attributes.device_class === 'temperature') {
                type = DeviceType.TemperatureSensor;
                internalState = parseFloat(state) || 0;
            }
            break;
        case 'binary_sensor':
            if (['motion', 'occupancy'].includes(attributes.device_class)) {
                type = DeviceType.MotionSensor;
                internalState = state === 'on';
            } else if (['door', 'window', 'opening'].includes(attributes.device_class)) {
                type = DeviceType.ContactSensor;
                internalState = state === 'on';
            } else if (['smoke'].includes(attributes.device_class)) {
                type = DeviceType.SmokeDetector;
                internalState = state === 'on';
            } else if (['carbon_monoxide', 'co'].includes(attributes.device_class)) {
                type = DeviceType.CarbonMonoxideDetector;
                internalState = state === 'on';
            } else if (['moisture', 'water'].includes(attributes.device_class)) {
                type = DeviceType.WaterSensor;
                internalState = state === 'on';
            }
            break;
        case 'climate':
            type = DeviceType.Thermostat;
            internalState = {
                mode: state,
                currentTemp: attributes.current_temperature || 0,
                setpoint: attributes.temperature || 0,
                fan: attributes.fan_mode || 'auto'
            };
            break;
        case 'media_player':
            if (attributes.device_class === 'speaker' || attributes.friendly_name?.toLowerCase().includes('sonos')) {
                type = DeviceType.SonosPlayer;
                const mapPlaybackState = (haState: string): 'PLAYING' | 'PAUSED_PLAYBACK' | 'STOPPED' => {
                    switch (haState) {
                        case 'playing': return 'PLAYING';
                        case 'paused': return 'PAUSED_PLAYBACK';
                        case 'idle':
                        case 'off':
                        case 'unavailable':
                        default: return 'STOPPED';
                    }
                }
                internalState = {
                    playbackState: mapPlaybackState(state),
                    volume: Math.round((attributes.volume_level || 0) * 100),
                    currentTrack: {
                        title: attributes.media_title,
                        artist: attributes.media_artist,
                        album: attributes.media_album_name,
                        albumArtURI: attributes.entity_picture,
                        duration: attributes.media_duration,
                    },
                    roomName: attributes.friendly_name || name,
                    elapsedTime: attributes.media_position,
                    playMode: {
                        shuffle: attributes.shuffle === true,
                        repeat: attributes.repeat && attributes.repeat !== 'off',
                        crossfade: false,
                    }
                };
            }
            break;
        case 'camera':
            type = DeviceType.Camera;
            // The live HLS stream is resolved lazily by CameraTile via HA's
            // camera/stream command (entity_picture is the snapshot fallback).
            internalState = { entityId: entity_id, entityPicture: attributes.entity_picture };
            break;
        case 'person':
            type = DeviceType.OccupancySensor;
            internalState = state === 'home';
            break;
    }

    // Infer what this entity can do from its HA metadata. Used to (a) render a
    // generic tile for domains/device_classes we don't map to a bespoke type
    // above, instead of dropping them, and (b) drive generic command routing
    // and Admin discovery in later phases. Inference never returns null.
    const profile = inferCapabilityProfile(entity);

    if (!type) {
        // Unmapped domain (e.g. a new HACS integration) — surface it generically
        // rather than returning null. Read-only entities show their value; the
        // raw state is preserved for the generic tile to format.
        type = DeviceType.Generic;
        internalState =
            typeof state === 'string' || typeof state === 'number' || typeof state === 'boolean'
                ? state
                : String(state ?? '');
    }

    return {
        id: entity_id,
        name,
        type,
        service: DeviceService.HomeAssistant,
        state: internalState,
        location: 'Home Assistant',
        battery: batteryLevel,
        capabilities: profile.capabilities,
        capabilityData: {
            domain,
            primary: profile.primary,
            controllable: profile.controllable,
            deviceClass: profile.deviceClass,
            unit: profile.unit,
            rawState: state,
        },
    };
};

const updateMediamtxConfig = (draft: StoredConfig) => {
    const cameraDevices = draft.virtualDevices.filter(
        d => d.type === DeviceType.Camera && (d.state as any)?.rtspStreamUrl
    );

    const newPaths: Record<string, { source: string; rtspTransport: string }> = {};
    cameraDevices.forEach(cam => {
        const pathKey = cam.name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
        const rtspUrl = (cam.state as any).rtspStreamUrl;
        if (rtspUrl) {
            newPaths[`cam-${pathKey}`] = { 
                source: rtspUrl,
                rtspTransport: 'tcp' 
            };
        }
    });

    const newMediamtxConfig: Record<string, any> = {
        logLevel: 'info',
        // API settings
        api: true,
        apiAddress: ':9997',
        apiAllowOrigin: '*',
        // Auth settings for API and stream access
        authInternalUsers: [
            {
                user: 'any',
                pass: '',
                ips: [],
                permissions: [
                    { action: 'publish' },
                    { action: 'read' },
                    { action: 'playback' }
                ]
            },
            {
                user: 'admin',
                pass: 'hometile',
                ips: [],
                permissions: [
                    { action: 'api' },
                    { action: 'metrics' },
                    { action: 'pprof' }
                ]
            }
        ],
        // HLS settings
        hlsVariant: 'fmp4',
        hlsAllowOrigin: '*',
        hlsSegmentCount: 3,
        hlsSegmentDuration: '2s',
        // Paths
        paths: newPaths
    };
    
    // Replace the old config entirely.
    draft.mediamtxConfig = newMediamtxConfig;
};

// #endregion

type ArmingState = 'ready' | 'not_ready' | 'no_sensors';

type SonosCommand = 'play' | 'pause' | 'next' | 'previous' | 'volume' | 'seek' | 'playmode';

export interface SonosSources {
    favorites: string[];
    playlists: string[];
}

interface DashboardContextType {
  devices: Device[];
  deviceMap: Map<string, Device>;
  panels: DashboardPanel[];
  connections: ServiceConnection[];
  users: User[];
  virtualDevices: Device[];
  mediaItems: MediaItem[];
  dashboardTitle: string;
  useDemoMode: boolean;
  loading: boolean;
  isConfigLoading: boolean;
  isDeviceLoading: boolean;
  sthmState: STHMState | null;
  armingState: ArmingState;
  isAudioUnlocked: boolean;
  activePanelId: string | null;
  ipFilterEnabled: boolean;
  allowedIPs: AllowedIP[];
  notifyingSensorIds: string[];
  sensorAliases: Record<string, string>;
  ttsNotificationsEnabled: boolean;
  sonosNotifications: SonosNotification[];
  notifications: AppNotification[];
  serviceError: string | null;
  configLoadError: string | null;
  connectionState: SSEConnectionState;
  connectionRetryCountdown: number | null;
  retryConnection: () => void;
  armingStatusDeviceId: string | null;
  weatherZipCode: string;
  monitoringEnabled: boolean;
  monitoringWebhookUrl: string;
  mediamtxConfig: Record<string, any> | undefined;
  sthmHistory: ArmingEvent[];
  setActivePanelId: (panelId: string | null) => void;
  unlockAudio: () => void;
  requestPin: (onConfirm: (pin: string) => void) => void;
  requestConfirmation: (message: string) => Promise<boolean>;
  requestInput: (message: string, initialValue?: string, type?: 'text' | 'password' | 'number') => Promise<string | null>;
  addPanel: (name: string) => string;
  removePanel: (panelId: string) => Promise<boolean>;
  renamePanel: (panelId: string, newName: string) => void;
  clonePanel: (panelId: string, newName: string) => void;
  updatePanelTiles: (panelId: string, tiles: TileConfig[]) => void;
  updatePanelHighlights: (panelId: string, highlights: HighlightSectionConfig[]) => void;
  updatePanelConfig: (panelId: string, updates: Partial<Omit<DashboardPanel, 'id'>>) => void;
  updateTileConfig: (panelId: string, tileId: string, newConfig: Partial<Omit<TileConfig, 'id' | 'deviceId'>>) => void;
  addTileToPanel: (panelId: string, deviceId: string, position?: { x: number, y: number }) => void;
  removeTileFromPanel: (panelId: string, tileId: string) => void;
  addHighlightToPanel: (panelId: string) => void;
  removeHighlightFromPanel: (panelId: string, highlightId: string) => void;
  updateHighlightConfig: (panelId: string, highlightId: string, updates: Partial<Omit<HighlightSectionConfig, 'id'>>) => void;
  updateDeviceState: (deviceId: string, newState: Device['state']) => void;
  triggerScene: (deviceId: string) => void;
  updateConnectionConfig: (serviceId: DeviceService, field: keyof Omit<ServiceConnection, 'id'>, value: any) => void;
  fetchDevicesFromServices: () => Promise<void>;
  refreshDeviceStatus: (device: Device) => Promise<void>;
  addUser: (name: string, pin: string) => void;
  removeUser: (userId: string) => void;
  validatePin: (pin: string) => boolean;
  addVirtualDevice: (device: Omit<Device, 'id' | 'service'>) => void;
  updateVirtualDevice: (deviceId: string, updates: Partial<Omit<Device, 'id' | 'service'>>) => void;
  removeVirtualDevice: (deviceId: string) => void;
  addMediaItem: (item: Omit<MediaItem, 'id'>) => void;
  updateMediaItem: (mediaId: string, updates: Omit<Partial<MediaItem>, 'id'>) => void;
  removeMediaItem: (mediaId: string) => void;
  addSonosNotification: (notification: Omit<SonosNotification, 'id'>) => void;
  updateSonosNotification: (notificationId: string, updates: Partial<Omit<SonosNotification, 'id'>>) => void;
  removeSonosNotification: (notificationId: string) => void;
  updateDashboardTitle: (newTitle: string) => void;
  addFolder: (panelId: string, folderName: string) => string;
  toggleIpFilter: () => void;
  addAllowedIP: (name: string, ip: string) => void;
  removeAllowedIP: (id: string) => void;
  updatePanelLayoutConfig: (panelId: string, updates: { columns?: number; rowHeight?: number }) => void;
  setHAAlarmStatus: (status: 'DISARMED' | 'ARMED_STAY' | 'ARMED_AWAY', options?: { skipDelay?: boolean; force?: boolean; pin?: string }) => Promise<void>;
  setAlarmStatus: (status: 'DISARMED' | 'ARMED_STAY' | 'ARMED_AWAY', pin?: string) => Promise<void>;
  primaryAlarmProvider: 'st' | 'ha';
  updatePrimaryAlarmProvider: (provider: 'st' | 'ha') => void;
  haWsState: 'disconnected' | 'connecting' | 'connected';
  lastHaEventAt: Date | null;
  haAlarmoSensors: string[];
  updateNotifyingSensorIds: (ids: string[]) => void;
  alarmTriggerSensorIds: string[];
  updateAlarmTriggerSensorIds: (ids: string[]) => void;
  updateEntryDelaySound: (sound: { mode: 'beep' | 'countdown'; beepStyle?: 'single' | 'double' | 'pulse' }) => void;
  // Server-side armed-sensor debug logging toggle (logs/alarm-debug.log).
  alarmDebug: boolean;
  updateAlarmDebug: (enabled: boolean) => void;
  updateSensorAlias: (sensorId: string, alias: string) => void;
  toggleTtsNotifications: () => void;
  removeNotification: (id: number) => void;
  addNotification: (message: string, type?: AppNotification['type']) => void;
  updateArmingStatusDeviceId: (deviceId: string | null) => void;
  updateWeatherZipCode: (zip: string) => void;
  updateMonitoringConfig: (updates: { enabled?: boolean; webhookUrl?: string }) => void;
  internetMonitorConfig: InternetMonitorConfig | undefined;
  updateInternetMonitorConfig: (updates: Partial<InternetMonitorConfig>) => void;
  fishingReportConfig: FishingReportConfig | undefined;
  updateFishingReportConfig: (updates: Partial<FishingReportConfig>) => void;
  batteryReportConfig: BatteryReportConfig | undefined;
  updateBatteryReportConfig: (updates: Partial<BatteryReportConfig>) => void;
  batteryTypeMappings: BatteryTypeMappings;
  updateBatteryTypeMapping: (deviceId: string, batteryType: string) => void;
  batteryQuantityMappings: BatteryQuantityMappings;
  updateBatteryQuantityMapping: (deviceId: string, quantity: number) => void;
  customBatteryTypes: string[];
  addCustomBatteryType: (batteryType: string) => void;
  removeCustomBatteryType: (batteryType: string) => void;
  triggerPanicAlarm: (deviceId: string) => void;
  activeDevicePanel: { deviceId: string; device: Device } | null;
  openDevicePanel: (deviceId: string) => void;
  closeDevicePanel: () => void;
  retryConfigLoad: () => void;
  sendBroadcastNotification: (message: string) => Promise<void>;
  dismissIntrusion: () => void;
  dismissServiceError: () => void;
  // Fire the deferred alarm annunciation when the entry-delay window expires.
  escalateToFullAlarm: (triggerName?: string) => void;
  // Entry-delay warning-sound preference (beep style or spoken countdown).
  entryDelaySound: { mode: 'beep' | 'countdown'; beepStyle?: 'single' | 'double' | 'pulse' };
}

const DashboardContext = createContext<DashboardContextType | undefined>(undefined);

export const useDashboard = () => {
    const context = useContext(DashboardContext);
    if (!context) {
        throw new Error('useDashboard must be used within a DashboardProvider');
    }
    return context;
};

export const DashboardProvider = ({ children }: { children?: ReactNode }) => {
  const [serviceDevices, setServiceDevices] = useState<Device[]>([]);
  const [syntheticVirtualDevices, setSyntheticVirtualDevices] = useState<Device[]>([]);
  const [deviceMap, setDeviceMap] = useState<Map<string, Device>>(new Map());
  const [config, setConfig] = useState<StoredConfig>(getDefaultConfig);
  const [isConfigLoading, setIsConfigLoading] = useState(true);
  const { panels, connections, users, virtualDevices: storedVirtualDevices, mediaItems, dashboardTitle, ipFilterEnabled, allowedIPs, notifyingSensorIds, sensorAliases, sonosNotifications, armingStatusDeviceId, weatherZipCode, monitoringEnabled, monitoringWebhookUrl, mediamtxConfig, sthmHistory, internetMonitorConfig, fishingReportConfig, batteryReportConfig } = config;
  // HA-only: demo mode is never used. Force it off regardless of any stale
  // saved config (older builds persisted useDemoMode:true, which routed device
  // control to a no-op demo service so toggles never reached Home Assistant).
  const useDemoMode = false;
  const [isDeviceLoading, setIsDeviceLoading] = useState(true);
  const [sthmState, setSthmState] = useState<STHMState | null>(null);
  /// Tracks the previous arm state so the next effect can detect when
  /// the alarm transitions externally (SmartThings app, hub schedule,
  /// voice command, second panel pressing arm) and append the event
  /// to sthmHistory. The local setSTHMStatus() path already pushes
  /// to history for THIS panel's button presses, but every external
  /// trigger arrived via WebSocket → setSthmState() and silently
  /// updated the display without recording history, leaving the
  /// AlarmHistoryTile stuck on the last button press.
  const prevArmStateRef = useRef<STHMState['armState'] | undefined>(undefined);
  const [armingState, setArmingState] = useState<ArmingState>('no_sensors');
  const [isAudioUnlocked, setAudioUnlocked] = useState(false);
  const [activePanelId, setActivePanelId] = useState<string | null>(null);
  const [activeDevicePanelId, setActiveDevicePanelId] = useState<string | null>(null);
  const [pinRequest, setPinRequest] = useState<{ onConfirm: (pin: string) => void } | null>(null);
  const [confirmRequest, setConfirmRequest] = useState<{ message: string; resolve: (confirmed: boolean) => void } | null>(null);
  const [inputRequest, setInputRequest] = useState<{ message: string; initialValue?: string; type?: 'text' | 'password' | 'number', resolve: (value: string | null) => void; } | null>(null);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [configLoadError, setConfigLoadError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  // Initialize Local TTS state from localStorage
  // If key is missing (first run or fresh browser), default to TRUE so users get audio out of the box.
  const [localTtsEnabled, setLocalTtsEnabled] = useState<boolean>(() => {
      const stored = localStorage.getItem('homeTileTtsEnabled');
      return stored === null ? true : stored === 'true';
  });

  // Auto-unlock audio if running in Fully Kiosk Browser, as it supports programmatic TTS without gesture
  useEffect(() => {
      if (typeof (window as any).fully !== 'undefined') {
          console.log("Fully Kiosk detected: Auto-unlocking audio.");
          setAudioUnlocked(true);
      }
  }, []);

  // Handle side effects of toggling TTS (saving setting, stopping audio) in an effect
  // to prevent race conditions or blocking UI updates in the WebView.
  useEffect(() => {
      localStorage.setItem('homeTileTtsEnabled', String(localTtsEnabled));
      
      // If disabled, stop any currently playing audio immediately
      if (!localTtsEnabled) {
          if (typeof window !== 'undefined' && window.speechSynthesis) {
              window.speechSynthesis.cancel();
          }
          const fully = getFully();
          if (fully && typeof fully.stopTextToSpeech === 'function') {
              try { fully.stopTextToSpeech(); } catch(e) { console.warn("Failed to stop Fully TTS", e); }
          }
      }
  }, [localTtsEnabled]);

  const toggleTtsNotifications = useCallback(() => {
    setLocalTtsEnabled(prev => !prev);
  }, []);

  const allVirtualDevices = useMemo(() => {
    const deviceMap = new Map<string, Device>();
    // Add synthetic devices first, so real stored devices can overwrite them if they exist.
    syntheticVirtualDevices.forEach(d => deviceMap.set(d.id, d));
    storedVirtualDevices.forEach(d => deviceMap.set(d.id, d));
    // HA-only: drop virtual devices tied to removed api-server services so they
    // never surface as "Unsupported Type" tiles (see INTEGRATIONS.md).
    return Array.from(deviceMap.values())
      .filter(d => !DEAD_VIRTUAL_TYPES.has(d.type))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [storedVirtualDevices, syntheticVirtualDevices]);

  const devices = useMemo(() => {
    const uniqueDeviceMap = new Map<string, Device>();
    // Add virtual devices (including synthetic) first
    allVirtualDevices.forEach(d => uniqueDeviceMap.set(d.id, d));
    // Then add service devices, overwriting any virtual device with the same ID
    serviceDevices.forEach(d => uniqueDeviceMap.set(d.id, d));
    
    return Array.from(uniqueDeviceMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [serviceDevices, allVirtualDevices]);


  const allDevicesForUpdate = useRef<Device[]>([]);
  // Track selected locations for WebSocket handler (location filtering)
  const selectedLocationsRef = useRef<string[]>([]);
  // Track the "Triggering Sensors" list for the WebSocket handler so only
  // configured sensors can raise the alarm/disarm modal (defense-in-depth; the
  // api-server applies the same filter at the source).
  const notifyingSensorIdsRef = useRef<string[]>([]);
  const alarmTriggerSensorIdsRef = useRef<string[]>([]);
  useEffect(() => {
    allDevicesForUpdate.current = devices;
  }, [devices]);

  // Keep selectedLocationsRef in sync with SmartThings connection config
  useEffect(() => {
    const stConnection = connections.find(c => c.id === DeviceService.SmartThings && c.enabled);
    selectedLocationsRef.current = stConnection?.selectedLocations || [];
  }, [connections]);

  useEffect(() => {
    notifyingSensorIdsRef.current = config.notifyingSensorIds || [];
  }, [config.notifyingSensorIds]);
  useEffect(() => {
    alarmTriggerSensorIdsRef.current = config.alarmTriggerSensorIds || [];
  }, [config.alarmTriggerSensorIds]);

  // FIX: Decouple 'loading' from 'isDeviceLoading' to prevent full app reload/unmount on background refreshes.
  // 'loading' now only reflects critical initial configuration load. Components can check isDeviceLoading separately.
  const loading = isConfigLoading;

  const removeNotification = useCallback((id: number) => {
    setNotifications(current => current.filter(n => n.id !== id));
  }, []);

  const addNotification = useCallback((message: string, type: AppNotification['type'] = 'info') => {
    const id = Date.now();
    setNotifications(current => [...current, { id, message, type }]);
    setTimeout(() => removeNotification(id), 5000);
  }, [removeNotification]);

  // WebSocket for local real-time updates (Lutron)
  useEffect(() => {
    // Use same port detection logic as api.ts - dev dashboard on 8080 uses API on 8081
    const apiPort = window.location.port === '8080' ? '8081' : '3001';
    const wsUrl = `ws://${window.location.hostname}:${apiPort}`;
    let ws: WebSocket;
    let reconnectTimeout: ReturnType<typeof setTimeout>;

    const connect = () => {
        ws = new WebSocket(wsUrl);

        ws.onopen = () => console.log('[WebSocket] Connected to API server.');

        ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                if (message.type === 'lutron-update') {
                    setServiceDevices(current => produce(current, draft => {
                        const device = draft.find(d => d.id === message.deviceId);
                        if (device) {
                            device.state = message.state;
                        }
                    }));
                } else if (message.type === 'ha-entities' && Array.isArray(message.entities)) {
                    // Live HA entity deltas relayed by the server-side HA
                    // WebSocket (Phase 4, feature-flagged). Each is a full
                    // {entity_id,state,attributes}; map and upsert by id. When
                    // the server socket is disabled these never arrive, so this
                    // is inert and the browser's own HA WS path is unaffected.
                    setServiceDevices(current => produce(current, draft => {
                        for (const entity of message.entities) {
                            const mapped = mapHaEntityToInternalDevice(entity);
                            if (!mapped) continue;
                            const idx = draft.findIndex(d => d.id === mapped.id);
                            if (idx >= 0) draft[idx] = mapped;
                            else draft.push(mapped);
                        }
                    }));
                } else if (message.type === 'lutronDevicesDiscovered') {
                    // Lutron devices were discovered after initial load - trigger re-fetch
                    console.log(`[WebSocket] Lutron discovered ${message.count} devices, triggering re-fetch...`);
                    // Dispatch a custom event that we can listen to elsewhere
                    window.dispatchEvent(new CustomEvent('lutronDevicesDiscovered'));
                } else if (message.type === 'tts') {
                    // POST /api/tts/speak broadcast — anyone on the LAN
                    // can drop a curl to make every panel announce
                    // something. Useful as an end-to-end TTS test path
                    // (validates JS → window.fully → native bridge →
                    // AVSpeechSynthesizer on iPad, or speechSynthesis
                    // fallback in browser / FullyKiosk).
                    const text = typeof message.text === 'string' ? message.text : '';
                    if (!text) return;
                    console.log(`[WebSocket] tts broadcast: "${text}"`);
                    playTextToSpeech(text);
                } else if (message.type === 'alarm-trigger') {
                    // Alarm trigger event from api-server's AlarmEventService
                    // This provides location-aware intrusion detection with sensor details
                    console.log(`[WebSocket] Alarm trigger received:`, message);

                    // Location filtering: Only process alarms for locations this site is subscribed to
                    const selectedLocations = selectedLocationsRef.current;
                    if (selectedLocations.length > 0) {
                        if (!message.locationId) {
                            console.warn('[WebSocket] Ignoring alarm-trigger without locationId');
                            return;
                        }
                        if (!selectedLocations.includes(message.locationId)) {
                            console.log(`[WebSocket] Ignoring alarm-trigger for location ${message.locationId} (not in selectedLocations: ${selectedLocations.join(', ')})`);
                            return;
                        }
                    }

                    // Only configured alarm-trigger sensors may raise the modal
                    // (defense-in-depth; api-server filters at the source too).
                    const triggeringSensors = alarmTriggerSensorIdsRef.current;
                    if (triggeringSensors.length > 0 && message.deviceId && !triggeringSensors.includes(message.deviceId)) {
                        console.log(`[WebSocket] Ignoring alarm-trigger for sensor not in alarm trigger list: ${message.deviceId}`);
                        return;
                    }

                    setSthmState(current => {
                        // Additional check: verify locationId matches current STHM state
                        if (current && current.locationId && message.locationId !== current.locationId) {
                            console.log(`[WebSocket] Ignoring alarm-trigger - locationId mismatch (got: ${message.locationId}, expected: ${current.locationId})`);
                            return current;
                        }

                        const newSensor = { name: message.triggerName };
                        const currentSensors = current?.securityState === 'VIOLATION' ? (current.violatingSensors || []) : [];
                        const sensorExists = currentSensors.some(s => s.name === newSensor.name);

                        return {
                            ...current,
                            locationId: message.locationId || current?.locationId || '',
                            locationName: current?.locationName || 'SmartThings',
                            armState: current?.armState || 'armedAway',
                            securityState: 'VIOLATION',
                            violatingSensors: sensorExists ? currentSensors : [...currentSensors, newSensor],
                            trigger: { name: message.triggerName, type: message.triggerType }
                        };
                    });
                    // NOTE: the loud kiosk siren, the 'triggered' history entry,
                    // and the Sonos announcement are intentionally NOT fired here.
                    // This is only the START of the entry-delay window — STHM's
                    // own "Delay before alert" is counting down in parallel. Those
                    // actions are deferred to escalateToFullAlarm(), called when
                    // the EntryDelayModal countdown expires without a disarm. A
                    // disarm inside the window unmounts the modal, so escalation
                    // never runs and nothing fires.

                    // Wake the screen so the disarm modal is seen. On the iOS
                    // shell the api-server also fans out a screenOn command
                    // (→ IdleController.forceWake); here we cover the Fully-Kiosk
                    // / browser case via the window.fully shim.
                    try {
                        const f = (window as any).fully;
                        if (typeof f?.turnScreenOn === 'function') f.turnScreenOn();
                        if (typeof f?.bringToForeground === 'function') f.bringToForeground();
                        if (typeof f?.setScreenBrightness === 'function') f.setScreenBrightness(255);
                    } catch (e) { /* non-fatal */ }
                }
            } catch (e) {
                console.warn('[WebSocket] Received non-JSON message:', event.data);
            }
        };

        ws.onclose = () => {
            console.warn('[WebSocket] Disconnected. Attempting to reconnect in 5s...');
            clearTimeout(reconnectTimeout);
            reconnectTimeout = setTimeout(connect, 5000);
        };
        
        ws.onerror = () => {
             ws.close(); // This will trigger the onclose handler to reconnect
        };
    };

    connect();

    return () => {
        clearTimeout(reconnectTimeout);
        if (ws) ws.close();
    };
  }, []);

  const refreshDeviceStatus = useCallback(async (device: Device) => {
      if (device.service !== DeviceService.SmartThings || !device.locationId) return;

      const stConnection = connections.find(c => c.id === DeviceService.SmartThings && c.enabled);
      if (!stConnection) return;

      try {
          const status = await smartThingsService.getDeviceStatus(device.id, device.locationId, stConnection);
          if (status && status.components?.main) {
               const flatState: Record<string, any> = {};
               const main = status.components.main;
               for (const cap in main) {
                   for (const attr in main[cap]) {
                       if (main[cap][attr]?.value !== undefined) {
                           flatState[`${cap}.${attr}`] = main[cap][attr].value;
                       }
                   }
               }
               
               const updates = parseRelayState(device.type, flatState);
               
               // Check if state is valid (including primitive 0, false, etc.)
               const isStateValid = updates.state !== undefined && (
                   typeof updates.state !== 'object' || // primitive (boolean, number, string)
                   (updates.state !== null && Object.keys(updates.state).length > 0) // non-empty object
               );

               if (isStateValid || updates.battery !== undefined) {
                   setServiceDevices(current => produce(current, draft => {
                       const dev = draft.find(d => d.id === device.id);
                       if (dev) {
                           if (updates.state !== undefined) dev.state = updates.state;
                           if (updates.battery !== undefined) dev.battery = updates.battery;
                       }
                   }));
               }
          }
      } catch (error) {
          console.warn(`[Dashboard] Failed to refresh status for ${device.name}`, error);
      }
  }, [connections]);

  const fetchDevicesFromServices = useCallback(async () => {
    // HA-only: Home Assistant is the sole backend (same-origin, always-on).
    // Fetch every HA entity and map it to a Device; unmapped domains fall
    // through to the generic capability tile, so new HA core / HACS devices
    // appear automatically with no config.
    setIsDeviceLoading(true);
    setServiceError(null);
    let fetchedDevices: Device[] = [];
    try {
        const haEntities = await homeAssistantService.getDevices();
        fetchedDevices = haEntities
            .map(mapHaEntityToInternalDevice)
            .filter((d): d is Device => d !== null);
    } catch (error) {
        const errorMessage = (error as Error).message;
        console.error(`[Home Assistant] Failed to fetch devices:`, errorMessage);
        setServiceError(`[Home Assistant] ${errorMessage}`);
    }
    fetchedDevices.sort((a, b) => a.name.localeCompare(b.name));
    setServiceDevices(fetchedDevices);
    setIsDeviceLoading(false);
  }, [useDemoMode, connections]);

  // SSE for EnergyTrak real-time updates (replaces polling)
  useEffect(() => {
    const etConnection = connections.find(c => c.id === DeviceService.EnergyTrak && c.enabled);

    // Only set up SSE if EnergyTrak is enabled and we are not in config-loading state
    if (!etConnection || isConfigLoading) return;

    const eventsUrl = energyTrakService.getEventsUrl(etConnection);
    let eventSource: EventSource | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout>;

    const connect = () => {
        console.log('[EnergyTrak SSE] Connecting to', eventsUrl);
        eventSource = new EventSource(eventsUrl);

        eventSource.onopen = () => {
            console.log('[EnergyTrak SSE] Connected');
        };

        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'update' && data.site) {
                    // Update the device state for this site
                    const siteId = data.site.siteId;
                    const deviceId = `genmon-${siteId?.replace('genmon-', '') || 'unknown'}`;
                    setServiceDevices(current => produce(current, draft => {
                        const device = draft.find(d => d.id === deviceId);
                        if (device) {
                            device.state = data.site;
                        }
                    }));
                } else if (data.type === 'initial' && data.sites) {
                    // Initial state - update all sites
                    setServiceDevices(current => produce(current, draft => {
                        for (const site of data.sites) {
                            const siteId = site.siteId;
                            const deviceId = `genmon-${siteId?.replace('genmon-', '') || 'unknown'}`;
                            const device = draft.find(d => d.id === deviceId);
                            if (device) {
                                device.state = site;
                            }
                        }
                    }));
                }
            } catch (e) {
                console.warn('[EnergyTrak SSE] Failed to parse message:', e);
            }
        };

        eventSource.onerror = () => {
            console.warn('[EnergyTrak SSE] Connection error, reconnecting in 5s...');
            eventSource?.close();
            reconnectTimeout = setTimeout(connect, 5000);
        };
    };

    connect();

    return () => {
        clearTimeout(reconnectTimeout);
        eventSource?.close();
    };
  }, [connections, isConfigLoading]);

  // Polling for Litter Robot updates
  useEffect(() => {
    const whiskerConnection = connections.find(c => c.id === DeviceService.Whisker && c.enabled);

    if (!whiskerConnection || isConfigLoading) return;

    const pollLitterRobot = async () => {
        try {
            const newDevices = await litterRobotService.getDevices(whiskerConnection);
            setServiceDevices(current => {
                return produce(current, draft => {
                    newDevices.forEach(newDev => {
                        const index = draft.findIndex(d => d.id === newDev.id);
                        if (index !== -1) {
                            draft[index] = newDev;
                        } else {
                            draft.push(newDev);
                        }
                    });
                });
            });
        } catch (e) {
            console.warn("LitterRobot polling failed", e);
        }
    };

    // Poll every 30 seconds (Litter Robot doesn't need frequent updates)
    const interval = setInterval(pollLitterRobot, 30000);
    return () => clearInterval(interval);
  }, [connections, isConfigLoading]);

  // Polling for Hayward Pool updates
  useEffect(() => {
    const haywardConnection = connections.find(c => c.id === DeviceService.HaywardPool && c.enabled);

    if (!haywardConnection || isConfigLoading) return;

    const pollHaywardPool = async () => {
        try {
            const newDevices = await haywardPoolService.getDevices(haywardConnection);
            setServiceDevices(current => {
                return produce(current, draft => {
                    newDevices.forEach(newDev => {
                        const index = draft.findIndex(d => d.id === newDev.id);
                        if (index !== -1) {
                            draft[index] = newDev;
                        } else {
                            draft.push(newDev);
                        }
                    });
                });
            });
        } catch (e) {
            console.warn("HaywardPool polling failed", e);
        }
    };

    // Poll every 30 seconds
    const interval = setInterval(pollHaywardPool, 30000);
    return () => clearInterval(interval);
  }, [connections, isConfigLoading]);

  // Polling for Flair HVAC updates
  useEffect(() => {
    const flairConnection = connections.find(c => c.id === DeviceService.Flair && c.enabled);

    if (!flairConnection || isConfigLoading) return;

    const pollFlair = async () => {
        try {
            const newDevices = await flairService.getDevices(flairConnection);
            setServiceDevices(current => {
                return produce(current, draft => {
                    newDevices.forEach(newDev => {
                        const index = draft.findIndex(d => d.id === newDev.id);
                        if (index !== -1) {
                            draft[index] = newDev;
                        } else {
                            draft.push(newDev);
                        }
                    });
                });
            });
        } catch (e) {
            console.warn("Flair polling failed", e);
        }
    };

    // Poll every 30 seconds
    const interval = setInterval(pollFlair, 30000);
    return () => clearInterval(interval);
  }, [connections, isConfigLoading]);

  // Polling for CoolAutomation / CoolMaster HVAC updates
  useEffect(() => {
    const coolmasterConnection = connections.find(c => c.id === DeviceService.CoolMaster && c.enabled);

    if (!coolmasterConnection || isConfigLoading) return;

    const pollCoolMaster = async () => {
        try {
            const newDevices = await coolMasterService.getDevices(coolmasterConnection);
            setServiceDevices(current => {
                return produce(current, draft => {
                    newDevices.forEach(newDev => {
                        const index = draft.findIndex(d => d.id === newDev.id);
                        if (index !== -1) {
                            draft[index] = newDev;
                        } else {
                            draft.push(newDev);
                        }
                    });
                });
            });
        } catch (e) {
            console.warn("CoolMaster polling failed", e);
        }
    };

    const interval = setInterval(pollCoolMaster, 30000);
    return () => clearInterval(interval);
  }, [connections, isConfigLoading]);

  // SSE for Pool Floor (Akvo) real-time updates.
  // The poolfloor service polls Modbus every 1 s and broadcasts each result via
  // SSE, so the UI reflects any external change (HMI, third-party system) within
  // ~1 second without polling.
  useEffect(() => {
    const poolFloorConnection = connections.find(c => c.id === DeviceService.PoolFloor && c.enabled);
    if (!poolFloorConnection || isConfigLoading) return;

    const eventsUrl = poolFloorService.getEventsUrl(poolFloorConnection);
    let eventSource: EventSource | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout>;

    const connect = () => {
        console.log('[PoolFloor SSE] Connecting to', eventsUrl);
        eventSource = new EventSource(eventsUrl);

        eventSource.onopen = () => {
            console.log('[PoolFloor SSE] Connected');
        };

        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                setServiceDevices(current => produce(current, draft => {
                    const device = draft.find(d => d.id === 'poolfloor-akvo');
                    if (device) {
                        device.state = data;
                    }
                }));
            } catch (e) {
                console.warn('[PoolFloor SSE] Failed to parse message:', e);
            }
        };

        eventSource.onerror = () => {
            console.warn('[PoolFloor SSE] Connection error, reconnecting in 5s...');
            eventSource?.close();
            reconnectTimeout = setTimeout(connect, 5000);
        };
    };

    connect();

    return () => {
        clearTimeout(reconnectTimeout);
        eventSource?.close();
    };
  }, [connections, isConfigLoading]);

  // Polling for Sonos player state. jishi's node-sonos-http-api (the stock
  // server we run) has no SSE endpoint, so we refresh zone state on a short
  // interval instead. 15s is a reasonable balance: responsive enough that
  // clicking Play in the modal catches up quickly, without hammering the
  // Sonos controller. When a SonosControlModal is open it also triggers its
  // own getZoneState calls on user interaction, so real-time feel is fine.
  useEffect(() => {
    const sonosConn = connections.find(c => c.id === DeviceService.Sonos && c.enabled);
    if (!sonosConn || !sonosConn.cloudEndpoint || isConfigLoading) return;

    const pollSonos = async () => {
        try {
            const newPlayers = await sonosService.getPlayers(sonosConn);
            setServiceDevices(current => {
                return produce(current, draft => {
                    newPlayers.forEach(newDev => {
                        const index = draft.findIndex(d => d.id === newDev.id);
                        if (index !== -1) {
                            draft[index] = newDev;
                        } else {
                            draft.push(newDev);
                        }
                    });
                });
            });
        } catch (e) {
            // Don't spam the UI on transient failures — just log.
            console.warn("Sonos polling failed", e);
        }
    };

    const interval = setInterval(pollSonos, 15000);
    return () => clearInterval(interval);
  }, [connections, isConfigLoading]);

  useEffect(() => {
    if (!isConfigLoading && !configLoadError) {
      fetchDevicesFromServices();
    }
  }, [isConfigLoading, configLoadError, fetchDevicesFromServices]);

  // Listen for Lutron device discovery event and re-fetch devices
  useEffect(() => {
    const handleLutronDiscovery = () => {
      console.log('[Lutron] Devices discovered event received, re-fetching...');
      fetchDevicesFromServices();
    };
    window.addEventListener('lutronDevicesDiscovered', handleLutronDiscovery);
    return () => window.removeEventListener('lutronDevicesDiscovered', handleLutronDiscovery);
  }, [fetchDevicesFromServices]);

  useEffect(() => {
    if (isConfigLoading) return;

    const devicesToReset = config.virtualDevices.filter(d =>
        d.type === DeviceType.PanicButton && d.state !== 'IDLE'
    );

    if (devicesToReset.length > 0) {
        setConfig(current => produce(current, draft => {
            devicesToReset.forEach(button => {
                const deviceInDraft = draft.virtualDevices.find(d => d.id === button.id);
                if (deviceInDraft) {
                    deviceInDraft.state = 'IDLE';
                }
            });
        }));
    }
  }, [isConfigLoading, config.virtualDevices]);

  useEffect(() => {
    if (useDemoMode) {
        const interval = setInterval(async () => {
            const updatedDevices = await demoService.getDeviceUpdates(allDevicesForUpdate.current);
            const updatedServiceDevices = updatedDevices.filter(d => d.service !== DeviceService.Virtual);
            setServiceDevices(updatedServiceDevices);
        }, 3000);
        return () => clearInterval(interval);
    }
  }, [useDemoMode]);

  const saveTimeoutRef = useRef<number | null>(null);

  // FIX: Added loadConfig function definition and initial load effect.
  const loadConfig = useCallback((silent: boolean = false) => {
    if (!silent) setIsConfigLoading(true);
    setConfigLoadError(null);
    
    apiGetConfig()
        .then(loadedConfig => {
            const defaultConfig = getDefaultConfig();
            if (loadedConfig) {
                const mergedConfig = produce(defaultConfig, draft => {
                    Object.assign(draft, loadedConfig);

                    // Ensure system virtual devices exist. Without this, an
                    // upgrade can leave the user with a saved virtualDevices
                    // array that pre-dates a system device (e.g. fishing-report
                    // was added after a user's last config save), and the
                    // panel builder can't surface a tile for a device that
                    // doesn't exist. We only INJECT missing ones — never
                    // overwrite a user-edited copy.
                    // One-time migration: alarmTriggerSensorIds used to be the same
                    // list as notifyingSensorIds. Seed it from notifying* on first
                    // load so existing setups keep firing the same intrusion alerts.
                    if (loadedConfig.alarmTriggerSensorIds === undefined) {
                        draft.alarmTriggerSensorIds = [...(loadedConfig.notifyingSensorIds || [])];
                    }

                    if (!draft.virtualDevices) draft.virtualDevices = [];
                    const existingIds = new Set(draft.virtualDevices.map(d => d.id));
                    for (const sysDev of (defaultConfig.virtualDevices || [])) {
                        if (!existingIds.has(sysDev.id)) {
                            draft.virtualDevices.push(sysDev);
                        }
                    }

                    const loadedConnectionIds = new Set((loadedConfig.connections || []).map(c => c.id));
                    const newConnections = defaultConfig.connections.filter(c => !loadedConnectionIds.has(c.id));
                    const mergedConnections = (loadedConfig.connections || []).map(loadedConn => {
                        const defaultConn = defaultConfig.connections.find(c => c.id === loadedConn.id);
                        return defaultConn ? { ...defaultConn, ...loadedConn } : loadedConn;
                    });
                    draft.connections = [...mergedConnections, ...newConnections];
                    
                    if (draft.panels) {
                        draft.panels.forEach(panel => {
                            if (!panel.tiles) panel.tiles = [];
                            const needsLayout = panel.tiles.some(t => t.x === undefined || t.y === undefined);
                            if (needsLayout) {
                                const grid: boolean[][] = Array(200).fill(null).map(() => Array(panel.columns || 8).fill(false));
                                panel.tiles.forEach(tile => {
                                    if (tile.x !== undefined && tile.y !== undefined) {
                                        const tileW = Math.min(tile.width || 1, panel.columns || 8);
                                        const tileH = tile.height || 1;
                                        for (let i = 0; i < tileH; i++) {
                                            for (let j = 0; j < tileW; j++) {
                                                if ((tile.y! + i) < grid.length && (tile.x! + j) < grid[0].length) {
                                                    grid[tile.y! + i][tile.x! + j] = true;
                                                }
                                            }
                                        }
                                    }
                                });
                                panel.tiles.forEach(tile => {
                                    if (tile.x === undefined || tile.y === undefined) {
                                        const tileW = Math.min(tile.width || 1, panel.columns || 8);
                                        const tileH = tile.height || 1;
                                        let placed = false;
                                        for (let y = 0; y < grid.length - tileH + 1; y++) {
                                            for (let x = 0; x < (panel.columns || 8) - tileW + 1; x++) {
                                                let canPlace = true;
                                                for (let i = 0; i < tileH; i++) {
                                                    for (let j = 0; j < tileW; j++) {
                                                        if (grid[y + i][x + j]) {
                                                            canPlace = false;
                                                            break;
                                                        }
                                                    }
                                                    if (!canPlace) break;
                                                }
                                                if (canPlace) {
                                                    tile.x = x;
                                                    tile.y = y;
                                                    for (let i = 0; i < tileH; i++) {
                                                        for (let j = 0; j < tileW; j++) {
                                                            grid[y + i][x + j] = true;
                                                        }
                                                    }
                                                    placed = true;
                                                    break;
                                                }
                                            }
                                            if (placed) break;
                                        }
                                    }
                                });
                            }
                            // Migration: Enable tile borders by default for existing panels
                            if (panel.showTileBorders === undefined) {
                                panel.showTileBorders = true;
                            }
                        });
                    }
                    updateMediamtxConfig(draft);
                });
                
                // Deep equality check to prevent infinite loops and unnecessary re-renders
                setConfig(currentConfig => {
                    if (JSON.stringify(currentConfig) === JSON.stringify(mergedConfig)) {
                        return currentConfig;
                    }
                    return mergedConfig;
                });
            } else {
                // Loaded config is null (empty database, first run).
                // Initialize with default config.
                setConfig(defaultConfig);
                apiSaveConfig(defaultConfig).catch(err => {
                    console.warn("Could not save initial default config (likely read-only access):", err);
                });
            }
        })
        .catch(error => {
            console.error("Failed to load configuration:", error);
            setConfigLoadError(error.message || "Failed to load configuration.");
            // IMPORTANT: Do NOT set default config here.
            // Setting default config would trigger auto-save and overwrite the server if the user is an admin!
        })
        .finally(() => {
            if (!silent) setIsConfigLoading(false);
        });
  }, []);

  useEffect(() => {
      loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (isConfigLoading || configLoadError) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    
    saveTimeoutRef.current = window.setTimeout(async () => {
        try {
            await apiSaveConfig(config);
            
            // FIX: Removed internal broadcast of 'config_updated' here.
            // This prevented a feedback loop where the client saving the config
            // would receive its own update via SSE and trigger a reload/refresh,
            // which caused UI disruption (e.g., losing focus in input fields).
        } catch (err) {
            // This can happen for read-only users.
            console.warn('Config save failed (might be read-only access):', err);
        }
    }, 1500);
    
    return () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current); };
  }, [config, isConfigLoading, configLoadError]);

  const stConnection = useMemo(() => 
    connections.find(c => c.id === DeviceService.SmartThings && c.enabled && c.cloudEndpoint),
    [connections]
  );

  const sonosConnection = useMemo(() =>
    connections.find(c => c.id === DeviceService.Sonos && c.enabled && c.cloudEndpoint),
    [connections]
  );

  // Fire the actual alarm annunciation. Called only when the entry-delay window
  // expires WITHOUT a disarm (from Dashboard's EntryDelayModal onExpired). These
  // effects are deferred from detection so that disarming inside the window
  // prevents them entirely (and STHM's own "Delay before alert" cancels its
  // sirens in parallel). Fires: the kiosk siren, a 'triggered' history entry
  // (deduped), and the Sonos intrusion announcement.
  const escalateToFullAlarm = useCallback((triggerName?: string) => {
    const name = triggerName || 'Unknown';

    // Native kiosk alarm tone (iOS shell only — shim from DashboardView.swift).
    try {
      const f = (window as any).fully;
      if (typeof f?.alarmOn === 'function') f.alarmOn();
    } catch (e) { /* non-fatal */ }

    // Append a 'triggered' entry to sthmHistory (dedupe same-sensor re-triggers
    // within 60s so a flapping door doesn't spam history).
    setConfig(produce(draft => {
      if (!draft.sthmHistory) draft.sthmHistory = [];
      const last = draft.sthmHistory[0];
      const nowMs = Date.now();
      const sameTrigger = last && last.status === 'triggered' && last.triggerName === name;
      if (sameTrigger) {
        const lastMs = new Date(last.timestamp).getTime();
        if (!Number.isNaN(lastMs) && nowMs - lastMs < 60_000) return;
      }
      draft.sthmHistory.unshift({
        timestamp: new Date().toISOString(),
        status: 'triggered',
        triggerName: name,
      });
      if (draft.sthmHistory.length > 10) {
        draft.sthmHistory = draft.sthmHistory.slice(0, 10);
      }
    }));

    // Sonos intrusion announcement.
    if (sonosConnection) {
      const notificationsToTrigger = (config.sonosNotifications || []).filter(n => n.eventType === 'intrusion-detected');
      notificationsToTrigger.forEach(notif => {
        const ttsMessage = notif.message.replace('{deviceName}', name);
        notif.targetDeviceIds.forEach(sonosId => {
          const sonosDevice = allDevicesForUpdate.current.find(d => d.id === sonosId);
          if (sonosDevice && sonosDevice.type === DeviceType.SonosPlayer) {
            const roomName = (sonosDevice.state as any).roomName;
            if (roomName) {
              console.log(`[Sonos TTS] Intrusion: Speaking "${ttsMessage}" in room "${roomName}"`);
              sonosService.say(sonosConnection, roomName, ttsMessage, notif.volume)
                .catch(e => {
                  console.error(`[Sonos TTS] Failed to speak:`, e);
                  addNotification(`Sonos TTS failed: ${e.message}`, 'error');
                });
            }
          }
        });
      });
    }
  }, [sonosConnection, config.sonosNotifications, setConfig, addNotification]);

  // HA is the only backend now and is reached same-origin via haClient (the HA
  // iframe handles URL + auth), so cloudEndpoint/apiKey are no longer required.
  const haConnection = useMemo(() =>
    connections.find(c => c.id === DeviceService.HomeAssistant && c.enabled),
    [connections]
  );

  const stSseUrl = useMemo(() => {
      if (useDemoMode || !stConnection) return null;
      try {
        const baseUrl = stConnection.cloudEndpoint.replace(/\/+$/, '');
        const url = new URL(`${baseUrl}/events`);

        const selectedLocations = stConnection.selectedLocations || [];
        if (selectedLocations.length > 0) {
          url.searchParams.set('locationIds', selectedLocations.join(','));
        } else {
          console.warn('[SSE] No selectedLocations configured for SmartThings connection');
          return null;
        }

        // EventSource can't send Authorization headers; the relay accepts
        // ?token= as a fallback for SSE clients (see Relay/server.js).
        const token =
          localStorage.getItem('homeTileAuthToken') ||
          localStorage.getItem('homeTileDeviceAuthToken');
        if (token) {
          url.searchParams.set('token', token);
        }

        return url.toString();
      } catch (e) { return null; }
  }, [useDemoMode, stConnection]);

  // Sonos SSE is intentionally disabled: jishi's node-sonos-http-api (the
  // standard package that runs on port 5005) does NOT expose an /events SSE
  // endpoint. Attempting the connection just produces repeated failures that
  // eventually surface as "SSE connection error" banners once the retry count
  // climbs. Sonos player state is refreshed via the periodic polling loop
  // further down, which matches the pattern used by Flair / HaywardPool /
  // LitterRobot / EnergyTrak. If someone ever runs a custom Sonos bridge that
  // DOES speak SSE, re-enable by returning a real URL here.
  const sonosSseUrl = useMemo<string | null>(() => null, []);


  const handleStSseMessage = useCallback((message: any) => {
    if (message.type === 'system') {
        if (message.event === 'config_updated') {
            console.log("[System] Configuration updated remotely. Reloading...");
            // Re-load configuration from server to sync changes silently (background)
            loadConfig(true);
        } else if (message.event === 'panel_reload') {
            // Broadcast by api-server when dist/version.txt changes (i.e. a deploy
            // happened — deployv3.sh restamps it with the new build SHA). Forces a
            // fresh fetch with a cache-busting query so the browser picks up the
            // new bundle without anyone hard-refreshing.
            const newVersion = message?.data?.version || 'unknown';
            console.log(`[System] Panel reload requested (version ${newVersion}). Reloading...`);
            const url = new URL(window.location.href);
            url.searchParams.set('_v', Date.now().toString());
            window.location.replace(url.toString());
        }
        return;
    }

    if (message.type === 'notification') {
        if (message.message) {
            const text = message.message;
            addNotification(text);
            if (isAudioUnlocked) {
                // Play TTS if the user has interacted with the page to unlock audio
                playTextToSpeech(text);
            }
        }
        return;
    }

    if (message.type === 'device') {
        const messageLocationId = getMessageLocationId(message);
        // Location filtering: Only process device events for locations we're subscribed to
        if (messageLocationId && stConnection) {
            const selectedLocations = stConnection.selectedLocations || [];
            if (selectedLocations.length > 0 && !selectedLocations.includes(messageLocationId)) {
                // Silently ignore - device events are frequent and logging would be spammy
                return;
            }
        }

        const { deviceId, capability, attribute, value } = message;
        let deviceNameForNotification: string | undefined;
        
        // Look up alias from config
        const alias = config.sensorAliases?.[deviceId];

        setServiceDevices(current => produce(current, draft => {
            const device = draft.find(d => d.id === deviceId);
            if (!device) return;

            deviceNameForNotification = device.name;
            const nameToSpeak = (alias || deviceNameForNotification).trim();
            
            // Panel TTS Notifications
            if (capability === 'battery' && attribute === 'battery') {
                device.battery = Number(value);
                return;
            }

            if (capability === 'switch' && attribute === 'switch') {
                const isOn = value === 'on';
                if (device.type === DeviceType.Dimmer) device.state = isOn ? 100 : 0;
                else if (device.type === DeviceType.Shade) device.state = isOn ? 100 : 0;
                else if (device.type === DeviceType.Switch || device.type === DeviceType.Light || device.type === DeviceType.SmartPlug) device.state = isOn;
                return;
            }

            if ((capability === 'switchLevel' && attribute === 'level') || (capability === 'windowShadeLevel' && (attribute === 'shadeLevel' || attribute === 'level'))) {
                if (device.type === DeviceType.Dimmer || device.type === DeviceType.Shade) device.state = Number(value);
                return;
            }

            if (capability === 'windowShade' && attribute === 'windowShade') {
                if (device.type === DeviceType.Shade) {
                    if (value === 'opening' || value === 'open') device.state = 100;
                    else if (value === 'closing' || value === 'closed') device.state = 0;
                }
                return;
            }
            
            switch (device.type) {
                case DeviceType.Siren:
                    if (capability === 'alarm' && attribute === 'alarm') device.state = value !== 'off';
                    break;
                case DeviceType.MotionSensor:
                    if (capability === 'motionSensor' && attribute === 'motion') {
                        const isActive = value === 'active';
                        device.state = isActive;
                        if (isActive && notifyingSensorIds?.includes(deviceId)) {
                             const msg = `${nameToSpeak} Motion Detected`;
                             console.log(`[Dashboard] Triggering notification: ${msg}`);
                             addNotification(msg);
                             if (localTtsEnabled && isAudioUnlocked) {
                                 playTextToSpeech(msg);
                             }
                        }
                    }
                    break;
                case DeviceType.ContactSensor:
                    if (capability === 'contactSensor' && attribute === 'contact') {
                        const isOpen = value === 'open';
                        device.state = isOpen;
                        if (notifyingSensorIds?.includes(deviceId)) {
                            const notificationMessage = `${nameToSpeak} ${isOpen ? 'Opened' : 'Closed'}`;
                            console.log(`[Dashboard] Triggering notification: ${notificationMessage}`);
                            addNotification(notificationMessage);
                            if (localTtsEnabled && isAudioUnlocked) {
                                playTextToSpeech(notificationMessage);
                            }
                        }
                    }
                    break;
                case DeviceType.TemperatureSensor:
                     if (capability === 'temperatureMeasurement' && attribute === 'temperature') device.state = Number(value);
                    break;
                case DeviceType.WaterSensor:
                    const stateObj = (typeof device.state === 'object' ? device.state : { leak: false }) as any;
                    if (capability === 'waterSensor' && attribute === 'water') {
                         const isWet = value === 'wet';
                         stateObj.leak = isWet;
                         if (isWet && notifyingSensorIds?.includes(deviceId)) {
                             const msg = `${nameToSpeak} Leak Detected`;
                             console.log(`[Dashboard] Triggering notification: ${msg}`);
                             addNotification(msg, 'error');
                             if (localTtsEnabled && isAudioUnlocked) {
                                 playTextToSpeech(msg);
                             }
                         }
                    } else if (capability === 'temperatureMeasurement' && attribute === 'temperature') {
                         stateObj.temperature = Number(value);
                    }
                    device.state = stateObj;
                    break;
                case DeviceType.Lock:
                    if (capability === 'lock' && attribute === 'lock') device.state = value === 'locked';
                    break;
                case DeviceType.Valve:
                    if (capability === 'valve' && attribute === 'valve') device.state = value === 'open';
                    break;
                case DeviceType.Thermostat:
                    if (typeof device.state === 'object' && device.state !== null) {
                        const thermostatState = device.state as Record<string, any>;
                        if (capability === 'thermostatMode' && attribute === 'thermostatMode') thermostatState.mode = value;
                        else if (capability === 'temperatureMeasurement' && attribute === 'temperature') thermostatState.currentTemp = Number(value);
                        else if (capability === 'thermostatCoolingSetpoint' && attribute === 'coolingSetpoint') thermostatState.setpoint = Number(value);
                        else if (capability === 'thermostatHeatingSetpoint' && attribute === 'heatingSetpoint') thermostatState.setpoint = Number(value);
                        else if (capability === 'thermostatFanMode' && attribute === 'thermostatFanMode') thermostatState.fan = value;
                    }
                    break;
            }

            // Sonos TTS Notifications
            let eventType: SonosNotificationEventType | null = null;
            if (capability === 'motionSensor' && attribute === 'motion' && value === 'active') {
                eventType = 'motion-active';
            } else if (capability === 'contactSensor' && attribute === 'contact' && value === 'open') {
                eventType = 'contact-open';
            } else if (capability === 'contactSensor' && attribute === 'contact' && value === 'closed') {
                eventType = 'contact-close';
            } else if (capability === 'waterSensor' && attribute === 'water' && value === 'wet') {
                eventType = 'leak-detected';
            } else if (capability === 'smokeDetector' && attribute === 'smoke' && value === 'detected') {
                eventType = 'smoke-detected';
            } else if (capability === 'carbonMonoxideDetector' && attribute === 'carbonMonoxide' && value === 'detected') {
                eventType = 'carbon-monoxide-detected';
            } else if (capability === 'alarm' && attribute === 'alarm' && value !== 'off') {
                eventType = 'siren-on';
            }

            if (eventType && sonosConnection) {
                const notificationsToTrigger = (config.sonosNotifications || []).filter(n => n.eventType === eventType);
                if (notificationsToTrigger.length > 0) {
                    notificationsToTrigger.forEach(notif => {
                        const message = notif.message.replace('{deviceName}', nameToSpeak);
                        notif.targetDeviceIds.forEach(sonosId => {
                            const sonosDevice = allDevicesForUpdate.current.find(d => d.id === sonosId);
                            if (sonosDevice && sonosDevice.type === DeviceType.SonosPlayer) {
                                const roomName = (sonosDevice.state as any).roomName;
                                if (roomName) {
                                    console.log(`[Sonos TTS] Speaking "${message}" in room "${roomName}"`);
                                    sonosService.say(sonosConnection, roomName, message, notif.volume)
                                        .catch(e => {
                                            console.error(`[Sonos TTS] Failed to speak:`, e);
                                            addNotification(`Sonos TTS failed: ${e.message}`, 'error');
                                        });
                                }
                            }
                        });
                    });
                }
            }
        }));

    } else if (message.type === 'sthm') {
        const messageLocationId = getMessageLocationId(message);
        // Location filtering: Only process STHM events for locations we're subscribed to
        const selectedLocations = stConnection?.selectedLocations || [];
        if (selectedLocations.length > 0) {
            if (!messageLocationId) {
                console.warn('[STHM] Ignoring event without locationId (selectedLocations configured).');
                return;
            }
            if (!selectedLocations.includes(messageLocationId)) {
                console.log(`[STHM] Ignoring event from location ${messageLocationId} (not in selectedLocations)`);
                return;
            }
        }

        const isIntrusionEvent = message.triggerType === 'SENSOR_EVENT';

        // NOTE: the Sonos intrusion announcement is intentionally deferred to
        // escalateToFullAlarm() (fired when the entry-delay window expires
        // without a disarm), so that disarming in time prevents it. This path
        // only flips state to VIOLATION below to bring up the warning modal.

        setSthmState(current => {
            const oldArmState = current?.armState;
            const newArmState = normalizeArmState(message.armState);

            // If disarmed, clear any violation state.
            if (newArmState === 'disarmed') {
                // Alarm announcements bypass mute — always audible if audio is unlocked
                if (isAudioUnlocked && oldArmState && oldArmState !== newArmState) {
                    playTextToSpeech('Alarm disarmed');
                }
                // Kill the native iOS alarm siren if it's still going.
                try {
                    const f = (window as any).fully;
                    if (typeof f?.alarmOff === 'function') f.alarmOff();
                } catch (e) { /* non-fatal */ }
                return {
                    ...current,
                    locationId: messageLocationId,
                    locationName: current?.locationName || 'SmartThings',
                    armState: 'disarmed',
                    securityState: 'OK',
                    violatingSensors: [],
                    trigger: null
                };
            }

            // If this event indicates an intrusion, update the state to VIOLATION.
            if (isIntrusionEvent) {
                const newSensor = { name: message.triggerName };
                const currentSensors = current?.securityState === 'VIOLATION' ? (current.violatingSensors || []) : [];
                const sensorExists = currentSensors.some(s => s.name === newSensor.name);

                return {
                    ...current,
                    locationId: messageLocationId,
                    locationName: current?.locationName || 'SmartThings',
                    armState: newArmState, // arm state might also change
                    securityState: 'VIOLATION',
                    violatingSensors: sensorExists ? currentSensors : [...currentSensors, newSensor],
                    trigger: { name: message.triggerName, type: message.triggerType }
                };
            }

            // Otherwise, it's a standard arming event without an intrusion.
            // Alarm announcements bypass mute — always audible if audio is unlocked
            if (isAudioUnlocked && oldArmState && oldArmState !== newArmState) {
                playTextToSpeech('Alarm armed');
            }
            
            // Preserve violation state if it exists, otherwise set to OK.
            // Don't clear violation on a simple arming event. Only on disarm.
            const isCurrentlyInViolation = current?.securityState === 'VIOLATION';

            return {
                ...current,
                locationId: messageLocationId,
                locationName: current?.locationName || 'SmartThings',
                armState: newArmState,
                securityState: isCurrentlyInViolation ? 'VIOLATION' : 'OK',
                violatingSensors: isCurrentlyInViolation ? (current?.violatingSensors || []) : [],
                trigger: isCurrentlyInViolation ? current.trigger : null,
            };
        });
    }
  }, [addNotification, notifyingSensorIds, localTtsEnabled, isAudioUnlocked, config.sensorAliases, config.sonosNotifications, sonosConnection, stConnection, loadConfig]);

  const handleSonosSseMessage = useCallback((message: any) => {
    const { topic, data } = message;
    if (!topic || data === undefined) return;

    const [uuid, eventType] = topic.split('/');
    if (!uuid || !eventType) return;

    setServiceDevices(current => produce(current, draft => {
        const device = draft.find(d => d.id === uuid);
        if (!device || device.type !== DeviceType.SonosPlayer) return;

        const state = device.state as any;
        switch (eventType) {
            case 'playback-state':
                state.playbackState = data;
                break;
            case 'volume-level':
                state.volume = data.volume;
                break;
            case 'current-track':
                state.currentTrack = {
                    artist: data.artist,
                    title: data.title,
                    albumArtURI: data.albumArtURI,
                    duration: data.duration,
                };
                break;
             case 'play-mode':
                state.playMode = {
                    repeat: data.repeat,
                    shuffle: data.shuffle,
                    crossfade: data.crossfade
                };
                break;
        }
    }));
  }, []);

  const handleSseError = useCallback((url: string | null) => () => {
    setServiceError(`[SSE] Connection error to ${url}. Will attempt to reconnect. Check relay server URL and status.`);
  }, []);

  const handleSseOpen = useCallback(() => {
      // Clear error only if it looks like a connection error, or just clear it generally to be responsive.
      setServiceError(null);
      // Re-fetch all devices to ensure state is fresh after a disconnect/reconnect cycle
      fetchDevicesFromServices();
  }, [fetchDevicesFromServices]);

  const { state: stSseState, retryNow: retryStSse } = useSSE(stSseUrl, handleStSseMessage, handleSseError(stSseUrl), handleSseOpen);
  const { state: sonosSseState, retryNow: retrySonosSse } = useSSE(sonosSseUrl, handleSonosSseMessage, handleSseError(sonosSseUrl), handleSseOpen);

  // Combine connection states - show worst state between SmartThings and Sonos
  const connectionState: SSEConnectionState = useMemo(() => {
    const states = [stSseState.connectionState, sonosSseState.connectionState];
    if (states.includes('reconnecting')) return 'reconnecting';
    if (states.includes('connecting')) return 'connecting';
    if (states.includes('disconnected')) return 'disconnected';
    return 'connected';
  }, [stSseState.connectionState, sonosSseState.connectionState]);

  // Show the countdown for whichever is actively reconnecting
  const connectionRetryCountdown = useMemo(() => {
    if (stSseState.connectionState === 'reconnecting' && stSseState.retryCountdown !== null) {
      return stSseState.retryCountdown;
    }
    if (sonosSseState.connectionState === 'reconnecting' && sonosSseState.retryCountdown !== null) {
      return sonosSseState.retryCountdown;
    }
    return null;
  }, [stSseState, sonosSseState]);

  // Retry all connections
  const retryConnection = useCallback(() => {
    if (stSseState.connectionState !== 'connected') {
      retryStSse();
    }
    if (sonosSseState.connectionState !== 'connected') {
      retrySonosSse();
    }
    // Also clear any lingering error message
    setServiceError(null);
  }, [stSseState.connectionState, sonosSseState.connectionState, retryStSse, retrySonosSse]);

  const haUnsubsRef = useRef<Array<() => void>>([]);
  const haSensorRefreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // HA-only: Home Assistant is always the alarm provider.
  const primaryAlarmProviderRef = useRef<'st' | 'ha'>('ha');

  // Expose connection-state and last-event timestamp for Admin UI status badge / stale-data detection
  const [haWsState, setHaWsState] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [lastHaEventAt, setLastHaEventAt] = useState<Date | null>(null);

  // List of HA entity_ids that Alarmo is configured to monitor. Fetched via the
  // `alarmo/sensors` WebSocket command after auth. In HA mode this list — not
  // the user-edited notifyingSensorIds — drives both readiness and sensor TTS,
  // so the user only configures spoken aliases (the *what* comes from Alarmo).
  const [haAlarmoSensors, setHaAlarmoSensors] = useState<string[]>([]);
  const haAlarmoSensorsRef = useRef<string[]>([]);
  useEffect(() => { haAlarmoSensorsRef.current = haAlarmoSensors; }, [haAlarmoSensors]);
  const haAlarmoSensorsMsgIdRef = useRef<number | null>(null);

  const connectHaWebSocket = useCallback(() => {
    // HA-only: the websocket is same-origin and always available — never gate
    // realtime on a configured/enabled "connection". Without this the alarm
    // state never populates and haWsState stays 'disconnected'.
    console.log('[HA WS] Connecting via home-assistant-js-websocket');
    setHaWsState('connecting');

    // Fetch Alarmo's configured sensor list via the alarmo/sensors WS command.
    // The response is `{ entity_id: {...} }`.
    const requestAlarmoSensors = async () => {
        try {
            const conn = await haClient.getConnection();
            const result: any = await conn.sendMessagePromise({ type: 'alarmo/sensors' });
            if (result && typeof result === 'object') {
                const entityIds = Object.keys(result);
                console.log(`[HA WS] Alarmo monitors ${entityIds.length} sensor(s).`);
                setHaAlarmoSensors(entityIds);
            }
        } catch (e) {
            console.warn('[HA WS] alarmo/sensors request failed:', e);
        }
    };

    // Process an HA event payload that mirrors the legacy raw-socket shape.
    const handleEvent = (eventType: string | undefined, eventData: any) => {
            if (eventType === 'state_changed') {
                const { entity_id, new_state } = eventData;
                if (!new_state) return;
                setLastHaEventAt(new Date());

                // HA-only: match the alarm panel by configured entity if set,
                // otherwise treat any alarm_control_panel entity as the panel
                // (robust to naming and to deviceMap not yet being populated when
                // this handler closure was created). HA is always the provider.
                const configuredAlarm = haConnection?.haAlarmEntityId;
                const isAlarmEntity = configuredAlarm
                    ? entity_id === configuredAlarm
                    : typeof entity_id === 'string' && entity_id.startsWith('alarm_control_panel.');

                if (isAlarmEntity) {
                    const haState = new_state.state as string;
                    const attrs = new_state.attributes || {};

                    // 'arming' and 'pending' are transient — map to their destination arm state
                    // but keep special delay fields so the UI can show countdowns
                    const isTransient = haState === 'arming' || haState === 'pending';
                    const targetArmState = isTransient
                        ? normalizeArmState(attrs.arm_mode || haState)
                        : normalizeArmState(haState);

                    // Build violating sensors from open_sensors attribute
                    const openSensors: Record<string, string> = attrs.open_sensors || {};
                    const violatingSensors = Object.keys(openSensors).map(entityId => {
                        // Try to resolve entity_id to a friendly name from the loaded devices
                        return { name: entityId }; // will be enriched below via deviceMap
                    });

                    setServiceDevices(current => {
                        // Enrich violating sensor names using current device list
                        const enriched = Object.keys(openSensors).map(eid => {
                            const d = current.find(dev => dev.id === eid);
                            return { name: d?.name || eid };
                        });
                        return current; // state update happens below via setSthmState
                        void enriched; // used below
                    });

                    // Enrich violating sensor names (synchronous — deviceMap is a ref-stable memo)
                    const enrichedViolators = Object.keys(openSensors).map(eid => {
                        const d = deviceMap.get(eid);
                        return { name: d?.name || eid };
                    });

                    setSthmState(current => {
                        const prev = current;
                        // Both 'pending' (entry delay) and 'triggered' show the disarm modal
                        const isViolation = haState === 'triggered' || haState === 'pending';
                        const newState: STHMState = {
                            locationId: 'ha-default',
                            locationName: 'Home Assistant',
                            armState: targetArmState,
                            securityState: isViolation
                                ? 'VIOLATION'
                                : (haState === 'disarmed' ? 'OK' : (prev?.securityState ?? 'OK')),
                            violatingSensors: isViolation ? enrichedViolators : (haState === 'disarmed' ? [] : (prev?.violatingSensors ?? [])),
                            trigger: isViolation && enrichedViolators.length > 0
                                ? { name: enrichedViolators[0].name, type: 'sensor' }
                                : (haState === 'disarmed' ? null : prev?.trigger),
                            source: 'ha',
                            haOpenSensors: Object.keys(openSensors).length > 0 ? openSensors : null,
                            haAvailableModes: prev?.haAvailableModes,
                            haArmError: prev?.haArmError,
                            haExitDelay: haState === 'arming' ? (typeof attrs.delay === 'number' ? attrs.delay : null) : null,
                            haEntryDelay: haState === 'pending' ? (typeof attrs.delay === 'number' ? attrs.delay : null) : null,
                        };
                        return newState;
                    });

                    // TTS on arm state transitions
                    if (isAudioUnlocked) {
                        if (haState === 'disarmed') {
                            playTextToSpeech('Alarm disarmed');
                        } else if (haState === 'armed_away' || haState === 'armed_home' || haState === 'armed_night') {
                            playTextToSpeech('Alarm armed');
                        } else if (haState === 'triggered') {
                            // escalateToFullAlarm will handle Sonos + native siren
                        }
                    }

                    // On 'triggered': fire full alarm immediately (Alarmo owns the delay, no frontend timer)
                    if (haState === 'triggered') {
                        const triggerName = enrichedViolators[0]?.name || 'Unknown sensor';
                        escalateToFullAlarm(triggerName);
                    }

                    // On 'disarmed': clear native siren (entry-delay modal cleared by Dashboard watching sthmState)
                    if (haState === 'disarmed') {
                        try {
                            const f = (window as any).fully;
                            if (typeof f?.alarmOff === 'function') f.alarmOff();
                        } catch (e) { /* non-fatal */ }
                    }

                    return;
                }

                // Regular device state update
                const updatedDevice = mapHaEntityToInternalDevice(new_state);
                if (updatedDevice) {
                    // Sensor TTS notifications (same logic as ST SSE path)
                    const alias = config.sensorAliases?.[entity_id];
                    const nameToSpeak = (alias || updatedDevice.name).trim();
                    // notifyingSensorIds is the user-managed TTS list (configured on the
                    // Notifications admin tab), independent from Alarmo's alarm-trigger
                    // sensor list. Both providers use this for spoken sensor announcements.
                    const notifyingSensors = notifyingSensorIdsRef.current;
                    if (notifyingSensors.includes(entity_id) && isAudioUnlocked && localTtsEnabled) {
                        if (updatedDevice.type === DeviceType.ContactSensor) {
                            // Announce both open and close, matching the ST SSE path.
                            playTextToSpeech(`${nameToSpeak} ${updatedDevice.state === true ? 'opened' : 'closed'}`);
                        } else if (updatedDevice.type === DeviceType.MotionSensor && updatedDevice.state === true) {
                            playTextToSpeech(`Motion detected at ${nameToSpeak}`);
                        } else if (updatedDevice.type === DeviceType.WaterSensor && updatedDevice.state === true) {
                            playTextToSpeech(`Water detected at ${nameToSpeak}`);
                        }
                    }

                    setServiceDevices(current => produce(current, draft => {
                        const deviceIndex = draft.findIndex(d => d.id === entity_id);
                        if (deviceIndex !== -1) {
                            draft[deviceIndex].state = updatedDevice.state;
                            if (updatedDevice.battery !== undefined) {
                                draft[deviceIndex].battery = updatedDevice.battery;
                            }
                        }
                    }));
                }

            } else if (eventType === 'alarmo_failed_to_arm') {
                const { reason, sensors } = eventData || {};
                setSthmState(current => current ? {
                    ...current,
                    haArmError: { reason: reason || 'unknown', sensors: sensors || [] }
                } : current);
                // Auto-clear after 10 seconds
                setTimeout(() => {
                    setSthmState(current => current ? { ...current, haArmError: null } : current);
                }, 10000);

            } else if (eventType === 'alarmo_ready_to_arm_modes_updated') {
                const { modes } = eventData || {};
                if (Array.isArray(modes)) {
                    setSthmState(current => current ? { ...current, haAvailableModes: modes } : current);
                }
            }
    };

    (async () => {
        try {
            const conn = await haClient.getConnection();
            // Reflect the real socket state and keep it accurate as the library
            // auto-reconnects, rather than latching a single value.
            setHaWsState(conn.connected ? 'connected' : 'connecting');
            const onReady = () => setHaWsState('connected');
            const onDisc = () => setHaWsState('connecting');
            conn.addEventListener('ready', onReady);
            conn.addEventListener('disconnected', onDisc);
            haUnsubsRef.current.push(() => {
                conn.removeEventListener('ready', onReady);
                conn.removeEventListener('disconnected', onDisc);
            });

            // Realtime entity state via the library's entity subscription.
            // It emits the full entity collection on each change; we synthesize
            // per-entity state_changed events by diffing against the prior snapshot.
            let prevEntities: Record<string, any> = {};
            const unsubEntities = await haClient.subscribeEntities((entities: any) => {
                for (const entityId of Object.keys(entities)) {
                    const newEnt = entities[entityId];
                    const oldEnt = prevEntities[entityId];
                    if (!oldEnt || oldEnt.state !== newEnt.state || oldEnt.last_updated !== newEnt.last_updated) {
                        handleEvent('state_changed', { entity_id: entityId, new_state: newEnt });
                    }
                }
                prevEntities = entities;
            });
            haUnsubsRef.current.push(unsubEntities);
            setHaWsState('connected');

            // Alarmo custom events + sensor list are best-effort: if Alarmo is
            // not installed these must NOT knock the connection to
            // 'disconnected'. The core entity subscription above is what matters.
            try {
                const unsubFail = await conn.subscribeEvents(
                    (ev: any) => handleEvent('alarmo_failed_to_arm', ev?.data),
                    'alarmo_failed_to_arm'
                );
                haUnsubsRef.current.push(unsubFail);
                const unsubModes = await conn.subscribeEvents(
                    (ev: any) => handleEvent('alarmo_ready_to_arm_modes_updated', ev?.data),
                    'alarmo_ready_to_arm_modes_updated'
                );
                haUnsubsRef.current.push(unsubModes);
                requestAlarmoSensors();
                if (haSensorRefreshTimerRef.current) clearInterval(haSensorRefreshTimerRef.current);
                haSensorRefreshTimerRef.current = setInterval(requestAlarmoSensors, 30000);
            } catch (e) {
                console.warn('[HA WS] Alarmo subscriptions unavailable (Alarmo not installed?):', e);
            }
        } catch (e) {
            console.warn('[HA WS] Connection failed:', e);
            setHaWsState('disconnected');
            setLastHaEventAt(null);
        }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [haConnection, useDemoMode]);

  const teardownHa = useCallback(() => {
    haUnsubsRef.current.forEach(unsub => { try { unsub(); } catch { /* ignore */ } });
    haUnsubsRef.current = [];
    if (haSensorRefreshTimerRef.current) { clearInterval(haSensorRefreshTimerRef.current); haSensorRefreshTimerRef.current = null; }
    setHaWsState('disconnected');
  }, []);

  useEffect(() => {
    // HA is always-on (same-origin). Connect the realtime websocket
    // unconditionally so device state stays live.
    connectHaWebSocket();
    return () => {
        teardownHa();
    };
  }, [connectHaWebSocket, teardownHa]);

  useEffect(() => {
    // For HA provider: derive readiness from Alarmo's configured sensor list
    // (fetched via the alarmo/sensors WS command). Alarmo's open_sensors
    // attribute can't be used here because it's empty while disarmed even
    // when doors are open. Any sensor in the Alarmo list reporting on/open
    // → not ready.
    // HA-only: derive readiness from Alarmo's configured sensor list.
    {
        if (haAlarmoSensors.length === 0) {
            setArmingState('no_sensors');
            return;
        }
        const anyOpen = haAlarmoSensors.some(id => {
            const d = deviceMap.get(id);
            return d ? !!d.state : false;
        });
        setArmingState(anyOpen ? 'not_ready' : 'ready');
        return;
    }

    if (!armingStatusDeviceId) {
        setArmingState('no_sensors');
        return;
    }
    const sourceDevice = deviceMap.get(armingStatusDeviceId);
    if (!sourceDevice) {
        setArmingState('not_ready');
        return;
    }

    // Determine 'Ready' state based on device type
    let isReady = false;

    const isSensorType = [
        DeviceType.ContactSensor,
        DeviceType.MotionSensor,
        DeviceType.OccupancySensor,
        DeviceType.WaterSensor,
        DeviceType.SmokeDetector,
        DeviceType.CarbonMonoxideDetector,
        DeviceType.Valve
    ].includes(sourceDevice.type);

    if (isSensorType) {
        // For sensors: False/Closed/Inactive usually means Secure/Ready
        // State is true if Open/Active/Wet
        isReady = !sourceDevice.state;
    } else if (sourceDevice.type === DeviceType.Lock) {
        // For locks: True (Locked) means Secure/Ready
        isReady = !!sourceDevice.state;
    } else {
        // For Switches/Virtuals: Default to 'On' = 'Ready'
        isReady = !!sourceDevice.state;
    }

    setArmingState(isReady ? 'ready' : 'not_ready');
  }, [devices, deviceMap, armingStatusDeviceId, config.primaryAlarmProvider, sthmState?.haOpenSensors, haAlarmoSensors]);

  // Record arm-state transitions from ANY source (external SmartThings
  // app / hub / schedule / voice / a different panel) into sthmHistory
  // so the AlarmHistoryTile keeps growing. The local setSTHMStatus
  // path already pushes for THIS panel's button presses; this effect
  // covers everything else.
  //
  // Dedupe: skip if the most recent history event already has the
  // same status within the last 10 seconds. Catches:
  //   - the same WebSocket event being processed by multiple panels
  //     (each panel sees the broadcast and races on save; whichever
  //     wins, the others' duplicate-write is suppressed)
  //   - setSTHMStatus pushing the status, then the WebSocket echo
  //     coming back and trying to push again
  useEffect(() => {
    const prev = prevArmStateRef.current;
    const curr = sthmState?.armState;
    if (prev !== undefined && curr && prev !== curr) {
      setConfig(produce(draft => {
        if (!draft.sthmHistory) draft.sthmHistory = [];
        const last = draft.sthmHistory[0];
        const nowMs = Date.now();
        if (last && last.status === curr) {
          const lastMs = new Date(last.timestamp).getTime();
          if (!Number.isNaN(lastMs) && nowMs - lastMs < 10_000) return;
        }
        draft.sthmHistory.unshift({
          timestamp: new Date().toISOString(),
          status: curr,
        });
        if (draft.sthmHistory.length > 10) {
          draft.sthmHistory = draft.sthmHistory.slice(0, 10);
        }
      }));
    }
    prevArmStateRef.current = curr;
  }, [sthmState?.armState]);

  useEffect(() => {
    const newDeviceMap = new Map<string, Device>();
    devices.forEach(d => newDeviceMap.set(d.id, d));
    setDeviceMap(newDeviceMap);
  }, [devices])

  const unlockAudio = useCallback(() => {
      console.log("[Audio] Unlocking audio context via user interaction.");
      setAudioUnlocked(true);
      // Explicitly prime the speech synthesis engine with a non-empty utterance (space).
      // Empty strings '' are often optimized out by browsers like Chrome, failing to wake the engine.
      if (typeof window !== 'undefined' && window.speechSynthesis) {
          const utterance = new SpeechSynthesisUtterance(' ');
          utterance.volume = 0;
          window.speechSynthesis.speak(utterance);
      }
  }, []);

  const validatePin = useCallback((pin: string) => {
      return users.some(u => u.pin === pin);
  }, [users]);
  
  const requestPin = useCallback((onConfirm: (pin: string) => void) => {
      setPinRequest({ onConfirm });
  }, []);

  const handlePinConfirm = (pin: string): Promise<boolean> => {
      return new Promise(resolve => {
          if (validatePin(pin) && pinRequest) {
              pinRequest.onConfirm(pin);
              setPinRequest(null);
              resolve(true);
          } else {
              resolve(false);
          }
      });
  };

  const requestConfirmation = useCallback((message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmRequest({ message, resolve });
    });
  }, []);

  const handleConfirmModalClose = useCallback((confirmed: boolean) => {
    if (confirmRequest) {
      confirmRequest.resolve(confirmed);
      setConfirmRequest(null);
    }
  }, [confirmRequest]);

  const requestInput = useCallback((message: string, initialValue: string = '', type: 'text' | 'password' | 'number' = 'text') => {
    return new Promise<string | null>((resolve) => {
        setInputRequest({ message, initialValue, type, resolve });
    });
  }, []);

  const handleInputModalClose = useCallback((value: string | null) => {
      if (inputRequest) {
          inputRequest.resolve(value);
          setInputRequest(null);
      }
  }, [inputRequest]);

  const addPanel = useCallback((name: string) => {
    const newPanelId = `panel-${Date.now()}`;
    const newPanel: DashboardPanel = { id: newPanelId, name, tiles: [], highlights: [], columns: 8, rowHeight: 120, showSTHMAlerts: false, showArmingStatus: false, themeMode: 'dark' };
    setConfig(current => produce(current, draft => {
        draft.panels.push(newPanel);
    }));
    return newPanelId;
  }, []);

  const removePanel = useCallback(async (panelId: string): Promise<boolean> => {
    const panelsInFolder = config.panels.filter(p => p.parentId === panelId);
    if (panelsInFolder.length > 0) {
        addNotification("Cannot delete a panel that contains folders. Please move or delete them first.", 'warning');
        return false;
    }

    const panelToDelete = config.panels.find(p => p.id === panelId);
    if (!panelToDelete) return false;

    const message = panelToDelete.tiles.length > 0
        ? `Panel "${panelToDelete.name}" is not empty. Are you sure you want to delete it and all its tiles? This cannot be undone.`
        : `Are you sure you want to delete panel "${panelToDelete.name}"? This cannot be undone.`;

    const confirmed = await requestConfirmation(message);
    if (!confirmed) {
        return false;
    }

    setConfig(current => produce(current, draft => {
        draft.panels = draft.panels.filter(p => p.id !== panelId);
        draft.virtualDevices = draft.virtualDevices.filter(d => 
            !(d.type === DeviceType.Folder && (d.state as any)?.panelId === panelId)
        );
        draft.panels.forEach(p => {
            p.tiles = p.tiles.filter(t => !draft.virtualDevices.some(vd => vd.id === t.deviceId && vd.type === DeviceType.Folder && (vd.state as any)?.panelId === panelId));
        });
    }));
    return true;
  }, [config.panels, config.virtualDevices, requestConfirmation, addNotification]);

  const renamePanel = useCallback((panelId: string, newName: string) => {
    setConfig(produce(draft => {
        const panel = draft.panels.find(p => p.id === panelId);
        if (panel) {
            panel.name = newName;
        }

        // Also update the label on any tile that links to this folder
        draft.panels.forEach(p => {
            (p.tiles || []).forEach(t => {
                const deviceId = t.deviceId;
                if (deviceId.startsWith('virtual-folder-')) {
                    const linkedPanelId = `panel-${deviceId.substring('virtual-folder-'.length)}`;
                    if (linkedPanelId === panelId) {
                        t.label = newName;
                    }
                }
            });
        });

        // This part only works for "real" virtual devices, which is fine.
        const folderDevice = draft.virtualDevices.find(d => d.type === DeviceType.Folder && (d.state as any)?.panelId === panelId);
        if (folderDevice) {
            folderDevice.name = newName;
        }
    }));
  }, []);

  const clonePanel = useCallback((panelId: string, newName: string) => {
    const sourcePanel = panels.find(p => p.id === panelId);
    if (!sourcePanel) return;
    const newPanel: DashboardPanel = {
        id: `panel-${Date.now()}`,
        name: newName,
        parentId: sourcePanel.parentId,
        tiles: sourcePanel.tiles.map(tile => ({
            ...tile,
            id: `tile-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        })),
        highlights: sourcePanel.highlights?.map(h => ({ ...h, id: `highlight-${Date.now()}-${Math.random().toString(36).substr(2, 9)}` })),
        columns: sourcePanel.columns,
        rowHeight: sourcePanel.rowHeight,
        showSTHMAlerts: sourcePanel.showSTHMAlerts,
        themeMode: sourcePanel.themeMode,
    };

    setConfig(produce(draft => {
        draft.panels.push(newPanel);
    }));
  }, [panels]);


  const updatePanelTiles = useCallback((panelId: string, tiles: TileConfig[]) => {
      setConfig(currentConfig => produce(currentConfig, draft => {
          const panel = draft.panels.find(p => p.id === panelId);
          if (panel) {
              panel.tiles = tiles;
          }
      }));
  }, []);
  
  const updatePanelHighlights = useCallback((panelId: string, highlights: HighlightSectionConfig[]) => {
      setConfig(produce(draft => {
          const panel = draft.panels.find(p => p.id === panelId);
          if (panel) {
              panel.highlights = highlights;
          }
      }));
  }, []);

  const updatePanelConfig = useCallback((panelId: string, updates: Partial<Omit<DashboardPanel, 'id'>>) => {
      setConfig(produce(draft => {
          const panel = draft.panels.find(p => p.id === panelId);
          if (panel) {
              Object.assign(panel, updates);
          }
      }));
  }, []);

  const updateTileConfig = useCallback((panelId: string, tileId: string, newConfig: Partial<Omit<TileConfig, 'id' | 'deviceId'>>) => {
      setConfig(currentConfig => produce(currentConfig, draft => {
          const panel = draft.panels.find(p => p.id === panelId);
          if (panel) {
              const tileIndex = panel.tiles.findIndex(t => t.id === tileId);
              if (tileIndex !== -1) {
                  // Create a temporary array with the new width/height/etc. applied
                  const tempTiles = produce(panel.tiles, tempDraft => {
                      Object.assign(tempDraft[tileIndex], newConfig);
                  });

                  // Run the collision resolution algorithm on the temporary layout
                  const resolvedTiles = resolveTileCollisions(
                      tempTiles,
                      tileId,
                      panel.columns || 8
                  );

                  // Replace the original tiles with the new, collision-free layout
                  panel.tiles = resolvedTiles;
              }
          }
      }));
  }, []);

  const addTileToPanel = useCallback((panelId: string, deviceId: string, position?: { x: number, y: number }) => {
      setConfig(currentConfig => produce(currentConfig, draft => {
          const panel = draft.panels.find(p => p.id === panelId);
          if (panel) {
              const tileW = 1;
              const tileH = 1;
              let finalX = position?.x;
              let finalY = position?.y;

              if (finalX === undefined || finalY === undefined) {
                  const grid: boolean[][] = Array(200).fill(null).map(() => Array(panel.columns || 8).fill(false));
                  panel.tiles.forEach(t => {
                      for (let i = 0; i < (t.height || 1); i++) {
                          for (let j = 0; j < (t.width || 1); j++) {
                              if ((t.y! + i) < grid.length && (t.x! + j) < grid[0].length) {
                                  grid[t.y! + i][t.x! + j] = true;
                              }
                          }
                      }
                  });
                  let placed = false;
                  for (let y = 0; y < grid.length; y++) {
                      for (let x = 0; x < (panel.columns || 8); x++) {
                          if (!grid[y][x]) {
                              finalX = x;
                              finalY = y;
                              placed = true;
                              break;
                          }
                      }
                      if (placed) break;
                  }
              }

              const newTile: TileConfig = {
                  id: `tile-${Date.now()}`,
                  deviceId: deviceId,
                  width: tileW,
                  height: tileH,
                  x: finalX ?? 0,
                  y: finalY ?? 0,
              };
              panel.tiles.push(newTile);
          }
      }));
  }, []);

  const removeTileFromPanel = useCallback((panelId: string, tileId: string) => {
      setConfig(currentConfig => produce(currentConfig, draft => {
          const panel = draft.panels.find(p => p.id === panelId);
          if (panel) {
              panel.tiles = panel.tiles.filter(t => t.id !== tileId);
          }
      }));
  }, []);
  
  const addHighlightToPanel = useCallback((panelId: string) => {
    const newHighlight: HighlightSectionConfig = {
        id: `highlight-${Date.now()}`,
        x: 0,
        y: 0,
        width: 2,
        height: 2,
        label: 'New Section',
        backgroundStyle: 'default',
        glowColor: '#ffffff'
    };
    setConfig(produce(draft => {
        const panel = draft.panels.find(p => p.id === panelId);
        if (panel) {
            if (!panel.highlights) {
                panel.highlights = [];
            }
            panel.highlights.push(newHighlight);
        }
    }));
  }, []);

  const removeHighlightFromPanel = useCallback((panelId: string, highlightId: string) => {
    setConfig(produce(draft => {
        const panel = draft.panels.find(p => p.id === panelId);
        if (panel && panel.highlights) {
            panel.highlights = panel.highlights.filter(h => h.id !== highlightId);
        }
    }));
  }, []);

  const updateHighlightConfig = useCallback((panelId: string, highlightId: string, updates: Partial<Omit<HighlightSectionConfig, 'id'>>) => {
      setConfig(produce(draft => {
          const panel = draft.panels.find(p => p.id === panelId);
          if (panel && panel.highlights) {
              const highlight = panel.highlights.find(h => h.id === highlightId);
              if (highlight) {
                  Object.assign(highlight, updates);
              }
          }
      }));
  }, []);

  const updateDeviceState = useCallback(async (deviceId: string, newState: Device['state']) => {
    const device = allDevicesForUpdate.current.find(d => d.id === deviceId);
    if (!device) return;

    if (useDemoMode) {
      const updatedDevice = await demoService.setDeviceState(deviceId, newState);
      if (updatedDevice.service !== DeviceService.Virtual) {
          setServiceDevices(current => produce(current, draft => {
              const devIndex = draft.findIndex(d => d.id === deviceId);
              if (devIndex > -1) {
                  draft[devIndex] = updatedDevice;
              }
          }));
      }
    } else {
        if (device.service === DeviceService.SmartThings) {
            const stConnection = connections.find(c => c.id === DeviceService.SmartThings && c.enabled);
            if (stConnection && device.locationId) {
                try {
                    const commands: any[] = [];
                    switch (device.type) {
                        case DeviceType.Switch:
                        case DeviceType.Light:
                        case DeviceType.SmartPlug:
                        case DeviceType.Scene:
                            commands.push({ component: 'main', capability: 'switch', command: newState ? 'on' : 'off', arguments: [] });
                            break;
                        case DeviceType.Valve:
                            commands.push({ component: 'main', capability: 'valve', command: newState ? 'open' : 'close', arguments: [] });
                            break;
                        case DeviceType.Siren:
                            commands.push({ component: 'main', capability: 'alarm', command: newState ? 'siren' : 'off', arguments: [] });
                            break;
                        case DeviceType.Dimmer:
                            let targetLevel: number;
                            if (typeof newState === 'boolean') {
                                targetLevel = newState ? 100 : 0;
                            } else {
                                targetLevel = newState as number;
                            }
                            commands.push({ component: 'main', capability: 'switchLevel', command: 'setLevel', arguments: [targetLevel] });
                            break;
                        case DeviceType.Shade:
                            commands.push({ component: 'main', capability: 'windowShadeLevel', command: 'setShadeLevel', arguments: [newState as number] });
                            break;
                        case DeviceType.Lock:
                            commands.push({ component: 'main', capability: 'lock', command: newState ? 'lock' : 'unlock', arguments: [] });
                            break;
                        case DeviceType.Thermostat:
                            const state = newState as { mode: string, setpoint: number };
                            commands.push({ component: 'main', capability: 'thermostatMode', command: 'setThermostatMode', arguments: [state.mode] });
                            if (state.mode === 'cool' || state.mode === 'heat') {
                                const cap = state.mode === 'cool' ? 'thermostatCoolingSetpoint' : 'thermostatHeatingSetpoint';
                                const cmd = state.mode === 'cool' ? 'setCoolingSetpoint' : 'setHeatingSetpoint';
                                commands.push({ component: 'main', capability: cap, command: cmd, arguments: [state.setpoint] });
                            }
                            break;
                        default:
                             throw new Error(`Control for device type ${device.type} is not implemented.`);
                    }
                    
                    if (commands.length > 0) {
                        await smartThingsService.setDeviceState(deviceId, device.locationId, commands, stConnection);
                        setServiceDevices(current => produce(current, draft => {
                            const dev = draft.find(d => d.id === deviceId);
                            if (dev) dev.state = newState;
                        }));
                    }

                } catch (error) {
                    console.error("Failed to set SmartThings device state:", error);
                    const errorMessage = (error as Error).message;
                    setServiceError(`[SmartThings] ${errorMessage}`);
                }
            }
        } else if (device.service === DeviceService.HomeAssistant) {
            const haConnection = connections.find(c => c.id === DeviceService.HomeAssistant && c.enabled);
            if (haConnection) {
                try {
                    await homeAssistantService.setDeviceState(deviceId, newState, haConnection);
                    setServiceDevices(current => produce(current, draft => {
                        const dev = draft.find(d => d.id === deviceId);
                        if (dev) dev.state = newState;
                    }));
                } catch (error) {
                    console.error("Failed to set Home Assistant device state:", error);
                    const errorMessage = (error as Error).message;
                    setServiceError(`[Home Assistant] ${errorMessage}`);
                }
            }
        } else if (device.service === DeviceService.Lutron) {
            try {
                let command;
                if (device.type === 'DIMMER' || device.type === 'SWITCH' || device.type === 'SHADE') {
                    if (newState && typeof newState === 'object') {
                        command = newState;
                    } else {
                        command = { level: newState };
                    }
                } else if (device.type === 'KEYPAD') {
                    command = { action: 'PressAndRelease' };
                } else {
                    return; // Not controllable
                }
                await apiSendLutronCommand(deviceId, command);
                // Optimistically update local state while we wait for LEAP to confirm
                setServiceDevices(current => produce(current, draft => {
                    const dev = draft.find(d => d.id === deviceId);
                    if (dev) {
                        const existing = dev.state;
                        if (existing && typeof existing === 'object' && newState && typeof newState === 'object') {
                            dev.state = { ...existing, ...newState } as any;
                        } else {
                            dev.state = newState;
                        }
                    }
                }));
                // State update will be corrected via WebSocket when the processor reports back
            } catch (error) {
                console.error("Failed to set Lutron device state:", error);
                const errorMessage = (error as Error).message;
                setServiceError(`[Lutron] ${errorMessage}`);
            }
        }
    }
  }, [useDemoMode, connections]);

  const triggerScene = useCallback((deviceId: string) => {
      console.log(`Triggering scene: ${deviceId}`);
      
      const device = allDevicesForUpdate.current.find(d => d.id === deviceId);
      if (!device) return;

      if (!useDemoMode) {
          updateDeviceState(deviceId, true);
          return;
      }
      
      setServiceDevices(current => produce(current, draft => {
          const scene = draft.find(d => d.id === deviceId);
          if (scene) scene.state = true;
      }));
      setTimeout(() => {
          setServiceDevices(current => produce(current, draft => {
              const scene = draft.find(d => d.id === deviceId);
              if (scene) scene.state = false;
          }));
      }, 1000);
  }, [useDemoMode, updateDeviceState]);

  const triggerPanicAlarm = useCallback(async (deviceId: string) => {
    const noonlightConn = connections.find(c => c.id === DeviceService.Noonlight && c.enabled);
    if (!noonlightConn || !noonlightConn.apiToken || !noonlightConn.address || !noonlightConn.city || !noonlightConn.state || !noonlightConn.zip || !noonlightConn.name || !noonlightConn.phone) {
        addNotification('Noonlight is not configured. Please check all fields in Admin > Connections.', 'error');
        updateVirtualDevice(deviceId, { state: 'ERROR' });
        setTimeout(() => {
            updateVirtualDevice(deviceId, { state: 'IDLE' });
        }, 5000);
        return;
    }
    
    const pin = await requestInput("Enter Noonlight PIN:", '', 'password');
    if (pin) {
        try {
            await noonlightService.createAlarm(pin);
            addNotification('Noonlight alarm successfully triggered.', 'success');
            updateVirtualDevice(deviceId, { state: 'TRIGGERED' });
            
            setTimeout(() => {
                updateVirtualDevice(deviceId, { state: 'IDLE' });
            }, 30 * 1000);

        } catch (error) {
            console.error("Failed to trigger Noonlight alarm:", error);
            addNotification(`Noonlight Error: ${(error as Error).message}`, 'error');
            updateVirtualDevice(deviceId, { state: 'ERROR' });
            setTimeout(() => {
                updateVirtualDevice(deviceId, { state: 'IDLE' });
            }, 5000);
        }
    }
  }, [connections, addNotification, requestInput]);

  const openDevicePanel = useCallback((deviceId: string) => {
    setActiveDevicePanelId(deviceId);
  }, []);

  const closeDevicePanel = useCallback(() => {
    setActiveDevicePanelId(null);
  }, []);

  const activeDevicePanel = activeDevicePanelId ? (() => {
    const device = deviceMap.get(activeDevicePanelId);
    return device ? { deviceId: activeDevicePanelId, device } : null;
  })() : null;

  const updateConnectionConfig = useCallback((serviceId: DeviceService, field: keyof Omit<ServiceConnection, 'id'>, value: any) => {
    setConfig(current => produce(current, draft => {
      const conn = draft.connections.find(c => c.id === serviceId);
      if (conn) {
        (conn as any)[field] = value;
      }
    }));
  }, []);

  const addUser = useCallback((name: string, pin: string) => {
    const newUser: User = { id: `user-${Date.now()}`, name, pin };
    setConfig(produce(draft => {
        draft.users.push(newUser);
    }));
  }, []);

  const removeUser = useCallback((userId: string) => {
    if (config.users.length <= 1) {
        // FIX: Proactively replaced alert with addNotification for consistency and to prevent errors.
        addNotification("You cannot remove the last user.", 'warning');
        return;
    }
    setConfig(produce(draft => {
        draft.users = draft.users.filter(u => u.id !== userId);
    }));
  }, [config.users.length, addNotification]);

  const addVirtualDevice = useCallback((device: Omit<Device, 'id' | 'service'>) => {
    setConfig(produce(draft => {
        const newDevice: Device = {
            ...device,
            id: `virtual-${Date.now()}`,
            service: DeviceService.Virtual,
            location: 'Virtual',
        };
        draft.virtualDevices.push(newDevice);
        if (newDevice.type === DeviceType.Camera) {
            updateMediamtxConfig(draft);
        }
    }));
  }, []);

  const updateVirtualDevice = useCallback((deviceId: string, updates: Partial<Omit<Device, 'id' | 'service'>>) => {
      setConfig(produce(draft => {
          const deviceIndex = draft.virtualDevices.findIndex(d => d.id === deviceId);
  
          if (deviceIndex !== -1) {
              // It's an existing "real" virtual device, update it.
              Object.assign(draft.virtualDevices[deviceIndex], updates);
          } else {
              // It's a synthetic device being saved for the first time. Create it fully.
              const newDevice: Device = {
                  id: deviceId,
                  service: DeviceService.Virtual,
                  location: 'Virtual',
                  name: updates.name || 'Unnamed Device',
                  type: updates.type || DeviceType.Virtual,
                  state: updates.state === undefined ? false : updates.state,
                  ...updates
              };
              draft.virtualDevices.push(newDevice);
          }
          
          const device = draft.virtualDevices.find(d => d.id === deviceId);
          if (device?.type === DeviceType.Camera || updates.type === DeviceType.Camera) {
              updateMediamtxConfig(draft);
          }
      }));
  }, []);

  const removeVirtualDevice = useCallback((deviceId: string) => {
    setConfig(produce(draft => {
        const device = draft.virtualDevices.find(d => d.id === deviceId);
        const isCamera = device?.type === DeviceType.Camera;

        draft.virtualDevices = draft.virtualDevices.filter(d => d.id !== deviceId);
        draft.panels.forEach(panel => {
            panel.tiles = panel.tiles.filter(tile => tile.deviceId !== deviceId);
        });

        if (isCamera) {
            updateMediamtxConfig(draft);
        }
    }));
  }, []);


  const addMediaItem = useCallback((item: Omit<MediaItem, 'id'>) => {
      const newItem: MediaItem = { ...item, id: `media-${Date.now()}` };
      setConfig(produce(draft => {
          draft.mediaItems.push(newItem);
      }));
  }, []);

  const updateMediaItem = useCallback((mediaId: string, updates: Omit<Partial<MediaItem>, 'id'>) => {
      setConfig(produce(draft => {
          const item = draft.mediaItems.find(m => m.id === mediaId);
          if (item) Object.assign(item, updates);
      }));
  }, []);
  
  const removeMediaItem = useCallback((mediaId: string) => {
      setConfig(produce(draft => {
          draft.mediaItems = draft.mediaItems.filter(m => m.id !== mediaId);
      }));
  }, []);

  const addSonosNotification = useCallback((notification: Omit<SonosNotification, 'id'>) => {
      setConfig(produce(draft => {
          if (!draft.sonosNotifications) draft.sonosNotifications = [];
          const newNotification: SonosNotification = { ...notification, id: `sonos-notif-${Date.now()}` };
          draft.sonosNotifications.push(newNotification);
      }));
  }, []);

  const updateSonosNotification = useCallback((notificationId: string, updates: Partial<Omit<SonosNotification, 'id'>>) => {
      setConfig(produce(draft => {
          const notif = draft.sonosNotifications?.find(n => n.id === notificationId);
          if (notif) Object.assign(notif, updates);
      }));
  }, []);

  const removeSonosNotification = useCallback((notificationId: string) => {
      setConfig(produce(draft => {
          if (draft.sonosNotifications) {
              draft.sonosNotifications = draft.sonosNotifications.filter(n => n.id !== notificationId);
          }
      }));
  }, []);

  const updateDashboardTitle = useCallback((newTitle: string) => {
      setConfig(produce(draft => { draft.dashboardTitle = newTitle; }));
  }, []);

  const updateWeatherZipCode = useCallback((zip: string) => {
    setConfig(produce(draft => { draft.weatherZipCode = zip; }));
  }, []);

  const addFolder = useCallback((panelId: string, folderName: string) => {
    const timestamp = Date.now();
    const newPanelId = `panel-${timestamp}`;
    const newFolderDeviceId = `virtual-folder-${timestamp}`;

    setConfig(produce(draft => {
        // 1. Create the new panel for the folder
        const newPanel: DashboardPanel = { 
            id: newPanelId, 
            name: folderName, 
            tiles: [], 
            highlights: [], 
            columns: 8, 
            rowHeight: 120, 
            showSTHMAlerts: false, 
            showArmingStatus: false,
            parentId: panelId,
            themeMode: 'dark'
        };
        draft.panels.push(newPanel);

        // 2. Create the virtual device for the folder tile
        const newFolderDevice: Device = {
            id: newFolderDeviceId,
            name: folderName,
            type: DeviceType.Folder,
            service: DeviceService.Virtual,
            state: { panelId: newPanelId },
            location: 'Virtual',
        };
        draft.virtualDevices.push(newFolderDevice);

        // 3. Add the folder tile to the parent panel
        const parentPanel = draft.panels.find(p => p.id === panelId);
        if (parentPanel) {
            const tileW = 1;
            const tileH = 1;
            let finalX: number | undefined;
            let finalY: number | undefined;

            const grid: boolean[][] = Array(200).fill(null).map(() => Array(parentPanel.columns || 8).fill(false));
            parentPanel.tiles.forEach(t => {
                if (t.x !== undefined && t.y !== undefined) {
                    for (let i = 0; i < (t.height || 1); i++) {
                        for (let j = 0; j < (t.width || 1); j++) {
                            if ((t.y + i) < grid.length && (t.x + j) < grid[0].length) {
                                grid[t.y + i][t.x + j] = true;
                            }
                        }
                    }
                }
            });

            let placed = false;
            for (let y = 0; y < grid.length; y++) {
                for (let x = 0; x < (parentPanel.columns || 8); x++) {
                    if (!grid[y][x]) {
                        finalX = x;
                        finalY = y;
                        placed = true;
                        break;
                    }
                }
                if (placed) break;
            }

            const newTile: TileConfig = {
                id: `tile-folder-${timestamp}`,
                deviceId: newFolderDeviceId,
                label: folderName,
                width: tileW,
                height: tileH,
                x: finalX ?? 0,
                y: finalY ?? 0,
            };
            parentPanel.tiles.push(newTile);
        }
    }));

    return newPanelId;
  }, []);

  const toggleIpFilter = useCallback(() => {
    setConfig(produce(draft => { draft.ipFilterEnabled = !draft.ipFilterEnabled; }));
  }, []);
  
  const addAllowedIP = useCallback((name: string, ip: string) => {
    const newIP: AllowedIP = { id: `ip-${Date.now()}`, name, ip };
    setConfig(produce(draft => { draft.allowedIPs.push(newIP); }));
  }, []);

  const removeAllowedIP = useCallback((id: string) => {
    setConfig(produce(draft => { draft.allowedIPs = draft.allowedIPs.filter(ip => ip.id !== id); }));
  }, []);

  const updatePanelLayoutConfig = useCallback((panelId: string, updates: { columns?: number, rowHeight?: number }) => {
    setConfig(produce(draft => {
        const panel = draft.panels.find(p => p.id === panelId);
        if (panel) {
            if (updates.columns !== undefined) panel.columns = updates.columns;
            if (updates.rowHeight !== undefined) panel.rowHeight = updates.rowHeight;
        }
    }));
  }, []);

  const setHAAlarmStatus = useCallback(async (
      status: 'DISARMED' | 'ARMED_STAY' | 'ARMED_AWAY',
      options?: { skipDelay?: boolean; force?: boolean; pin?: string }
  ) => {
      const haConn = connections.find(c => c.id === DeviceService.HomeAssistant && c.enabled);
      if (!haConn) {
          setServiceError('[Home Assistant] Connection not enabled.');
          return;
      }
      const armState = status === 'ARMED_STAY' ? 'armedStay' : status === 'ARMED_AWAY' ? 'armedAway' : 'disarmed';
      try {
          // Routed through the api-server proxy — a direct browser → HA REST call
          // is CORS-blocked (HA sends no CORS headers for REST). The PIN entered
          // by the user is forwarded server-side as the Alarmo code.
          const result = await apiHomeAssistantArm(armState, options);
          if (!result.ok) {
              setServiceError(`[Home Assistant] Alarm command failed: ${result.error || 'Unknown error'}`);
          }
          // State will update via HA WebSocket state_changed event — no local setSthmState needed here
      } catch (e) {
          setServiceError(`[Home Assistant] Alarm command failed: ${(e as Error).message}`);
      }
  }, [connections]);

  const updatePrimaryAlarmProvider = useCallback((provider: 'st' | 'ha') => {
      setConfig(produce(draft => { draft.primaryAlarmProvider = provider; }));
  }, []);

  const setAlarmStatus = useCallback(async (status: 'DISARMED' | 'ARMED_STAY' | 'ARMED_AWAY', pin?: string) => {
      // HA-only: always route arm/disarm to Home Assistant (Alarmo).
      await setHAAlarmStatus(status, pin ? { pin } : undefined);
  }, [setHAAlarmStatus]);

  const updateNotifyingSensorIds = useCallback((ids: string[]) => {
      setConfig(produce(draft => { draft.notifyingSensorIds = ids; }));
  }, []);

  const updateAlarmTriggerSensorIds = useCallback((ids: string[]) => {
      setConfig(produce(draft => { draft.alarmTriggerSensorIds = ids; }));
  }, []);

  const updateEntryDelaySound = useCallback((sound: { mode: 'beep' | 'countdown'; beepStyle?: 'single' | 'double' | 'pulse' }) => {
      setConfig(produce(draft => { draft.entryDelaySound = sound; }));
  }, []);

  const updateAlarmDebug = useCallback((enabled: boolean) => {
      setConfig(produce(draft => { draft.alarmDebug = enabled; }));
  }, []);

  const updateSensorAlias = useCallback((sensorId: string, alias: string) => {
      setConfig(produce(draft => {
          if (!draft.sensorAliases) draft.sensorAliases = {};
          // If the alias is not just whitespace, save it as-is to allow typing spaces.
          // If it IS empty or just whitespace, remove the key to clear the alias.
          if (alias.trim() !== '') {
              draft.sensorAliases[sensorId] = alias;
          } else {
              delete draft.sensorAliases[sensorId];
          }
      }));
  }, []);

  const updateArmingStatusDeviceId = useCallback((deviceId: string | null) => {
      setConfig(produce(draft => { draft.armingStatusDeviceId = deviceId; }));
  }, []);

  const updateMonitoringConfig = useCallback((updates: { enabled?: boolean; webhookUrl?: string }) => {
      setConfig(produce(draft => {
          if (updates.enabled !== undefined) draft.monitoringEnabled = updates.enabled;
          if (updates.webhookUrl !== undefined) draft.monitoringWebhookUrl = updates.webhookUrl;
      }));
  }, []);

  const updateInternetMonitorConfig = useCallback((updates: Partial<InternetMonitorConfig>) => {
      setConfig(produce(draft => {
          if (!draft.internetMonitorConfig) {
              draft.internetMonitorConfig = {
                  enabled: false,
                  checkIntervalSeconds: 60,
                  failureThreshold: 3,
                  rebootCooldownMinutes: 30,
                  postRebootWaitMinutes: 5,
                  smartPlugIp: '',
                  smartPlugEmail: '',
                  smartPlugPassword: '',
                  checkEndpoints: [
                      { type: 'https', target: 'https://www.google.com', description: 'Google HTTPS' },
                      { type: 'https', target: 'https://www.cloudflare.com', description: 'Cloudflare HTTPS' },
                                      { type: 'dns', target: 'google.com', description: 'Google DNS' },
                      { type: 'dns', target: 'cloudflare.com', description: 'Cloudflare DNS' },
                      { type: 'ping', target: '8.8.8.8', description: 'Google DNS Ping' },
                      { type: 'ping', target: '1.1.1.1', description: 'Cloudflare DNS Ping' },
                  ],
                  endpointTimeout: 5,
                  notifyOnFailure: true,
                  notifyOnReboot: true,
                  notifyOnRecovery: true,
              };
          }
          Object.assign(draft.internetMonitorConfig, updates);
      }));
  }, []);

  const updateFishingReportConfig = useCallback((updates: Partial<FishingReportConfig>) => {
      setConfig(produce(draft => {
          if (!draft.fishingReportConfig) {
              // Default to the Kiawah River, SC preset so the tile works out
              // of the box once the user toggles it on. NOAA station 8667062
              // (Kiawah River Bridge) returns on-river predictions.
              draft.fishingReportConfig = {
                  enabled: false,
                  latitude: 32.6033,
                  longitude: -80.1317,
                  stationId: '8667062',
                  timezone: 'America/New_York',
              };
          }
          Object.assign(draft.fishingReportConfig, updates);
      }));
  }, []);

  const updateBatteryReportConfig = useCallback((updates: Partial<BatteryReportConfig>) => {
      setConfig(produce(draft => {
          if (!draft.batteryReportConfig) {
              draft.batteryReportConfig = {
                  enabled: false,
                  dayOfWeek: 'sunday',
                  timeOfDay: '09:00',
                  timezone: 'America/New_York',
                  smtpHost: '',
                  smtpPort: 587,
                  smtpSecure: false,
                  smtpUser: '',
                  smtpPassword: '',
                  fromEmail: '',
                  fromName: 'HomeTile Battery Report',
                  recipientEmails: [],
                  includeAllBatteries: true,
                  lowBatteryThreshold: 20,
                  criticalBatteryThreshold: 10,
                  reportTitle: 'Weekly Battery Status Report',
              };
          }
          Object.assign(draft.batteryReportConfig, updates);
      }));
  }, []);

  const updateBatteryTypeMapping = useCallback((deviceId: string, batteryType: string) => {
      setConfig(produce(draft => {
          if (!draft.batteryTypeMappings) {
              draft.batteryTypeMappings = {};
          }
          if (batteryType === 'Unknown' || batteryType === '') {
              // Remove the mapping to fall back to auto-detection
              delete draft.batteryTypeMappings[deviceId];
          } else {
              draft.batteryTypeMappings[deviceId] = batteryType as any;
          }
      }));
  }, []);

  const updateBatteryQuantityMapping = useCallback((deviceId: string, quantity: number) => {
      setConfig(produce(draft => {
          if (!draft.batteryQuantityMappings) {
              draft.batteryQuantityMappings = {};
          }
          if (quantity <= 1) {
              // Remove the mapping to fall back to default (1)
              delete draft.batteryQuantityMappings[deviceId];
          } else {
              draft.batteryQuantityMappings[deviceId] = quantity;
          }
      }));
  }, []);

  const addCustomBatteryType = useCallback((batteryType: string) => {
      const trimmed = batteryType.trim();
      if (!trimmed) return;
      setConfig(produce(draft => {
          if (!draft.customBatteryTypes) {
              draft.customBatteryTypes = [];
          }
          // Don't add duplicates
          if (!draft.customBatteryTypes.includes(trimmed)) {
              draft.customBatteryTypes.push(trimmed);
          }
      }));
  }, []);

  const removeCustomBatteryType = useCallback((batteryType: string) => {
      setConfig(produce(draft => {
          if (draft.customBatteryTypes) {
              draft.customBatteryTypes = draft.customBatteryTypes.filter(t => t !== batteryType);
          }
      }));
  }, []);

  const sendBroadcastNotification = useCallback(async (message: string) => {
      const stConnection = connections.find(c => c.id === DeviceService.SmartThings && c.enabled);
      if (!stConnection) {
          throw new Error("SmartThings connection not enabled. It is required for broadcasting.");
      }
      await smartThingsService.sendBroadcast(stConnection, message);
  }, [connections]);

  // Helper to manually dismiss intrusion alerts by clearing the violation state
  const dismissIntrusion = useCallback(() => {
      setSthmState(current => {
          if (!current) return null;
          return {
              ...current,
              securityState: 'OK',
              violatingSensors: [],
              trigger: null
          };
      });
  }, []);

  // NEW: Helper to dismiss the generic service/SSE error message
  const dismissServiceError = useCallback(() => {
      setServiceError(null);
  }, []);

  const value = {
      devices,
      deviceMap,
      panels,
      connections,
      users,
      virtualDevices: allVirtualDevices,
      mediaItems,
      dashboardTitle,
      useDemoMode,
      loading: isConfigLoading, // ONLY block UI for initial config load
      isConfigLoading,
      isDeviceLoading,
      sthmState,
      armingState,
      isAudioUnlocked,
      activePanelId,
      ipFilterEnabled,
      allowedIPs,
      notifyingSensorIds: notifyingSensorIds || [],
      sensorAliases: sensorAliases || {},
      ttsNotificationsEnabled: localTtsEnabled,
      sonosNotifications: sonosNotifications || [],
      notifications,
      serviceError,
      configLoadError,
      connectionState,
      connectionRetryCountdown,
      retryConnection,
      armingStatusDeviceId: armingStatusDeviceId || null,
      weatherZipCode: weatherZipCode || '',
      monitoringEnabled: monitoringEnabled || false,
      monitoringWebhookUrl: monitoringWebhookUrl || '',
      mediamtxConfig,
      sthmHistory: sthmHistory || [],
      setActivePanelId,
      unlockAudio,
      requestPin,
      requestConfirmation,
      requestInput,
      addPanel,
      removePanel,
      renamePanel,
      clonePanel,
      updatePanelTiles,
      updatePanelHighlights,
      updatePanelConfig,
      updateTileConfig,
      addTileToPanel,
      removeTileFromPanel,
      addHighlightToPanel,
      removeHighlightFromPanel,
      updateHighlightConfig,
      updateDeviceState,
      triggerScene,
      updateConnectionConfig,
      fetchDevicesFromServices,
      refreshDeviceStatus,
      addUser,
      removeUser,
      validatePin,
      addVirtualDevice,
      updateVirtualDevice,
      removeVirtualDevice,
      addMediaItem,
      updateMediaItem,
      removeMediaItem,
      addSonosNotification,
      updateSonosNotification,
      removeSonosNotification,
      updateDashboardTitle,
      addFolder,
      toggleIpFilter,
      addAllowedIP,
      removeAllowedIP,
      updatePanelLayoutConfig,
      setHAAlarmStatus,
      setAlarmStatus,
      primaryAlarmProvider: 'ha' as const,
      updatePrimaryAlarmProvider,
      haWsState,
      lastHaEventAt,
      haAlarmoSensors,
      updateNotifyingSensorIds,
      alarmTriggerSensorIds: config.alarmTriggerSensorIds || [],
      updateAlarmTriggerSensorIds,
      updateEntryDelaySound,
      alarmDebug: config.alarmDebug ?? false,
      updateAlarmDebug,
      updateSensorAlias,
      toggleTtsNotifications,
      removeNotification,
      addNotification,
      updateArmingStatusDeviceId,
      updateWeatherZipCode,
      updateMonitoringConfig,
      internetMonitorConfig,
      updateInternetMonitorConfig,
      fishingReportConfig,
      updateFishingReportConfig,
      batteryReportConfig,
      updateBatteryReportConfig,
      batteryTypeMappings: config.batteryTypeMappings || {},
      updateBatteryTypeMapping,
      batteryQuantityMappings: config.batteryQuantityMappings || {},
      updateBatteryQuantityMapping,
      customBatteryTypes: config.customBatteryTypes || [],
      addCustomBatteryType,
      removeCustomBatteryType,
      triggerPanicAlarm,
      activeDevicePanel,
      openDevicePanel,
      closeDevicePanel,
      retryConfigLoad: loadConfig,
      sendBroadcastNotification,
      dismissIntrusion,
      dismissServiceError, // ADDED
      escalateToFullAlarm,
      entryDelaySound: config.entryDelaySound || { mode: 'beep', beepStyle: 'single' },
  };

  return (
    <DashboardContext.Provider value={value}>
        {children}
        {pinRequest && <PinPadModal onClose={() => setPinRequest(null)} onConfirm={handlePinConfirm} />}
        {confirmRequest && <ConfirmModal message={confirmRequest.message} onConfirm={() => handleConfirmModalClose(true)} onCancel={() => handleConfirmModalClose(false)} />}
        {inputRequest && <InputModal message={inputRequest.message} initialValue={inputRequest.initialValue} type={inputRequest.type} onConfirm={(val) => handleInputModalClose(val)} onCancel={() => handleInputModalClose(null)} />}
    </DashboardContext.Provider>
  );
};
