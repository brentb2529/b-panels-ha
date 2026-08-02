import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useDashboard } from '../hooks/useDashboard';
import { Device, DeviceService, DashboardPanel, TileConfig, DeviceType, MediaItem, AllowedIP, ServiceConnection, TileDisplayOverride, TileAnimationConfig, HighlightSectionConfig, SonosNotification, SonosNotificationEventType, IdleMode } from '../types';
import { IconPlus, IconTrash2, IconChevronDown, IconFolder, IconLock, IconExpand, IconAlertTriangle, IconLayoutGrid, IconLightbulb, IconSquare, IconSun, IconThermometer, IconPersonStanding, IconDoorOpen, IconKeyboard, IconFlame, IconShield, IconZap, IconCamera, IconTv, IconVideo, IconX, IconCopy, IconPencil, IconSettings, IconArrowRight, IconLink, IconShieldAlert, IconArrowLeft, IconMusic, IconAlertOctagon, IconHome, IconCloud, IconCloudSun, IconServer, IconHistory, IconRss, IconDroplets, IconQrCode, IconUsers, IconCpu, IconRefreshCw, IconInfo, IconVolume2, IconCat, IconWifi, IconWaves, IconWind } from './icons';
import { produce } from 'immer';
import Tile from './Tile';
import { useNavigate, useLocation } from 'react-router-dom';
import AdminUserManager from './AdminUserManager';
import KioskScheduleEditor from './KioskScheduleEditor';
import SystemStatusManager from './SystemStatusManager';
import { apiSendTestWebhook, apiTestHomeAssistant, apiBroadcastTts, apiGetHomeAssistantStates } from '../services/api';
import yaml from 'js-yaml';
import { playTextToSpeech } from '../services/audioPlayer';

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
        case DeviceType.AirControl: return <IconWind {...iconProps} className="w-8 h-8 text-sky-400" />;
        case DeviceType.RSSFeed: return <IconRss {...iconProps} className="w-8 h-8 text-orange-400" />;
        case DeviceType.WaterSensor: 
        case DeviceType.Valve: return <IconDroplets {...iconProps} className="w-8 h-8 text-blue-400" />;
        case DeviceType.SmokeDetector: return <IconFlame {...iconProps} className="w-8 h-8 text-red-400" />;
        case DeviceType.CarbonMonoxideDetector: return <IconAlertTriangle {...iconProps} className="w-8 h-8 text-orange-400" />;
        case DeviceType.LitterRobot:
        case DeviceType.Vacuum: return <IconCat {...iconProps} className="w-8 h-8 text-indigo-400" />;
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
        weatherEntityId, updateWeatherEntityId,
    } = useDashboard();

    // Discover the HA `weather.*` entities so the source station is selectable
    // (e.g. choosing Arlington over a second Tempest site). Best-effort — if the
    // states call fails we still allow the ZIP-based Open-Meteo fallback.
    const [weatherEntities, setWeatherEntities] = useState<{ id: string; label: string }[]>([]);
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const states = await apiGetHomeAssistantStates();
                if (cancelled) return;
                const ents = (states || [])
                    .filter((s: any) => typeof s.entity_id === 'string' && s.entity_id.startsWith('weather.'))
                    .map((s: any) => {
                        const attr = s.attributes || {};
                        const src = /tempest|weatherflow/i.test(attr.attribution || '') ? ' — Tempest' : '';
                        return { id: s.entity_id, label: `${attr.friendly_name || s.entity_id}${src}` };
                    });
                setWeatherEntities(ents);
            } catch { /* selector falls back to free-text ZIP only */ }
        })();
        return () => { cancelled = true; };
    }, []);

    return (
        <AdminSection title="General Settings" description="Basic dashboard configuration.">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <AdminInput
                    label="Dashboard Title"
                    id="dash-title"
                    value={dashboardTitle}
                    onChange={e => updateDashboardTitle(e.target.value)}
                />
                <AdminSelect
                    label="Weather Source (HA entity)"
                    id="weather-entity"
                    value={weatherEntityId}
                    onChange={e => updateWeatherEntityId(e.target.value)}
                >
                    <option value="">Auto (prefer Tempest station)</option>
                    {weatherEntities.map(e => (
                        <option key={e.id} value={e.id}>{e.label}</option>
                    ))}
                    {/* Preserve a previously-saved id even if states haven't loaded yet */}
                    {weatherEntityId && !weatherEntities.some(e => e.id === weatherEntityId) && (
                        <option value={weatherEntityId}>{weatherEntityId}</option>
                    )}
                </AdminSelect>
                <AdminInput
                    label="Weather Zip Code (Open-Meteo fallback)"
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

            {/* Alarm system — Home Assistant / Alarmo. This build is HA-only;
                SmartThings is no longer a supported provider. */}
            <div className="border-t border-gray-700 mt-6 pt-6">
                {(
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
        updatePanelConfig, updatePanelTiles, updatePanelHighlights, alarmState, connections,
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
                            if (tile.deviceId === 'hometile-sthm-panel' && alarmState) {
                                device = {
                                    id: 'hometile-sthm-panel',
                                    name: `${alarmState.locationName} Monitor`,
                                    type: DeviceType.AlarmPanel,
                                    service: DeviceService.Virtual,
                                    state: alarmState,
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
                                        label="Show Intrusion Alerts"
                                        description="Shows the configured alarm's status in the header and displays a full-screen alert on intrusion."
                                        enabled={!!panel.showAlarmAlerts}
                                        onToggle={() => updatePanelConfig(panelId, { showAlarmAlerts: !panel.showAlarmAlerts })}
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
        { value: DeviceType.AirControl, label: 'Air Control (Climate Zones)' },
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
        { id: 'security', label: 'Security', icon: IconShield },
        { id: 'notifications', label: 'Notifications', icon: IconVolume2 },
        { id: 'access', label: 'Access Control', icon: IconUsers },
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
                {activeTab === 'security' && <SecuritySettings />}
                {activeTab === 'notifications' && <NotificationsSettings />}
                {activeTab === 'access' && (
                    <>
                        <DashboardUserManager />
                        <AdminUserManager />
                    </>
                )}
                {activeTab === 'system' && <SystemStatusManager />}
            </div>
        </div>
    );
};

export default Admin;