import { ServiceConnection } from '../types';
import * as haClient from './haClient';

export type HaArmMode = 'away' | 'home' | 'night' | 'vacation' | 'custom';

export interface HaArmOptions {
    skipDelay?: boolean;
    force?: boolean;
}

// All transport is now the HA WebSocket via haClient. The ServiceConnection
// argument is retained for interface compatibility (alarm entity id / code),
// but URLs and tokens are handled by HA itself (same-origin iframe auth).
class HomeAssistantService {
    async getDevices(_connection?: ServiceConnection): Promise<any[]> {
        const states = await haClient.getStates();
        return Array.isArray(states) ? states : [];
    }

    async testConnection(connection: ServiceConnection): Promise<{ entityCount: number; alarmoFound: boolean }> {
        const entities = await this.getDevices(connection);
        const alarmEntityId = connection.haAlarmEntityId || 'alarm_control_panel.alarmo';
        const alarmoFound = entities.some((e: any) => e.entity_id === alarmEntityId);
        return { entityCount: entities.length, alarmoFound };
    }

    async setDeviceState(deviceId: string, newState: any, _connection?: ServiceConnection): Promise<void> {
        const [domain] = deviceId.split('.');

        let service: string;
        let serviceData: { entity_id: string, [key: string]: any } = { entity_id: deviceId };

        switch (domain) {
            case 'light':
                if (typeof newState === 'number') {
                    if (newState > 0) {
                        service = 'turn_on';
                        serviceData.brightness_pct = newState;
                    } else {
                        service = 'turn_off';
                    }
                } else if (newState && typeof newState === 'object') {
                    // Rich state from DimmerTile color/colorTemp controls.
                    const s = newState as any;
                    if (s.isOn === false || s.level === 0) {
                        service = 'turn_off';
                    } else {
                        service = 'turn_on';
                        if (typeof s.level === 'number') serviceData.brightness_pct = s.level;
                        if (Array.isArray(s.hsColor)) serviceData.hs_color = s.hsColor;
                        else if (typeof s.colorTemp === 'number') serviceData.color_temp_kelvin = s.colorTemp;
                    }
                } else {
                    service = newState ? 'turn_on' : 'turn_off';
                }
                break;
            case 'switch':
            case 'input_boolean':
            case 'fan':
            case 'siren':
                service = newState ? 'turn_on' : 'turn_off';
                break;
            case 'scene':
            case 'automation':
                service = 'turn_on';
                break;
            case 'script':
                service = 'turn_on';
                break;
            case 'cover':
                service = 'set_cover_position';
                serviceData.position = newState as number;
                break;
            case 'valve':
                service = newState ? 'open_valve' : 'close_valve';
                break;
            case 'input_number':
            case 'number':
                service = 'set_value';
                serviceData.value = newState as number;
                break;
            case 'select':
            case 'input_select':
                // Generic mode-select: tap-to-cycle sends the next option string.
                service = 'select_option';
                serviceData.option = String(newState);
                break;
            case 'button':
            case 'input_button':
                // Momentary press — no payload, newState is ignored.
                service = 'press';
                break;
            case 'lock':
                service = newState ? 'lock' : 'unlock';
                break;
            case 'climate':
                if (typeof newState.mode === 'string') {
                    service = 'set_hvac_mode';
                    serviceData.hvac_mode = newState.mode;
                } else if (typeof newState.setpoint === 'number') {
                    service = 'set_temperature';
                    serviceData.temperature = newState.setpoint;
                } else {
                    throw new Error(`Unsupported climate action for ${deviceId}`);
                }
                break;
            default:
                // Generic command routing: an unmapped domain that the UI
                // surfaced as a controllable toggle is driven via HA's
                // near-universal turn_on/turn_off services. Domains that don't
                // support them return an error from HA, surfaced to the user.
                if (typeof newState === 'boolean') {
                    service = newState ? 'turn_on' : 'turn_off';
                } else {
                    throw new Error(`Control for domain '${domain}' is not implemented.`);
                }
                break;
        }

        await haClient.callService(domain, service, serviceData);
    }

    async armAlarm(
        connection: ServiceConnection,
        entityId: string,
        armState: 'armedAway' | 'armedStay' | 'disarmed',
        options?: HaArmOptions
    ): Promise<void> {
        const code = connection?.haAlarmCode || undefined;

        const serviceData: Record<string, any> = { entity_id: entityId };
        let service: string;

        if (armState === 'disarmed') {
            service = 'disarm';
            if (code) serviceData.code = code;
        } else {
            service = 'arm';
            serviceData.mode = armState === 'armedAway' ? 'away' : 'home';
            if (code) serviceData.code = code;
            if (options?.skipDelay) serviceData.skip_delay = true;
            if (options?.force) serviceData.force = true;
        }

        await haClient.callService('alarmo', service, serviceData);
    }

    async skipAlarmDelay(_connection: ServiceConnection, entityId: string): Promise<void> {
        await haClient.callService('alarmo', 'skip_delay', { entity_id: entityId });
    }

    /**
     * Ask HA to re-poll one or more entities (homeassistant.update_entity forces
     * the backing integration to fetch a fresh value). Used by the reconcile poll
     * to hydrate tiles whose entity is stuck 'unavailable'/'unknown' — so a device
     * the cloud/bridge left stale gets a real status back instead of sitting blank.
     * Best-effort: push-only integrations may treat it as a no-op, which is fine.
     */
    async refreshEntities(entityIds: string[]): Promise<void> {
        if (!entityIds.length) return;
        await haClient.callService('homeassistant', 'update_entity', { entity_id: entityIds });
    }

    async controlMediaPlayer(deviceId: string, command: string, value: any, _connection?: ServiceConnection): Promise<void> {
        const serviceData: { entity_id: string, [key: string]: any } = { entity_id: deviceId };
        let service: string;

        switch (command) {
            case 'play': service = 'media_play'; break;
            case 'pause': service = 'media_pause'; break;
            case 'next': service = 'media_next_track'; break;
            case 'previous': service = 'media_previous_track'; break;
            case 'volume':
                service = 'volume_set';
                serviceData.volume_level = (value as number) / 100;
                break;
            default:
                throw new Error(`Unsupported media player command: ${command}`);
        }

        await haClient.callService('media_player', service, serviceData);
    }
}

export const homeAssistantService = new HomeAssistantService();
