import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useDashboard } from '../hooks/useDashboard';
import { Device, DeviceService, DashboardPanel, TileConfig, DeviceType, MediaItem, AllowedIP, ServiceConnection, TileDisplayOverride, TileAnimationConfig, HighlightSectionConfig, SonosNotification, SonosNotificationEventType, BatteryType, IdleMode } from '../types';
import { IconPlus, IconTrash2, IconChevronDown, IconFolder, IconLock, IconExpand, IconAlertTriangle, IconLayoutGrid, IconLightbulb, IconSquare, IconSun, IconThermometer, IconPersonStanding, IconDoorOpen, IconKeyboard, IconFlame, IconShield, IconZap, IconCamera, IconTv, IconVideo, IconX, IconCopy, IconPencil, IconSettings, IconArrowRight, IconLink, IconShieldAlert, IconArrowLeft, IconMusic, IconAlertOctagon, IconHome, IconCloud, IconCloudSun, IconServer, IconHistory, IconRss, IconDroplets, IconQrCode, IconUsers, IconCpu, IconRefreshCw, IconInfo, IconVolume2, IconCat, IconWifi, IconWaves, IconBattery } from './icons';
import { produce } from 'immer';
import Tile from './Tile';
import { useNavigate, useLocation } from 'react-router-dom';
import AdminUserManager from './AdminUserManager';
import KioskScheduleEditor from './KioskScheduleEditor';
import SystemStatusManager from './SystemStatusManager';
import { apiSendTestWebhook, apiTestHomeAssistant, apiBroadcastTts } from '../services/api';
import yaml from 'js-yaml';
import { playTextToSpeech } from '../services/audioPlayer';

// --- HA-only inert stubs for removed non-HA integrations & api-server features.
// The Admin config sub-sections for these integrations no longer apply in the
// HA-only build; their handlers are routed to inert stubs and the corresponding
// tabs/sections have been removed below.
const emptyArrayAsync = async (..._a: any[]): Promise<any[]> => [];
const noopAsync = async (..._a: any[]): Promise<any> => undefined;
const stubHealth = async (..._a: any[]): Promise<any> => ({ ok: false });
const smartThingsService: any = { getLocations: emptyArrayAsync };
const energyTrakService: any = { getConfiguredSites: emptyArrayAsync, getDebug: noopAsync, setDebug: noopAsync, configure: noopAsync, addSite: emptyArrayAsync, removeSite: emptyArrayAsync };
const tempestService: any = { getStations: async () => ({ stations: [] }), configure: noopAsync };
const haywardPoolService: any = { getHealth: stubHealth, configure: noopAsync };
const flairService: any = { getHealth: stubHealth, configure: noopAsync };
const coolMasterService: any = { getHealth: stubHealth, configure: noopAsync };
const poolFloorService: any = { getHealth: stubHealth, configure: noopAsync };
const apiGenerateLutronCsr = async (): Promise<{ csr: string; privateKey: string }> => ({ csr: '', privateKey: '' });
const apiUploadLutronCerts = noopAsync;
const apiUploadLutronCertsManual = noopAsync;
const apiGetLutronStatus = async (): Promise<any> => ({ isPaired: false, isConnected: false });
const apiDiscoverLutronProcessors = async (): Promise<any> => ({ processors: [] });
const apiPairLutron = async (): Promise<any> => ({ ok: false, message: 'Lutron is not available in HA-only mode.' });

// #region Helper Components & Icons

const TilePreviewIcon = ({ type }: { type: DeviceType }) => {
    const iconProps = { className: "w-8 h-8 text-gray-400" };
    switch (type) {
        case DeviceType.Dimmer: case DeviceType.Light: case DeviceType.Switch: return <IconLightbulb {...iconProps} />;
        case DeviceType.SmartPlug: return <IconZap {...iconProps} />;
        case DeviceType.Shade: return <IconSquare {...iconProps} />;
        case DeviceType.Scene: return <IconSun {...iconProps} />;
        case DeviceType.TemperatureSensor: return <IconThermometer {...iconProps} />;
        case DeviceType.MotionSensor: case DeviceType.OccupancySensor: return <IconPersonStanding {...iconProps} />;
        case DeviceType.ContactSensor: return <IconDoorOpen {...iconProps} />;
        case DeviceType.Keypad: return <IconKeyboard {...iconProps} />;
        case DeviceType.Thermostat: return <IconFlame {...iconProps} />;
        case DeviceType.AlarmPanel: return <IconShield {...iconProps} className="w-8 h-8 text-red-400" />;
        case DeviceType.Siren: return <IconShieldAlert {...iconProps} className="w-8 h-8 text-orange-400" />;
        case DeviceType.Lock: return <IconLock {...iconProps} className="w-8 h-8 text-cyan-400" />;
        case DeviceType.Folder: return <IconFolder {...iconProps} className="w-8 h-8 text-yellow-400" />;
        case DeviceType.WebFrame: return <IconTv {...iconProps} />;
        case DeviceType.HACustomCard: return <IconLink {...iconProps} />;
        case DeviceType.Camera: return <IconCamera {...iconProps} />;
        case DeviceType.CameraGroup: return <IconLayoutGrid {...iconProps} />;
        case DeviceType.SonosPlayer: return <IconMusic {...iconProps} />;
        case DeviceType.PanicButton: return <IconAlertOctagon {...iconProps} className="w-8 h-8 text-red-400" />;
        case DeviceType.AlarmHistory: return <IconHistory {...iconProps} className="w-8 h-8 text-blue-400" />;
        case DeviceType.RSSFeed: return <IconRss {...iconProps} className="w-8 h-8 text-orange-400" />;
        case DeviceType.WaterSensor: 
        case DeviceType.Valve: return <IconDroplets {...iconProps} className="w-8 h-8 text-blue-400" />;
        case DeviceType.SmokeDetector: return <IconFlame {...iconProps} className="w-8 h-8 text-red-400" />;
        case DeviceType.CarbonMonoxideDetector: return <IconAlertTriangle {...iconProps} className="w-8 h-8 text-orange-400" />;
        case DeviceType.LitterRobot: return <IconCat {...iconProps} className="w-8 h-8 text-indigo-400" />;
        default: return <IconLayoutGrid {...iconProps} />;
    }
};

const ServiceSourceIcon = ({ service }: { service: DeviceService }) => {
    const wrapperClass = "flex-shrink-0 flex items-center justify-center";
    const iconBaseClass = "w-3 h-3";

    switch (service) {
        case DeviceService.SmartThings:
            return (
                <div title="SmartThings" className={wrapperClass}>
                    <IconCloud className={`${iconBaseClass} text-blue-400`} />
                </div>
            );
        case DeviceService.Lutron:
            return (
                <div title="Lutron" className={wrapperClass}>
                    <IconLightbulb className={`${iconBaseClass} text-yellow-400`} />
                </div>
            );
        case DeviceService.HomeAssistant:
            return (
                <div title="Home Assistant" className={wrapperClass}>
                    <IconHome className={`${iconBaseClass} text-cyan-400`} />
                </div>
            );
        case DeviceService.Sonos:
            return (
                <div title="Sonos" className={wrapperClass}>
                    <IconMusic className={`${iconBaseClass} text-green-400`} />
                </div>
            );
        case DeviceService.Noonlight:
            return (
                <div title="Noonlight" className={wrapperClass}>
                    <IconAlertOctagon className={`${iconBaseClass} text-red-400`} />
                </div>
            );
        case DeviceService.RTSP:
            return (
                <div title="RTSP Relay" className={wrapperClass}>
                    <IconServer className={`${iconBaseClass} text-indigo-400`} />
                </div>
            );
        case DeviceService.Virtual:
            return (
                <div title="Virtual Device" className={wrapperClass}>
                    <IconSettings className={`${iconBaseClass} text-purple-400`} />
                </div>
            );
        case DeviceService.Whisker:
            return (
                <div title="Whisker (Litter-Robot)" className={wrapperClass}>
                    <IconCat className={`${iconBaseClass} text-indigo-400`} />
                </div>
            );
        case DeviceService.Tempest:
            return (
                <div title="Tempest Weather" className={wrapperClass}>
                    <IconCloudSun className={`${iconBaseClass} text-sky-400`} />
                </div>
            );
        default:
            return null;
    }
};

const AdminSection: React.FC<React.PropsWithChildren<{ title: string; description?: string }>> = ({ title, description, children }) => (
    <div className="bg-gray-800 p-6 rounded-lg shadow-lg mb-6">
        <h3 className="text-xl font-semibold mb-1">{title}</h3>
        {description && <p className="text-sm text-gray-400 mb-4">{description}</p>}
        {children}
    </div>
);

const AdminInput: React.FC<React.InputHTMLAttributes<HTMLInputElement> & { label: string }> = ({ label, id, ...props }) => (
    <div>
        <label htmlFor={id} className="block mb-1 text-sm font-medium text-gray-400">{label}</label>
        <input id={id} {...props} className="w-full bg-gray-700 border border-gray-600 rounded-md p-2 text-white focus:ring-brand-blue focus:border-brand-blue" />
    </div>
);

const AdminSelect: React.FC<React.SelectHTMLAttributes<HTMLSelectElement> & { label: string }> = ({ label, id, children, ...props }) => (
    <div>
        <label htmlFor={id} className="block mb-1 text-sm font-medium text-gray-400">{label}</label>
        <select id={id} {...props} className="w-full bg-gray-700 border border-gray-600 rounded-md p-2 text-white focus:ring-brand-blue focus:border-brand-blue">
            {children}
        </select>
    </div>
);

const AdminButton = ({ children, onClick, variant = 'primary', className = '', ...props }: React.PropsWithChildren<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'danger' | 'secondary' }>) => {
    const baseClasses = 'px-4 py-2 rounded-md font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
    const variantClasses = {
        primary: 'bg-brand-blue text-white hover:bg-blue-500',
        danger: 'bg-red-600 text-white hover:bg-red-500',
        secondary: 'bg-gray-600 text-white hover:bg-gray-500',
    }[variant];

    return (
        <button onClick={onClick} className={`${baseClasses} ${variantClasses} ${className}`} {...props}>
            {children}
        </button>
    );
};

const AdminToggle: React.FC<{ label: string; enabled: boolean; onToggle: () => void; description?: string }> = ({ label, enabled, onToggle, description }) => (
    <div className="flex items-center justify-between py-2">
        <div>
            <span className="font-medium text-white">{label}</span>
            {description && <p className="text-sm text-gray-400">{description}</p>}
        </div>
        <button
            onClick={onToggle}
            className={`relative inline-flex items-center h-6 rounded-full w-11 transition-colors ${enabled ? 'bg-brand-blue' : 'bg-gray-600'}`}
        >
            <span className={`inline-block w-4 h-4 transform bg-white rounded-full transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
    </div>
);

// #endregion

// #region Settings Sections

const GeneralSettings = () => {
    const {
        dashboardTitle, updateDashboardTitle,
        weatherZipCode, updateWeatherZipCode,
    } = useDashboard();

    return (
        <AdminSection title="General Settings" description="Basic dashboard configuration.">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <AdminInput
                    label="Dashboard Title"
                    id="dash-title"
                    value={dashboardTitle}
                    onChange={e => updateDashboardTitle(e.target.value)}
                />
                <AdminInput
                    label="Weather Zip Code"
                    id="zip-code"
                    value={weatherZipCode}
                    onChange={e => updateWeatherZipCode(e.target.value)}
                    placeholder="e.g. 90210"
                />
            </div>
        </AdminSection>
    );
};

const SecuritySettings = () => {
    const {
        devices,
        entryDelaySound, updateEntryDelaySound,
        alarmDebug, updateAlarmDebug,
        primaryAlarmProvider, updatePrimaryAlarmProvider,
        connections, updateConnectionConfig,
        haWsState, lastHaEventAt, haAlarmoSensors,
        armingStatusDeviceId, updateArmingStatusDeviceId,
        alarmTriggerSensorIds, updateAlarmTriggerSensorIds,
    } = useDashboard();

    const [haTestLoading, setHaTestLoading] = useState(false);
    const [haTestResult, setHaTestResult] = useState<{ entityCount: number; alarmoFound: boolean } | null>(null);
    const [haTestError, setHaTestError] = useState<string | null>(null);

    const sensorTypes = [
        DeviceType.ContactSensor,
        DeviceType.MotionSensor,
        DeviceType.WaterSensor,
        DeviceType.SmokeDetector,
        DeviceType.CarbonMonoxideDetector,
    ];

    const sensorDevices = useMemo(() => {
        if (primaryAlarmProvider === 'ha') {
            // In HA mode the list comes from Alarmo (not the user). Resolve each
            // monitored entity_id to its device entry for the friendly name;
            // fall back to the entity_id if devices haven't loaded yet.
            return haAlarmoSensors
                .map(entityId => {
                    const d = devices.find(x => x.id === entityId);
                    return d || { id: entityId, name: entityId, location: 'Home Assistant', type: 'sensor' } as any;
                })
                .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        }
        return devices.filter(d =>
            d.service === DeviceService.SmartThings && sensorTypes.includes(d.type)
        ).sort((a, b) => a.name.localeCompare(b.name));
    }, [devices, primaryAlarmProvider, haAlarmoSensors]);

    const triggerableDevices = useMemo(() =>
        devices.filter(d => [DeviceType.Scene, DeviceType.Switch, DeviceType.Virtual].includes(d.type))
            .sort((a, b) => a.name.localeCompare(b.name)),
        [devices]
    );

    const potentialArmingDevices = useMemo(() =>
        devices.filter(d => [
            DeviceType.ContactSensor, DeviceType.MotionSensor, DeviceType.Lock,
            DeviceType.Switch, DeviceType.Virtual, DeviceType.OccupancySensor, DeviceType.WaterSensor,
        ].includes(d.type)).sort((a, b) => a.name.localeCompare(b.name)),
        [devices]
    );

    const stConn = connections.find(c => c.id === DeviceService.SmartThings);
    const haConn = connections.find(c => c.id === DeviceService.HomeAssistant);

    const formatArmLabel = (status: string) =>
        status.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());

    return (
        <AdminSection title="Security & Alarm" description="Configure the active alarm system provider, arming mappings, sensor triggers, and notification settings.">

            {/* Section A — Provider selector */}
            <h4 className="font-semibold text-white mb-2">Alarm Provider</h4>
            <p className="text-xs text-gray-400 mb-3">Select which alarm backend drives the Security tile, arming state, and sensor TTS announcements. Only one provider is active at a time.</p>
            <div className="flex gap-3">
                <button
                    onClick={() => updatePrimaryAlarmProvider('st')}
                    className={`flex-1 py-2 px-4 rounded-lg font-semibold text-sm border transition-colors ${primaryAlarmProvider === 'st' ? 'bg-brand-blue border-brand-blue text-white' : 'bg-gray-800 border-gray-600 text-gray-300 hover:border-gray-400'}`}
                >
                    SmartThings (STHM)
                </button>
                <button
                    onClick={() => updatePrimaryAlarmProvider('ha')}
                    className={`flex-1 py-2 px-4 rounded-lg font-semibold text-sm border transition-colors ${primaryAlarmProvider === 'ha' ? 'bg-brand-blue border-brand-blue text-white' : 'bg-gray-800 border-gray-600 text-gray-300 hover:border-gray-400'}`}
                >
                    Home Assistant (Alarmo)
                </button>
            </div>

            {/* Section B — Provider-specific config */}
            <div className="border-t border-gray-700 mt-6 pt-6">
                {primaryAlarmProvider === 'st' ? (
                    <>
                        <h4 className="font-semibold text-white mb-1">STHM Control Mapping</h4>
                        <p className="text-xs text-gray-400 mb-3">Map each arm state to a device or scene that SmartThings will activate.</p>
                        <div className="space-y-2">
                            {(['armedStay', 'armedAway', 'disarmed'] as const).map(status => (
                                <div key={status} className="flex items-center gap-3">
                                    <span className="w-28 text-sm text-gray-300">{formatArmLabel(status)}</span>
                                    <select
                                        value={stConn?.sthmMappings?.[status] || ''}
                                        onChange={e => updateConnectionConfig(DeviceService.SmartThings, 'sthmMappings', { ...stConn?.sthmMappings, [status]: e.target.value || null })}
                                        className="flex-1 bg-gray-700 border border-gray-600 rounded-md p-2 text-sm text-white focus:ring-brand-blue focus:border-brand-blue"
                                    >
                                        <option value="">No Action</option>
                                        {triggerableDevices.map(d => (
                                            <option key={d.id} value={d.id}>{d.name}</option>
                                        ))}
                                    </select>
                                </div>
                            ))}
                        </div>

                        <div className="border-t border-gray-700 mt-6 pt-6">
                            <h4 className="font-semibold text-white mb-1">Arming Status Source</h4>
                            <p className="text-xs text-gray-400 mb-3">Select a device that indicates whether all sensors are closed and the system is ready to arm. Used to show the 'Sensors Open' warning on the Security tile.</p>
                            <select
                                value={armingStatusDeviceId || ''}
                                onChange={e => updateArmingStatusDeviceId(e.target.value || null)}
                                className="w-full bg-gray-700 border border-gray-600 rounded-md p-2 text-white focus:ring-brand-blue focus:border-brand-blue"
                            >
                                <option value="">-- None (always ready) --</option>
                                {potentialArmingDevices.map(d => (
                                    <option key={d.id} value={d.id}>{d.name} ({d.type})</option>
                                ))}
                            </select>
                        </div>
                    </>
                ) : (
                    <>
                        <h4 className="font-semibold text-white mb-3">Alarmo Integration</h4>
                        <AdminInput
                            label="Alarm Entity ID"
                            id="ha-alarm-entity-security"
                            type="text"
                            value={(haConn as any)?.haAlarmEntityId || ''}
                            onChange={e => updateConnectionConfig(DeviceService.HomeAssistant, 'haAlarmEntityId' as any, e.target.value || undefined)}
                            placeholder="alarm_control_panel.alarmo"
                        />
                        <p className="text-xs text-gray-400 mt-1">Your B-Panels PIN is automatically sent as the Alarmo code when arming or disarming.</p>

                        {haConn?.enabled && (
                            <div className="mt-4">
                                <div className={`flex items-center gap-2 px-3 py-2 rounded text-xs font-medium ${
                                    haWsState === 'connected'
                                        ? 'bg-green-900/30 text-green-300'
                                        : haWsState === 'connecting'
                                        ? 'bg-yellow-900/30 text-yellow-300'
                                        : 'bg-red-900/30 text-red-300'
                                }`}>
                                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                        haWsState === 'connected' ? 'bg-green-400' :
                                        haWsState === 'connecting' ? 'bg-yellow-400 animate-pulse' :
                                        'bg-red-400'
                                    }`} />
                                    <span>
                                        WebSocket:{' '}
                                        {haWsState === 'connected' ? 'Connected' :
                                         haWsState === 'connecting' ? 'Connecting…' :
                                         'Disconnected — reconnecting'}
                                    </span>
                                    {haWsState === 'connected' && lastHaEventAt && (
                                        <span className="ml-auto text-gray-400">
                                            Last event: {(() => {
                                                const diffMs = Date.now() - lastHaEventAt.getTime();
                                                const diffSec = Math.floor(diffMs / 1000);
                                                if (diffSec < 60) return `${diffSec}s ago`;
                                                const diffMin = Math.floor(diffSec / 60);
                                                if (diffMin < 60) return `${diffMin}m ago`;
                                                return `${Math.floor(diffMin / 60)}h ago`;
                                            })()}
                                        </span>
                                    )}
                                    {haWsState === 'connected' && !lastHaEventAt && (
                                        <span className="ml-auto text-gray-500">No events yet</span>
                                    )}
                                </div>
                                {haWsState === 'connected' && lastHaEventAt && (Date.now() - lastHaEventAt.getTime()) > 5 * 60 * 1000 && (
                                    <p className="text-xs text-yellow-400 mt-1 px-1">
                                        ⚠ No events in over 5 minutes — data may be stale.
                                    </p>
                                )}
                            </div>
                        )}

                        <div className="mt-4 flex flex-col gap-2">
                            <p className="text-xs text-gray-400">Test runs server-side to verify URL and token, then checks for the Alarmo entity.</p>
                            <AdminButton
                                onClick={async () => {
                                    setHaTestLoading(true);
                                    setHaTestResult(null);
                                    setHaTestError(null);
                                    try {
                                        const data = await apiTestHomeAssistant();
                                        if (data.ok) {
                                            setHaTestResult({ entityCount: data.entityCount ?? 0, alarmoFound: !!data.alarmoFound });
                                        } else {
                                            setHaTestError(data.error || 'Test failed');
                                        }
                                    } catch (e) {
                                        setHaTestError((e as Error).message);
                                    } finally {
                                        setHaTestLoading(false);
                                    }
                                }}
                                disabled={haTestLoading}
                            >
                                {haTestLoading ? 'Testing…' : 'Test Connection'}
                            </AdminButton>
                            {haTestResult && (
                                <div className="text-xs text-green-400 bg-green-900/30 px-3 py-2 rounded">
                                    ✓ Connected — {haTestResult.entityCount} entities found.{' '}
                                    {haTestResult.alarmoFound
                                        ? '✓ Alarmo entity found.'
                                        : '⚠ Alarmo entity not found — check Alarm Entity ID above.'}
                                </div>
                            )}
                            {haTestError && (
                                <div className="text-xs text-red-400 bg-red-900/30 px-3 py-2 rounded">
                                    ✗ {haTestError}
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>

            {/* Section C — Entry-Delay Warning Sound */}
            <div className="border-t border-gray-700 mt-6 pt-6">
                <h4 className="font-semibold text-white mb-1">Entry-Delay Warning Sound</h4>
                <p className="text-xs text-gray-400 mb-3">Plays the moment the alarm is triggered while armed, until the PIN is entered. Choose a beep style or a spoken countdown.</p>
                <div className="flex flex-wrap gap-3">
                    <select
                        value={entryDelaySound?.mode || 'beep'}
                        onChange={(e) => updateEntryDelaySound({ mode: e.target.value as 'beep' | 'countdown', beepStyle: entryDelaySound?.beepStyle || 'single' })}
                        className="bg-gray-700 border border-gray-600 rounded-md p-2 text-sm text-white focus:ring-brand-blue focus:border-brand-blue"
                    >
                        <option value="beep">Beep</option>
                        <option value="countdown">Spoken countdown</option>
                    </select>
                    {(entryDelaySound?.mode || 'beep') === 'beep' && (
                        <select
                            value={entryDelaySound?.beepStyle || 'single'}
                            onChange={(e) => updateEntryDelaySound({ mode: 'beep', beepStyle: e.target.value as 'single' | 'double' | 'pulse' })}
                            className="bg-gray-700 border border-gray-600 rounded-md p-2 text-sm text-white focus:ring-brand-blue focus:border-brand-blue"
                        >
                            <option value="single">Single beep</option>
                            <option value="double">Double beep</option>
                            <option value="pulse">Fast pulse</option>
                        </select>
                    )}
                </div>
            </div>

            {/* Section D — Alarm Trigger Sensors (read-only summary) */}
            <div className="border-t border-gray-700 mt-6 pt-6">
                <h4 className="font-semibold text-white mb-1">Alarm Trigger Sensors</h4>
                {primaryAlarmProvider === 'ha' ? (
                    <>
                        <p className="text-xs text-gray-400 mb-3">
                            These sensors trigger the alarm when armed. Managed by Alarmo in Home Assistant — to add or remove sensors, edit them there.
                            To configure TTS announcements (with optional spoken aliases) on sensor changes, use the <span className="text-brand-blue">Notifications</span> tab.
                        </p>
                        <div className="space-y-1 max-h-64 overflow-y-auto bg-gray-900 p-3 rounded-md border border-gray-700">
                            {sensorDevices.length === 0 ? (
                                <p className="text-gray-500 text-sm p-2">No sensors configured in Alarmo.</p>
                            ) : sensorDevices.map(device => (
                                <div key={device.id} className="flex items-center justify-between py-1 px-2 text-sm">
                                    <span className="text-white truncate">{device.name}</span>
                                    <span className="text-xs text-gray-500 truncate ml-3">{device.id}</span>
                                </div>
                            ))}
                        </div>
                    </>
                ) : (
                    <>
                        <p className="text-xs text-gray-400 mb-3">
                            Select the SmartThings sensors that trigger the intrusion alert when the system is armed.
                            TTS announcements are configured separately on the <span className="text-brand-blue">Notifications</span> tab.
                        </p>
                        <div className="space-y-2 max-h-80 overflow-y-auto bg-gray-900 p-3 rounded-md border border-gray-700">
                            {sensorDevices.length === 0 && (
                                <p className="text-gray-500 text-sm p-2">No supported sensors found from SmartThings.</p>
                            )}
                            {sensorDevices.map(device => {
                                const isChecked = (alarmTriggerSensorIds || []).includes(device.id);
                                const toggle = () => {
                                    const current = alarmTriggerSensorIds || [];
                                    updateAlarmTriggerSensorIds(
                                        current.includes(device.id)
                                            ? current.filter(id => id !== device.id)
                                            : [...current, device.id]
                                    );
                                };
                                return (
                                    <label key={device.id} className={`flex items-center gap-3 p-2 rounded cursor-pointer transition-colors ${isChecked ? 'bg-brand-blue/10 border border-brand-blue/30' : 'bg-gray-800 border border-transparent hover:bg-gray-700'}`}>
                                        <input
                                            type="checkbox"
                                            checked={isChecked}
                                            onChange={toggle}
                                            className="accent-brand-blue w-5 h-5 flex-shrink-0"
                                        />
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm text-white truncate">{device.name}</div>
                                            <div className="text-xs text-gray-400 truncate">{device.location} • {device.type}</div>
                                        </div>
                                    </label>
                                );
                            })}
                        </div>
                    </>
                )}
            </div>

            {/* Section E — Alarm Debug Logging */}
            <div className="border-t border-gray-700 mt-6 pt-6">
                <h4 className="font-semibold text-white mb-2">Alarm Debug Logging</h4>
                <p className="text-xs text-gray-400 mb-3">
                    Traces the full armed-sensor event path on the server (sensor event → filters → intrusion → disarm propagation),
                    so a field test can be reviewed afterwards. Logs to the api-server console (<code className="text-gray-300">npm run logs</code>)
                    and to a rotating file at <code className="text-gray-300">logs/alarm-debug.log</code> (5&nbsp;MB per file, gzipped on rotation,
                    deleted after 30 days). Takes effect on the next arm/disarm. Leave off for normal operation.
                </p>
                <label className="flex items-center gap-3 cursor-pointer select-none">
                    <input
                        type="checkbox"
                        checked={!!alarmDebug}
                        onChange={(e) => updateAlarmDebug(e.target.checked)}
                        className="accent-brand-blue w-5 h-5 flex-shrink-0"
                    />
                    <span className="text-sm text-white">
                        {alarmDebug ? 'Debug logging enabled' : 'Enable debug logging'}
                    </span>
                </label>
            </div>
        </AdminSection>
    );
};

const NotificationsSettings = () => {
    const {
        notifyingSensorIds, updateNotifyingSensorIds, devices,
        sensorAliases, updateSensorAlias,
        primaryAlarmProvider, isAudioUnlocked, addNotification,
    } = useDashboard();

    const [testText, setTestText] = useState('This is a test announcement from B-Panels.');
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [isBroadcasting, setIsBroadcasting] = useState(false);

    const handleTestTts = useCallback(async () => {
        if (!testText.trim()) return;
        if (!isAudioUnlocked) {
            addNotification('Audio is locked — tap anywhere on a panel first to unlock TTS.', 'error');
            return;
        }
        setIsSpeaking(true);
        try {
            await playTextToSpeech(testText.trim());
        } catch (e) {
            addNotification(`TTS playback failed: ${(e as Error).message}`, 'error');
        } finally {
            setIsSpeaking(false);
        }
    }, [testText, isAudioUnlocked, addNotification]);

    const handleBroadcastTts = useCallback(async () => {
        if (!testText.trim()) return;
        setIsBroadcasting(true);
        try {
            const result = await apiBroadcastTts(testText.trim());
            if (result.ok) {
                addNotification('Announcement broadcast to all panels.', 'success');
            } else {
                addNotification(`Broadcast failed: ${result.error || 'Unknown error'}`, 'error');
            }
        } catch (e) {
            addNotification(`Broadcast failed: ${(e as Error).message}`, 'error');
        } finally {
            setIsBroadcasting(false);
        }
    }, [testText, addNotification]);

    // Sensor types that can sensibly fire a TTS announcement on state change.
    const sensorTypes = [
        DeviceType.ContactSensor,
        DeviceType.MotionSensor,
        DeviceType.OccupancySensor,
        DeviceType.WaterSensor,
        DeviceType.SmokeDetector,
        DeviceType.CarbonMonoxideDetector,
    ];

    const sensorDevices = useMemo(() => {
        const targetService = primaryAlarmProvider === 'ha' ? DeviceService.HomeAssistant : DeviceService.SmartThings;
        return devices
            .filter(d => d.service === targetService && sensorTypes.includes(d.type))
            .sort((a, b) => a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [devices, primaryAlarmProvider]);

    const handleToggle = (deviceId: string) => {
        const current = notifyingSensorIds || [];
        if (current.includes(deviceId)) {
            updateNotifyingSensorIds(current.filter(id => id !== deviceId));
        } else {
            updateNotifyingSensorIds([...current, deviceId]);
        }
    };

    return (
        <AdminSection
            title="Notifications"
            description="Speak a TTS announcement on every panel when one of these sensors changes state (opens, detects motion, gets wet, etc.). Independent from the alarm system — sensors here don't have to be alarm sensors."
        >
            {primaryAlarmProvider === 'st' && (
                <div className="mb-3 text-xs text-gray-400 bg-gray-900/50 border border-gray-700 rounded p-2">
                    In SmartThings mode, the sensors selected here also trigger the intrusion alert while armed.
                    In Home Assistant mode, alarm trigger sensors are managed by Alarmo and are independent of this list.
                </div>
            )}

            <div className="mb-4 p-3 bg-gray-900 border border-gray-700 rounded-md">
                <h4 className="font-semibold text-white mb-1 text-sm">Test TTS</h4>
                <p className="text-xs text-gray-400 mb-2">
                    <strong className="text-gray-300">Speak Here</strong> plays on this panel only.{' '}
                    <strong className="text-gray-300">Broadcast</strong> sends the message to every connected panel via the api-server.
                </p>
                <input
                    type="text"
                    value={testText}
                    onChange={(e) => setTestText(e.target.value)}
                    placeholder="Text to speak"
                    className="w-full bg-gray-700 border border-gray-600 rounded-md p-2 text-sm text-white focus:ring-brand-blue focus:border-brand-blue mb-2"
                />
                <div className="flex gap-2">
                    <AdminButton onClick={handleTestTts} disabled={isSpeaking || !testText.trim()}>
                        {isSpeaking ? 'Speaking…' : 'Speak Here'}
                    </AdminButton>
                    <AdminButton onClick={handleBroadcastTts} disabled={isBroadcasting || !testText.trim()} variant="secondary">
                        {isBroadcasting ? 'Broadcasting…' : 'Broadcast to All Panels'}
                    </AdminButton>
                </div>
                {!isAudioUnlocked && (
                    <p className="text-xs text-yellow-400 mt-2">⚠ Audio is locked on this panel — tap anywhere to unlock before using Speak Here. Broadcast is unaffected (each receiving panel must already be unlocked).</p>
                )}
            </div>
            <div className="space-y-3 max-h-[calc(100vh-300px)] overflow-y-auto bg-gray-900 p-3 rounded-md border border-gray-700">
                {sensorDevices.length === 0 && (
                    <p className="text-gray-500 text-sm p-2">
                        No supported sensors found from {primaryAlarmProvider === 'ha' ? 'Home Assistant' : 'SmartThings'}.
                        Make sure the connection is enabled and devices are loaded.
                    </p>
                )}
                {sensorDevices.map(device => {
                    const isChecked = (notifyingSensorIds || []).includes(device.id);
                    const alias = sensorAliases[device.id] || '';
                    return (
                        <div key={device.id} className={`flex items-start gap-4 p-3 rounded-lg transition-colors ${isChecked ? 'bg-brand-blue/10 border border-brand-blue/30' : 'bg-gray-800 border border-transparent'}`}>
                            <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => handleToggle(device.id)}
                                className="accent-brand-blue w-5 h-5 mt-1 flex-shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                                <div className="font-medium text-white truncate">{device.name}</div>
                                <div className="text-xs text-gray-400 truncate">{device.location || device.id} • {device.type}</div>
                                <div className="mt-2">
                                    <label htmlFor={`notify-alias-${device.id}`} className="text-xs font-medium text-gray-400">Spoken Alias</label>
                                    <input
                                        id={`notify-alias-${device.id}`}
                                        type="text"
                                        value={alias}
                                        onChange={(e) => updateSensorAlias(device.id, e.target.value)}
                                        placeholder={device.name}
                                        className="w-full bg-gray-700 border border-gray-600 rounded-md p-1.5 text-sm text-white focus:ring-brand-blue focus:border-brand-blue mt-1 disabled:opacity-50 disabled:bg-gray-800"
                                        disabled={!isChecked}
                                    />
                                    <p className="text-xs text-gray-500 mt-1">If set, this name will be used instead of the device name for voice alerts.</p>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </AdminSection>
    );
};

// One-click presets so the user never has to chase down a NOAA station ID
// or look up coordinates. Add new entries here when we expand to other spots.
const FISHING_PRESETS: Array<{
    key: string;
    name: string;
    description: string;
    stationId: string;
    latitude: number;
    longitude: number;
    timezone: string;
}> = [
    {
        key: 'kiawah-river-sc',
        name: 'Kiawah River, SC',
        description: 'NOAA station 8667062 (Kiawah River Bridge) — on-river predictions, ~2.5 mi from the island',
        stationId: '8667062',
        latitude: 32.6033,
        longitude: -80.1317,
        timezone: 'America/New_York',
    },
];

const FishingReportSettings = () => {
    const { fishingReportConfig, updateFishingReportConfig, addNotification } = useDashboard();
    const [showStationFinder, setShowStationFinder] = useState(false);
    const [searchLat, setSearchLat] = useState('');
    const [searchLon, setSearchLon] = useState('');
    const [nearbyStations, setNearbyStations] = useState<any[]>([]);
    const [isSearching, setIsSearching] = useState(false);

    const config = fishingReportConfig || {
        enabled: false,
        latitude: null,
        longitude: null,
        stationId: null,
        timezone: 'America/New_York',
    };

    const applyPreset = (preset: typeof FISHING_PRESETS[number]) => {
        updateFishingReportConfig({
            stationId: preset.stationId,
            latitude: preset.latitude,
            longitude: preset.longitude,
            timezone: preset.timezone,
        });
        addNotification(`Applied ${preset.name} preset`, 'success');
    };

    const activePresetKey = FISHING_PRESETS.find(p =>
        p.stationId === config.stationId &&
        p.latitude === config.latitude &&
        p.longitude === config.longitude &&
        p.timezone === config.timezone
    )?.key ?? null;

    const getFishingReportUrl = () => {
        const protocol = window.location.protocol;
        const hostname = window.location.hostname;
        const currentPort = window.location.port;
        if (currentPort === '8080') return `${protocol}//${hostname}:4501`;
        return `${protocol}//${hostname}:4500`;
    };
    const FISHING_REPORT_BASE_URL = getFishingReportUrl();

    // Reload service config when fishingReportConfig changes so preset
    // switches take effect immediately (without waiting for the 5-min poll).
    const prevConfigRef = useRef<string | null>(null);
    useEffect(() => {
        const configStr = JSON.stringify(fishingReportConfig);
        if (prevConfigRef.current === null) {
            prevConfigRef.current = configStr;
            return;
        }
        if (prevConfigRef.current === configStr) return;
        prevConfigRef.current = configStr;

        const reloadTimeout = setTimeout(async () => {
            try {
                await fetch(`${FISHING_REPORT_BASE_URL}/fishing-report/reload-config`, { method: 'POST' });
            } catch (err) {
                console.error('Failed to reload fishing report config:', err);
            }
        }, 2000);
        return () => clearTimeout(reloadTimeout);
    }, [fishingReportConfig, FISHING_REPORT_BASE_URL]);

    const timezones = [
        'America/New_York',
        'America/Chicago',
        'America/Denver',
        'America/Los_Angeles',
        'America/Anchorage',
        'Pacific/Honolulu',
        'America/Phoenix',
    ];

    const searchNearbyStations = async () => {
        if (!searchLat || !searchLon) {
            addNotification('Please enter latitude and longitude', 'error');
            return;
        }

        setIsSearching(true);
        try {
            // Search for nearby NOAA stations using metadata API
            const response = await fetch(
                `https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions`
            );

            if (!response.ok) {
                throw new Error('Failed to fetch stations');
            }

            const data = await response.json();
            const userLat = parseFloat(searchLat);
            const userLon = parseFloat(searchLon);

            // Calculate distance and sort by nearest
            const stationsWithDistance = data.stations.map((station: any) => {
                const stationLat = parseFloat(station.lat);
                const stationLon = parseFloat(station.lng);

                // Simple distance calculation (not perfect but good enough)
                const latDiff = userLat - stationLat;
                const lonDiff = userLon - stationLon;
                const distance = Math.sqrt(latDiff * latDiff + lonDiff * lonDiff);

                return { ...station, distance };
            }).sort((a: any, b: any) => a.distance - b.distance);

            setNearbyStations(stationsWithDistance.slice(0, 10)); // Top 10 nearest
            addNotification('Found nearby tide stations!', 'success');
        } catch (error: any) {
            console.error('Station search error:', error);
            addNotification(`Error searching stations: ${error.message}`, 'error');
        } finally {
            setIsSearching(false);
        }
    };

    const selectStation = (station: any) => {
        updateFishingReportConfig({
            stationId: station.id,
            latitude: parseFloat(station.lat),
            longitude: parseFloat(station.lng),
        });
        setShowStationFinder(false);
        addNotification(`Selected station: ${station.name}`, 'success');
    };

    return (
        <AdminSection
            title="Fishing Report"
            description="Get tide predictions and solunar fishing forecasts for your location."
        >
            <div className="space-y-6">
                {/* Enable/Disable */}
                <AdminToggle
                    label="Enable Fishing Report"
                    description="Show tide data and best fishing times on your dashboard"
                    enabled={config.enabled}
                    onToggle={() => updateFishingReportConfig({ enabled: !config.enabled })}
                />

                {/* One-click presets */}
                <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
                    <h4 className="font-semibold text-white mb-1">Quick Setup</h4>
                    <p className="text-xs text-gray-400 mb-3">
                        One click to populate station, coordinates, and timezone — no lookups needed.
                    </p>
                    <div className="space-y-2">
                        {FISHING_PRESETS.map(preset => {
                            const isActive = preset.key === activePresetKey;
                            return (
                                <button
                                    key={preset.key}
                                    type="button"
                                    onClick={() => applyPreset(preset)}
                                    className={`w-full text-left rounded p-3 border transition-colors ${
                                        isActive
                                            ? 'bg-green-900/30 border-green-700'
                                            : 'bg-gray-800 hover:bg-gray-700 border-gray-700'
                                    }`}
                                >
                                    <div className="flex justify-between items-start gap-3">
                                        <div>
                                            <p className="font-semibold text-white">{preset.name}</p>
                                            <p className="text-xs text-gray-400 mt-0.5">{preset.description}</p>
                                        </div>
                                        {isActive && (
                                            <span className="shrink-0 text-xs font-semibold text-green-300">Active</span>
                                        )}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Location Configuration */}
                <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
                    <h4 className="font-semibold text-white mb-4">Location Settings</h4>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <AdminInput
                            label="Latitude"
                            id="fishing-latitude"
                            type="number"
                            step="0.0001"
                            placeholder="40.7128"
                            value={config.latitude || ''}
                            onChange={(e) => updateFishingReportConfig({ latitude: e.target.value ? parseFloat(e.target.value) : null })}
                        />
                        <AdminInput
                            label="Longitude"
                            id="fishing-longitude"
                            type="number"
                            step="0.0001"
                            placeholder="-74.0060"
                            value={config.longitude || ''}
                            onChange={(e) => updateFishingReportConfig({ longitude: e.target.value ? parseFloat(e.target.value) : null })}
                        />
                    </div>

                    <div className="mb-4">
                        <AdminSelect
                            label="Timezone"
                            id="fishing-timezone"
                            value={config.timezone}
                            onChange={(e) => updateFishingReportConfig({ timezone: e.target.value })}
                        >
                            {timezones.map(tz => (
                                <option key={tz} value={tz}>{tz}</option>
                            ))}
                        </AdminSelect>
                    </div>

                    <div className="text-xs text-gray-500 mb-4">
                        <p>Enter your location coordinates for accurate solunar calculations.</p>
                        <p className="mt-1">You can find your coordinates by searching your address on Google Maps and clicking on the map.</p>
                    </div>
                </div>

                {/* NOAA Station Configuration */}
                <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
                    <h4 className="font-semibold text-white mb-4">NOAA Tide Station</h4>

                    <div className="mb-4">
                        <AdminInput
                            label="Station ID"
                            id="fishing-station"
                            type="text"
                            placeholder="8518750"
                            value={config.stationId || ''}
                            onChange={(e) => updateFishingReportConfig({ stationId: e.target.value || null })}
                        />
                        <p className="text-xs text-gray-500 mt-1">
                            NOAA Station ID for tide predictions (e.g., 8518750 for The Battery, NY)
                        </p>
                    </div>

                    {!showStationFinder ? (
                        <AdminButton
                            variant="secondary"
                            onClick={() => setShowStationFinder(true)}
                        >
                            Find Nearby Stations
                        </AdminButton>
                    ) : (
                        <div className="bg-gray-800 border border-gray-700 rounded p-4">
                            <div className="flex justify-between items-center mb-4">
                                <h5 className="font-semibold text-white">Find Nearby Tide Stations</h5>
                                <button
                                    onClick={() => setShowStationFinder(false)}
                                    className="text-gray-400 hover:text-white"
                                >
                                    ✕
                                </button>
                            </div>

                            <div className="grid grid-cols-2 gap-3 mb-3">
                                <AdminInput
                                    label="Latitude"
                                    id="search-lat"
                                    type="number"
                                    step="0.0001"
                                    placeholder="40.7128"
                                    value={searchLat}
                                    onChange={(e) => setSearchLat(e.target.value)}
                                />
                                <AdminInput
                                    label="Longitude"
                                    id="search-lon"
                                    type="number"
                                    step="0.0001"
                                    placeholder="-74.0060"
                                    value={searchLon}
                                    onChange={(e) => setSearchLon(e.target.value)}
                                />
                            </div>

                            <AdminButton
                                onClick={searchNearbyStations}
                                disabled={isSearching}
                                className="w-full mb-4"
                            >
                                {isSearching ? 'Searching...' : 'Search Stations'}
                            </AdminButton>

                            {nearbyStations.length > 0 && (
                                <div className="max-h-64 overflow-y-auto">
                                    <p className="text-sm text-gray-400 mb-2">Nearest tide stations:</p>
                                    {nearbyStations.map((station) => (
                                        <div
                                            key={station.id}
                                            className="bg-gray-700 hover:bg-gray-600 rounded p-3 mb-2 cursor-pointer"
                                            onClick={() => selectStation(station)}
                                        >
                                            <div className="flex justify-between items-start">
                                                <div>
                                                    <p className="font-semibold text-white">{station.name}</p>
                                                    <p className="text-xs text-gray-400">ID: {station.id}</p>
                                                    <p className="text-xs text-gray-400">{station.state}</p>
                                                </div>
                                                <div className="text-xs text-gray-400">
                                                    {station.distance.toFixed(2)}° away
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Configuration Summary */}
                {config.enabled && config.stationId && config.latitude && config.longitude && (
                    <div className="bg-green-900/20 border border-green-700 rounded-lg p-4">
                        <h4 className="font-semibold text-green-300 mb-2">✓ Configuration Complete</h4>
                        <div className="text-sm text-gray-300 space-y-1">
                            <p>Station ID: {config.stationId}</p>
                            <p>Location: {config.latitude.toFixed(4)}, {config.longitude.toFixed(4)}</p>
                            <p>Timezone: {config.timezone}</p>
                        </div>
                        <p className="text-xs text-gray-400 mt-3">
                            Add a Fishing Report virtual device in the Virtual Devices tab, then add it to your dashboard!
                        </p>
                    </div>
                )}
            </div>
        </AdminSection>
    );
};

const InternetMonitorSettings = () => {
    const { internetMonitorConfig, updateInternetMonitorConfig, addNotification } = useDashboard();
    const [status, setStatus] = useState<any>(null);
    const [isTestingPlug, setIsTestingPlug] = useState(false);
    const [isCheckingInternet, setIsCheckingInternet] = useState(false);

    // Determine the correct port based on environment
    const getInternetMonitorUrl = () => {
        const currentPort = window.location.port;
        const hostname = window.location.hostname;
        const protocol = window.location.protocol;

        // Dev environment (dashboard on 8080) uses port 4401
        if (currentPort === '8080') {
            return `${protocol}//${hostname}:4401`;
        }

        // Production (dashboard on 3000) uses port 4400
        return `${protocol}//${hostname}:4400`;
    };

    const INTERNET_MONITOR_BASE_URL = getInternetMonitorUrl();

    const config = internetMonitorConfig || {
        enabled: false,
        checkIntervalSeconds: 60,
        failureThreshold: 3,
        rebootCooldownMinutes: 30,
        postRebootWaitMinutes: 5,
        smartPlugIp: '',
        smartPlugEmail: '',
        smartPlugPassword: '',
        checkEndpoints: ['8.8.8.8', '1.1.1.1', 'google.com'],
        endpointTimeout: 5,
        notifyOnFailure: true,
        notifyOnReboot: true,
        notifyOnRecovery: true,
    };

    // Track previous config to detect changes
    const prevConfigRef = useRef<string | null>(null);

    // Reload service config when internetMonitorConfig changes
    useEffect(() => {
        const configStr = JSON.stringify(internetMonitorConfig);

        // Skip initial mount
        if (prevConfigRef.current === null) {
            prevConfigRef.current = configStr;
            return;
        }

        // Skip if no actual change
        if (prevConfigRef.current === configStr) {
            return;
        }

        prevConfigRef.current = configStr;

        // Debounce the reload - wait for config to be saved (1.5s) + small buffer
        const reloadTimeout = setTimeout(async () => {
            try {
                console.log('[InternetMonitor] Reloading service config...');
                await fetch(`${INTERNET_MONITOR_BASE_URL}/internet-monitor/reload-config`, {
                    method: 'POST'
                });
            } catch (err) {
                console.error('Failed to reload internet monitor config:', err);
            }
        }, 2000);

        return () => clearTimeout(reloadTimeout);
    }, [internetMonitorConfig, INTERNET_MONITOR_BASE_URL]);

    // Fetch status on mount and every 10 seconds
    useEffect(() => {
        const fetchStatus = async () => {
            try {
                const res = await fetch(`${INTERNET_MONITOR_BASE_URL}/internet-monitor/status`);
                if (res.ok) {
                    const data = await res.json();
                    setStatus(data);
                }
            } catch (err) {
                console.error('Failed to fetch internet monitor status:', err);
            }
        };

        fetchStatus();
        const interval = setInterval(fetchStatus, 10000);
        return () => clearInterval(interval);
    }, [INTERNET_MONITOR_BASE_URL]);

    const handleTestPlug = async () => {
        if (!config.smartPlugIp) {
            addNotification('Please enter a smart plug IP address first', 'error');
            return;
        }
        setIsTestingPlug(true);
        try {
            const res = await fetch(`${INTERNET_MONITOR_BASE_URL}/internet-monitor/test-plug`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ip: config.smartPlugIp })
            });
            const data = await res.json();
            if (data.ok) {
                addNotification(`Smart plug connected: ${data.deviceInfo.alias} (${data.deviceInfo.model}) - ${data.deviceInfo.relayState ? 'ON' : 'OFF'}`, 'success');
            } else {
                addNotification(`Failed to connect to smart plug at ${data.testedIp}: ${data.error}`, 'error');
            }
        } catch (err: any) {
            addNotification(`Error testing smart plug: ${err.message}`, 'error');
        } finally {
            setIsTestingPlug(false);
        }
    };

    const handleCheckInternet = async () => {
        setIsCheckingInternet(true);
        try {
            const res = await fetch(`${INTERNET_MONITOR_BASE_URL}/internet-monitor/check`, {
                method: 'POST'
            });
            const data = await res.json();
            if (data.ok) {
                setStatus(data.status);
                addNotification('Internet connectivity check completed', 'success');
            }
        } catch (err: any) {
            addNotification(`Error checking internet: ${err.message}`, 'error');
        } finally {
            setIsCheckingInternet(false);
        }
    };

    const getStatusBadge = () => {
        if (!status) return null;

        const colors = {
            online: 'bg-green-500',
            offline: 'bg-red-500',
            checking: 'bg-yellow-500',
            waiting_after_reboot: 'bg-blue-500',
            cooldown: 'bg-orange-500'
        };

        return (
            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${colors[status.currentStatus as keyof typeof colors] || 'bg-gray-500'}`}>
                {status.currentStatus.replace(/_/g, ' ').toUpperCase()}
            </span>
        );
    };

    return (
        <>
            <AdminSection
                title="Internet Monitoring"
                description="Monitor internet connectivity and automatically reboot a smart plug when connection is lost."
            >
                <div className="space-y-6">
                    {/* Enable/Disable */}
                    <AdminToggle
                        label="Enable Internet Monitoring"
                        description="Automatically monitor internet connectivity and reboot smart plug on failure"
                        enabled={config.enabled}
                        onToggle={() => updateInternetMonitorConfig({ enabled: !config.enabled })}
                    />

                    {/* Current Status */}
                    {status && (
                        <>
                            <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
                                <div className="flex items-center justify-between mb-3">
                                    <h4 className="font-semibold text-white">Current Status</h4>
                                    {getStatusBadge()}
                                </div>
                                <div className="space-y-2 text-sm">
                                    <div className="flex justify-between">
                                        <span className="text-gray-400">Status:</span>
                                        <span className="text-white">{status.statusMessage}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-gray-400">Last Check:</span>
                                        <span className="text-white">{new Date(status.lastCheckTime).toLocaleString()}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-gray-400">Consecutive Failures:</span>
                                        <span className="text-white">{status.consecutiveFailures}</span>
                                    </div>
                                    {status.lastRebootTime && (
                                        <div className="flex justify-between">
                                            <span className="text-gray-400">Last Reboot:</span>
                                            <span className="text-white">{new Date(status.lastRebootTime).toLocaleString()}</span>
                                        </div>
                                    )}
                                    {status.smartPlug && (
                                        <>
                                            <div className="flex justify-between">
                                                <span className="text-gray-400">Smart Plug:</span>
                                                <span>
                                                    {status.smartPlug.error ? (
                                                        <span className="text-yellow-400">Error - {status.smartPlug.error}</span>
                                                    ) : status.smartPlug.isOn === null ? (
                                                        <span className="text-gray-500">Unknown</span>
                                                    ) : status.smartPlug.isOn ? (
                                                        <span className="text-green-400 font-semibold">ON</span>
                                                    ) : (
                                                        <span className="text-red-400 font-semibold">OFF</span>
                                                    )}
                                                </span>
                                            </div>
                                            {status.smartPlug.lastPollTime && (
                                                <div className="flex justify-between">
                                                    <span className="text-gray-400">Plug Last Polled:</span>
                                                    <span className="text-white">{new Date(status.smartPlug.lastPollTime).toLocaleString()}</span>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>

                                {/* Check Summary */}
                                {status.checkSummary && (
                                    <div className="mt-4 pt-4 border-t border-gray-700">
                                        <h5 className="text-sm font-semibold text-white mb-2">Check Summary</h5>
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                            <div className="bg-gray-800 p-2 rounded">
                                                <div className="text-xs text-gray-400">HTTP</div>
                                                <div className="text-sm font-semibold text-white">
                                                    {status.checkSummary.byType.http.passed}/{status.checkSummary.byType.http.passed + status.checkSummary.byType.http.failed}
                                                </div>
                                            </div>
                                            <div className="bg-gray-800 p-2 rounded">
                                                <div className="text-xs text-gray-400">HTTPS</div>
                                                <div className="text-sm font-semibold text-white">
                                                    {status.checkSummary.byType.https.passed}/{status.checkSummary.byType.https.passed + status.checkSummary.byType.https.failed}
                                                </div>
                                            </div>
                                            <div className="bg-gray-800 p-2 rounded">
                                                <div className="text-xs text-gray-400">Ping</div>
                                                <div className="text-sm font-semibold text-white">
                                                    {status.checkSummary.byType.ping.passed}/{status.checkSummary.byType.ping.passed + status.checkSummary.byType.ping.failed}
                                                </div>
                                            </div>
                                            <div className="bg-gray-800 p-2 rounded">
                                                <div className="text-xs text-gray-400">DNS</div>
                                                <div className="text-sm font-semibold text-white">
                                                    {status.checkSummary.byType.dns.passed}/{status.checkSummary.byType.dns.passed + status.checkSummary.byType.dns.failed}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                <div className="mt-4 flex gap-2">
                                    <AdminButton
                                        variant="secondary"
                                        onClick={handleCheckInternet}
                                        disabled={isCheckingInternet}
                                    >
                                        {isCheckingInternet ? 'Checking...' : 'Check Now'}
                                    </AdminButton>
                                </div>
                            </div>

                            {/* Detailed Check Results */}
                            {status.checkResults && status.checkResults.length > 0 && (
                                <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
                                    <h4 className="font-semibold text-white mb-3">Check Details</h4>
                                    <div className="space-y-2 max-h-64 overflow-y-auto">
                                        {status.checkResults.map((result: any, idx: number) => (
                                            <div key={idx} className={`flex items-start justify-between p-2 rounded text-sm ${result.success ? 'bg-green-900/20' : 'bg-red-900/20'}`}>
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2">
                                                        <span className={`w-2 h-2 rounded-full ${result.success ? 'bg-green-500' : 'bg-red-500'}`} />
                                                        <span className="font-medium text-white">{result.endpoint}</span>
                                                        <span className="text-xs text-gray-400 uppercase">{result.type}</span>
                                                    </div>
                                                    {result.details && (
                                                        <div className="text-xs text-gray-400 ml-4 mt-1">{result.details}</div>
                                                    )}
                                                    {result.error && (
                                                        <div className="text-xs text-red-400 ml-4 mt-1">Error: {result.error}</div>
                                                    )}
                                                </div>
                                                {result.responseTime && (
                                                    <span className="text-xs text-gray-400 ml-2">{result.responseTime}ms</span>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    {/* Smart Plug Configuration */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <AdminInput
                            label="Smart Plug IP Address"
                            id="smartplug-ip"
                            type="text"
                            placeholder="192.168.1.100"
                            value={config.smartPlugIp}
                            onChange={(e) => updateInternetMonitorConfig({ smartPlugIp: e.target.value })}
                        />
                        <div className="flex items-end">
                            <AdminButton
                                variant="secondary"
                                onClick={handleTestPlug}
                                disabled={!config.smartPlugIp || isTestingPlug}
                                className="w-full"
                            >
                                {isTestingPlug ? 'Testing...' : 'Test Connection'}
                            </AdminButton>
                        </div>
                    </div>

                    {/* Check Intervals */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <AdminInput
                            label="Check Interval (seconds)"
                            id="check-interval"
                            type="number"
                            min="10"
                            value={config.checkIntervalSeconds}
                            onChange={(e) => updateInternetMonitorConfig({ checkIntervalSeconds: parseInt(e.target.value) || 60 })}
                        />
                        <AdminInput
                            label="Failure Threshold"
                            id="failure-threshold"
                            type="number"
                            min="1"
                            value={config.failureThreshold}
                            onChange={(e) => updateInternetMonitorConfig({ failureThreshold: parseInt(e.target.value) || 3 })}
                        />
                        <AdminInput
                            label="Endpoint Timeout (seconds)"
                            id="endpoint-timeout"
                            type="number"
                            min="1"
                            value={config.endpointTimeout}
                            onChange={(e) => updateInternetMonitorConfig({ endpointTimeout: parseInt(e.target.value) || 5 })}
                        />
                    </div>

                    {/* Reboot Configuration */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <AdminInput
                            label="Reboot Cooldown (minutes)"
                            id="reboot-cooldown"
                            type="number"
                            min="1"
                            value={config.rebootCooldownMinutes}
                            onChange={(e) => updateInternetMonitorConfig({ rebootCooldownMinutes: parseInt(e.target.value) || 30 })}
                        />
                        <AdminInput
                            label="Post-Reboot Wait (minutes)"
                            id="post-reboot-wait"
                            type="number"
                            min="1"
                            value={config.postRebootWaitMinutes}
                            onChange={(e) => updateInternetMonitorConfig({ postRebootWaitMinutes: parseInt(e.target.value) || 5 })}
                        />
                    </div>

                    {/* Check Endpoints */}
                    <div>
                        <label className="block mb-2 text-sm font-medium text-gray-400">
                            Configured Check Endpoints
                        </label>
                        <div className="bg-gray-800 border border-gray-700 rounded-md p-3 max-h-48 overflow-y-auto">
                            {config.checkEndpoints && config.checkEndpoints.length > 0 ? (
                                <div className="space-y-2">
                                    {config.checkEndpoints.map((endpoint: any, idx: number) => (
                                        <div key={idx} className="flex items-center gap-2 text-sm">
                                            <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                                                endpoint.type === 'https' ? 'bg-green-700' :
                                                endpoint.type === 'http' ? 'bg-blue-700' :
                                                endpoint.type === 'ping' ? 'bg-yellow-700' :
                                                'bg-purple-700'
                                            }`}>
                                                {endpoint.type.toUpperCase()}
                                            </span>
                                            <span className="text-white flex-1">
                                                {endpoint.description || endpoint.target}
                                            </span>
                                            <span className="text-gray-400 text-xs font-mono">
                                                {endpoint.target}
                                            </span>
                                            <button
                                                onClick={() => {
                                                    const newEndpoints = config.checkEndpoints.filter((_: any, i: number) => i !== idx);
                                                    updateInternetMonitorConfig({ checkEndpoints: newEndpoints });
                                                }}
                                                className="text-red-400 hover:text-red-300 p-1"
                                                title="Remove endpoint"
                                            >
                                                🗑️
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-gray-500 text-sm">No endpoints configured</p>
                            )}
                        </div>
                        <p className="text-xs text-gray-500 mt-2">
                            Internet monitoring uses multiple check types (HTTP, HTTPS, Ping, DNS) for robust connectivity detection.
                            A reboot only fires after the configured number of consecutive cycles where <em>every</em> check failed —
                            a single successful check of any type keeps the cycle marked online.
                            Default configuration includes checks for Google and Cloudflare services.
                        </p>
                    </div>

                    {/* Notification Settings */}
                    <div className="space-y-2">
                        <h4 className="font-semibold text-white">Notifications</h4>
                        <AdminToggle
                            label="Notify on Failure"
                            description="Send webhook notification when internet connection fails"
                            enabled={config.notifyOnFailure}
                            onToggle={() => updateInternetMonitorConfig({ notifyOnFailure: !config.notifyOnFailure })}
                        />
                        <AdminToggle
                            label="Notify on Reboot"
                            description="Send webhook notification when smart plug is rebooted"
                            enabled={config.notifyOnReboot}
                            onToggle={() => updateInternetMonitorConfig({ notifyOnReboot: !config.notifyOnReboot })}
                        />
                        <AdminToggle
                            label="Notify on Recovery"
                            description="Send webhook notification when internet connection is restored"
                            enabled={config.notifyOnRecovery}
                            onToggle={() => updateInternetMonitorConfig({ notifyOnRecovery: !config.notifyOnRecovery })}
                        />
                    </div>
                </div>
            </AdminSection>
        </>
    );
};

const BatteryReportSettings = () => {
    const { batteryReportConfig, updateBatteryReportConfig, batteryTypeMappings, updateBatteryTypeMapping, batteryQuantityMappings, updateBatteryQuantityMapping, customBatteryTypes, addCustomBatteryType, removeCustomBatteryType, addNotification } = useDashboard();
    const [status, setStatus] = useState<any>(null);
    const [isTestingSmtp, setIsTestingSmtp] = useState(false);
    const [isSendingReport, setIsSendingReport] = useState(false);
    const [isSendingTest, setIsSendingTest] = useState(false);
    const [testEmail, setTestEmail] = useState('');
    const [newRecipient, setNewRecipient] = useState('');
    const [batteryDevices, setBatteryDevices] = useState<any[]>([]);
    const [isLoadingDevices, setIsLoadingDevices] = useState(false);
    const [batteryPredictions, setBatteryPredictions] = useState<any[]>([]);
    const [isLoadingPredictions, setIsLoadingPredictions] = useState(false);
    const [lastRecordingTime, setLastRecordingTime] = useState<string | null>(null);
    const [newBatteryType, setNewBatteryType] = useState('');

    // Default battery types + custom types from config
    const DEFAULT_BATTERY_TYPES: BatteryType[] = ['CR2032', 'CR2450', 'CR123A', 'AA', 'AAA', 'CR2', 'CR2477', 'A23', 'Rechargeable', 'Other', 'Unknown'];
    const ALL_BATTERY_TYPES = useMemo(() => {
        // Combine defaults with custom, but keep Unknown at the end
        const combined = [...DEFAULT_BATTERY_TYPES.filter(t => t !== 'Unknown'), ...customBatteryTypes, 'Unknown'];
        // Remove duplicates while preserving order
        return [...new Set(combined)];
    }, [customBatteryTypes]);

    // Determine the correct API base URL based on environment
    const getApiBaseUrl = () => {
        const currentPort = window.location.port;
        const hostname = window.location.hostname;
        const protocol = window.location.protocol;

        // Dev environment (dashboard on 8080)
        if (currentPort === '8080') {
            return `${protocol}//${hostname}:8081`;
        }

        // Production (dashboard on 3000)
        return `${protocol}//${hostname}:3001`;
    };

    const API_BASE_URL = getApiBaseUrl();

    const config = batteryReportConfig || {
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

    const timezones = [
        'America/New_York',
        'America/Chicago',
        'America/Denver',
        'America/Los_Angeles',
        'America/Anchorage',
        'Pacific/Honolulu',
        'America/Phoenix',
        'UTC',
    ];

    const daysOfWeek = [
        { value: 'sunday', label: 'Sunday' },
        { value: 'monday', label: 'Monday' },
        { value: 'tuesday', label: 'Tuesday' },
        { value: 'wednesday', label: 'Wednesday' },
        { value: 'thursday', label: 'Thursday' },
        { value: 'friday', label: 'Friday' },
        { value: 'saturday', label: 'Saturday' },
    ];

    // Helper to get auth headers for API calls
    const getAuthHeaders = useCallback(() => {
        const token = localStorage.getItem('homeTileAuthToken') || localStorage.getItem('homeTileDeviceAuthToken');
        return token ? { 'Authorization': `Bearer ${token}` } : {};
    }, []);

    // Fetch status on mount and every 30 seconds
    useEffect(() => {
        const fetchStatus = async () => {
            try {
                const res = await fetch(`${API_BASE_URL}/api/battery-report/status`, {
                    headers: getAuthHeaders(),
                });
                if (res.ok) {
                    const data = await res.json();
                    setStatus(data);
                }
            } catch (err) {
                console.error('Failed to fetch battery report status:', err);
            }
        };

        fetchStatus();
        const interval = setInterval(fetchStatus, 30000);
        return () => clearInterval(interval);
    }, [API_BASE_URL, getAuthHeaders]);

    // Fetch battery devices for the mapping UI (directly from API server)
    const fetchBatteryDevices = useCallback(async () => {
        setIsLoadingDevices(true);
        try {
            const res = await fetch(`${API_BASE_URL}/api/battery-devices`, {
                headers: getAuthHeaders(),
            });
            if (res.ok) {
                const devices = await res.json();
                // API returns array directly
                setBatteryDevices(Array.isArray(devices) ? devices : []);
            } else {
                console.error('Failed to fetch battery devices:', res.status);
                addNotification('Failed to load battery devices', 'error');
            }
        } catch (err) {
            console.error('Failed to fetch battery devices:', err);
            addNotification('Error loading battery devices', 'error');
        } finally {
            setIsLoadingDevices(false);
        }
    }, [API_BASE_URL, getAuthHeaders, addNotification]);

    // Helper to get effective battery type (user mapping takes precedence)
    const getEffectiveBatteryType = useCallback((device: any) => {
        return batteryTypeMappings[device.id] || device.batteryType || 'Unknown';
    }, [batteryTypeMappings]);

    // Helper to get effective battery quantity (user mapping takes precedence, default 1)
    const getEffectiveBatteryQuantity = useCallback((device: any) => {
        return batteryQuantityMappings[device.id] || device.batteryQuantity || 1;
    }, [batteryQuantityMappings]);

    // Group devices by battery type for display
    const devicesByBatteryType = useMemo(() => {
        const grouped: Record<string, any[]> = {};
        for (const device of batteryDevices) {
            const type = getEffectiveBatteryType(device);
            if (!grouped[type]) grouped[type] = [];
            grouped[type].push(device);
        }
        // Sort by battery type name, but put Unknown at the end
        const sortedKeys = Object.keys(grouped).sort((a, b) => {
            if (a === 'Unknown') return 1;
            if (b === 'Unknown') return -1;
            return a.localeCompare(b);
        });
        return { grouped, sortedKeys };
    }, [batteryDevices, getEffectiveBatteryType]);

    // Fetch battery predictions
    const fetchPredictions = useCallback(async () => {
        setIsLoadingPredictions(true);
        try {
            const res = await fetch(`${API_BASE_URL}/api/battery-history/predictions`, {
                headers: getAuthHeaders(),
            });
            if (res.ok) {
                const data = await res.json();
                setBatteryPredictions(data.predictions || []);
                setLastRecordingTime(data.lastRecordingTime || null);
            } else {
                console.error('Failed to fetch predictions:', res.status);
            }
        } catch (err) {
            console.error('Failed to fetch battery predictions:', err);
        } finally {
            setIsLoadingPredictions(false);
        }
    }, [API_BASE_URL, getAuthHeaders]);

    // Trigger a manual recording of battery history
    const recordBatteryHistory = useCallback(async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/api/battery-history/record`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            });
            if (res.ok) {
                addNotification('Battery history recorded successfully', 'success');
                fetchPredictions(); // Refresh predictions
            } else {
                addNotification('Failed to record battery history', 'error');
            }
        } catch (err) {
            addNotification('Error recording battery history', 'error');
        }
    }, [API_BASE_URL, addNotification, fetchPredictions, getAuthHeaders]);

    const handleTestSmtp = async () => {
        setIsTestingSmtp(true);
        try {
            const res = await fetch(`${API_BASE_URL}/api/battery-report/test-smtp`, {
                method: 'POST',
                headers: getAuthHeaders(),
            });
            const data = await res.json();
            if (data.success) {
                addNotification('SMTP connection successful!', 'success');
            } else {
                addNotification(`SMTP test failed: ${data.error}`, 'error');
            }
        } catch (err: any) {
            addNotification(`Error testing SMTP: ${err.message}`, 'error');
        } finally {
            setIsTestingSmtp(false);
        }
    };

    const handleSendNow = async () => {
        setIsSendingReport(true);
        try {
            const res = await fetch(`${API_BASE_URL}/api/battery-report/send-now`, {
                method: 'POST',
                headers: getAuthHeaders(),
            });
            const data = await res.json();
            if (data.success) {
                addNotification(`Battery report sent to ${data.recipientCount} recipient(s)!`, 'success');
            } else {
                addNotification(`Failed to send report: ${data.reason}`, 'error');
            }
        } catch (err: any) {
            addNotification(`Error sending report: ${err.message}`, 'error');
        } finally {
            setIsSendingReport(false);
        }
    };

    const handleSendTestEmail = async () => {
        if (!testEmail) {
            addNotification('Please enter an email address', 'error');
            return;
        }
        setIsSendingTest(true);
        try {
            const res = await fetch(`${API_BASE_URL}/api/battery-report/test-email`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify({ email: testEmail })
            });
            const data = await res.json();
            if (data.success) {
                addNotification(`Test email sent to ${testEmail}!`, 'success');
                setTestEmail('');
            } else {
                addNotification(`Failed to send test email: ${data.error}`, 'error');
            }
        } catch (err: any) {
            addNotification(`Error sending test email: ${err.message}`, 'error');
        } finally {
            setIsSendingTest(false);
        }
    };

    const handleAddRecipient = () => {
        if (!newRecipient) return;
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(newRecipient)) {
            addNotification('Please enter a valid email address', 'error');
            return;
        }
        const currentRecipients = config.recipientEmails || [];
        if (currentRecipients.includes(newRecipient)) {
            addNotification('This email is already in the list', 'warning');
            return;
        }
        updateBatteryReportConfig({ recipientEmails: [...currentRecipients, newRecipient] });
        setNewRecipient('');
        addNotification('Recipient added', 'success');
    };

    const handleRemoveRecipient = (email: string) => {
        const currentRecipients = config.recipientEmails || [];
        updateBatteryReportConfig({ recipientEmails: currentRecipients.filter(e => e !== email) });
    };

    const handlePreviewReport = async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/api/battery-report/preview`, {
                headers: getAuthHeaders(),
            });
            if (!res.ok) throw new Error(`Failed to load preview: ${res.status}`);
            const html = await res.text();
            const blob = new Blob([html], { type: 'text/html' });
            window.open(URL.createObjectURL(blob), '_blank');
        } catch (err) {
            addNotification(`Preview failed: ${(err as Error).message}`, 'error');
        }
    };

    return (
        <>
            <AdminSection
                title="Weekly Battery Report"
                description="Schedule weekly email reports with battery status for all your devices."
            >
                <div className="space-y-6">
                    {/* Enable/Disable */}
                    <AdminToggle
                        label="Enable Weekly Battery Report"
                        description="Send automatic weekly battery status reports via email"
                        enabled={config.enabled}
                        onToggle={() => updateBatteryReportConfig({ enabled: !config.enabled })}
                    />

                    {/* Current Status */}
                    {status && (
                        <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
                            <h4 className="font-semibold text-white mb-3">Report Status</h4>
                            <div className="space-y-2 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Service Status:</span>
                                    <span className={`font-semibold ${status.configured ? 'text-green-400' : 'text-yellow-400'}`}>
                                        {status.configured ? 'Configured' : 'Not Configured'}
                                    </span>
                                </div>
                                {status.nextScheduledReport && (
                                    <div className="flex justify-between">
                                        <span className="text-gray-400">Next Report:</span>
                                        <span className="text-white">{new Date(status.nextScheduledReport).toLocaleString()}</span>
                                    </div>
                                )}
                                {status.lastReportTime && (
                                    <div className="flex justify-between">
                                        <span className="text-gray-400">Last Report:</span>
                                        <span className="text-white">{new Date(status.lastReportTime).toLocaleString()}</span>
                                    </div>
                                )}
                                {status.lastReportStatus && (
                                    <div className="flex justify-between">
                                        <span className="text-gray-400">Last Status:</span>
                                        <span className={`font-semibold ${status.lastReportStatus === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                                            {status.lastReportStatus === 'success' ? 'Sent Successfully' : 'Error'}
                                        </span>
                                    </div>
                                )}
                                {status.lastReportError && (
                                    <div className="mt-2 p-2 bg-red-900/20 border border-red-700 rounded text-sm text-red-300">
                                        Error: {status.lastReportError}
                                    </div>
                                )}
                            </div>
                            <div className="mt-4 flex flex-wrap gap-2">
                                <AdminButton
                                    variant="secondary"
                                    onClick={handleSendNow}
                                    disabled={isSendingReport || !status.configured}
                                >
                                    {isSendingReport ? 'Sending...' : 'Send Report Now'}
                                </AdminButton>
                                <AdminButton
                                    variant="secondary"
                                    onClick={handlePreviewReport}
                                >
                                    Preview Report
                                </AdminButton>
                            </div>
                        </div>
                    )}

                    {/* Schedule Configuration */}
                    <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
                        <h4 className="font-semibold text-white mb-4">Schedule</h4>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <AdminSelect
                                label="Day of Week"
                                id="battery-day"
                                value={config.dayOfWeek}
                                onChange={(e) => updateBatteryReportConfig({ dayOfWeek: e.target.value as any })}
                            >
                                {daysOfWeek.map(day => (
                                    <option key={day.value} value={day.value}>{day.label}</option>
                                ))}
                            </AdminSelect>
                            <AdminInput
                                label="Time (24-hour)"
                                id="battery-time"
                                type="time"
                                value={config.timeOfDay}
                                onChange={(e) => updateBatteryReportConfig({ timeOfDay: e.target.value })}
                            />
                            <AdminSelect
                                label="Timezone"
                                id="battery-timezone"
                                value={config.timezone}
                                onChange={(e) => updateBatteryReportConfig({ timezone: e.target.value })}
                            >
                                {timezones.map(tz => (
                                    <option key={tz} value={tz}>{tz}</option>
                                ))}
                            </AdminSelect>
                        </div>
                    </div>

                    {/* SMTP Configuration */}
                    <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
                        <h4 className="font-semibold text-white mb-4">Email Server (SMTP)</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                            <AdminInput
                                label="SMTP Host"
                                id="smtp-host"
                                type="text"
                                placeholder="smtp.gmail.com"
                                value={config.smtpHost}
                                onChange={(e) => updateBatteryReportConfig({ smtpHost: e.target.value })}
                            />
                            <div className="grid grid-cols-2 gap-2">
                                <AdminInput
                                    label="Port"
                                    id="smtp-port"
                                    type="number"
                                    placeholder="587"
                                    value={config.smtpPort}
                                    onChange={(e) => updateBatteryReportConfig({ smtpPort: parseInt(e.target.value) || 587 })}
                                />
                                <div className="flex items-end">
                                    <div className="w-full">
                                        <label className="block mb-1 text-sm font-medium text-gray-400">SSL/TLS</label>
                                        <button
                                            onClick={() => updateBatteryReportConfig({ smtpSecure: !config.smtpSecure })}
                                            className={`w-full p-2 rounded-md border ${config.smtpSecure ? 'bg-green-600 border-green-500 text-white' : 'bg-gray-700 border-gray-600 text-gray-300'}`}
                                        >
                                            {config.smtpSecure ? 'SSL (465)' : 'STARTTLS (587)'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                            <AdminInput
                                label="Username"
                                id="smtp-user"
                                type="text"
                                placeholder="your-email@gmail.com"
                                value={config.smtpUser}
                                onChange={(e) => updateBatteryReportConfig({ smtpUser: e.target.value })}
                            />
                            <AdminInput
                                label="Password / App Password"
                                id="smtp-password"
                                type="password"
                                placeholder="Your SMTP password"
                                value={config.smtpPassword}
                                onChange={(e) => updateBatteryReportConfig({ smtpPassword: e.target.value })}
                            />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                            <AdminInput
                                label="From Email"
                                id="from-email"
                                type="email"
                                placeholder="Optional - defaults to username"
                                value={config.fromEmail}
                                onChange={(e) => updateBatteryReportConfig({ fromEmail: e.target.value })}
                            />
                            <AdminInput
                                label="From Name"
                                id="from-name"
                                type="text"
                                placeholder="HomeTile Battery Report"
                                value={config.fromName}
                                onChange={(e) => updateBatteryReportConfig({ fromName: e.target.value })}
                            />
                        </div>
                        <AdminButton
                            variant="secondary"
                            onClick={handleTestSmtp}
                            disabled={isTestingSmtp || !config.smtpHost || !config.smtpUser || !config.smtpPassword}
                        >
                            {isTestingSmtp ? 'Testing...' : 'Test SMTP Connection'}
                        </AdminButton>
                        <p className="text-xs text-gray-500 mt-2">
                            For Gmail, use an App Password instead of your regular password.
                            Go to Google Account &gt; Security &gt; App Passwords to generate one.
                        </p>
                    </div>

                    {/* Recipients */}
                    <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
                        <h4 className="font-semibold text-white mb-4">Recipients</h4>
                        <div className="flex gap-2 mb-4">
                            <input
                                type="email"
                                placeholder="email@example.com"
                                value={newRecipient}
                                onChange={(e) => setNewRecipient(e.target.value)}
                                onKeyPress={(e) => e.key === 'Enter' && handleAddRecipient()}
                                className="flex-1 bg-gray-700 border border-gray-600 rounded-md p-2 text-white focus:ring-brand-blue focus:border-brand-blue"
                            />
                            <AdminButton onClick={handleAddRecipient}>
                                <IconPlus className="w-4 h-4" />
                            </AdminButton>
                        </div>
                        {(config.recipientEmails && config.recipientEmails.length > 0) ? (
                            <div className="space-y-2">
                                {config.recipientEmails.map((email, idx) => (
                                    <div key={idx} className="flex items-center justify-between bg-gray-800 p-2 rounded">
                                        <span className="text-white">{email}</span>
                                        <button
                                            onClick={() => handleRemoveRecipient(email)}
                                            className="text-red-400 hover:text-red-300 p-1"
                                        >
                                            <IconTrash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-gray-500 text-sm">No recipients configured. Add email addresses above.</p>
                        )}
                    </div>

                    {/* Test Email */}
                    <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
                        <h4 className="font-semibold text-white mb-4">Send Test Email</h4>
                        <div className="flex gap-2">
                            <input
                                type="email"
                                placeholder="test@example.com"
                                value={testEmail}
                                onChange={(e) => setTestEmail(e.target.value)}
                                className="flex-1 bg-gray-700 border border-gray-600 rounded-md p-2 text-white focus:ring-brand-blue focus:border-brand-blue"
                            />
                            <AdminButton
                                onClick={handleSendTestEmail}
                                disabled={isSendingTest || !config.smtpHost}
                            >
                                {isSendingTest ? 'Sending...' : 'Send Test'}
                            </AdminButton>
                        </div>
                        <p className="text-xs text-gray-500 mt-2">
                            Send a test report to any email address to verify your configuration.
                        </p>
                    </div>

                    {/* Report Options */}
                    <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
                        <h4 className="font-semibold text-white mb-4">Report Options</h4>
                        <div className="space-y-4">
                            <AdminInput
                                label="Report Title"
                                id="report-title"
                                type="text"
                                placeholder="Weekly Battery Status Report"
                                value={config.reportTitle}
                                onChange={(e) => updateBatteryReportConfig({ reportTitle: e.target.value })}
                            />
                            <AdminToggle
                                label="Include All Devices"
                                description="Include all devices with batteries, not just low ones"
                                enabled={config.includeAllBatteries}
                                onToggle={() => updateBatteryReportConfig({ includeAllBatteries: !config.includeAllBatteries })}
                            />
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <AdminInput
                                    label="Low Battery Threshold (%)"
                                    id="low-threshold"
                                    type="number"
                                    min="1"
                                    max="100"
                                    value={config.lowBatteryThreshold}
                                    onChange={(e) => updateBatteryReportConfig({ lowBatteryThreshold: parseInt(e.target.value) || 20 })}
                                />
                                <AdminInput
                                    label="Critical Battery Threshold (%)"
                                    id="critical-threshold"
                                    type="number"
                                    min="1"
                                    max="100"
                                    value={config.criticalBatteryThreshold}
                                    onChange={(e) => updateBatteryReportConfig({ criticalBatteryThreshold: parseInt(e.target.value) || 10 })}
                                />
                            </div>
                            <p className="text-xs text-gray-500">
                                Devices at or below the critical threshold will be highlighted in red.
                                Devices between critical and low thresholds will be highlighted in yellow/orange.
                            </p>
                        </div>
                    </div>

                    {/* Battery Predictions */}
                    <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h4 className="font-semibold text-white">Battery Predictions</h4>
                                <p className="text-xs text-gray-500 mt-1">
                                    Learn when batteries will need replacement based on usage patterns.
                                </p>
                            </div>
                            <div className="flex gap-2">
                                <AdminButton
                                    variant="secondary"
                                    onClick={recordBatteryHistory}
                                >
                                    Record Now
                                </AdminButton>
                                <AdminButton
                                    variant="secondary"
                                    onClick={fetchPredictions}
                                    disabled={isLoadingPredictions}
                                >
                                    {isLoadingPredictions ? 'Loading...' : batteryPredictions.length > 0 ? 'Refresh' : 'Load Predictions'}
                                </AdminButton>
                            </div>
                        </div>

                        {lastRecordingTime && (
                            <p className="text-xs text-gray-500 mb-3">
                                Last recorded: {new Date(lastRecordingTime).toLocaleString()}
                            </p>
                        )}

                        {batteryPredictions.length > 0 ? (
                            <div className="space-y-2">
                                {batteryPredictions.slice(0, 10).map((pred: any) => {
                                    const hasPrediction = pred.predictedCriticalDate && pred.avgDailyDrain > 0;
                                    const daysUntil = hasPrediction
                                        ? Math.ceil((new Date(pred.predictedCriticalDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                                        : null;
                                    const urgencyColor = daysUntil !== null
                                        ? daysUntil <= 7 ? 'text-red-400' : daysUntil <= 14 ? 'text-yellow-400' : 'text-green-400'
                                        : 'text-gray-500';

                                    return (
                                        <div key={pred.deviceId} className="flex items-center justify-between bg-gray-800 p-3 rounded-lg">
                                            <div className="flex-1 min-w-0">
                                                <div className="text-sm text-white truncate">{pred.deviceName}</div>
                                                <div className="text-xs text-gray-500">
                                                    {pred.currentLevel}% • {pred.avgDailyDrain ? `~${pred.avgDailyDrain.toFixed(2)}%/day drain` : 'Calculating...'}
                                                    {pred.readingCount > 0 && ` • ${pred.readingCount} readings`}
                                                </div>
                                            </div>
                                            <div className={`text-sm font-medium ${urgencyColor}`}>
                                                {hasPrediction ? (
                                                    daysUntil <= 0 ? 'Replace now' :
                                                    daysUntil === 1 ? 'Tomorrow' :
                                                    `${daysUntil} days`
                                                ) : (
                                                    pred.readingCount < 2 ? 'Need more data' : 'Stable'
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                                {batteryPredictions.length > 10 && (
                                    <p className="text-xs text-gray-500 text-center mt-2">
                                        + {batteryPredictions.length - 10} more devices
                                    </p>
                                )}
                            </div>
                        ) : (
                            <p className="text-gray-500 text-sm text-center py-4">
                                {isLoadingPredictions ? 'Loading predictions...' :
                                    'Click "Load Predictions" to see estimated battery replacement dates. Predictions improve over time as more readings are collected.'}
                            </p>
                        )}
                    </div>

                    {/* Custom Battery Types */}
                    <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
                        <div className="mb-3">
                            <h4 className="font-semibold text-white">Battery Types</h4>
                            <p className="text-xs text-gray-500 mt-1">
                                Add custom battery types to the list. Default types: CR2032, CR2450, CR123A, AA, AAA, CR2, CR2477, A23.
                            </p>
                        </div>
                        <div className="flex gap-2 mb-3">
                            <input
                                type="text"
                                value={newBatteryType}
                                onChange={(e) => setNewBatteryType(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && newBatteryType.trim()) {
                                        addCustomBatteryType(newBatteryType);
                                        setNewBatteryType('');
                                    }
                                }}
                                placeholder="e.g. CR2025, 18650"
                                className="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white focus:ring-brand-blue focus:border-brand-blue"
                            />
                            <AdminButton
                                variant="secondary"
                                onClick={() => {
                                    if (newBatteryType.trim()) {
                                        addCustomBatteryType(newBatteryType);
                                        setNewBatteryType('');
                                    }
                                }}
                                disabled={!newBatteryType.trim()}
                            >
                                Add
                            </AdminButton>
                        </div>
                        {customBatteryTypes.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                                {customBatteryTypes.map(type => (
                                    <span
                                        key={type}
                                        className="inline-flex items-center gap-1 px-2 py-1 bg-gray-700 rounded text-sm text-white"
                                    >
                                        {type}
                                        <button
                                            onClick={() => removeCustomBatteryType(type)}
                                            className="text-gray-400 hover:text-red-400 ml-1"
                                            title="Remove"
                                        >
                                            <IconX className="w-3 h-3" />
                                        </button>
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Battery Type Mappings */}
                    <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h4 className="font-semibold text-white">Battery Type Mappings</h4>
                                <p className="text-xs text-gray-500 mt-1">
                                    Assign battery types to devices for the shopping list in reports.
                                </p>
                            </div>
                            <AdminButton
                                variant="secondary"
                                onClick={fetchBatteryDevices}
                                disabled={isLoadingDevices}
                            >
                                {isLoadingDevices ? 'Loading...' : batteryDevices.length > 0 ? 'Refresh Devices' : 'Load Devices'}
                            </AdminButton>
                        </div>

                        {batteryDevices.length > 0 ? (
                            <div className="space-y-4">
                                {devicesByBatteryType.sortedKeys.map(batteryType => (
                                    <div key={batteryType} className="border border-gray-700 rounded-lg overflow-hidden">
                                        <div className={`px-3 py-2 font-medium text-sm flex items-center gap-2 ${
                                            batteryType === 'Unknown' ? 'bg-yellow-900/30 text-yellow-300' : 'bg-gray-800 text-white'
                                        }`}>
                                            <IconBattery className="w-4 h-4" />
                                            {batteryType}
                                            <span className="text-gray-500 font-normal">
                                                ({devicesByBatteryType.grouped[batteryType].length} device{devicesByBatteryType.grouped[batteryType].length !== 1 ? 's' : ''})
                                            </span>
                                        </div>
                                        <div className="divide-y divide-gray-700">
                                            {devicesByBatteryType.grouped[batteryType].map((device: any) => (
                                                <div key={device.id} className="px-3 py-2 flex items-center justify-between bg-gray-800/50">
                                                    <div className="flex-1 min-w-0">
                                                        <div className="text-sm text-white truncate">{device.name}</div>
                                                        <div className="text-xs text-gray-500 truncate">
                                                            {device.manufacturerName && device.deviceName
                                                                ? `${device.manufacturerName} - ${device.deviceName}`
                                                                : device.service}
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-2 ml-2">
                                                        <span className={`text-xs px-2 py-0.5 rounded ${
                                                            device.battery <= 10 ? 'bg-red-900/50 text-red-300' :
                                                            device.battery <= 20 ? 'bg-yellow-900/50 text-yellow-300' :
                                                            'bg-green-900/50 text-green-300'
                                                        }`}>
                                                            {device.battery}%
                                                        </span>
                                                        <div className="flex items-center gap-1">
                                                            <label className="text-xs text-gray-500">Qty:</label>
                                                            <input
                                                                type="number"
                                                                min="1"
                                                                max="20"
                                                                value={getEffectiveBatteryQuantity(device)}
                                                                onChange={(e) => updateBatteryQuantityMapping(device.id, parseInt(e.target.value) || 1)}
                                                                className="bg-gray-700 border border-gray-600 rounded px-1.5 py-1 text-xs text-white w-12 focus:ring-brand-blue focus:border-brand-blue"
                                                            />
                                                        </div>
                                                        <select
                                                            value={getEffectiveBatteryType(device)}
                                                            onChange={(e) => updateBatteryTypeMapping(device.id, e.target.value)}
                                                            className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-white focus:ring-brand-blue focus:border-brand-blue"
                                                        >
                                                            {ALL_BATTERY_TYPES.map(type => (
                                                                <option key={type} value={type}>{type}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-gray-500 text-sm text-center py-4">
                                Click "Load Devices" to see your battery-powered devices and assign battery types.
                            </p>
                        )}
                    </div>

                    {/* Configuration Summary */}
                    {config.enabled && config.smtpHost && config.recipientEmails.length > 0 && (
                        <div className="bg-green-900/20 border border-green-700 rounded-lg p-4">
                            <h4 className="font-semibold text-green-300 mb-2">Configuration Complete</h4>
                            <div className="text-sm text-gray-300 space-y-1">
                                <p>Schedule: Every {config.dayOfWeek.charAt(0).toUpperCase() + config.dayOfWeek.slice(1)} at {config.timeOfDay} ({config.timezone})</p>
                                <p>Recipients: {config.recipientEmails.length} email address(es)</p>
                                <p>Report Type: {config.includeAllBatteries ? 'All devices' : 'Low battery devices only'}</p>
                            </div>
                        </div>
                    )}
                </div>
            </AdminSection>
        </>
    );
};

// #endregion

// #region Panel Management

const PanelManager: React.FC<{ onEditPanel: (panelId: string) => void }> = ({ onEditPanel }) => {
    const { panels, addPanel, removePanel, requestInput, renamePanel, clonePanel } = useDashboard();

    const handleAddPanel = async () => {
        const name = await requestInput("Enter new panel name:");
        if (name) {
            const newPanelId = addPanel(name);
            onEditPanel(newPanelId);
        }
    };

    const handleRenamePanel = async (panelId: string, currentName: string) => {
        const newName = await requestInput("Enter new panel name:", currentName);
        if (newName && newName !== currentName) {
            renamePanel(panelId, newName);
        }
    };

    const handleClonePanel = async (panelId: string, currentName: string) => {
        const newName = await requestInput("Enter name for cloned panel:", `Copy of ${currentName}`);
        if (newName) {
            clonePanel(panelId, newName);
        }
    }

    return (
        <AdminSection title="Dashboard Panels" description="Manage your dashboard screens.">
            <div className="space-y-2">
                {panels.filter(p => !p.parentId).map(panel => (
                    <div key={panel.id} className="flex items-center justify-between bg-gray-700 p-3 rounded-md">
                        <span className="font-medium">{panel.name}</span>
                        <div className="flex items-center gap-2">
                             {/* Open the kiosk view in a new tab where the browser
                                 allows it; fall back to navigating the current tab
                                 in kiosk browsers / webviews that block new windows
                                 — so the click always does something. */}
                             <AdminButton
                                onClick={() => {
                                    const url = `${window.location.origin}${window.location.pathname}#/dashboard/${panel.id}?headless=true`;
                                    // No 'noopener' feature here: it forces window.open to return null,
                                    // which would trip the fallback even on success. Open, then sever
                                    // opener manually; fall back to same-tab nav only if truly blocked.
                                    const w = window.open(url, '_blank');
                                    if (w) { try { w.opener = null; } catch {} }
                                    else { window.location.assign(url); }
                                }}
                                variant="secondary"
                                className="!px-3 !py-1 text-sm"
                                title="Open Headless URL"
                            >
                                <IconLink className="w-4 h-4" />
                            </AdminButton>
                            <AdminButton onClick={() => onEditPanel(panel.id)} variant="secondary" className="!px-3 !py-1 text-sm" title="Edit Panel">
                                <IconPencil className="w-4 h-4" />
                            </AdminButton>
                            <AdminButton onClick={() => handleRenamePanel(panel.id, panel.name)} variant="secondary" className="!px-3 !py-1 text-sm">
                                Rename
                            </AdminButton>
                             <AdminButton onClick={() => handleClonePanel(panel.id, panel.name)} variant="secondary" className="!px-3 !py-1 text-sm" title="Clone Panel">
                                <IconCopy className="w-4 h-4" />
                            </AdminButton>
                            <AdminButton onClick={() => removePanel(panel.id)} variant="danger" className="!px-3 !py-1 text-sm" title="Delete Panel">
                                <IconTrash2 className="w-4 h-4" />
                            </AdminButton>
                        </div>
                    </div>
                ))}
            </div>
            <AdminButton onClick={handleAddPanel} className="mt-4">
                <IconPlus className="inline w-4 h-4 mr-2" /> Add Panel
            </AdminButton>
        </AdminSection>
    );
};

// #endregion

// #region Panel Editor

type DraggedItem = {
    type: 'tile' | 'highlight' | 'device';
    id: string;
    width: number;
    height: number;
    // For moving existing items, to calculate delta
    startX?: number;
    startY?: number;
    // For mouse offset within the dragged item
    offsetX: number;
    offsetY: number;
};

// --- Collision Resolution Logic ---
const shiftTilesOnDrop = (
    currentTiles: TileConfig[],
    draggedTileId: string,
    targetX: number,
    targetY: number,
    columns: number
): TileConfig[] => {
    return produce(currentTiles, draft => {
        const draggedTile = draft.find(t => t.id === draggedTileId);
        if (!draggedTile) return;

        // Place the dragged tile at its new target position
        draggedTile.x = targetX;
        draggedTile.y = targetY;

        let hasCollisions = true;
        let safetyNet = 0;
        
        while (hasCollisions && safetyNet < 100) {
            hasCollisions = false;
            safetyNet++;

            // Check all pairs of tiles for collisions
            for (const tileA of draft) {
                for (const tileB of draft) {
                    if (tileA.id === tileB.id) continue;

                    const aWidth = tileA.width || 1;
                    const aHeight = tileA.height || 1;
                    const bWidth = tileB.width || 1;
                    const bHeight = tileB.height || 1;

                    // Bounding box collision check
                    if (tileA.x! < tileB.x! + bWidth &&
                        tileA.x! + aWidth > tileB.x! &&
                        tileA.y! < tileB.y! + bHeight &&
                        tileA.y! + aHeight > tileB.y!) {
                        
                        hasCollisions = true;

                        // Decide which tile to push. Always push the one that isn't being actively dragged.
                        // If it's a secondary collision, push the one "lower" on the grid.
                        const tileToMove = (tileA.id === draggedTileId) ? tileB : tileA;
                        
                        // Push right by one column
                        tileToMove.x! += 1;
                        
                        // If it goes off the edge, move to the start of the next row
                        if (tileToMove.x! + (tileToMove.width || 1) > columns) {
                            tileToMove.x = 0;
                            tileToMove.y! += 1;
                        }
                        
                        // Break from inner loops to restart the collision check with the new layout
                        break;
                    }
                }
                if (hasCollisions) break;
            }
        }
        if (safetyNet >= 100) console.warn("Collision resolution aborted after 100 iterations.");
    });
};

const findNextFreeSpot = (
    startX: number,
    startY: number,
    tileW: number,
    tileH: number,
    tiles: TileConfig[],
    columns: number
): { x: number, y: number } => {
    let x = startX;
    let y = startY;

    const isOccupied = (checkX: number, checkY: number) => {
        for (const tile of tiles) {
            if (checkX < (tile.x || 0) + (tile.width || 1) &&
                checkX + tileW > (tile.x || 0) &&
                checkY < (tile.y || 0) + (tile.height || 1) &&
                checkY + tileH > (tile.y || 0)) {
                return true;
            }
        }
        return false;
    };

    while (isOccupied(x, y)) {
        x++;
        if (x + tileW > columns) {
            x = 0;
            y++;
        }
    }
    return { x, y };
};


const overrideableDeviceTypes = [
    DeviceType.Switch,
    DeviceType.Light,
    DeviceType.Dimmer,
    DeviceType.SmartPlug,
    DeviceType.Siren,
    DeviceType.Lock,
    DeviceType.Valve,
];

const animatableDeviceTypes = [
    DeviceType.Switch,
    DeviceType.Light,
    DeviceType.Dimmer,
    DeviceType.SmartPlug,
    DeviceType.Siren,
    DeviceType.MotionSensor,
    DeviceType.ContactSensor,
    DeviceType.Shade,
    DeviceType.PanicButton,
    DeviceType.Lock,
    DeviceType.WaterSensor,
    DeviceType.Valve,
    DeviceType.SmokeDetector,
    DeviceType.CarbonMonoxideDetector,
];

const availableIcons = [
    'Lightbulb', 'LightbulbOff', 'ShieldCheck', 'ShieldAlert', 'ShieldOff', 
    'Zap', 'Power', 'PowerOff', 'CheckCircle', 'XCircle', 'Droplets',
    'ShadeOpen', 'ShadeClosed', 'Cat'
];

const PanelEditor: React.FC<{ panelId: string, onBack: () => void }> = ({ panelId, onBack }) => {
    const {
        panels, devices, deviceMap, addTileToPanel, removeTileFromPanel,
        updateTileConfig, addFolder, requestInput, updatePanelLayoutConfig,
        updatePanelConfig, updatePanelTiles, updatePanelHighlights, sthmState, connections,
        addHighlightToPanel, removeHighlightFromPanel, updateHighlightConfig,
    } = useDashboard();
    const navigate = useNavigate();
    const gridRef = useRef<HTMLDivElement>(null);

    const [selectedTileId, setSelectedTileId] = useState<string | null>(null);
    const [selectedHighlightId, setSelectedHighlightId] = useState<string | null>(null);
    const [deviceFilter, setDeviceFilter] = useState<string>('');
    const [deviceTypeFilter, setDeviceTypeFilter] = useState<string>('ALL');
    const [draggedItem, setDraggedItem] = useState<DraggedItem | null>(null);
    const [ghostPosition, setGhostPosition] = useState<{ x: number, y: number, width: number, height: number } | null>(null);
    const [copied, setCopied] = useState(false);

    const panel = useMemo(() => panels.find(p => p.id === panelId), [panels, panelId]);
    const selectedTile = useMemo(() => panel?.tiles.find(t => t.id === selectedTileId), [panel, selectedTileId]);
    const selectedHighlight = useMemo(() => panel?.highlights?.find(h => h.id === selectedHighlightId), [panel, selectedHighlightId]);
    const sonosConnection = useMemo(() => connections.find(c => c.id === DeviceService.Sonos), [connections]);
    const stConnection = useMemo(() => connections.find(c => c.id === DeviceService.SmartThings), [connections]);

    const isSmartThingsEnabled = useMemo(() =>
        connections.some(c => c.id === DeviceService.SmartThings && c.enabled),
        [connections]
    );

    const availableDevices = useMemo(() => {
        const tilesInPanel = new Set(panel?.tiles.map(t => t.deviceId));
        let filteredDevices = devices.filter(d => !tilesInPanel.has(d.id));
        if (deviceTypeFilter !== 'ALL') {
            filteredDevices = filteredDevices.filter(device => device.type === deviceTypeFilter);
        }
        const lowercasedFilter = deviceFilter.toLowerCase().trim();
        if (lowercasedFilter) {
            filteredDevices = filteredDevices.filter(device =>
                device.name.toLowerCase().includes(lowercasedFilter) ||
                (device.location && device.location.toLowerCase().includes(lowercasedFilter))
            );
        }
        return filteredDevices;
    }, [devices, panel, deviceFilter, deviceTypeFilter]);

    // Calculate dynamic column spans for the editor layout to better represent the final dashboard
    const panelColumns = panel?.columns || 8;
    // These complete class strings are necessary for Tailwind's JIT compiler to detect them.
    // lg:col-span-2 lg:col-span-3 lg:col-span-4 lg:col-span-5 lg:col-span-6 lg:col-span-7 lg:col-span-8
    let leftPanelCls = 'lg:col-span-3';
    let middleGridCls = 'lg:col-span-6';
    let rightPanelCls = 'lg:col-span-3';

    if (panelColumns <= 5) { // For narrow grids, give more space to the settings panel
        middleGridCls = 'lg:col-span-5';
        rightPanelCls = 'lg:col-span-4';
    } else if (panelColumns >= 9 && panelColumns < 12) { // For wide grids, expand the grid and shrink settings
        middleGridCls = 'lg:col-span-7';
        rightPanelCls = 'lg:col-span-2';
    } else if (panelColumns >= 12) { // For very wide grids, expand grid further and shrink side panels
        leftPanelCls = 'lg:col-span-2';
        middleGridCls = 'lg:col-span-8';
        rightPanelCls = 'lg:col-span-2';
    }

    useEffect(() => {
        if (panel && selectedTileId && !panel.tiles.some(t => t.id === selectedTileId)) {
            setSelectedTileId(null);
        }
        if (panel && selectedHighlightId && !panel.highlights?.some(h => h.id === selectedHighlightId)) {
            setSelectedHighlightId(null);
        }
    }, [panel, selectedTileId, selectedHighlightId]);
    
    const headlessUrl = `${window.location.origin}${window.location.pathname}#/dashboard/${panelId}?headless=true`;
    
    const handleCopy = () => {
        navigator.clipboard.writeText(headlessUrl).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    const getGridCoordinates = (e: React.DragEvent): { x: number, y: number } | null => {
        if (!gridRef.current || !panel) return null;
        const rect = gridRef.current.getBoundingClientRect();
        const gap = 8; // The gap is 8px (.5rem) in the editor
        const colWidth = (rect.width - (panel.columns! - 1) * gap) / panel.columns!;
        const rowHeight = (panel.rowHeight || 120) * 0.75;
        
        let x = e.clientX - rect.left - (draggedItem?.offsetX || 0);
        let y = e.clientY - rect.top - (draggedItem?.offsetY || 0);
        
        const gridX = Math.round(x / (colWidth + gap));
        const gridY = Math.round(y / (rowHeight + gap));

        return { x: Math.max(0, gridX), y: Math.max(0, gridY) };
    }

    const handleDragStart = (e: React.DragEvent, type: 'tile' | 'highlight' | 'device', id: string) => {
        const rect = (e.target as HTMLElement).getBoundingClientRect();
        const offsetX = e.clientX - rect.left;
        const offsetY = e.clientY - rect.top;

        if (type === 'tile') {
            const tile = panel?.tiles.find(t => t.id === id);
            if (!tile) return;
            setDraggedItem({ type, id, width: tile.width || 1, height: tile.height || 1, startX: tile.x, startY: tile.y, offsetX, offsetY });
        } else if (type === 'highlight') {
            const highlight = panel?.highlights?.find(h => h.id === id);
            if (!highlight) return;
            setDraggedItem({ type, id, width: highlight.width, height: highlight.height, startX: highlight.x, startY: highlight.y, offsetX, offsetY });
        } else { // device
            setDraggedItem({ type, id, width: 1, height: 1, offsetX, offsetY });
        }
        e.dataTransfer.effectAllowed = 'move';
        // Use a transparent image to hide the default browser drag preview
        const img = new Image();
        img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        e.dataTransfer.setDragImage(img, 0, 0);
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        if (!draggedItem) return;
        const pos = getGridCoordinates(e);
        if (pos) {
            setGhostPosition({ ...pos, width: draggedItem.width, height: draggedItem.height });
        }
    };
    
    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        if (!draggedItem || !panel) return;
    
        const pos = getGridCoordinates(e);
        if (!pos) {
            setDraggedItem(null);
            setGhostPosition(null);
            return;
        }
    
        if (draggedItem.type === 'device') {
            const finalPos = findNextFreeSpot(pos.x, pos.y, 1, 1, panel.tiles, panel.columns || 8);
            addTileToPanel(panelId, draggedItem.id, finalPos);
        } else if (draggedItem.type === 'tile') {
            const updatedTiles = shiftTilesOnDrop(panel.tiles, draggedItem.id, pos.x, pos.y, panel.columns || 8);
            updatePanelTiles(panelId, updatedTiles);
        } else if (draggedItem.type === 'highlight') {
            const dx = pos.x - (draggedItem.startX ?? 0);
            const dy = pos.y - (draggedItem.startY ?? 0);
            
            const containedTileIds = new Set(
                panel.tiles.filter(t =>
                    t.x! >= draggedItem.startX! && t.x! + (t.width || 1) <= draggedItem.startX! + draggedItem.width &&
                    t.y! >= draggedItem.startY! && t.y! + (t.height || 1) <= draggedItem.startY! + draggedItem.height
                ).map(t => t.id)
            );

            const newTiles = panel.tiles.map(t => {
                if (containedTileIds.has(t.id)) {
                    return { ...t, x: t.x! + dx, y: t.y! + dy };
                }
                return t;
            });
            updatePanelTiles(panelId, newTiles);
            
            const newHighlights = (panel.highlights || []).map(h => 
                h.id === draggedItem.id ? { ...h, x: pos.x, y: pos.y } : h
            );
            updatePanelHighlights(panelId, newHighlights);
        }
    
        setDraggedItem(null);
        setGhostPosition(null);
    };

    const handleAddFolder = async () => {
        if (!panel) return;
        const folderName = await requestInput("Enter folder name:");
        if (folderName) {
            addFolder(panel.id, folderName);
        }
    };
    
     const handleDoubleClickTile = (tile: TileConfig) => {
        const device = deviceMap.get(tile.deviceId);
        if (device && device.type === DeviceType.Folder) {
            const folderPanelId = (device.state as any)?.panelId;
            if (folderPanelId) {
                navigate(`/admin?panel=${folderPanelId}`);
            }
        }
    }

    const updateDisplayOverride = (field: keyof TileDisplayOverride, value: any) => {
        if (!selectedTile) return;
        const newOverrides = { ...(selectedTile.displayOverride || {}), [field]: value };
        updateTileConfig(panelId, selectedTile.id, { displayOverride: newOverrides });
    };

    const updateAnimationConfig = (field: keyof TileAnimationConfig, value: any) => {
        if (!selectedTile) return;
        if (field === 'enabled' && !value) {
            updateTileConfig(panelId, selectedTile.id, { animation: undefined });
        } else {
            const newAnimationConfig = { 
                ...(selectedTile.animation || {}), 
                [field]: value 
            };
            if (field === 'enabled' && value && !selectedTile.animation) {
                newAnimationConfig.effect = 'pulse';
                newAnimationConfig.color = '#00aaff';
            }
            updateTileConfig(panelId, selectedTile.id, { animation: newAnimationConfig });
        }
    };
    
    if (!panel) return <div>Panel not found</div>;
    
    const selectedDevice = selectedTile ? deviceMap.get(selectedTile.deviceId) : null;
    const canOverride = selectedDevice && overrideableDeviceTypes.includes(selectedDevice.type);
    const canAnimate = selectedDevice && animatableDeviceTypes.includes(selectedDevice.type);

    return (
        <div className="flex flex-col h-full">
            <div className="flex items-center gap-3 mb-4">
                <button onClick={onBack} className="p-2 rounded-full hover:bg-gray-700"><IconArrowLeft className="w-5 h-5" /></button>
                <h2 className="text-2xl font-bold">Editing: {panel.name}</h2>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1">
                {/* Available Devices List */}
                <div className={`${leftPanelCls} bg-gray-800 p-4 rounded-lg overflow-y-auto h-[calc(100vh-200px)]`}>
                    <h3 className="font-semibold mb-3">Available Devices</h3>
                    <div className="mb-3 space-y-2">
                        <input
                            type="text"
                            placeholder="Filter by name/location..."
                            value={deviceFilter}
                            onChange={e => setDeviceFilter(e.target.value)}
                            className="w-full bg-gray-700 border border-gray-600 rounded-md p-2 text-white focus:ring-brand-blue focus:border-brand-blue"
                            aria-label="Filter available devices by name or location"
                        />
                         <select
                            value={deviceTypeFilter}
                            onChange={e => setDeviceTypeFilter(e.target.value)}
                            className="w-full bg-gray-700 border border-gray-600 rounded-md p-2 text-white focus:ring-brand-blue focus:border-brand-blue"
                            aria-label="Filter available devices by type"
                        >
                            <option value="ALL">All Types</option>
                            {Object.values(DeviceType)
                                .sort((a, b) => a.localeCompare(b))
                                .map(type => (
                                <option key={type} value={type}>
                                    {type.replace(/_/g, ' ').replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase())}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="space-y-2">
                        {stConnection && !stConnection.enabled && (
                            <div className="p-2 text-xs text-center text-yellow-200 bg-yellow-800/40 rounded-md border border-yellow-700/60">
                                Enable <strong>SmartThings</strong> in Connections to see devices.
                            </div>
                        )}
                        {sonosConnection && !sonosConnection.enabled && (
                            <div className="p-2 text-xs text-center text-yellow-200 bg-yellow-800/40 rounded-md border border-yellow-700/60">
                                Enable <strong>Sonos</strong> in Connections to see players.
                            </div>
                        )}
                        <button onClick={handleAddFolder} draggable onDragStart={(e) => e.preventDefault()} className="w-full flex items-center gap-3 text-left p-2 rounded-md hover:bg-gray-700 bg-yellow-600/20 border border-yellow-500">
                            <IconFolder className="w-6 h-6 text-yellow-400" />
                            <div>
                                <p className="font-semibold text-white">Add New Folder</p>
                                <p className="text-xs text-gray-400">Create a sub-panel</p>
                            </div>
                        </button>
                         <button onClick={() => addHighlightToPanel(panelId)} draggable onDragStart={(e) => e.preventDefault()} className="w-full flex items-center gap-3 text-left p-2 rounded-md hover:bg-gray-700 bg-purple-600/20 border border-purple-500">
                            <IconLayoutGrid className="w-6 h-6 text-purple-400" />
                            <div>
                                <p className="font-semibold text-white">Add Highlight Section</p>
                                <p className="text-xs text-gray-400">Visually group tiles</p>
                            </div>
                        </button>
                        {isSmartThingsEnabled && !panel.tiles.some(t => t.deviceId === 'hometile-sthm-panel') && (
                            <div 
                                key="hometile-sthm-panel" 
                                draggable 
                                onDragStart={(e) => handleDragStart(e, 'device', 'hometile-sthm-panel')}
                                className="flex items-center gap-3 p-2 rounded-md hover:bg-gray-700 cursor-grab bg-blue-900/30 border border-blue-600"
                            >
                                <TilePreviewIcon type={DeviceType.AlarmPanel} />
                                <div className="flex-1 min-w-0">
                                    <p className="font-semibold truncate">STHM Security Panel</p>
                                    <div className="flex items-center gap-1.5 text-xs text-gray-400">
                                        <ServiceSourceIcon service={DeviceService.SmartThings} />
                                        <span className="truncate">{sthmState ? sthmState.locationName : 'SmartThings'}</span>
                                    </div>
                                </div>
                            </div>
                        )}
                        {availableDevices.map(device => (
                            <div key={device.id} draggable onDragStart={(e) => handleDragStart(e, 'device', device.id)} className="flex items-center gap-3 p-2 rounded-md hover:bg-gray-700 cursor-grab">
                                <TilePreviewIcon type={device.type} />
                                <div className="flex-1 min-w-0">
                                    <p className="font-semibold truncate" title={device.name}>{device.name}</p>
                                    <div className="flex items-center gap-1.5 text-xs text-gray-400">
                                        <ServiceSourceIcon service={device.service} />
                                        <span className="truncate" title={device.location || device.service}>{device.location || device.service}</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Panel Grid Preview */}
                <div
                    ref={gridRef}
                    className={`${middleGridCls} bg-gray-900 p-4 rounded-lg overflow-y-auto h-[calc(100vh-200px)] relative`}
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                    onDragEnd={() => { setDraggedItem(null); setGhostPosition(null); }}
                >
                    <div
                        className="grid gap-2 min-h-full"
                        style={{
                            gridTemplateColumns: `repeat(${panel.columns || 8}, minmax(0, 1fr))`,
                            gridAutoRows: `${(panel.rowHeight || 120) * 0.75}px`,
                        }}
                    >
                        {/* Render Highlights */}
                        {panel.highlights?.map(highlight => (
                            <div
                                key={highlight.id}
                                draggable
                                onDragStart={(e) => handleDragStart(e, 'highlight', highlight.id)}
                                onClick={() => { setSelectedHighlightId(highlight.id); setSelectedTileId(null); }}
                                className={`relative group cursor-pointer transition-all ${selectedHighlightId === highlight.id ? 'ring-2 ring-brand-blue rounded-lg' : ''} ${draggedItem?.id === highlight.id ? 'opacity-30' : ''}`}
                                style={{
                                    gridColumn: `${highlight.x + 1} / span ${highlight.width}`,
                                    gridRow: `${highlight.y + 1} / span ${highlight.height}`,
                                    zIndex: 1,
                                }}
                            >
                                <div className="w-full h-full border-2 border-dashed border-gray-600 rounded-lg bg-gray-700/20 flex items-center justify-center p-2">
                                    {highlight.label && (
                                        <span className="text-sm font-bold text-gray-500 truncate">{highlight.label}</span>
                                    )}
                                </div>
                                <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                                    <button onClick={(e) => { e.stopPropagation(); removeHighlightFromPanel(panel.id, highlight.id); }} className="p-1.5 bg-red-600/80 backdrop-blur-sm rounded-full text-white hover:bg-red-500">
                                        <IconX className="w-3 h-3" />
                                    </button>
                                </div>
                            </div>
                        ))}

                        {/* Render Tiles */}
                        {panel.tiles.map(tile => {
                            let device = deviceMap.get(tile.deviceId);
                            // Special handling for STHM tile
                            if (tile.deviceId === 'hometile-sthm-panel' && sthmState) {
                                device = {
                                    id: 'hometile-sthm-panel',
                                    name: `${sthmState.locationName} Monitor`,
                                    type: DeviceType.AlarmPanel,
                                    service: DeviceService.Virtual,
                                    state: sthmState,
                                };
                            }
                            return (
                                <div
                                    key={tile.id}
                                    draggable
                                    onDragStart={(e) => handleDragStart(e, 'tile', tile.id)}
                                    onClick={() => { setSelectedTileId(tile.id); setSelectedHighlightId(null); }}
                                    onDoubleClick={() => handleDoubleClickTile(tile)}
                                    className={`relative group cursor-pointer rounded-lg transition-all ${draggedItem?.id === tile.id ? 'opacity-30' : ''} ${selectedTileId === tile.id ? 'ring-2 ring-brand-blue' : ''}`}
                                    style={{
                                        gridColumn: `${(tile.x ?? 0) + 1} / span ${tile.width || 1}`,
                                        gridRow: `${(tile.y ?? 0) + 1} / span ${tile.height || 1}`,
                                        zIndex: 0,
                                    }}
                                >
                                    <div className="w-full h-full pointer-events-none">
                                        <Tile tile={tile} device={device} isEditor />
                                    </div>
                                    <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                                        <button onClick={(e) => { e.stopPropagation(); removeTileFromPanel(panel.id, tile.id); }} className="p-1.5 bg-red-600/80 backdrop-blur-sm rounded-full text-white hover:bg-red-500">
                                            <IconX className="w-3 h-3" />
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                         {/* Ghost element for drag preview */}
                        {ghostPosition && (
                            <div
                                className="bg-brand-blue/30 border-2 border-dashed border-brand-blue rounded-lg pointer-events-none"
                                style={{
                                    gridColumn: `${ghostPosition.x + 1} / span ${ghostPosition.width}`,
                                    gridRow: `${ghostPosition.y + 1} / span ${ghostPosition.height}`,
                                    zIndex: 20,
                                }}
                            />
                        )}
                    </div>
                </div>

                {/* Settings Inspector */}
                <div className={`${rightPanelCls} bg-gray-800 p-4 rounded-lg overflow-y-auto h-[calc(100vh-200px)]`}>
                    <h3 className="font-semibold mb-3 border-b border-gray-700 pb-2">Settings</h3>
                    <div className="space-y-4">
                        {selectedTile ? (
                            <div>
                                <h4 className="font-medium mb-3 text-lg truncate" title={selectedDevice?.name || (selectedTile.deviceId === 'hometile-sthm-panel' ? 'STHM Security Panel' : '')}>
                                    Tile: {selectedDevice?.name || (selectedTile.deviceId === 'hometile-sthm-panel' ? 'STHM Security Panel' : 'Selected Tile')}
                                </h4>
                                <div className="space-y-3">
                                    <div>
                                        <label htmlFor={`label-${selectedTile.id}`} className="block mb-1 text-sm font-medium text-gray-400">Label</label>
                                        <div className="flex items-center gap-2">
                                            <input
                                                id={`label-${selectedTile.id}`}
                                                type="text"
                                                value={selectedTile.label || ''}
                                                onChange={e => updateTileConfig(panelId, selectedTile.id, { 'label': e.target.value })}
                                                placeholder={selectedDevice?.name || ''}
                                                className="flex-grow bg-gray-700 border border-gray-600 rounded-md p-2 text-white focus:ring-brand-blue focus:border-brand-blue"
                                            />
                                            <button
                                                onClick={() => updateTileConfig(panelId, selectedTile.id, { 'label': selectedDevice?.name || '' })}
                                                className="p-2 bg-gray-600 rounded-md hover:bg-gray-500"
                                                title="Use device name"
                                            >
                                                <IconArrowLeft className="w-4 h-4" />
                                            </button>
                                        </div>
                                         <p className="text-xs text-gray-500 mt-1">Leave blank to use the default device name.</p>
                                    </div>
                                    <AdminInput label="Width (columns)" id={`width-${selectedTile.id}`} type="number" min="1" max={panel.columns} value={selectedTile.width || 1} onChange={e => updateTileConfig(panelId, selectedTile.id, { 'width': parseInt(e.target.value) })} />
                                    <AdminInput label="Height (rows)" id={`height-${selectedTile.id}`} type="number" min="1" max="10" value={selectedTile.height || 1} onChange={e => updateTileConfig(panelId, selectedTile.id, { 'height': parseInt(e.target.value) })} />
                                    
                                    {selectedDevice?.type === DeviceType.Folder && (
                                        <AdminSelect
                                            label="Folder Icon"
                                            id={`folder-icon-${selectedTile.id}`}
                                            value={selectedTile.folderIcon || ''}
                                            onChange={e => updateTileConfig(panelId, selectedTile.id, { 'folderIcon': e.target.value })}
                                        >
                                            <option value="">Default (Folder)</option>
                                            <option value="Lightbulb">Lights</option>
                                            <option value="Square">Shades</option>
                                            <option value="Sun">Scenes</option>
                                            <option value="Shield">Security</option>
                                            <option value="Camera">Cameras</option>
                                            <option value="Music">Audio</option>
                                            <option value="Flame">Climate</option>
                                            <option value="LayoutGrid">More</option>
                                            <option value="Home">Home</option>
                                            <option value="Cat">Litter</option>
                                        </AdminSelect>
                                    )}

                                    {selectedTile.deviceId !== 'hometile-sthm-panel' && (
                                        <>
                                            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer py-2">
                                                <input
                                                    type="checkbox"
                                                    checked={!!selectedTile.isLocked}
                                                    onChange={e => updateTileConfig(panelId, selectedTile.id, { 
                                                        isLocked: e.target.checked,
                                                        requirePin: e.target.checked ? false : selectedTile.requirePin
                                                    })}
                                                    className="accent-brand-blue w-4 h-4"
                                                />
                                                Lock Tile (Interaction Disabled)
                                            </label>
                                            <label className={`flex items-center gap-2 text-sm py-2 ${selectedTile.isLocked ? 'text-gray-500 cursor-not-allowed' : 'text-gray-300 cursor-pointer'}`}>
                                                <input
                                                    type="checkbox"
                                                    checked={!!selectedTile.requirePin}
                                                    onChange={e => updateTileConfig(panelId, selectedTile.id, { 'requirePin': e.target.checked })}
                                                    className="accent-brand-blue w-4 h-4"
                                                    disabled={!!selectedTile.isLocked}
                                                />
                                                Require PIN for interaction
                                            </label>
                                        </>
                                    )}

                                    {selectedDevice?.type === DeviceType.Camera && (
                                        <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer py-2">
                                            <input type="checkbox" checked={!!selectedTile.cameraEnlargeOnClick} onChange={e => updateTileConfig(panelId, selectedTile.id, { 'cameraEnlargeOnClick': e.target.checked })} className="accent-brand-blue w-4 h-4" />
                                            Enlarge camera on click
                                        </label>
                                    )}

                                    {canOverride && (
                                        <div className="pt-3 mt-3 border-t border-gray-700 space-y-3">
                                            <h5 className="font-medium text-gray-200">Display Overrides</h5>
                                            <AdminInput label="On Label" value={selectedTile.displayOverride?.onLabel || ''} onChange={e => updateDisplayOverride('onLabel', e.target.value)} placeholder="On" />
                                            <AdminInput label="Off Label" value={selectedTile.displayOverride?.offLabel || ''} onChange={e => updateDisplayOverride('offLabel', e.target.value)} placeholder="Off" />
                                            <AdminSelect label="On Icon" value={selectedTile.displayOverride?.onIcon || ''} onChange={e => updateDisplayOverride('onIcon', e.target.value)}>
                                                <option value="">Default</option>
                                                {availableIcons.map(icon => <option key={icon} value={icon}>{icon}</option>)}
                                            </AdminSelect>
                                            <AdminSelect label="Off Icon" value={selectedTile.displayOverride?.offIcon || ''} onChange={e => updateDisplayOverride('offIcon', e.target.value)}>
                                                <option value="">Default</option>
                                                {availableIcons.map(icon => <option key={icon} value={icon}>{icon}</option>)}
                                            </AdminSelect>
                                            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer py-2">
                                                <input type="checkbox" checked={!!selectedTile.displayOverride?.invertState} onChange={e => updateDisplayOverride('invertState', e.target.checked)} className="accent-brand-blue w-4 h-4" />
                                                Invert State (On means Off)
                                            </label>
                                        </div>
                                    )}

                                    {canAnimate && (
                                        <div className="pt-3 mt-3 border-t border-gray-700 space-y-3">
                                            <h5 className="font-medium text-gray-200">Active State Animation</h5>
                                            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer py-2">
                                                <input
                                                    type="checkbox"
                                                    checked={!!selectedTile.animation?.enabled}
                                                    onChange={e => updateAnimationConfig('enabled', e.target.checked)}
                                                    className="accent-brand-blue w-4 h-4"
                                                />
                                                Enable Animation
                                            </label>
                                            {selectedTile.animation?.enabled && (
                                                <div className="space-y-3 pl-6 border-l-2 border-gray-700">
                                                    <AdminSelect
                                                        label="Animation Effect"
                                                        value={selectedTile.animation?.effect || 'pulse'}
                                                        onChange={e => updateAnimationConfig('effect', e.target.value as 'pulse' | 'bounce')}
                                                    >
                                                        <option value="pulse">Pulse</option>
                                                        <option value="bounce">Bounce</option>
                                                    </AdminSelect>
                                                    <AdminInput
                                                        label="Animation Color"
                                                        type="color"
                                                        value={selectedTile.animation?.color || '#00aaff'}
                                                        onChange={e => updateAnimationConfig('color', e.target.value)}
                                                        className="h-10 p-1"
                                                    />
                                                    <p className="text-xs text-gray-500 mt-1">
                                                        Select a color for the animation glow.
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                </div>
                            </div>
                        ) : selectedHighlight ? (
                             <div>
                                <h4 className="font-medium mb-3 text-lg">Highlight Section</h4>
                                 <div className="space-y-4">
                                    <AdminInput label="Label" id={`label-${selectedHighlight.id}`} type="text" value={selectedHighlight.label || ''} onChange={e => updateHighlightConfig(panelId, selectedHighlight.id, { label: e.target.value })} placeholder="e.g., Living Room" />
                                    <div className="grid grid-cols-2 gap-3">
                                        <AdminInput label="X (column)" id={`x-${selectedHighlight.id}`} type="number" min="0" max={(panel.columns || 8) - 1} value={selectedHighlight.x} onChange={e => updateHighlightConfig(panelId, selectedHighlight.id, { x: parseInt(e.target.value, 10) })} />
                                        <AdminInput label="Y (row)" id={`y-${selectedHighlight.id}`} type="number" min="0" value={selectedHighlight.y} onChange={e => updateHighlightConfig(panelId, selectedHighlight.id, { y: parseInt(e.target.value, 10) })} />
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <AdminInput label="Width" id={`width-${selectedHighlight.id}`} type="number" min="1" max={panel.columns} value={selectedHighlight.width} onChange={e => updateHighlightConfig(panelId, selectedHighlight.id, { width: parseInt(e.target.value, 10) })} />
                                        <AdminInput label="Height" id={`height-${selectedHighlight.id}`} type="number" min="1" max="20" value={selectedHighlight.height} onChange={e => updateHighlightConfig(panelId, selectedHighlight.id, { height: parseInt(e.target.value, 10) })} />
                                    </div>
                                    <div className="pt-3 mt-3 border-t border-gray-700 space-y-3">
                                        <h5 className="font-medium text-gray-200">Appearance</h5>
                                        <AdminSelect label="Background Style" id={`bgstyle-${selectedHighlight.id}`} value={selectedHighlight.backgroundStyle || 'default'} onChange={e => updateHighlightConfig(panelId, selectedHighlight.id, { backgroundStyle: e.target.value as any })}>
                                            <option value="default">Subtle</option>
                                            <option value="glow">Glow</option>
                                        </AdminSelect>
                                        {selectedHighlight.backgroundStyle === 'glow' && (
                                            <AdminInput
                                                label="Glow Color"
                                                type="color"
                                                id={`glowcolor-${selectedHighlight.id}`}
                                                value={selectedHighlight.glowColor || '#ffffff'}
                                                onChange={e => updateHighlightConfig(panelId, selectedHighlight.id, { glowColor: e.target.value })}
                                                className="h-10 p-1"
                                            />
                                        )}
                                    </div>
                                 </div>
                             </div>
                        ) : (
                            <div>
                                <h4 className="font-medium mb-3 text-lg">Panel Settings</h4>
                                <div className="space-y-3">
                                     <AdminInput label="Grid Columns" type="number" id="gridCols" min="1" max="20" value={panel.columns} onChange={(e) => updatePanelLayoutConfig(panelId, { columns: parseInt(e.target.value, 10) })} />
                                     <AdminInput label="Row Height (px)" type="number" id="rowHeight" min="20" max="300" step="10" value={panel.rowHeight} onChange={(e) => updatePanelLayoutConfig(panelId, { rowHeight: parseInt(e.target.value, 10) })} />
                                     
                                     {/* Theme Selector — only on top-level panels. Sub-panels
                                         inherit their root dashboard's theme. */}
                                     {panel.parentId ? (
                                        <div>
                                            <label className="block mb-1 text-sm font-medium text-gray-400">Theme Mode</label>
                                            <p className="text-xs text-gray-400 bg-gray-900/50 border border-gray-700 rounded p-2">
                                                This sub-panel follows its top-level dashboard's theme. Set Light / Dark / Automatic on the parent panel.
                                            </p>
                                        </div>
                                     ) : (
                                        <AdminSelect
                                            label="Theme Mode"
                                            id="themeMode"
                                            value={panel.themeMode || 'dark'}
                                            onChange={(e) => updatePanelConfig(panelId, { themeMode: e.target.value as any })}
                                        >
                                            <option value="dark">Dark (Default)</option>
                                            <option value="light">Light</option>
                                            <option value="auto">Automatic (Sunset/Sunrise)</option>
                                        </AdminSelect>
                                     )}

                                     <AdminToggle
                                        label="Show Tile Borders"
                                        description="Adds a subtle border around each tile for better contrast and depth."
                                        enabled={panel.showTileBorders ?? true}
                                        onToggle={() => updatePanelConfig(panelId, { showTileBorders: !(panel.showTileBorders ?? true) })}
                                     />

                                     <AdminToggle
                                        label="Show SmartThings Intrusion Alerts"
                                        description="Shows the STHM status in the header and displays a full-screen alert on intrusion."
                                        enabled={!!panel.showSTHMAlerts}
                                        onToggle={() => updatePanelConfig(panelId, { showSTHMAlerts: !panel.showSTHMAlerts })}
                                     />
                                      <AdminToggle
                                        label="Show Arming Status Indicator"
                                        description="Shows the status from the configured Arming Status Source device in the header."
                                        enabled={!!panel.showArmingStatus}
                                        onToggle={() => updatePanelConfig(panelId, { showArmingStatus: !panel.showArmingStatus })}
                                     />
                                </div>

                                <div className="mt-6 pt-4 border-t border-gray-700">
                                    <h5 className="font-medium mb-2 text-white">Idle Behavior (Native iPad App)</h5>
                                    <p className="text-xs text-gray-500 mb-3">Controls what the native iPadOS B-Panels app does after a period of inactivity. Ignored by browser-based panels.</p>
                                    <div className="space-y-3">
                                        <AdminSelect
                                            label="Idle Mode"
                                            id="idleMode"
                                            value={panel.idleConfig?.mode || 'always-on'}
                                            onChange={(e) => updatePanelConfig(panelId, { idleConfig: { ...(panel.idleConfig || {}), mode: e.target.value as IdleMode } })}
                                        >
                                            <option value="always-on">Always On (screen never sleeps)</option>
                                            <option value="screen-off">Screen Off (black after idle)</option>
                                            <option value="screen-saver">Screen Saver (custom view after idle)</option>
                                        </AdminSelect>

                                        {(panel.idleConfig?.mode === 'screen-off' || panel.idleConfig?.mode === 'screen-saver') && (
                                            <AdminInput
                                                label="Idle Timeout (seconds)"
                                                type="number"
                                                id="idleTimeoutSeconds"
                                                min="10"
                                                max="3600"
                                                step="10"
                                                value={panel.idleConfig?.idleTimeoutSeconds ?? 300}
                                                onChange={(e) => updatePanelConfig(panelId, { idleConfig: { mode: panel.idleConfig?.mode || 'always-on', ...(panel.idleConfig || {}), idleTimeoutSeconds: parseInt(e.target.value, 10) || 300 } })}
                                            />
                                        )}

                                        {panel.idleConfig?.mode === 'screen-saver' && (
                                            <>
                                                <AdminInput
                                                    label="Screen Saver Text"
                                                    type="text"
                                                    id="screenSaverText"
                                                    placeholder="Tap to wake"
                                                    value={panel.idleConfig?.screenSaverText || ''}
                                                    onChange={(e) => updatePanelConfig(panelId, { idleConfig: { mode: 'screen-saver', ...(panel.idleConfig || {}), screenSaverText: e.target.value } })}
                                                />
                                                <AdminInput
                                                    label="Screen Saver Background Color"
                                                    type="color"
                                                    id="screenSaverBackgroundColor"
                                                    value={panel.idleConfig?.screenSaverBackgroundColor || '#000000'}
                                                    onChange={(e) => updatePanelConfig(panelId, { idleConfig: { mode: 'screen-saver', ...(panel.idleConfig || {}), screenSaverBackgroundColor: e.target.value } })}
                                                    className="h-10 p-1"
                                                />
                                                <AdminInput
                                                    label="Screen Saver Background Image URL (optional)"
                                                    type="text"
                                                    id="screenSaverBackgroundImageUrl"
                                                    placeholder="https://…"
                                                    value={panel.idleConfig?.screenSaverBackgroundImageUrl || ''}
                                                    onChange={(e) => updatePanelConfig(panelId, { idleConfig: { mode: 'screen-saver', ...(panel.idleConfig || {}), screenSaverBackgroundImageUrl: e.target.value } })}
                                                />
                                                <AdminToggle
                                                    label="Show Clock"
                                                    description="Overlay the current time on the screen saver."
                                                    enabled={!!panel.idleConfig?.screenSaverShowClock}
                                                    onToggle={() => updatePanelConfig(panelId, { idleConfig: { mode: 'screen-saver', ...(panel.idleConfig || {}), screenSaverShowClock: !panel.idleConfig?.screenSaverShowClock } })}
                                                />
                                            </>
                                        )}

                                        {panel.idleConfig?.mode !== 'always-on' && (
                                            <AdminToggle
                                                label="Motion Wake (iOS, front camera)"
                                                description="While idle, use the iPad's front camera to detect movement and wake the screen — like a touch. Off by default; requires camera permission and uses some battery."
                                                enabled={!!panel.idleConfig?.motionWakeEnabled}
                                                onToggle={() => updatePanelConfig(panelId, { idleConfig: { mode: panel.idleConfig?.mode || 'always-on', ...(panel.idleConfig || {}), motionWakeEnabled: !panel.idleConfig?.motionWakeEnabled } })}
                                            />
                                        )}
                                    </div>

                                    <KioskScheduleEditor
                                        kind="dim"
                                        title="Brightness Schedule (iOS Kiosk)"
                                        description="Time-of-day brightness for the native iOS app on this panel. First matching window wins."
                                        windows={panel.idleConfig?.dimSchedule}
                                        onChange={(next) => updatePanelConfig(panelId, {
                                            idleConfig: {
                                                mode: panel.idleConfig?.mode || 'always-on',
                                                ...(panel.idleConfig || {}),
                                                dimSchedule: next.length > 0 ? next : undefined,
                                            }
                                        })}
                                    />

                                    <KioskScheduleEditor
                                        kind="mute"
                                        title="Mute Schedule (iOS Kiosk)"
                                        description="When inside one of these windows, the native iOS app suppresses TTS and sound-effect playback. Intrusion alarms still fire."
                                        windows={panel.idleConfig?.muteSchedule}
                                        onChange={(next) => updatePanelConfig(panelId, {
                                            idleConfig: {
                                                mode: panel.idleConfig?.mode || 'always-on',
                                                ...(panel.idleConfig || {}),
                                                muteSchedule: next.length > 0 ? next : undefined,
                                            }
                                        })}
                                    />
                                </div>

                                <div className="mt-6 pt-4 border-t border-gray-700">
                                    <label htmlFor="headless-url" className="block mb-2 text-sm font-medium text-gray-400">Panel Headless URL</label>
                                    <div className="flex gap-2">
                                        <input 
                                            id="headless-url" 
                                            type="text" 
                                            readOnly 
                                            value={headlessUrl} 
                                            className="w-full bg-gray-900 border border-gray-600 rounded-md p-2 text-gray-300 font-mono text-xs" 
                                            onFocus={(e) => e.target.select()}
                                        />
                                        <AdminButton onClick={handleCopy} variant="secondary" className="!px-3 w-[88px] flex-shrink-0">
                                            {copied ? 'Copied!' : <IconCopy className="w-4 h-4 mx-auto" />}
                                        </AdminButton>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-2">Use this URL for wall-mounted tablets to hide admin controls.</p>
                                </div>

                                <p className="text-sm text-gray-400 mt-6 p-3 bg-gray-700 rounded-md">Select a tile or section in the grid to edit its specific properties.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};


// #endregion

// #region Other Managers

// Read-only "Discovered Devices" view: lists the entities the dashboard now
// sees from Home Assistant, sourced from the capability layer. Its main value
// is surfacing entities that previously fell through to UnknownTile (now typed
// DeviceType.Generic via capability inference) so a newly-installed HA/HACS
// integration can be found and placed without code edits. No mutations here —
// placement still happens in the panel editor.
const DiscoveredDevicesManager = () => {
    const { devices, addNotification } = useDashboard();
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState<'all' | 'new'>('all');
    const [domainFilter, setDomainFilter] = useState('');

    const haDevices = useMemo(
        () => devices.filter(d => d.service === DeviceService.HomeAssistant),
        [devices]
    );

    const domains = useMemo(() => {
        const set = new Set<string>();
        haDevices.forEach(d => { const dom = d.capabilityData?.domain; if (dom) set.add(dom); });
        return Array.from(set).sort();
    }, [haDevices]);

    const genericCount = useMemo(
        () => haDevices.filter(d => d.type === DeviceType.Generic).length,
        [haDevices]
    );

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return haDevices.filter(d => {
            if (filter === 'new' && d.type !== DeviceType.Generic) return false;
            if (domainFilter && d.capabilityData?.domain !== domainFilter) return false;
            if (q && !(d.name.toLowerCase().includes(q) || d.id.toLowerCase().includes(q))) return false;
            return true;
        });
    }, [haDevices, search, filter, domainFilter]);

    const stateText = (d: Device): string => {
        const raw = d.capabilityData?.rawState;
        const val = raw !== undefined && raw !== null && raw !== '' ? String(raw) : String(d.state ?? '—');
        const unit = d.capabilityData?.unit;
        return unit && /^-?\d/.test(val) ? `${val} ${unit}` : val;
    };

    const copyId = (id: string) => {
        try {
            navigator.clipboard?.writeText(id);
            addNotification(`Copied ${id}`, 'success');
        } catch {
            addNotification('Could not copy to clipboard', 'error');
        }
    };

    const FilterPill = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
        <button
            onClick={onClick}
            className={`px-3 py-1.5 rounded-md text-sm transition-colors ${active ? 'bg-brand-blue text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
        >
            {children}
        </button>
    );

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold text-white mb-1">Discovered Devices</h2>
                <p className="text-gray-400 text-sm">
                    Entities the dashboard currently sees from Home Assistant. Items tagged{' '}
                    <span className="text-brand-blue font-semibold">New</span> are now supported
                    via capability inference and would previously have failed to render — place them
                    on a panel from the editor.
                </p>
            </div>

            {/* Summary */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="bg-gray-800 rounded-lg p-4">
                    <p className="text-2xl font-bold text-white tabular-nums">{haDevices.length}</p>
                    <p className="text-gray-400 text-sm">HA entities</p>
                </div>
                <div className="bg-gray-800 rounded-lg p-4">
                    <p className="text-2xl font-bold text-brand-blue tabular-nums">{genericCount}</p>
                    <p className="text-gray-400 text-sm">Newly supported</p>
                </div>
                <div className="bg-gray-800 rounded-lg p-4">
                    <p className="text-2xl font-bold text-white tabular-nums">{domains.length}</p>
                    <p className="text-gray-400 text-sm">Domains</p>
                </div>
            </div>

            {/* Controls */}
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search name or entity_id…"
                    className="flex-1 bg-gray-700 text-white rounded-md px-3 py-2 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-blue"
                />
                <div className="flex gap-2">
                    <FilterPill active={filter === 'all'} onClick={() => setFilter('all')}>All</FilterPill>
                    <FilterPill active={filter === 'new'} onClick={() => setFilter('new')}>New only</FilterPill>
                </div>
                <select
                    value={domainFilter}
                    onChange={e => setDomainFilter(e.target.value)}
                    className="bg-gray-700 text-white rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-blue"
                >
                    <option value="">All domains</option>
                    {domains.map(dom => <option key={dom} value={dom}>{dom}</option>)}
                </select>
            </div>

            {/* List */}
            {filtered.length === 0 ? (
                <div className="bg-gray-800 rounded-lg p-8 text-center text-gray-400">
                    {haDevices.length === 0
                        ? 'No Home Assistant entities found. Check the Home Assistant connection under Connections.'
                        : 'No entities match the current filters.'}
                </div>
            ) : (
                <div className="space-y-2">
                    {filtered.map(d => {
                        const isNew = d.type === DeviceType.Generic;
                        const cap = d.capabilityData || {};
                        return (
                            <div key={d.id} className="bg-gray-800 rounded-lg p-4 flex items-center gap-4">
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-semibold text-white truncate">{d.name}</span>
                                        {isNew && (
                                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-brand-blue/20 text-brand-blue">New</span>
                                        )}
                                        {cap.controllable === false && (
                                            <span className="px-2 py-0.5 rounded-full text-xs bg-gray-700 text-gray-400">read-only</span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2 mt-1">
                                        <code className="text-xs text-gray-400 truncate">{d.id}</code>
                                        <button
                                            onClick={() => copyId(d.id)}
                                            title="Copy entity_id"
                                            className="text-gray-500 hover:text-white transition-colors flex-shrink-0"
                                        >
                                            <IconCopy className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                    <div className="flex items-center gap-2 mt-2 flex-wrap text-xs">
                                        {cap.domain && <span className="px-2 py-0.5 rounded-md bg-gray-700 text-gray-300">{cap.domain}</span>}
                                        {cap.deviceClass && <span className="px-2 py-0.5 rounded-md bg-gray-700 text-gray-300">{String(cap.deviceClass)}</span>}
                                        {cap.primary && <span className="px-2 py-0.5 rounded-md bg-gray-700 text-gray-300">{String(cap.primary)}</span>}
                                    </div>
                                </div>
                                <div className="text-right flex-shrink-0">
                                    <p className="font-bold text-white tabular-nums">{stateText(d)}</p>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

const VirtualDeviceManager = () => {
    const { virtualDevices, addVirtualDevice, updateVirtualDevice, removeVirtualDevice, devices } = useDashboard();
    const [isFormVisible, setIsFormVisible] = useState(false);
    const [editingDevice, setEditingDevice] = useState<Device | null>(null);

    // Form state
    const [name, setName] = useState('');
    const [type, setType] = useState<DeviceType>(DeviceType.Virtual);
    // state for the device's state property
    const [deviceState, setDeviceState] = useState<Device['state']>({});

    const availableVirtualTypes = [
        { value: DeviceType.Virtual, label: 'Virtual Switch' },
        { value: DeviceType.WebFrame, label: 'Web Frame' },
        { value: DeviceType.HACustomCard, label: 'HA Custom Card' },
        { value: DeviceType.Camera, label: 'Camera' },
        { value: DeviceType.CameraGroup, label: 'Camera Group' },
        { value: DeviceType.PanicButton, label: 'Panic Button' },
        { value: DeviceType.AlarmHistory, label: 'Alarm History' },
        { value: DeviceType.RSSFeed, label: 'RSS Feed' },
        { value: DeviceType.InternetMonitor, label: 'Internet Monitor' },
        { value: DeviceType.FishingReport, label: 'Fishing Report' },
    ];

    const allCameras = useMemo(() => 
        devices.filter(d => d.type === DeviceType.Camera && d.service === DeviceService.Virtual),
        [devices]
    );

    const resetAndCloseForm = () => {
        setIsFormVisible(false);
        setEditingDevice(null);
        setName('');
        setType(DeviceType.Virtual);
        setDeviceState({});
    };

    const handleAddNew = () => {
        setEditingDevice(null);
        setName('');
        setType(DeviceType.Virtual);
        setDeviceState(false);
        setIsFormVisible(true);
    };

    const handleEdit = (device: Device) => {
        setEditingDevice(device);
        setName(device.name);
        setType(device.type);
        
        let initialState: Device['state'] = {};

        // Backward compatibility for various legacy formats
        const rawState = device.state;
        
        switch (device.type) {
            case DeviceType.WebFrame:
            case DeviceType.RSSFeed:
                if (typeof rawState === 'string') {
                    initialState = { url: rawState, refresh: 900 };
                } else if (typeof rawState === 'object' && rawState !== null) {
                    initialState = { 
                        url: (rawState as any).url || '', 
                        refresh: (rawState as any).refresh || 900 
                    };
                } else {
                    initialState = { url: '', refresh: 900 };
                }
                break;
            case DeviceType.HACustomCard:
                if (typeof rawState === 'object' && rawState !== null) {
                    initialState = {
                        path: (rawState as any).path || '',
                        url: (rawState as any).url || '',
                        refresh: (rawState as any).refresh || 0,
                    };
                } else if (typeof rawState === 'string') {
                    initialState = { path: '', url: rawState, refresh: 0 };
                } else {
                    initialState = { path: '', url: '', refresh: 0 };
                }
                break;
            case DeviceType.Camera:
                 if (typeof rawState === 'string') {
                    initialState = { rtspStreamUrl: rawState };
                } else if (typeof rawState === 'object' && rawState !== null) {
                    initialState = { 
                        rtspStreamUrl: (rawState as any).rtspStreamUrl || (rawState as any).url || ''
                    };
                } else {
                    initialState = { rtspStreamUrl: '' };
                }
                break;
            case DeviceType.CameraGroup:
                if (typeof rawState === 'object' && rawState !== null && Array.isArray((rawState as any).cameraIds)) {
                    initialState = { cameraIds: (rawState as any).cameraIds };
                } else {
                    initialState = { cameraIds: [] };
                }
                break;
            default:
                initialState = rawState ?? {}; // Fallback for other types
                break;
        }
        
        setDeviceState(initialState);
        setIsFormVisible(true);
    };
    
    useEffect(() => {
        // This effect ONLY runs for NEW devices to set initial state structure.
        if (!isFormVisible || editingDevice) return;

        switch (type) {
            case DeviceType.Virtual: setDeviceState(false); break;
            case DeviceType.WebFrame: case DeviceType.RSSFeed: setDeviceState({ url: '', refresh: 900 }); break;
            case DeviceType.HACustomCard: setDeviceState({ path: '', url: '', refresh: 0 }); break;
            case DeviceType.Camera: setDeviceState({ rtspStreamUrl: '' }); break;
            case DeviceType.CameraGroup: setDeviceState({ cameraIds: [] }); break;
            case DeviceType.PanicButton: setDeviceState('IDLE'); break;
            default: setDeviceState({}); break;
        }
    }, [type, editingDevice, isFormVisible]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!name) return;

        const deviceData = { name, type, state: deviceState };

        if (editingDevice) {
            updateVirtualDevice(editingDevice.id, deviceData);
        } else {
            addVirtualDevice(deviceData);
        }
        resetAndCloseForm();
    };

    const renderStateFields = () => {
        // FIX: Use functional update form of useState to prevent errors when spreading non-object states (e.g., boolean for a switch)
        const handleStateChange = (updates: Record<string, any>) => {
            setDeviceState(currentState => ({
                ...(typeof currentState === 'object' && currentState !== null ? currentState : {}),
                ...updates
            }));
        };

        switch (type) {
            case DeviceType.WebFrame:
            case DeviceType.RSSFeed:
                return (
                    <>
                        <AdminInput label="URL" id="vd-url" type="text" value={(deviceState as any).url || ''} onChange={e => handleStateChange({ url: e.target.value })} required />
                        <AdminInput label="Refresh Interval (seconds)" id="vd-refresh" type="number" value={(deviceState as any).refresh || 900} onChange={e => handleStateChange({ refresh: parseInt(e.target.value, 10) || 900 })} />
                    </>
                );
            case DeviceType.HACustomCard:
                return (
                    <>
                        <AdminInput label="Dashboard path or full URL" id="vd-ha-path" type="text" value={(deviceState as any).path || (deviceState as any).url || ''} onChange={e => handleStateChange({ path: e.target.value, url: '' })} required placeholder="/lovelace/kiosk  or  https://…" />
                        <p className="text-xs text-gray-500 -mt-2 mb-2">
                            A relative path (e.g. <code>/lovelace/kiosk</code>) is resolved against the enabled Home Assistant connection's URL. A full <code>http(s)://</code> URL is used as-is. HA must permit being framed (frame-ancestors / X-Frame-Options) and the kiosk needs an authenticated HA session.
                        </p>
                        <AdminInput label="Refresh Interval (seconds, 0 = never)" id="vd-ha-refresh" type="number" value={(deviceState as any).refresh || 0} onChange={e => handleStateChange({ refresh: parseInt(e.target.value, 10) || 0 })} />
                    </>
                );
            case DeviceType.Camera:
                return (
                     <AdminInput label="RTSP Stream URL" id="vd-rtsp" type="text" value={(deviceState as any).rtspStreamUrl || ''} onChange={e => handleStateChange({ rtspStreamUrl: e.target.value })} required placeholder="rtsp://..." />
                );
            case DeviceType.CameraGroup:
                const selectedCameras = (deviceState as any).cameraIds || [];
                const handleCameraSelection = (camId: string, isSelected: boolean) => {
                    const currentIds = (deviceState as any).cameraIds || [];
                    const newIds = isSelected ? [...currentIds, camId] : currentIds.filter((id: string) => id !== camId);
                    handleStateChange({ cameraIds: newIds });
                }
                return (
                     <div>
                        <label className="block mb-2 text-sm font-medium text-gray-400">Select Cameras for Group</label>
                        <div className="bg-gray-900 p-2 rounded-md border border-gray-600 max-h-40 overflow-y-auto">
                            {allCameras.map(cam => (
                                <label key={cam.id} className="flex items-center gap-2 p-1 rounded hover:bg-gray-600 cursor-pointer">
                                    <input type="checkbox" checked={selectedCameras.includes(cam.id)} onChange={e => handleCameraSelection(cam.id, e.target.checked)} className="accent-brand-blue" />
                                    <span>{cam.name}</span>
                                </label>
                            ))}
                            {allCameras.length === 0 && <p className="text-xs text-gray-500 p-2">No virtual camera devices found. Add a camera first to create a group.</p>}
                        </div>
                    </div>
                );
            case DeviceType.Virtual:
            case DeviceType.PanicButton:
            case DeviceType.AlarmHistory:
            default:
                return <p className="text-sm text-gray-400">This device type has no configurable options.</p>;
        }
    };
    
    return (
        <AdminSection title="Virtual Devices" description="Create and manage non-physical devices like web frames, cameras, and triggers.">
            <div className="space-y-2 mb-4">
                {virtualDevices
                  .filter(d => d.type !== DeviceType.Folder) // Folders are managed in the panel editor
                  .map(device => (
                     <div key={device.id} className="flex items-center justify-between bg-gray-700 p-3 rounded-md">
                        <div>
                            <span className="font-medium">{device.name}</span>
                            <span className="text-gray-400 text-sm ml-2">({device.type.replace(/_/g, ' ')})</span>
                        </div>
                         <div className="flex items-center gap-2">
                            <AdminButton onClick={() => handleEdit(device)} variant="secondary" className="!px-3 !py-1 text-sm"><IconPencil className="w-4 h-4" /></AdminButton>
                            <AdminButton onClick={() => removeVirtualDevice(device.id)} variant="danger" className="!px-3 !py-1 text-sm"><IconTrash2 className="w-4 h-4" /></AdminButton>
                         </div>
                    </div>
                ))}
            </div>

            {isFormVisible ? (
                <form onSubmit={handleSubmit} className="bg-gray-700 p-4 rounded-lg mt-4 space-y-4">
                     <h4 className="font-semibold text-lg">{editingDevice ? 'Edit' : 'Add'} Virtual Device</h4>
                     <AdminInput label="Name" id="vd-name" type="text" value={name} onChange={e => setName(e.target.value)} required />
                     <AdminSelect label="Type" id="vd-type" value={type} onChange={e => setType(e.target.value as DeviceType)} disabled={!!editingDevice}>
                        {availableVirtualTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                     </AdminSelect>
                     
                     {renderStateFields()}

                     <div className="flex gap-2">
                        <AdminButton type="submit">Save Device</AdminButton>
                        <AdminButton type="button" variant="secondary" onClick={resetAndCloseForm}>Cancel</AdminButton>
                     </div>
                </form>
            ) : (
                <AdminButton onClick={handleAddNew}>
                    <IconPlus className="inline w-4 h-4 mr-2" />
                    Add Virtual Device
                </AdminButton>
            )}
        </AdminSection>
    );
}

const DashboardUserManager = () => {
    const { users, addUser, removeUser } = useDashboard();
    const [newName, setNewName] = useState('');
    const [newPin, setNewPin] = useState('');

    const handleAdd = (e: React.FormEvent) => {
        e.preventDefault();
        if (newName && newPin) {
            addUser(newName, newPin);
            setNewName('');
            setNewPin('');
        }
    };

    return (
        <AdminSection title="Dashboard PIN Users" description="Users who can interact with PIN-protected tiles (e.g. Locks, Alarm).">
            <div className="space-y-2 mb-4">
                {users.map(u => (
                    <div key={u.id} className="flex items-center justify-between bg-gray-700 p-3 rounded-md">
                        <div>
                            <span className="font-medium">{u.name}</span>
                            <span className="text-gray-400 text-sm ml-2">(PIN: {u.pin})</span>
                        </div>
                         <AdminButton onClick={() => removeUser(u.id)} variant="danger" className="!px-3 !py-1 text-sm" disabled={users.length <= 1} title="Remove User">
                            <IconTrash2 className="w-4 h-4" />
                        </AdminButton>
                    </div>
                ))}
            </div>
            <form onSubmit={handleAdd} className="flex gap-3 items-end">
                 <div className="flex-1">
                    <AdminInput label="Name" id="dash-user-name" value={newName} onChange={e => setNewName(e.target.value)} required />
                 </div>
                 <div className="w-32">
                    <AdminInput label="PIN" id="dash-user-pin" value={newPin} onChange={e => setNewPin(e.target.value)} required />
                 </div>
                 <AdminButton type="submit">Add User</AdminButton>
            </form>
        </AdminSection>
    );
};

const EnergyTrakSettings = ({ connection }: { connection: ServiceConnection }) => {
    const { updateConnectionConfig, addNotification } = useDashboard();
    const [email, setEmail] = useState(connection.energytrakEmail || '');
    const [magicLink, setMagicLink] = useState(connection.energytrakMagicLink || '');
    const [isSaving, setIsSaving] = useState(false);
    const [siteIds, setSiteIds] = useState<string[]>([]);
    const [newSiteId, setNewSiteId] = useState('');
    const [isLoadingSites, setIsLoadingSites] = useState(false);
    const [debugEnabled, setDebugEnabled] = useState(false);
    const [debugToggling, setDebugToggling] = useState(false);

    // Load configured sites and debug state on mount
    useEffect(() => {
        const loadSites = async () => {
            try {
                const sites = await energyTrakService.getConfiguredSites(connection);
                setSiteIds(sites);
            } catch (e) {
                // Service may not be running yet
            }
        };
        const loadDebug = async () => {
            try {
                const status = await energyTrakService.getDebug(connection);
                setDebugEnabled(status.debugGenerator);
            } catch (e) {
                // Service may not be running yet
            }
        };
        loadSites();
        loadDebug();
    }, [connection]);

    const handleToggleDebug = async () => {
        setDebugToggling(true);
        try {
            const newVal = !debugEnabled;
            await energyTrakService.setDebug(connection, newVal);
            setDebugEnabled(newVal);
            addNotification(`Generator debug logging ${newVal ? 'enabled' : 'disabled'}`, 'success');
        } catch (e: any) {
            addNotification(`Failed to toggle debug: ${e.message}`, 'error');
        } finally {
            setDebugToggling(false);
        }
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            await energyTrakService.configure(connection, email, magicLink);
            updateConnectionConfig(connection.id, 'energytrakEmail', email);
            updateConnectionConfig(connection.id, 'energytrakMagicLink', magicLink);
            addNotification('EnergyTrak configured and authenticated successfully!', 'success');
        } catch (e: any) {
            addNotification(`EnergyTrak Error: ${e.message}`, 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const handleAddSite = async () => {
        if (!newSiteId.trim()) return;
        setIsLoadingSites(true);
        try {
            const updatedSites = await energyTrakService.addSite(connection, newSiteId.trim());
            setSiteIds(updatedSites);
            setNewSiteId('');
            addNotification(`Site ${newSiteId} added successfully`, 'success');
        } catch (e: any) {
            addNotification(`Failed to add site: ${e.message}`, 'error');
        } finally {
            setIsLoadingSites(false);
        }
    };

    const handleRemoveSite = async (siteId: string) => {
        setIsLoadingSites(true);
        try {
            const updatedSites = await energyTrakService.removeSite(connection, siteId);
            setSiteIds(updatedSites);
            addNotification(`Site ${siteId} removed`, 'success');
        } catch (e: any) {
            addNotification(`Failed to remove site: ${e.message}`, 'error');
        } finally {
            setIsLoadingSites(false);
        }
    };

    return (
        <div className="space-y-4 mt-2">
            {/* Authentication Section */}
            <div className="space-y-3">
                <AdminInput
                    label="Account Email"
                    id="et-email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                />
                <AdminInput
                    label="Magic Link URL"
                    id="et-magiclink"
                    value={magicLink}
                    onChange={e => setMagicLink(e.target.value)}
                    placeholder="Paste the link from your email here"
                />
                <div className="text-right">
                    <AdminButton onClick={handleSave} disabled={isSaving || !email || !magicLink}>
                        {isSaving ? 'Authenticating...' : 'Save & Authenticate'}
                    </AdminButton>
                </div>
            </div>

            {/* Site ID Management Section */}
            <div className="border-t border-white/10 pt-4 mt-4">
                <label className="block text-sm font-medium text-white/80 mb-2">
                    Configured Site IDs
                </label>
                {siteIds.length > 0 ? (
                    <div className="space-y-2 mb-3">
                        {siteIds.map(siteId => (
                            <div key={siteId} className="flex items-center justify-between bg-white/5 rounded px-3 py-2">
                                <span className="text-sm text-white/90 font-mono">{siteId}</span>
                                <button
                                    onClick={() => handleRemoveSite(siteId)}
                                    disabled={isLoadingSites}
                                    className="text-red-400 hover:text-red-300 text-sm disabled:opacity-50"
                                >
                                    Remove
                                </button>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-sm text-white/50 mb-3">No sites configured. Add a site ID below.</p>
                )}
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={newSiteId}
                        onChange={e => setNewSiteId(e.target.value)}
                        placeholder="e.g., genmon-2214600454"
                        className="flex-1 bg-white/10 border border-white/20 rounded px-3 py-2 text-sm text-white placeholder-white/40"
                        onKeyDown={e => e.key === 'Enter' && handleAddSite()}
                    />
                    <AdminButton onClick={handleAddSite} disabled={isLoadingSites || !newSiteId.trim()}>
                        {isLoadingSites ? 'Adding...' : 'Add Site'}
                    </AdminButton>
                </div>
            </div>

            {/* Debug Logging Section */}
            <div className="border-t border-white/10 pt-4 mt-4">
                <div className="flex items-center justify-between">
                    <div>
                        <label className="block text-sm font-medium text-white/80">Debug Logging</label>
                        <p className="text-xs text-white/50 mt-1">
                            Logs all raw generator values to a rotating file for troubleshooting
                        </p>
                    </div>
                    <AdminButton
                        onClick={handleToggleDebug}
                        disabled={debugToggling}
                    >
                        {debugToggling ? 'Saving...' : debugEnabled ? 'Disable' : 'Enable'}
                    </AdminButton>
                </div>
                {debugEnabled && (
                    <p className="text-xs text-green-400/80 mt-2">
                        Debug logging is active. Logs written to energytrak/logs/generator-debug.log (5MB per file, compressed on rotation, deleted after 30 days).
                    </p>
                )}
            </div>
        </div>
    );
};

interface TempestStation {
    id: number;
    name: string;
    publicName: string;
    latitude: number;
    longitude: number;
    timezone: string;
}

const TempestSettings = ({ connection }: { connection: ServiceConnection }) => {
    const { updateConnectionConfig, addNotification } = useDashboard();
    const [apiToken, setApiToken] = useState(connection.tempestApiToken || '');
    const [selectedStationId, setSelectedStationId] = useState(connection.tempestStationId || '');
    const [stations, setStations] = useState<TempestStation[]>([]);
    const [isFetchingStations, setIsFetchingStations] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const handleFetchStations = async () => {
        if (!apiToken) {
            addNotification('Please enter an API token first', 'warning');
            return;
        }

        setIsFetchingStations(true);
        try {
            const result = await tempestService.getStations(connection, apiToken);
            if (result.stations && result.stations.length > 0) {
                setStations(result.stations);
                // Auto-select if only one station
                if (result.stations.length === 1) {
                    setSelectedStationId(String(result.stations[0].id));
                }
                addNotification(`Found ${result.stations.length} station(s)`, 'success');
            } else {
                addNotification('No stations found for this token', 'warning');
            }
        } catch (e: any) {
            addNotification(`Failed to fetch stations: ${e.message}`, 'error');
        } finally {
            setIsFetchingStations(false);
        }
    };

    const handleSave = async () => {
        if (!selectedStationId) {
            addNotification('Please select a station', 'warning');
            return;
        }

        setIsSaving(true);
        try {
            const result = await tempestService.configure(connection, apiToken, selectedStationId);
            updateConnectionConfig(connection.id, 'tempestApiToken', apiToken);
            updateConnectionConfig(connection.id, 'tempestStationId', selectedStationId);
            addNotification(`Tempest configured! Station: ${result.stationName || selectedStationId}, Current temp: ${result.temperature}°F`, 'success');
        } catch (e: any) {
            addNotification(`Tempest Error: ${e.message}`, 'error');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="space-y-3 mt-2">
            <div className="flex gap-2 items-end">
                <div className="flex-1">
                    <AdminInput
                        label="Tempest API Token"
                        id="tempest-token"
                        type="password"
                        value={apiToken}
                        onChange={e => { setApiToken(e.target.value); setStations([]); }}
                        placeholder="Get from tempestwx.com/settings/tokens"
                    />
                </div>
                <AdminButton
                    onClick={handleFetchStations}
                    disabled={isFetchingStations || !apiToken}
                    variant="secondary"
                >
                    {isFetchingStations ? 'Loading...' : 'Fetch Stations'}
                </AdminButton>
            </div>

            <p className="text-xs text-gray-400">
                Get your API token from <a href="https://tempestwx.com/settings/tokens" target="_blank" rel="noopener noreferrer" className="text-brand-blue hover:underline">tempestwx.com/settings/tokens</a>
            </p>

            {stations.length > 0 && (
                <>
                    <AdminSelect
                        label="Select Station"
                        id="tempest-station"
                        value={selectedStationId}
                        onChange={e => setSelectedStationId(e.target.value)}
                    >
                        <option value="">-- Select a station --</option>
                        {stations.map(station => (
                            <option key={station.id} value={String(station.id)}>
                                {station.name} ({station.id})
                            </option>
                        ))}
                    </AdminSelect>
                    <div className="text-right">
                        <AdminButton onClick={handleSave} disabled={isSaving || !selectedStationId}>
                            {isSaving ? 'Connecting...' : 'Save & Connect'}
                        </AdminButton>
                    </div>
                </>
            )}

            {connection.tempestStationId && stations.length === 0 && (
                <p className="text-sm text-gray-400">
                    Currently configured: Station ID {connection.tempestStationId}
                </p>
            )}
        </div>
    );
};

// Hayward Pool Connection Settings
const HaywardPoolSettings = ({ connection }: { connection: ServiceConnection }) => {
    const { updateConnectionConfig, addNotification } = useDashboard();
    const [mode, setMode] = useState<'local' | 'cloud' | 'both' | 'demo'>(connection.haywardConnectionMode || 'cloud');
    const [controllerIp, setControllerIp] = useState(connection.haywardControllerIp || '');
    const [email, setEmail] = useState(connection.haywardEmail || '');
    const [password, setPassword] = useState(connection.haywardPassword || '');
    const [isSaving, setIsSaving] = useState(false);
    const [healthInfo, setHealthInfo] = useState<any>(null);

    const needsIp = mode === 'local' || mode === 'both';
    const needsCreds = mode === 'cloud' || mode === 'both';
    const isDemo = mode === 'demo';

    useEffect(() => {
        let isMounted = true;
        const checkHealth = async () => {
            try {
                const health = await haywardPoolService.getHealth(connection);
                if (isMounted) setHealthInfo(health);
            } catch {
                // Service may not be running
            }
        };
        checkHealth();
        return () => { isMounted = false; };
    }, [connection]);

    const canSave = () => {
        if (isDemo) return true;
        if (needsIp && !controllerIp) return false;
        if (needsCreds && (!email || !password)) return false;
        return true;
    };

    const handleSave = async () => {
        if (!canSave()) {
            addNotification('Please fill in all required fields for the selected mode', 'warning');
            return;
        }
        setIsSaving(true);
        try {
            const result = await haywardPoolService.configure(connection, {
                email: needsCreds ? email : undefined,
                password: needsCreds ? password : undefined,
                connectionMode: mode,
                controllerIp: needsIp ? controllerIp : undefined,
            });
            updateConnectionConfig(connection.id, 'haywardConnectionMode', mode);
            updateConnectionConfig(connection.id, 'haywardControllerIp', controllerIp);
            if (needsCreds) {
                updateConnectionConfig(connection.id, 'haywardEmail', email);
                updateConnectionConfig(connection.id, 'haywardPassword', password);
            }
            const systemName = result.systemName || 'OmniLogic';
            const transport = result.activeTransport || mode;
            addNotification(`Hayward Pool connected via ${transport}! System: ${systemName}`, 'success');
            try {
                const health = await haywardPoolService.getHealth(connection);
                setHealthInfo(health);
            } catch {
                // Health refresh failed but config was saved
            }
        } catch (e: any) {
            addNotification(`Hayward Pool Error: ${e.message || 'Connection failed'}`, 'error');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="space-y-3">
            <AdminSelect
                label="Connection Mode"
                id="hayward-mode"
                value={mode}
                onChange={e => setMode(e.target.value as 'local' | 'cloud' | 'both')}
            >
                <option value="local">Local (direct to controller)</option>
                <option value="cloud">Cloud (Hayward OmniLogic servers)</option>
                <option value="both">Both (local first, cloud failover)</option>
                <option value="demo">Demo (simulated pool data)</option>
            </AdminSelect>
            <p className="text-xs text-gray-500 -mt-1">
                {mode === 'local' && 'Connects directly to your OmniLogic controller on the local network. No internet required.'}
                {mode === 'cloud' && 'Connects via Hayward cloud servers. Requires your OmniLogic app credentials.'}
                {mode === 'both' && 'Prefers local control for speed and reliability, falls back to cloud if the controller is unreachable.'}
                {mode === 'demo' && 'Shows simulated pool data for previewing the UI. No credentials or controller needed.'}
            </p>

            {needsIp && (
                <AdminInput
                    label="Controller IP Address"
                    id="hayward-ip"
                    type="text"
                    value={controllerIp}
                    onChange={e => setControllerIp(e.target.value)}
                    placeholder="192.168.1.100"
                />
            )}

            {needsCreds && (
                <>
                    <AdminInput
                        label="Hayward Account Email"
                        id="hayward-email"
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        placeholder="you@example.com"
                    />
                    <AdminInput
                        label="Hayward Account Password"
                        id="hayward-password"
                        type="password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                    />
                </>
            )}

            <AdminButton onClick={handleSave} disabled={isSaving || !canSave()}>
                {isSaving ? 'Connecting...' : 'Connect & Save'}
            </AdminButton>

            {healthInfo && healthInfo.configured && (
                <div className="mt-2 p-2 bg-green-900/20 border border-green-500/30 rounded text-xs text-green-400">
                    Connected to <strong>{healthInfo.systemName || 'OmniLogic'}</strong>
                    {' via '}<strong>{healthInfo.activeTransport || 'unknown'}</strong>
                    {healthInfo.connectionMode === 'both' && healthInfo.activeTransport === 'cloud' && (
                        <span className="text-yellow-400"> (local unavailable)</span>
                    )}
                    {healthInfo.bodyCount > 0 && ` • ${healthInfo.bodyCount} body(s)`}
                    {healthInfo.pumpCount > 0 && ` • ${healthInfo.pumpCount} pump(s)`}
                    {healthInfo.lastRefresh && ` • Last refresh: ${new Date(healthInfo.lastRefresh).toLocaleTimeString()}`}
                </div>
            )}
        </div>
    );
};

// Flair HVAC Connection Settings
const FlairSettings = ({ connection }: { connection: ServiceConnection }) => {
    const { updateConnectionConfig, addNotification, fetchDevicesFromServices } = useDashboard();
    const [mode, setMode] = useState<'cloud' | 'demo'>(connection.flairConnectionMode || 'cloud');
    const [clientId, setClientId] = useState(connection.flairClientId || '');
    const [clientSecret, setClientSecret] = useState(connection.flairClientSecret || '');
    const [isSaving, setIsSaving] = useState(false);
    const [healthInfo, setHealthInfo] = useState<any>(null);

    const needsCreds = mode === 'cloud';

    useEffect(() => {
        let isMounted = true;
        const checkHealth = async () => {
            try {
                const health = await flairService.getHealth(connection);
                if (isMounted) setHealthInfo(health);
            } catch {
                // Service may not be running
            }
        };
        checkHealth();
        return () => { isMounted = false; };
    }, [connection]);

    const canSave = () => {
        if (mode === 'demo') return true;
        return !!(clientId && clientSecret);
    };

    const handleSave = async () => {
        if (!canSave()) {
            addNotification('Client ID and Client Secret are required for cloud mode', 'warning');
            return;
        }
        setIsSaving(true);
        try {
            const result = await flairService.configure(connection, {
                clientId: needsCreds ? clientId : undefined,
                clientSecret: needsCreds ? clientSecret : undefined,
                connectionMode: mode,
            });
            updateConnectionConfig(connection.id, 'flairConnectionMode', mode);
            if (needsCreds) {
                updateConnectionConfig(connection.id, 'flairClientId', clientId);
                updateConnectionConfig(connection.id, 'flairClientSecret', clientSecret);
            }
            // Auto-enable the service on successful connect so the Flair device
            // shows up immediately in the devices list (the connection-card
            // "Enabled" toggle is a separate control and users expect Save here
            // to actually turn it on).
            if (!connection.enabled) {
                updateConnectionConfig(connection.id, 'enabled', true);
            }
            const structureName = result.structureName || 'Home';
            addNotification(`Flair connected! ${structureName} — ${result.roomCount ?? 0} rooms, ${result.ventCount ?? 0} vents`, 'success');
            try {
                const health = await flairService.getHealth(connection);
                setHealthInfo(health);
            } catch {
                // Health refresh failed but config was saved
            }
            // Kick an immediate device refresh so the Flair device appears without
            // waiting for the 30s poll cycle.
            try { await fetchDevicesFromServices(); } catch {}
        } catch (e: any) {
            addNotification(`Flair Error: ${e.message || 'Connection failed'}`, 'error');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="space-y-3">
            <AdminSelect
                label="Connection Mode"
                id="flair-mode"
                value={mode}
                onChange={e => setMode(e.target.value as 'cloud' | 'demo')}
            >
                <option value="cloud">Cloud (Flair API)</option>
                <option value="demo">Demo (simulated vents/rooms)</option>
            </AdminSelect>
            <p className="text-xs text-gray-500 -mt-1">
                {mode === 'cloud' && 'Connects to api.flair.co using OAuth2 client credentials. Request a client_id / client_secret from Flair by emailing partnerships@flair.co.'}
                {mode === 'demo' && 'Shows simulated Flair data for previewing the UI. No credentials needed.'}
            </p>

            {needsCreds && (
                <>
                    <AdminInput
                        label="Flair Client ID"
                        id="flair-client-id"
                        type="text"
                        value={clientId}
                        onChange={e => setClientId(e.target.value)}
                        placeholder="issued by Flair"
                    />
                    <AdminInput
                        label="Flair Client Secret"
                        id="flair-client-secret"
                        type="password"
                        value={clientSecret}
                        onChange={e => setClientSecret(e.target.value)}
                    />
                </>
            )}

            <AdminButton onClick={handleSave} disabled={isSaving || !canSave()}>
                {isSaving ? 'Connecting...' : 'Connect & Save'}
            </AdminButton>

            {healthInfo && healthInfo.configured && (
                <div className="mt-2 p-2 bg-green-900/20 border border-green-500/30 rounded text-xs text-green-400">
                    Connected to <strong>{healthInfo.structureName || 'Flair Home'}</strong>
                    {' • mode '}<strong>{healthInfo.systemMode || 'unknown'}</strong>
                    {healthInfo.roomCount > 0 && ` • ${healthInfo.roomCount} room(s)`}
                    {healthInfo.ventCount > 0 && ` • ${healthInfo.ventCount} vent(s)`}
                    {healthInfo.lastRefresh && ` • Last refresh: ${new Date(healthInfo.lastRefresh).toLocaleTimeString()}`}
                </div>
            )}
        </div>
    );
};

// Akvo Spiralift Pool Floor (Modbus TCP)
const PoolFloorSettings = ({ connection }: { connection: ServiceConnection }) => {
    const { updateConnectionConfig, addNotification, fetchDevicesFromServices } = useDashboard();
    const [mode, setMode] = useState<'live' | 'demo'>(connection.poolFloorConnectionMode || 'demo');
    const [ip, setIp] = useState(connection.poolFloorIp || '172.20.1.100');
    const [port, setPort] = useState(String(connection.poolFloorPort || 502));
    const [unitId, setUnitId] = useState(String(connection.poolFloorUnitId || 1));
    const [configNames, setConfigNames] = useState<string[]>(
        connection.poolFloorConfigNames ?? Array(8).fill('')
    );
    const [isSaving, setIsSaving] = useState(false);
    const [healthInfo, setHealthInfo] = useState<any>(null);

    useEffect(() => {
        let mounted = true;
        poolFloorService.getHealth(connection).then(h => { if (mounted) setHealthInfo(h); }).catch(() => {});
        return () => { mounted = false; };
    }, [connection.enabled]);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            if (mode === 'demo') {
                await poolFloorService.configure(connection, { demo: true });
            } else {
                await poolFloorService.configure(connection, {
                    ip,
                    port: parseInt(port, 10),
                    unitId: parseInt(unitId, 10),
                });
            }
            updateConnectionConfig(connection.id, 'poolFloorConnectionMode', mode);
            updateConnectionConfig(connection.id, 'poolFloorIp', ip);
            updateConnectionConfig(connection.id, 'poolFloorPort', parseInt(port, 10));
            updateConnectionConfig(connection.id, 'poolFloorUnitId', parseInt(unitId, 10));
            updateConnectionConfig(connection.id, 'poolFloorConfigNames', configNames);
            const h = await poolFloorService.getHealth(connection);
            setHealthInfo(h);
            addNotification('Pool Floor configured.', 'success');
            fetchDevicesFromServices();
        } catch (err: any) {
            addNotification(`Pool Floor error: ${err.message}`, 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const updateName = (i: number, val: string) => {
        setConfigNames(prev => { const next = [...prev]; next[i] = val; return next; });
    };

    return (
        <div className="space-y-3 mt-3">
            {healthInfo && (
                <div className={`text-xs px-3 py-2 rounded-lg ${healthInfo.ok ? 'bg-green-900/30 text-green-300' : 'bg-yellow-900/30 text-yellow-300'}`}>
                    {healthInfo.demo ? 'Demo mode — simulated Akvo Spiralift data' : healthInfo.ok ? `Connected to ${healthInfo.ip}:${healthInfo.port}` : `Not connected — ${healthInfo.ip}:${healthInfo.port}`}
                </div>
            )}
            <div>
                <label className="block text-xs text-gray-400 mb-2">Connection Mode</label>
                <div className="flex gap-2">
                    {(['demo', 'live'] as const).map(m => (
                        <button
                            key={m}
                            onClick={() => setMode(m)}
                            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${mode === m ? 'bg-blue-600/40 border-blue-500/60 text-blue-200' : 'bg-gray-800/60 border-gray-700/40 text-gray-400 hover:text-gray-200'}`}
                        >
                            {m === 'demo' ? 'Demo (Simulated)' : 'Live (Modbus TCP)'}
                        </button>
                    ))}
                </div>
            </div>
            {mode === 'live' && <div>
                <label className="block text-xs text-gray-400 mb-1">Akvo Controller IP</label>
                <input
                    className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white"
                    value={ip}
                    onChange={e => setIp(e.target.value)}
                    placeholder="172.20.1.100"
                />
            </div>}
            {mode === 'live' && <div className="flex gap-2">
                <div className="flex-1">
                    <label className="block text-xs text-gray-400 mb-1">Modbus Port</label>
                    <input
                        className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white"
                        value={port}
                        onChange={e => setPort(e.target.value)}
                        placeholder="502"
                    />
                </div>
                <div className="w-24">
                    <label className="block text-xs text-gray-400 mb-1">Unit ID</label>
                    <input
                        className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white"
                        value={unitId}
                        onChange={e => setUnitId(e.target.value)}
                        placeholder="1"
                    />
                </div>
            </div>}
            <div>
                <label className="block text-xs text-gray-400 mb-2">Configuration Names <span className="text-gray-600">(optional — shown on buttons)</span></label>
                <div className="grid grid-cols-2 gap-2">
                    {Array.from({ length: 8 }, (_, i) => (
                        <div key={i} className="flex items-center gap-2">
                            <span className="text-[10px] text-gray-500 w-4 text-right flex-shrink-0">C{i + 1}</span>
                            <input
                                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white placeholder-gray-600"
                                value={configNames[i] || ''}
                                onChange={e => updateName(i, e.target.value)}
                                placeholder={`Config ${i + 1}`}
                            />
                        </div>
                    ))}
                </div>
            </div>
            <button
                onClick={handleSave}
                disabled={isSaving || (mode === 'live' && !ip)}
                className="w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm font-semibold text-white transition-colors"
            >
                {isSaving ? (mode === 'demo' ? 'Starting…' : 'Connecting…') : mode === 'demo' ? 'Save (Demo Mode)' : 'Save & Connect'}
            </button>
        </div>
    );
};

// CoolAutomation / CoolMaster HVAC Connection Settings
const CoolMasterSettings = ({ connection }: { connection: ServiceConnection }) => {
    const { updateConnectionConfig, addNotification, fetchDevicesFromServices } = useDashboard();
    const [mode, setMode] = useState<'local' | 'cloud' | 'both' | 'demo'>(connection.coolmasterConnectionMode || 'demo');
    const [localIp, setLocalIp] = useState(connection.coolmasterLocalIp || '');
    const [localDeviceId, setLocalDeviceId] = useState(connection.coolmasterLocalDeviceId || '');
    const [username, setUsername] = useState(connection.coolmasterUsername || '');
    const [password, setPassword] = useState(connection.coolmasterPassword || '');
    const [isSaving, setIsSaving] = useState(false);
    const [healthInfo, setHealthInfo] = useState<any>(null);

    const needsIp = mode === 'local' || mode === 'both';
    const needsCreds = mode === 'cloud' || mode === 'both';

    useEffect(() => {
        let isMounted = true;
        const checkHealth = async () => {
            try {
                const h = await coolMasterService.getHealth(connection);
                if (isMounted) setHealthInfo(h);
            } catch {
                // Service may not be running yet
            }
        };
        checkHealth();
        return () => { isMounted = false; };
    }, [connection]);

    const canSave = () => {
        if (mode === 'demo') return true;
        if (needsIp && !localIp) return false;
        if (needsCreds && (!username || !password)) return false;
        return true;
    };

    const handleSave = async () => {
        if (!canSave()) {
            addNotification('Please fill in all required fields for the selected mode', 'warning');
            return;
        }
        setIsSaving(true);
        try {
            const result = await coolMasterService.configure(connection, {
                connectionMode: mode,
                localIp: needsIp ? localIp : undefined,
                localDeviceId: needsIp ? (localDeviceId || undefined) : undefined,
                username: needsCreds ? username : undefined,
                password: needsCreds ? password : undefined,
                unitAliases: connection.coolmasterUnitAliases || {},
            });
            updateConnectionConfig(connection.id, 'coolmasterConnectionMode', mode);
            if (needsIp) {
                updateConnectionConfig(connection.id, 'coolmasterLocalIp', localIp);
                // Device ID might have just been auto-discovered; persist whatever the server returned.
                if ((result as any).systemId && !localDeviceId) {
                    setLocalDeviceId((result as any).systemId);
                    updateConnectionConfig(connection.id, 'coolmasterLocalDeviceId', (result as any).systemId);
                } else if (localDeviceId) {
                    updateConnectionConfig(connection.id, 'coolmasterLocalDeviceId', localDeviceId);
                }
            }
            if (needsCreds) {
                updateConnectionConfig(connection.id, 'coolmasterUsername', username);
                updateConnectionConfig(connection.id, 'coolmasterPassword', password);
            }
            // Auto-enable on successful save so the device appears immediately.
            if (!connection.enabled) {
                updateConnectionConfig(connection.id, 'enabled', true);
            }
            addNotification(`CoolMaster connected via ${result.activeTransport || mode}! ${result.unitCount ?? 0} unit(s), ${result.lineCount ?? 0} line(s)`, 'success');
            try {
                const h = await coolMasterService.getHealth(connection);
                setHealthInfo(h);
            } catch { /* soft-fail */ }
            try { await fetchDevicesFromServices(); } catch { /* soft-fail */ }
        } catch (e: any) {
            addNotification(`CoolMaster Error: ${e.message || 'Connection failed'}`, 'error');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="space-y-3">
            <AdminSelect
                label="Connection Mode"
                id="coolmaster-mode"
                value={mode}
                onChange={e => setMode(e.target.value as 'local' | 'cloud' | 'both' | 'demo')}
            >
                <option value="local">Local (direct to CoolMasterNet box)</option>
                <option value="cloud">Cloud (CoolAutomation account)</option>
                <option value="both">Both (local first, cloud failover)</option>
                <option value="demo">Demo (simulated Mitsubishi VRF)</option>
            </AdminSelect>
            <p className="text-xs text-gray-500 -mt-1">
                {mode === 'local' && 'Talks to the CoolMasterNet gateway on your LAN. No internet required.'}
                {mode === 'cloud' && 'Authenticates to api.coolautomation.com. Requires your account email/password.'}
                {mode === 'both' && 'Prefers local for speed; falls back to cloud if the gateway is unreachable.'}
                {mode === 'demo' && 'Simulated Mitsubishi VRF system with 5 indoor units. No hardware or account needed — preview the UI before installation.'}
            </p>

            {needsIp && (
                <>
                    <AdminInput
                        label="CoolMasterNet IP Address"
                        id="coolmaster-ip"
                        type="text"
                        value={localIp}
                        onChange={e => setLocalIp(e.target.value)}
                        placeholder="192.168.1.50"
                    />
                    <AdminInput
                        label="Gateway Device ID (optional — auto-discovered)"
                        id="coolmaster-device"
                        type="text"
                        value={localDeviceId}
                        onChange={e => setLocalDeviceId(e.target.value)}
                        placeholder="L4.123 (leave blank to auto-detect)"
                    />
                </>
            )}

            {needsCreds && (
                <>
                    <AdminInput
                        label="CoolAutomation Account Email"
                        id="coolmaster-email"
                        type="email"
                        value={username}
                        onChange={e => setUsername(e.target.value)}
                        placeholder="you@example.com"
                    />
                    <AdminInput
                        label="CoolAutomation Account Password"
                        id="coolmaster-password"
                        type="password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                    />
                </>
            )}

            <AdminButton onClick={handleSave} disabled={isSaving || !canSave()}>
                {isSaving ? 'Connecting...' : 'Connect & Save'}
            </AdminButton>

            {healthInfo && healthInfo.configured && (
                <div className="mt-2 p-2 bg-green-900/20 border border-green-500/30 rounded text-xs text-green-400">
                    Connected via <strong>{healthInfo.activeTransport || 'unknown'}</strong>
                    {healthInfo.systemName && <> • {healthInfo.systemName}</>}
                    {healthInfo.unitCount > 0 && ` • ${healthInfo.activeUnitCount}/${healthInfo.unitCount} unit(s) on`}
                    {healthInfo.lineCount > 0 && ` • ${healthInfo.lineCount} line(s)`}
                    {healthInfo.lastRefresh && ` • Last refresh: ${new Date(healthInfo.lastRefresh).toLocaleTimeString()}`}
                </div>
            )}
        </div>
    );
};

const ConnectionManager = () => {
    const { connections, useDemoMode, toggleDemoMode, updateConnectionConfig, fetchDevicesFromServices, devices, mediamtxConfig } = useDashboard();
    const [discoveredLocations, setDiscoveredLocations] = useState<Array<{locationId: string, name: string}>>([]);
    const [isDiscovering, setIsDiscovering] = useState(false);
    const [discoveryError, setDiscoveryError] = useState<string | null>(null);
    const [showRtspHelp, setShowRtspHelp] = useState(false);

    // Lutron Pairing State
    const [lutronStatus, setLutronStatus] = useState<any>(null);
    const [isPairing, setIsPairing] = useState(false);
    const [pairingStatus, setPairingStatus] = useState<string | null>(null);
    const [discoveredProcessors, setDiscoveredProcessors] = useState<Array<{ name: string; ip: string; type: string }>>([]);
    const [isDiscoveringProcessors, setIsDiscoveringProcessors] = useState(false);
    const [pairIp, setPairIp] = useState('');
    const [showAdvancedLutron, setShowAdvancedLutron] = useState(false);


    const stConnection = connections.find(c => c.id === DeviceService.SmartThings);

    const triggerableDevices = useMemo(() =>
        devices.filter(d =>
            d.type === DeviceType.Switch ||
            d.type === DeviceType.Scene ||
            d.type === DeviceType.Light ||
            d.type === DeviceType.SmartPlug ||
            d.type === DeviceType.Dimmer ||
            d.type === DeviceType.Valve ||
            d.type === DeviceType.Virtual
        ).sort((a,b) => a.name.localeCompare(b.name)),
        [devices]
    );
    
    const checkLutronStatus = useCallback(async () => {
        try {
            const status = await apiGetLutronStatus();
            setLutronStatus(status);
        } catch (e) {
            setLutronStatus({ error: (e as Error).message });
        }
    }, []);

    useEffect(() => {
        const lutronConn = connections.find(c => c.id === DeviceService.Lutron);
        if (lutronConn && lutronConn.enabled) {
            checkLutronStatus();
            const interval = setInterval(checkLutronStatus, 5000);
            return () => clearInterval(interval);
        }
    }, [connections, checkLutronStatus]);

    const handleDiscoverLocations = async () => {
        if (!stConnection) return;
        setIsDiscovering(true);
        setDiscoveryError(null);
        setDiscoveredLocations([]);
        try {
            const locations = await smartThingsService.getLocations(stConnection);
            setDiscoveredLocations(locations);
            if (locations.length === 0) {
                setDiscoveryError("No locations found. Ensure the relay server is running and the SmartApp is installed.");
            }
        } catch (error) {
            setDiscoveryError((error as Error).message);
        } finally {
            setIsDiscovering(false);
        }
    };

    const handleLocationSelectionChange = (locationId: string, isSelected: boolean) => {
        if (!stConnection) return;
        const currentSelection = stConnection.selectedLocations || [];
        let newSelection;
        if (isSelected) {
            newSelection = [...currentSelection, locationId];
        } else {
            newSelection = currentSelection.filter(id => id !== locationId);
        }
        updateConnectionConfig(DeviceService.SmartThings, 'selectedLocations', newSelection);
    };
    
    const handleGenerateCsr = async () => {
        setIsPairing(true);
        try {
            const { csr, privateKey } = await apiGenerateLutronCsr();
            // Trigger download of CSR
            const blob = new Blob([csr], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'hometile_lutron_req.csr';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            // The API saves the key to the DB, but we should make sure the frontend knows about it
            // Actually, we need to update the config with the key so it's persisted if the user hits save again?
            // No, the backend handles persistence of the key during generation.
            alert("CSR file has been downloaded. Please upload it to your Lutron QSX processor's integration settings, then upload the two certificate files you receive back.");
        } catch (e) {
            alert(`Failed to generate CSR: ${(e as Error).message}`);
        } finally {
            setIsPairing(false);
        }
    };

    const handleCertsUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files || files.length !== 2) {
            alert("Please select exactly two files: the Client Certificate and the CA Certificate.");
            return;
        }

        setIsPairing(true);
        try {
            const clientCertFile = Array.from(files).find(f => f.name.includes('client') || f.name.endsWith('.crt')); // Heuristic
            const caCertFile = Array.from(files).find(f => f.name.includes('ca') || f.name.includes('root') || f.name.endsWith('.pem'));

            if (!clientCertFile || !caCertFile) {
                // Fallback: assume order if names are ambiguous? No, safer to ask user to rename.
                // Let's try simpler logic: usually one is remote-access...
                throw new Error("Could not identify client and CA certificates. Please ensure filenames contain 'client' and 'ca' respectively.");
            }

            const clientCert = await clientCertFile.text();
            const caCert = await caCertFile.text();

            await apiUploadLutronCerts(clientCert, caCert);
            alert("Certificates uploaded successfully! The system will now attempt to connect to your Lutron processor.");
            checkLutronStatus();
        } catch(e) {
            alert(`Failed to upload certificates: ${(e as Error).message}`);
        } finally {
            setIsPairing(false);
        }
    };

    // Manual upload for pylutron-caseta generated certs (3 files: key, cert, ca)
    // Supports both lap-pair naming (client.key, client.crt, ca.crt) and legacy (caseta.key, caseta.crt, caseta-bridge.crt)
    const handleManualCertsUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files || files.length !== 3) {
            alert("Please select exactly 3 files: client.key, client.crt, and ca.crt (from lap-pair command)");
            return;
        }

        setIsPairing(true);
        try {
            const fileArray = Array.from(files);

            // Match files by their specific characteristics:
            // - keyFile: ends with .key (e.g., client.key)
            // - caFile: filename is exactly "ca.crt" OR contains "bridge" (for legacy caseta-bridge.crt)
            // - certFile: ends with .crt but is NOT the CA cert
            const keyFile = fileArray.find(f => f.name.endsWith('.key'));
            const caFile = fileArray.find(f => {
                const name = f.name.toLowerCase();
                return name === 'ca.crt' || name.includes('bridge');
            });
            const certFile = fileArray.find(f => {
                const name = f.name.toLowerCase();
                return f.name.endsWith('.crt') && name !== 'ca.crt' && !name.includes('bridge');
            });

            if (!keyFile || !certFile || !caFile) {
                const missing = [];
                if (!keyFile) missing.push('private key (.key file)');
                if (!certFile) missing.push('client certificate (.crt file, not ca.crt)');
                if (!caFile) missing.push('CA certificate (ca.crt)');
                throw new Error(`Could not identify: ${missing.join(', ')}. Files found: ${fileArray.map(f => f.name).join(', ')}`);
            }

            console.log(`[Lutron Upload] Identified files - Key: ${keyFile.name}, Cert: ${certFile.name}, CA: ${caFile.name}`);

            const clientKey = await keyFile.text();
            const clientCert = await certFile.text();
            const caCert = await caFile.text();

            await apiUploadLutronCertsManual(clientKey, clientCert, caCert);
            alert("Certificates uploaded successfully! The system will now attempt to connect to your Lutron processor.");
            checkLutronStatus();
        } catch(e) {
            alert(`Failed to upload certificates: ${(e as Error).message}`);
        } finally {
            setIsPairing(false);
        }
    };

    const handleDiscoverProcessors = async () => {
        setIsDiscoveringProcessors(true);
        setDiscoveredProcessors([]);
        try {
            const result = await apiDiscoverLutronProcessors();
            setDiscoveredProcessors(result.processors || []);
            if (result.processors?.length === 0) {
                addNotification('No Lutron processors found on the network. Enter the IP manually.', 'warning');
            }
        } catch (e) {
            addNotification(`Discovery failed: ${(e as Error).message}`, 'error');
        } finally {
            setIsDiscoveringProcessors(false);
        }
    };

    const handlePairLutron = async () => {
        if (!pairIp) {
            addNotification('Enter or select a processor IP address first', 'warning');
            return;
        }
        setIsPairing(true);
        setPairingStatus('Connecting to processor...');
        try {
            const result = await apiPairLutron(pairIp);
            setPairingStatus(null);
            addNotification(result.message || 'Paired successfully!', 'success');
            updateConnectionConfig(DeviceService.Lutron, 'lutronManualIp', pairIp);
            updateConnectionConfig(DeviceService.Lutron, 'enabled', true);
            checkLutronStatus();
        } catch (e: any) {
            setPairingStatus(null);
            const msg = e.message || 'Pairing failed';
            if (msg.includes('button')) {
                addNotification(`Pairing timed out — press the button before starting`, 'error');
            } else {
                addNotification(`Pairing failed: ${msg}`, 'error');
            }
        } finally {
            setIsPairing(false);
        }
    };

    const generatedMediamtxYaml = useMemo(() => {
        if (!mediamtxConfig || Object.keys(mediamtxConfig.paths || {}).length === 0) {
            return "# No camera devices with RTSP URLs have been configured.\n# Add a camera in 'Virtual Devices' to generate the config here.";
        }
        try {
            // The dump function from js-yaml converts a JS object to a YAML string.
            // sortKeys: true makes the output deterministic and easier to read.
            return yaml.dump(mediamtxConfig, { sortKeys: true });
        } catch (e) {
            return "# Error generating YAML config.";
        }
    }, [mediamtxConfig]);

    return (
        <AdminSection title="Service Connections" description="Connect to your smart home hubs.">
            <div className="space-y-4">
                <AdminToggle
                    label="Enable Demo Mode"
                    description="Use sample devices instead of real connections."
                    enabled={useDemoMode}
                    onToggle={toggleDemoMode}
                />
                {connections.map(conn => (
                     <div key={conn.id} className="bg-gray-700 p-4 rounded-lg space-y-3">
                         <div className="flex items-center justify-between">
                            <h4 className="text-lg font-semibold">{conn.id}</h4>
                             <AdminToggle label="Enabled" enabled={conn.enabled} onToggle={() => updateConnectionConfig(conn.id, 'enabled', !conn.enabled)} />
                         </div>

                         {conn.id === DeviceService.SmartThings ? (
                            <>
                                <AdminInput 
                                    label="Relay Server URL"
                                    id={`${conn.id}-relay-url`} 
                                    type="text" 
                                    value={conn.cloudEndpoint} 
                                    onChange={e => updateConnectionConfig(conn.id, 'cloudEndpoint', e.target.value)} 
                                    placeholder="e.g., http://192.168.1.50:8080"
                                />
                                <div className="mt-3 pt-3 border-t border-gray-600">
                                    <h5 className="font-semibold text-gray-300 mb-2">Location Sync</h5>
                                    <p className="text-xs text-gray-400 mb-3">Select which locations to sync devices from.</p>
                                    <AdminButton onClick={handleDiscoverLocations} disabled={isDiscovering}>
                                        {isDiscovering ? 'Discovering...' : 'Discover Locations'}
                                    </AdminButton>
                                    {discoveryError && <p className="text-red-400 text-sm mt-2">{discoveryError}</p>}
                                    {(discoveredLocations.length > 0 || (stConnection?.selectedLocations?.length ?? 0) > 0) && (
                                        <div className="mt-3 space-y-2 max-h-60 overflow-y-auto bg-gray-900 p-2 rounded-md border border-gray-600">
                                            {discoveredLocations.length === 0 && stConnection?.selectedLocations?.map(locId => (
                                                 <div key={locId} className="flex items-center gap-3 p-2 rounded-md hover:bg-gray-600">
                                                    <input
                                                        type="checkbox"
                                                        checked={true}
                                                        onChange={(e) => handleLocationSelectionChange(locId, e.target.checked)}
                                                        className="accent-brand-blue w-4 h-4 flex-shrink-0"
                                                    />
                                                    <span className="text-white truncate italic text-sm flex-shrink-0">Saved: {locId.substring(0,8)}...</span>
                                                    <input
                                                        type="text"
                                                        placeholder="Location name..."
                                                        value={(conn.locationAliases || {})[locId] || ''}
                                                        onChange={(e) => {
                                                            const aliases = { ...(conn.locationAliases || {}), [locId]: e.target.value || undefined };
                                                            if (!e.target.value) delete aliases[locId];
                                                            updateConnectionConfig(DeviceService.SmartThings, 'locationAliases', aliases);
                                                        }}
                                                        onClick={(e) => e.stopPropagation()}
                                                        className="flex-1 min-w-0 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm text-white placeholder-gray-500"
                                                    />
                                                </div>
                                            ))}
                                            {discoveredLocations.map(loc => (
                                                <div key={loc.locationId} className="flex items-center gap-3 p-2 rounded-md hover:bg-gray-600">
                                                    <input
                                                        type="checkbox"
                                                        checked={(conn.selectedLocations || []).includes(loc.locationId)}
                                                        onChange={(e) => handleLocationSelectionChange(loc.locationId, e.target.checked)}
                                                        className="accent-brand-blue w-4 h-4 flex-shrink-0"
                                                    />
                                                    <span className="text-white truncate text-sm flex-shrink-0">{loc.name}</span>
                                                    <input
                                                        type="text"
                                                        placeholder="Alias..."
                                                        value={(conn.locationAliases || {})[loc.locationId] || ''}
                                                        onChange={(e) => {
                                                            const aliases = { ...(conn.locationAliases || {}), [loc.locationId]: e.target.value || undefined };
                                                            if (!e.target.value) delete aliases[loc.locationId];
                                                            updateConnectionConfig(DeviceService.SmartThings, 'locationAliases', aliases);
                                                        }}
                                                        onClick={(e) => e.stopPropagation()}
                                                        className="flex-1 min-w-0 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm text-white placeholder-gray-500"
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </>
                        ) : conn.id === DeviceService.Lutron ? (
                            <div className="space-y-3">
                                {/* Status banner */}
                                {lutronStatus && (
                                    <div className={`p-2 rounded text-sm ${
                                        lutronStatus.isConnected ? 'bg-green-900/50 text-green-200' :
                                        lutronStatus.isPaired ? 'bg-yellow-900/50 text-yellow-200' :
                                        'bg-red-900/50 text-red-200'
                                    }`}>
                                        <div className="font-semibold">
                                            Status: {lutronStatus.isConnected ? 'Connected' :
                                                     lutronStatus.discoveryActive ? 'Discovering...' :
                                                     lutronStatus.isPaired ? 'Paired but not connected' :
                                                     'Not paired'}
                                        </div>
                                        {lutronStatus.processorIp && <div className="text-xs mt-1">Processor: {lutronStatus.processorIp}</div>}
                                        {lutronStatus.error && <div className="text-xs mt-1 text-red-300">{lutronStatus.error}</div>}
                                    </div>
                                )}

                                {/* Pairing in progress */}
                                {pairingStatus && (
                                    <div className="p-3 bg-cyan-900/30 border border-cyan-500/30 rounded text-sm text-cyan-200 flex items-center gap-3">
                                        <svg className="w-5 h-5 animate-spin text-cyan-400 shrink-0" viewBox="0 0 24 24" fill="none">
                                            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4" strokeLinecap="round" />
                                        </svg>
                                        <span>{pairingStatus}</span>
                                    </div>
                                )}

                                {/* Step 1: Find processor */}
                                <div className="border-t border-gray-600 pt-3">
                                    <h5 className="font-semibold text-gray-300 mb-2">1. Find Processor</h5>
                                    <div className="flex gap-2 items-end">
                                        <div className="flex-1">
                                            <AdminInput
                                                label="Processor IP"
                                                id="lutron-pair-ip"
                                                type="text"
                                                value={pairIp || conn.lutronManualIp || ''}
                                                onChange={e => setPairIp(e.target.value)}
                                                placeholder="192.168.1.50"
                                            />
                                        </div>
                                        <AdminButton onClick={handleDiscoverProcessors} disabled={isDiscoveringProcessors || isPairing} variant="secondary">
                                            {isDiscoveringProcessors ? 'Searching...' : 'Discover'}
                                        </AdminButton>
                                    </div>
                                    {discoveredProcessors.length > 0 && (
                                        <div className="mt-2 space-y-1">
                                            {discoveredProcessors.map(p => (
                                                <button
                                                    key={p.ip}
                                                    onClick={() => setPairIp(p.ip)}
                                                    className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                                                        pairIp === p.ip ? 'bg-cyan-600/30 border border-cyan-500/50 text-white' : 'bg-gray-600/50 hover:bg-gray-600 text-gray-300'
                                                    }`}
                                                >
                                                    <span className="font-medium">{p.name}</span>
                                                    <span className="text-gray-400 ml-2">{p.ip}</span>
                                                    <span className="text-gray-500 ml-2 text-xs">({p.type})</span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Step 2: Pair */}
                                <div className="border-t border-gray-600 pt-3">
                                    <h5 className="font-semibold text-gray-300 mb-2">2. Pair</h5>
                                    <AdminButton onClick={handlePairLutron} disabled={isPairing || !(pairIp || conn.lutronManualIp)}>
                                        {isPairing ? 'Pairing...' : 'Start Pairing'}
                                    </AdminButton>
                                    <p className="text-xs text-gray-400 mt-1">
                                        After clicking, you'll have 3 minutes to press the small black button on the back of your Lutron processor.
                                    </p>
                                </div>

                                {/* Advanced: manual cert upload */}
                                <div className="border-t border-gray-600 pt-3">
                                    <button
                                        onClick={() => setShowAdvancedLutron(!showAdvancedLutron)}
                                        className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                                    >
                                        {showAdvancedLutron ? 'Hide' : 'Show'} advanced options
                                    </button>
                                    {showAdvancedLutron && (
                                        <div className="mt-3 space-y-3">
                                            <div>
                                                <h5 className="font-semibold text-gray-400 mb-1 text-sm">Upload lap-pair Certs</h5>
                                                <label className="flex items-center justify-center px-4 py-2 rounded-md font-semibold transition-colors bg-gray-600 text-white hover:bg-gray-500 cursor-pointer text-sm w-fit">
                                                    <span>Upload 3 Files (key, cert, ca)</span>
                                                    <input type="file" accept=".key,.crt,.pem" multiple onChange={handleManualCertsUpload} className="hidden" disabled={isPairing} />
                                                </label>
                                            </div>
                                            <div>
                                                <h5 className="font-semibold text-gray-400 mb-1 text-sm">CSR Flow</h5>
                                                <div className="flex gap-2 flex-wrap">
                                                    <AdminButton onClick={handleGenerateCsr} disabled={isPairing} variant="secondary">
                                                        Generate CSR
                                                    </AdminButton>
                                                    <label className="flex items-center justify-center px-4 py-2 rounded-md font-semibold transition-colors bg-gray-600 text-white hover:bg-gray-500 cursor-pointer text-sm">
                                                        <span>Upload Certs (2 files)</span>
                                                        <input type="file" accept=".crt,.pem" multiple onChange={handleCertsUpload} className="hidden" disabled={isPairing} />
                                                    </label>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                         ) : conn.id === DeviceService.EnergyTrak ? (
                            <EnergyTrakSettings connection={conn} />
                         ) : conn.id === DeviceService.Whisker ? (
                            <div className="space-y-3">
                                <AdminInput
                                    label="Whisker Account Email"
                                    id="whisker-email"
                                    type="email"
                                    value={conn.whiskerEmail || ''}
                                    onChange={e => updateConnectionConfig(conn.id, 'whiskerEmail', e.target.value)}
                                />
                                <AdminInput
                                    label="Whisker Account Password"
                                    id="whisker-password"
                                    type="password"
                                    value={conn.whiskerPassword || ''}
                                    onChange={e => updateConnectionConfig(conn.id, 'whiskerPassword', e.target.value)}
                                />
                            </div>
                         ) : conn.id === DeviceService.HaywardPool ? (
                            <HaywardPoolSettings connection={conn} />
                         ) : conn.id === DeviceService.Flair ? (
                            <FlairSettings connection={conn} />
                         ) : conn.id === DeviceService.CoolMaster ? (
                            <CoolMasterSettings connection={conn} />
                         ) : conn.id === DeviceService.PoolFloor ? (
                            <PoolFloorSettings connection={conn} />
                         ) : conn.id === DeviceService.HomeAssistant ? (
                            <div className="space-y-3">
                                <AdminInput
                                    label="Home Assistant URL"
                                    id="ha-url"
                                    type="text"
                                    value={conn.cloudEndpoint}
                                    onChange={e => updateConnectionConfig(conn.id, 'cloudEndpoint', e.target.value)}
                                    placeholder="http://homeassistant.local:8123"
                                />
                                <AdminInput
                                    label="Long-Lived Access Token"
                                    id="ha-token"
                                    type="password"
                                    value={conn.apiKey || ''}
                                    onChange={e => updateConnectionConfig(conn.id, 'apiKey', e.target.value)}
                                    placeholder="Paste your HA long-lived access token"
                                />
                            </div>
                         ) : conn.id === DeviceService.Tempest ? (
                            <TempestSettings connection={conn} />
                         ) : (
                            // Default / Other Services
                            <>
                                {conn.id === DeviceService.RTSP && (
                                    <>
                                        <div className="mt-2 text-right">
                                            <button
                                                onClick={() => setShowRtspHelp(!showRtspHelp)}
                                                className="text-xs text-brand-blue hover:underline"
                                            >
                                                {showRtspHelp ? 'Hide Config Help' : 'Show Config Help'}
                                            </button>
                                        </div>
                                        {showRtspHelp && (
                                            <div className="mt-2 p-2 bg-gray-900 rounded border border-gray-600">
                                                <p className="text-xs text-gray-400 mb-1">
                                                    Add this to your <code>mediamtx.yml</code> to enable HLS and API access for this dashboard:
                                                </p>
                                                <textarea
                                                    readOnly
                                                    className="w-full h-32 bg-black text-green-400 text-xs font-mono p-1 rounded"
                                                    value={generatedMediamtxYaml}
                                                />
                                            </div>
                                        )}
                                    </>
                                )}
                                
                                {conn.id !== DeviceService.RTSP && (
                                    <AdminInput
                                        label="Endpoint URL"
                                        id={`${conn.id}-endpoint`}
                                        type="text"
                                        value={conn.cloudEndpoint}
                                        onChange={e => updateConnectionConfig(conn.id, 'cloudEndpoint', e.target.value)}
                                    />
                                )}

                                {conn.id === DeviceService.RTSP && (
                                     <AdminInput
                                        label="MediaMTX HLS URL"
                                        id={`${conn.id}-url`}
                                        type="text"
                                        value={conn.cloudEndpoint}
                                        onChange={e => updateConnectionConfig(conn.id, 'cloudEndpoint', e.target.value)}
                                    />
                                )}
                            </>
                         )}
                     </div>
                ))}
            </div>
        </AdminSection>
    );
};

const Admin = () => {
    const { loading } = useDashboard();
    const [activeTab, setActiveTab] = useState('general');
    const [editingPanelId, setEditingPanelId] = useState<string | null>(null);
    const location = useLocation();
    
    useEffect(() => {
        const searchParams = new URLSearchParams(location.search);
        const panelId = searchParams.get('panel');
        if (panelId) {
            setEditingPanelId(panelId);
        } else {
            setEditingPanelId(null);
        }
    }, [location.search]);

    const handleEditPanel = (panelId: string) => {
        setEditingPanelId(panelId);
    };

    const handleBackFromEditor = () => {
        setEditingPanelId(null);
        window.history.replaceState(null, '', '#/admin');
    };

    if (loading) return <div className="p-8 text-center text-gray-400">Loading configuration...</div>;

    if (editingPanelId) {
        return <PanelEditor panelId={editingPanelId} onBack={handleBackFromEditor} />;
    }

    const tabs = [
        { id: 'general', label: 'General', icon: IconSettings },
        { id: 'panels', label: 'Panels', icon: IconLayoutGrid },
        { id: 'devices', label: 'Virtual Devices', icon: IconCpu },
        { id: 'discovered', label: 'Discovered Devices', icon: IconRss },
        { id: 'connections', label: 'Connections', icon: IconLink },
        { id: 'security', label: 'Security', icon: IconShield },
        { id: 'notifications', label: 'Notifications', icon: IconVolume2 },
        { id: 'access', label: 'Access Control', icon: IconUsers },
        { id: 'internet-monitor', label: 'Internet Monitor', icon: IconWifi },
        { id: 'fishing-report', label: 'Fishing Report', icon: IconWaves },
        { id: 'battery-report', label: 'Battery Report', icon: IconBattery },
        { id: 'system', label: 'System', icon: IconServer },
    ];

    return (
        <div className="flex flex-col md:flex-row gap-6 h-full">
            {/* Sidebar Navigation */}
            <div className="w-full md:w-64 flex-shrink-0">
                <div className="bg-gray-800 rounded-lg shadow-lg overflow-hidden sticky top-6">
                    <div className="p-4 bg-gray-900 border-b border-gray-700">
                        <h2 className="text-lg font-bold text-white">Admin Settings</h2>
                    </div>
                    <nav className="p-2 space-y-1">
                        {tabs.map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`w-full flex items-center gap-3 px-4 py-3 rounded-md transition-colors ${activeTab === tab.id ? 'bg-brand-blue text-white' : 'text-gray-400 hover:bg-gray-700 hover:text-white'}`}
                            >
                                <tab.icon className="w-5 h-5" />
                                <span className="font-medium">{tab.label}</span>
                            </button>
                        ))}
                    </nav>
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 min-w-0">
                {activeTab === 'general' && <GeneralSettings />}
                {activeTab === 'panels' && <PanelManager onEditPanel={handleEditPanel} />}
                {activeTab === 'devices' && <VirtualDeviceManager />}
                {activeTab === 'discovered' && <DiscoveredDevicesManager />}
                {activeTab === 'connections' && <ConnectionManager />}
                {activeTab === 'security' && <SecuritySettings />}
                {activeTab === 'notifications' && <NotificationsSettings />}
                {activeTab === 'access' && (
                    <>
                        <DashboardUserManager />
                        <AdminUserManager />
                    </>
                )}
                {activeTab === 'internet-monitor' && <InternetMonitorSettings />}
                {activeTab === 'fishing-report' && <FishingReportSettings />}
                {activeTab === 'battery-report' && <BatteryReportSettings />}
                {activeTab === 'system' && <SystemStatusManager />}
            </div>
        </div>
    );
};

export default Admin;