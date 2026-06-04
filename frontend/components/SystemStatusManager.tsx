
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useDashboard } from '../hooks/useDashboard';
import { DeviceService } from '../types';
import { IconCheckCircle, IconXCircle, IconAlertTriangle, IconRefreshCw, IconServer, IconInfo, IconZap, IconRss, IconLightbulb, IconCat, IconCloudSun, IconWaves, IconThermometer } from './icons';
import { apiSendTestWebhook, apiSendWebhookNotification } from '../services/api';

// HA-only inert stubs for removed non-HA integration health checks.
const stubHealth = async (..._a: any[]): Promise<any> => ({ ok: false, status: 'unavailable' });
const emptyArrayAsync = async (..._a: any[]): Promise<any[]> => [];
const energyTrakService: any = { getHealth: stubHealth, getDevices: emptyArrayAsync };
const litterRobotService: any = { getHealth: stubHealth };
const tempestService: any = { getHealth: stubHealth };
const haywardPoolService: any = { getHealth: stubHealth };
const flairService: any = { getHealth: stubHealth };
const coolMasterService: any = { getHealth: stubHealth };
const smartThingsService: any = { getRelayHealth: stubHealth };
const apiGetLutronStatus = async (): Promise<any> => ({ isPaired: false, isConnected: false });

// #region Re-used Admin Components
const AdminSection: React.FC<React.PropsWithChildren<{ title: string; description?: string }>> = ({ title, description, children }) => (
    <div className="bg-gray-800 p-6 rounded-lg shadow-lg mb-8">
        <div className="flex items-center gap-3 mb-1">
            <IconServer className="w-6 h-6 text-gray-400" />
            <h3 className="text-xl font-semibold">{title}</h3>
        </div>
        {description && <p className="text-sm text-gray-400 mb-4 ml-9">{description}</p>}
        <div className="ml-9">
            {children}
        </div>
    </div>
);

const AdminInput: React.FC<React.InputHTMLAttributes<HTMLInputElement> & { label: string }> = ({ label, id, ...props }) => (
    <div>
        <label htmlFor={id} className="block mb-1 text-sm font-medium text-gray-400">{label}</label>
        <input id={id} {...props} className="w-full bg-gray-700 border border-gray-600 rounded-md p-2 text-white focus:ring-brand-blue focus:border-brand-blue" />
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

interface HealthState {
    status: 'ok' | 'warning' | 'error' | 'checking' | 'disabled';
    message: string;
    details?: Record<string, any>;
}

const getApiBaseUrl = (): string => {
    const envUrl = (import.meta as any).env?.VITE_API_URL;
    if (envUrl) {
        return envUrl;
    }
    return `${window.location.protocol}//${window.location.hostname}:3001`;
};

const formatTimeAgo = (isoString: string | null): string => {
    if (!isoString) return 'Never';
    const date = new Date(isoString);
    const now = new Date();
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
    
    if (seconds < 5) return 'Just now';
    if (seconds < 60) return `${seconds} seconds ago`;
    
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    
    const days = Math.floor(hours / 24);
    return `${days} day${days > 1 ? 's' : ''} ago`;
};

const StatusCard = ({ title, health, icon, alertCondition }: { title: string; health: HealthState, icon?: React.ReactNode, alertCondition?: string }) => {
    const { status, message, details } = health;

    const statusConfig = {
        ok: { icon: icon || <IconCheckCircle className="w-8 h-8 text-green-400" />, color: 'border-green-500/50' },
        warning: { icon: <IconAlertTriangle className="w-8 h-8 text-yellow-400" />, color: 'border-yellow-500/50' },
        error: { icon: <IconXCircle className="w-8 h-8 text-red-400" />, color: 'border-red-500/50' },
        checking: { icon: <IconRefreshCw className="w-8 h-8 text-gray-400 animate-spin" />, color: 'border-gray-500/50' },
        disabled: { icon: <IconInfo className="w-8 h-8 text-gray-400" />, color: 'border-gray-500/50' },
    };

    const config = statusConfig[status];

    return (
        <div className={`bg-gray-700 p-4 rounded-lg flex items-start gap-4 border-l-4 ${config.color}`}>
            <div className="flex-shrink-0 pt-1">{config.icon}</div>
            <div className="flex-1 min-w-0">
                <h4 className="font-bold text-lg text-white">{title}</h4>
                <p className="text-sm text-gray-300 truncate" title={message}>{message}</p>
                {alertCondition && (
                    <p className="text-xs text-gray-500 mt-1 italic">
                        <span className="text-yellow-500/70">⚡ Alert:</span> {alertCondition}
                    </p>
                )}
                {details && (
                    <div className="mt-2 pt-2 border-t border-gray-600/50 text-xs text-gray-400 space-y-1">
                        {Object.entries(details).map(([key, value]) => (
                            <div key={key} className="flex justify-between">
                                <span className="font-semibold">{key}:</span>
                                <span className="font-mono">{value}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};


const SystemStatusManager = () => {
    const { connections, addNotification, monitoringEnabled, monitoringWebhookUrl, updateMonitoringConfig, haWsState, lastHaEventAt, primaryAlarmProvider } = useDashboard();
    const [isLoading, setIsLoading] = useState(false);

    const [apiHealth, setApiHealth] = useState<HealthState>({ status: 'checking', message: 'Checking...' });
    const [relayHealth, setRelayHealth] = useState<HealthState>({ status: 'checking', message: 'Checking...' });
    const [sonosHealth, setSonosHealth] = useState<HealthState>({ status: 'checking', message: 'Checking...' });
    const [streamHealth, setStreamHealth] = useState<HealthState>({ status: 'checking', message: 'Checking...' });
    const [energyTrakHealth, setEnergyTrakHealth] = useState<HealthState>({ status: 'checking', message: 'Checking...' });
    const [whiskerHealth, setWhiskerHealth] = useState<HealthState>({ status: 'checking', message: 'Checking...' });
    const [tempestHealth, setTempestHealth] = useState<HealthState>({ status: 'checking', message: 'Checking...' });
    const [lutronHealth, setLutronHealth] = useState<HealthState>({ status: 'checking', message: 'Checking...' });
    const [haywardPoolHealth, setHaywardPoolHealth] = useState<HealthState>({ status: 'checking', message: 'Checking...' });
    const [flairHealth, setFlairHealth] = useState<HealthState>({ status: 'checking', message: 'Checking...' });
    const [coolmasterHealth, setCoolmasterHealth] = useState<HealthState>({ status: 'checking', message: 'Checking...' });
    const [haHealth, setHaHealth] = useState<HealthState>({ status: 'checking', message: 'Checking...' });
    const [webhookHealth, setWebhookHealth] = useState<HealthState>({ status: 'checking', message: 'Checking...' });
    
    const [isTestingWebhook, setIsTestingWebhook] = useState(false);
    
    const prevHealthStates = useRef<Record<string, HealthState>>({});
    const errorStartTimes = useRef<Record<string, number>>({}); // Track when services entered error/warning state

    const healthServices = useMemo(() => ([
        { name: 'API Server', state: apiHealth },
        { name: 'SmartThings Relay', state: relayHealth },
        { name: 'Sonos API Server', state: sonosHealth },
        { name: 'Stream Server (MediaMTX)', state: streamHealth },
        { name: 'EnergyTrak Service', state: energyTrakHealth },
        { name: 'Whisker (Litter Robot)', state: whiskerHealth },
        { name: 'Tempest Weather', state: tempestHealth },
        { name: 'Lutron Caseta', state: lutronHealth },
        { name: 'Hayward Pool', state: haywardPoolHealth },
        { name: 'Flair HVAC', state: flairHealth },
        { name: 'CoolMaster HVAC', state: coolmasterHealth },
        { name: 'Home Assistant', state: haHealth },
        { name: 'Webhook Monitor', state: webhookHealth }
    ]), [apiHealth, relayHealth, sonosHealth, streamHealth, energyTrakHealth, whiskerHealth, tempestHealth, lutronHealth, haywardPoolHealth, flairHealth, coolmasterHealth, haHealth, webhookHealth]);

    useEffect(() => {
        const currentStates: Record<string, HealthState> = {};
        let hasChanges = false;

        healthServices.forEach(service => {
            currentStates[service.name] = service.state;
            const prevState = prevHealthStates.current[service.name];
            const prevStatus = prevState?.status;
            const currentStatus = service.state.status;

            if (!prevState || currentStatus !== prevStatus) {
                hasChanges = true;

                // Trigger global UI notification for any new error
                if (currentStatus === 'error' && prevStatus !== 'error') {
                    addNotification(`System Alert: ${service.name} is in a failed state.`, 'error');
                }

                // Track when services enter error/warning state for downtime calculation
                if ((currentStatus === 'error' || currentStatus === 'warning') &&
                    prevStatus !== 'error' && prevStatus !== 'warning') {
                    errorStartTimes.current[service.name] = Date.now();
                }

                // Trigger webhook for new errors if enabled
                if ((currentStatus === 'error' || currentStatus === 'warning') &&
                    prevStatus !== 'error' && prevStatus !== 'warning' &&
                    monitoringEnabled && monitoringWebhookUrl) {
                    const timestamp = new Date().toLocaleString();
                    let detailsStr = '';
                    if (service.state.details) {
                        detailsStr = Object.entries(service.state.details)
                            .map(([k, v]) => `${k}: ${v}`)
                            .join(' | ');
                    }
                    const statusEmoji = currentStatus === 'error' ? '🚨' : '⚠️';
                    const statusLabel = currentStatus === 'error' ? 'SERVICE FAILURE' : 'SERVICE WARNING';
                    const fullMessage = [
                        `${statusEmoji} ${statusLabel}`,
                        `Component: ${service.name}`,
                        `Status: ${service.state.message}`,
                        `Time: ${timestamp}`,
                        detailsStr ? `Details: ${detailsStr}` : ''
                    ].filter(Boolean).join('\n');

                    apiSendWebhookNotification(fullMessage, currentStatus, {
                        component: service.name,
                        eventType: 'failure',
                        errorMessage: service.state.message,
                        previousState: prevStatus || 'unknown',
                        details: service.state.details,
                        timestamp: new Date().toISOString()
                    })
                        .then(() => console.log(`[Webhook] Failure notification sent for ${service.name}`))
                        .catch(err => console.error(`[Webhook] Failed to send failure notification for ${service.name}`, err));
                }

                // Trigger RECOVERY webhook when service transitions from error/warning to ok
                if (currentStatus === 'ok' &&
                    (prevStatus === 'error' || prevStatus === 'warning') &&
                    monitoringEnabled && monitoringWebhookUrl) {
                    const timestamp = new Date().toLocaleString();
                    const errorStartTime = errorStartTimes.current[service.name];
                    let downtimeStr = '';

                    if (errorStartTime) {
                        const downtimeMs = Date.now() - errorStartTime;
                        const downtimeSec = Math.floor(downtimeMs / 1000);
                        if (downtimeSec < 60) {
                            downtimeStr = `${downtimeSec} seconds`;
                        } else if (downtimeSec < 3600) {
                            const mins = Math.floor(downtimeSec / 60);
                            const secs = downtimeSec % 60;
                            downtimeStr = `${mins}m ${secs}s`;
                        } else {
                            const hours = Math.floor(downtimeSec / 3600);
                            const mins = Math.floor((downtimeSec % 3600) / 60);
                            downtimeStr = `${hours}h ${mins}m`;
                        }
                        // Clear the tracked start time
                        delete errorStartTimes.current[service.name];
                    }

                    let detailsStr = '';
                    if (service.state.details) {
                        detailsStr = Object.entries(service.state.details)
                            .map(([k, v]) => `${k}: ${v}`)
                            .join(' | ');
                    }

                    const fullMessage = [
                        `✅ SERVICE RECOVERED`,
                        `Component: ${service.name}`,
                        `Status: ${service.state.message}`,
                        `Previous State: ${prevStatus}`,
                        downtimeStr ? `Downtime: ${downtimeStr}` : '',
                        `Recovered At: ${timestamp}`,
                        detailsStr ? `Details: ${detailsStr}` : ''
                    ].filter(Boolean).join('\n');

                    apiSendWebhookNotification(fullMessage, 'success', {
                        component: service.name,
                        eventType: 'recovery',
                        previousState: prevStatus,
                        currentState: 'ok',
                        downtimeDuration: downtimeStr || 'unknown',
                        details: service.state.details,
                        timestamp: new Date().toISOString()
                    })
                        .then(() => console.log(`[Webhook] Recovery notification sent for ${service.name}`))
                        .catch(err => console.error(`[Webhook] Failed to send recovery notification for ${service.name}`, err));

                    // Also notify the UI
                    addNotification(`Service Recovered: ${service.name} is now operational.`, 'success');
                }
            }
        });

        if (hasChanges) {
            prevHealthStates.current = currentStates;
        }

    }, [healthServices, addNotification, monitoringEnabled, monitoringWebhookUrl]);

    const checkAllHealth = useCallback(async () => {
        setIsLoading(true);

        const stConnection = connections.find(c => c.id === DeviceService.SmartThings);
        const sonosConnection = connections.find(c => c.id === DeviceService.Sonos);
        const rtspConnection = connections.find(c => c.id === DeviceService.RTSP);
        const apiBaseUrl = getApiBaseUrl();

        const fetchWithTimeout = (url: string, options = {}, timeout = 5000) => {
            return Promise.race([
                fetch(url, options),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Request timed out')), timeout)
                )
            ]);
        };

        // API Health
        const checkApi = async () => {
            try {
                const response = await fetchWithTimeout(`${apiBaseUrl}/api/health`) as Response;
                if (!response.ok) throw new Error(`HTTP status ${response.status}`);
                await response.json();
                setApiHealth({ status: 'ok', message: 'Operational' });
            } catch (error: any) {
                setApiHealth({ status: 'error', message: error.message || 'Failed to connect' });
            }
        };

        // ST Relay Health
        const checkRelay = async () => {
            if (!stConnection || !stConnection.enabled) {
                setRelayHealth({ status: 'disabled', message: 'Disabled in Connections' });
                return;
            }
            if (!stConnection.cloudEndpoint) {
                 setRelayHealth({ status: 'warning', message: 'URL not configured' });
                return;
            }
            try {
                // Use the authenticated /api/health (public /health is just
                // {ok:true} so it leaks nothing). getRelayHealth sends the auth
                // token the other relay calls already use.
                const data = await smartThingsService.getRelayHealth(stConnection);
                setRelayHealth({
                    status: 'ok',
                    message: 'Operational',
                    details: {
                        "Last Event": data.lastEventTimestamp ? formatTimeAgo(data.lastEventTimestamp) : 'No events yet',
                        "Connected Clients": data.sseClientCount ?? 'N/A'
                    }
                });
            } catch (error: any) {
                setRelayHealth({ status: 'error', message: error.message || 'Failed to connect' });
            }
        };

        // Sonos API Health
        const checkSonos = async () => {
            if (!sonosConnection || !sonosConnection.enabled) {
                setSonosHealth({ status: 'disabled', message: 'Disabled in Connections' });
                return;
            }
             if (!sonosConnection.cloudEndpoint) {
                 setSonosHealth({ status: 'warning', message: 'URL not configured' });
                return;
            }
            try {
                const url = sonosConnection.cloudEndpoint.replace(/\/+$/, '');
                const response = await fetchWithTimeout(`${url}/zones`) as Response;
                if (!response.ok) throw new Error(`HTTP status ${response.status}`);
                setSonosHealth({ status: 'ok', message: 'Operational' });
            } catch (error: any) {
                setSonosHealth({ status: 'error', message: error.message || 'Failed to connect' });
            }
        };

        // EnergyTrak Health
        const checkEnergyTrak = async () => {
            const etConnection = connections.find(c => c.id === DeviceService.EnergyTrak);
            if (!etConnection || !etConnection.enabled) {
                setEnergyTrakHealth({ status: 'disabled', message: 'Disabled in Connections' });
                return;
            }
            try {
                // Check if wrapper service is reachable and configured
                const health = await energyTrakService.getHealth(etConnection);
                if (!health.ok) throw new Error("Service reported unhealthy");

                // Use haveToken as the primary indicator of being configured, as it proves a successful sign-in happened once.
                if (!health.haveToken) {
                     setEnergyTrakHealth({ status: 'warning', message: 'Not configured (Auth missing)' });
                     return;
                }

                // Check data freshness using polledAt (when our service last fetched)
                // AND lastUpdated (when energytrak.io last received data from device)
                const devices = await energyTrakService.getDevices(etConnection);
                if (devices.length > 0) {
                    const firstDevice = devices[0];
                    const state = firstDevice.state as any;
                    const polledAtStr = state.polledAt;
                    const lastUpdatedStr = state.lastUpdated;
                    const now = Date.now();

                    // Build details - show both our poll time and origin data time
                    const details: Record<string, string> = {};

                    let polledAtStale = false;
                    let originDataStale = false;

                    if (polledAtStr) {
                        const polledAt = new Date(polledAtStr).getTime();
                        const diffMinutes = (now - polledAt) / 1000 / 60;
                        details["Last Poll"] = formatTimeAgo(polledAtStr);
                        if (diffMinutes > 5) { // Poll is > 5 mins old
                            polledAtStale = true;
                        }
                    }

                    if (lastUpdatedStr) {
                        // Parse the lastUpdated timestamp from energytrak.io
                        // Format: "2025-12-31 17:07:17.000"
                        const lastUpdated = new Date(lastUpdatedStr.replace(' ', 'T')).getTime();
                        if (!isNaN(lastUpdated)) {
                            const originDiffMinutes = (now - lastUpdated) / 1000 / 60;
                            details["Origin Data"] = formatTimeAgo(lastUpdatedStr.replace(' ', 'T'));
                            if (originDiffMinutes > 15) { // Origin data > 15 mins old is stale
                                originDataStale = true;
                            }
                        } else {
                            details["Origin Data"] = lastUpdatedStr; // Show raw if can't parse
                        }
                    }

                    // Determine overall status
                    if (polledAtStale && originDataStale) {
                        setEnergyTrakHealth({
                            status: 'error',
                            message: 'Both poll and origin data stale',
                            details
                        });
                    } else if (originDataStale) {
                        setEnergyTrakHealth({
                            status: 'warning',
                            message: 'Origin data from device is stale',
                            details
                        });
                    } else if (polledAtStale) {
                        setEnergyTrakHealth({
                            status: 'warning',
                            message: 'Poll data is stale',
                            details
                        });
                    } else if (Object.keys(details).length > 0) {
                        setEnergyTrakHealth({
                            status: 'ok',
                            message: 'Operational',
                            details
                        });
                    } else {
                        setEnergyTrakHealth({ status: 'ok', message: 'Operational (No timestamps)' });
                    }
                } else {
                    setEnergyTrakHealth({ status: 'warning', message: 'Connected but no sites found' });
                }

            } catch (error: any) {
                setEnergyTrakHealth({ status: 'error', message: error.message || 'Failed to connect' });
            }
        };

        // Whisker (Litter Robot) Health
        const checkWhisker = async () => {
            const whiskerConnection = connections.find(c => c.id === DeviceService.Whisker);
            if (!whiskerConnection || !whiskerConnection.enabled) {
                setWhiskerHealth({ status: 'disabled', message: 'Disabled in Connections' });
                return;
            }
            try {
                const health = await litterRobotService.getHealth(whiskerConnection);

                if (!health.ok) {
                    setWhiskerHealth({ status: 'error', message: 'Service unhealthy' });
                    return;
                }

                if (!health.configured) {
                    setWhiskerHealth({ status: 'warning', message: 'Not configured (Credentials missing)' });
                    return;
                }

                if (!health.connected) {
                    setWhiskerHealth({ status: 'warning', message: 'Configured but not connected to Whisker API' });
                    return;
                }

                const details: Record<string, any> = {
                    "Robots": health.robotCount
                };
                if (health.lastRefresh) {
                    details["Last Refresh"] = formatTimeAgo(health.lastRefresh);
                }

                setWhiskerHealth({
                    status: 'ok',
                    message: 'Operational',
                    details
                });

            } catch (error: any) {
                setWhiskerHealth({ status: 'error', message: error.message || 'Failed to connect' });
            }
        };

        // Tempest Weather Health Check
        const checkTempest = async () => {
            const tempestConnection = connections.find(c => c.id === DeviceService.Tempest);
            if (!tempestConnection || !tempestConnection.enabled) {
                setTempestHealth({ status: 'disabled', message: 'Disabled in Connections' });
                return;
            }
            try {
                const health = await tempestService.getHealth(tempestConnection);

                if (!health.ok) {
                    setTempestHealth({ status: 'error', message: 'Service unhealthy' });
                    return;
                }

                if (!health.configured) {
                    setTempestHealth({ status: 'warning', message: 'Not configured (API token or Station ID missing)' });
                    return;
                }

                if (!health.hasCachedData) {
                    setTempestHealth({ status: 'warning', message: 'Configured but no weather data yet' });
                    return;
                }

                const details: Record<string, any> = {
                    "Station ID": health.stationId
                };
                if (health.lastPoll) {
                    details["Last Poll"] = formatTimeAgo(health.lastPoll);
                }

                setTempestHealth({
                    status: 'ok',
                    message: 'Operational',
                    details
                });

            } catch (error: any) {
                setTempestHealth({ status: 'error', message: error.message || 'Failed to connect' });
            }
        };

        // Lutron Health Check
        const checkLutron = async () => {
            const lutronConnection = connections.find(c => c.id === DeviceService.Lutron);
            if (!lutronConnection || !lutronConnection.enabled) {
                setLutronHealth({ status: 'disabled', message: 'Disabled in Connections' });
                return;
            }
            try {
                const status = await apiGetLutronStatus();

                if (status.error) {
                    setLutronHealth({
                        status: 'error',
                        message: status.error,
                        details: status.processorIp ? { "Processor IP": status.processorIp } : undefined
                    });
                    return;
                }

                if (!status.isPaired) {
                    setLutronHealth({
                        status: 'warning',
                        message: 'Not paired - certificates missing',
                        details: { "Status": "Awaiting certificate upload" }
                    });
                    return;
                }

                if (status.discoveryActive) {
                    setLutronHealth({
                        status: 'warning',
                        message: 'Discovering processor...',
                        details: { "Status": "mDNS discovery in progress" }
                    });
                    return;
                }

                if (!status.isConnected) {
                    setLutronHealth({
                        status: 'error',
                        message: 'Paired but not connected',
                        details: {
                            "Processor IP": status.processorIp || 'Not discovered',
                            "Error": status.error || 'Connection failed'
                        }
                    });
                    return;
                }

                setLutronHealth({
                    status: 'ok',
                    message: 'Connected & Operational',
                    details: {
                        "Processor IP": status.processorIp,
                        "Status": "Paired & Connected"
                    }
                });
            } catch (error: any) {
                setLutronHealth({ status: 'error', message: error.message || 'Failed to check status' });
            }
        };

        // Hayward Pool Health Check
        const checkHaywardPool = async () => {
            const hpConnection = connections.find(c => c.id === DeviceService.HaywardPool);
            if (!hpConnection || !hpConnection.enabled) {
                setHaywardPoolHealth({ status: 'disabled', message: 'Disabled in Connections' });
                return;
            }
            try {
                const health = await haywardPoolService.getHealth(hpConnection);
                if (!health.ok) {
                    setHaywardPoolHealth({ status: 'error', message: 'Service unhealthy' });
                    return;
                }
                if (!health.configured) {
                    setHaywardPoolHealth({ status: 'warning', message: 'Not configured' });
                    return;
                }
                if (!health.connected) {
                    setHaywardPoolHealth({ status: 'warning', message: 'Configured but not connected' });
                    return;
                }
                const details: Record<string, any> = {
                    "System": health.systemName || 'OmniLogic',
                    "Transport": health.activeTransport || 'unknown',
                    "Bodies": health.bodyCount,
                    "Pumps": health.pumpCount,
                };
                if (health.lastRefresh) details["Last Refresh"] = formatTimeAgo(health.lastRefresh);
                setHaywardPoolHealth({ status: 'ok', message: 'Operational', details });
            } catch (error: any) {
                setHaywardPoolHealth({ status: 'error', message: error.message || 'Failed to connect' });
            }
        };

        // Flair HVAC Health Check
        const checkFlair = async () => {
            const flairConnection = connections.find(c => c.id === DeviceService.Flair);
            if (!flairConnection || !flairConnection.enabled) {
                setFlairHealth({ status: 'disabled', message: 'Disabled in Connections' });
                return;
            }
            try {
                const health = await flairService.getHealth(flairConnection);
                if (!health.ok) {
                    setFlairHealth({ status: 'error', message: 'Service unhealthy' });
                    return;
                }
                if (!health.configured) {
                    setFlairHealth({ status: 'warning', message: 'Not configured (client credentials missing)' });
                    return;
                }
                if (!health.connected) {
                    setFlairHealth({ status: 'warning', message: 'Configured but not connected to Flair API' });
                    return;
                }
                const details: Record<string, any> = {
                    "Structure": health.structureName || 'Home',
                    "Mode": health.systemMode || 'unknown',
                    "Rooms": health.roomCount,
                    "Vents": health.ventCount,
                    "Connection": health.connectionMode,
                };
                if (health.lastRefresh) details["Last Refresh"] = formatTimeAgo(health.lastRefresh);
                if (health.connectionMode === 'cloud' && !health.tokenValid) {
                    setFlairHealth({ status: 'warning', message: 'OAuth token expired — will refresh on next call', details });
                    return;
                }
                // Stale check — treat poll gap > 3 min as warning
                if (health.lastRefresh) {
                    const age = Date.now() - new Date(health.lastRefresh).getTime();
                    if (age > 3 * 60 * 1000) {
                        setFlairHealth({ status: 'warning', message: `Data stale (${Math.round(age / 60000)}m old)`, details });
                        return;
                    }
                }
                setFlairHealth({ status: 'ok', message: 'Operational', details });
            } catch (error: any) {
                setFlairHealth({ status: 'error', message: error.message || 'Failed to connect' });
            }
        };

        // CoolAutomation / CoolMaster HVAC Health Check
        const checkCoolMaster = async () => {
            const cmConnection = connections.find(c => c.id === DeviceService.CoolMaster);
            if (!cmConnection || !cmConnection.enabled) {
                setCoolmasterHealth({ status: 'disabled', message: 'Disabled in Connections' });
                return;
            }
            try {
                const health = await coolMasterService.getHealth(cmConnection);
                if (!health.ok) {
                    setCoolmasterHealth({ status: 'error', message: 'Service unhealthy' });
                    return;
                }
                if (!health.configured) {
                    setCoolmasterHealth({ status: 'warning', message: 'Not configured' });
                    return;
                }
                if (!health.connected) {
                    setCoolmasterHealth({ status: 'warning', message: 'Configured but not connected' });
                    return;
                }
                const details: Record<string, any> = {
                    "System": health.systemName || 'CoolMaster HVAC',
                    "Transport": health.activeTransport || 'unknown',
                    "Units": `${health.activeUnitCount} / ${health.unitCount}`,
                    "Lines": health.lineCount,
                };
                if (health.lastRefresh) details["Last Refresh"] = formatTimeAgo(health.lastRefresh);
                // Cloud token check (only meaningful in cloud/both mode)
                if ((health.connectionMode === 'cloud' || health.connectionMode === 'both') && health.tokenValid === false) {
                    setCoolmasterHealth({ status: 'warning', message: 'OAuth token expired — will refresh on next call', details });
                    return;
                }
                // Stale check — poll gap > 3 min is a warning
                if (health.lastRefresh) {
                    const age = Date.now() - new Date(health.lastRefresh).getTime();
                    if (age > 3 * 60 * 1000) {
                        setCoolmasterHealth({ status: 'warning', message: `Data stale (${Math.round(age / 60000)}m old)`, details });
                        return;
                    }
                }
                setCoolmasterHealth({ status: 'ok', message: 'Operational', details });
            } catch (error: any) {
                setCoolmasterHealth({ status: 'error', message: error.message || 'Failed to connect' });
            }
        };

        // Home Assistant Health Check
        const checkHomeAssistant = async () => {
            const haConnection = connections.find(c => c.id === DeviceService.HomeAssistant);
            if (!haConnection || !haConnection.enabled) {
                setHaHealth({ status: 'disabled', message: 'Disabled in Connections' });
                return;
            }
            if (!haConnection.cloudEndpoint) {
                setHaHealth({ status: 'warning', message: 'URL not configured' });
                return;
            }
            if (!(haConnection as any).apiKey) {
                setHaHealth({ status: 'warning', message: 'Access token not configured' });
                return;
            }
            // WebSocket connection state is the primary signal — no extra HTTP call needed
            if (haWsState === 'disconnected') {
                setHaHealth({ status: 'error', message: 'WebSocket disconnected — reconnecting' });
                return;
            }
            if (haWsState === 'connecting') {
                setHaHealth({ status: 'warning', message: 'WebSocket connecting…' });
                return;
            }
            // Connected — check for stale data
            const details: Record<string, string> = {};
            if (primaryAlarmProvider === 'ha') {
                const entityId = (haConnection as any).haAlarmEntityId || 'alarm_control_panel.alarmo';
                details['Alarm Entity'] = entityId;
            }
            if (lastHaEventAt) {
                const ageMs = Date.now() - lastHaEventAt.getTime();
                details['Last Event'] = formatTimeAgo(lastHaEventAt.toISOString());
                if (ageMs > 5 * 60 * 1000) {
                    setHaHealth({ status: 'warning', message: `No events in ${Math.round(ageMs / 60000)} min — data may be stale`, details });
                    return;
                }
            } else {
                details['Last Event'] = 'None yet';
            }
            setHaHealth({ status: 'ok', message: 'WebSocket connected', details });
        };

        // Webhook Monitor Check
        const checkWebhook = async () => {
             if (!monitoringEnabled) {
                 setWebhookHealth({ status: 'disabled', message: 'Monitoring Disabled' });
                 return;
             }
             if (!monitoringWebhookUrl) {
                 setWebhookHealth({ status: 'warning', message: 'URL not configured' });
                 return;
             }
             setWebhookHealth({ status: 'ok', message: 'Active & Configured' });
        };

        // Stream Server (MediaMTX) Health
        const checkStream = async () => {
            if (!rtspConnection || !rtspConnection.enabled) {
                setStreamHealth({ status: 'disabled', message: 'Disabled in Connections' });
                return;
            }
            if (!rtspConnection.cloudEndpoint) {
                 setStreamHealth({ status: 'warning', message: 'URL not configured' });
                return;
            }

            try {
                let apiUrl = '';
                try {
                    const hlsUrl = new URL(rtspConnection.cloudEndpoint);
                    apiUrl = `${hlsUrl.protocol}//${hlsUrl.hostname}:9997`;
                } catch {
                    throw new Error('Invalid HLS URL configured');
                }

                let data: any;
                let apiVersion = '';
                let lastError = 'Unknown error';
                let success = false;
                const versions = ['v3', 'v2', 'v1'];
                const credentials = btoa('admin:hometile');
                const headers = { 'Authorization': `Basic ${credentials}` };

                for (const v of versions) {
                    try {
                        const response = await fetchWithTimeout(`${apiUrl}/${v}/paths/list`, { headers }, 2000) as Response;
                        if (response.ok) {
                            data = await response.json();
                            apiVersion = v;
                            success = true;
                            break; 
                        } else {
                            lastError = response.status === 401 ? "Authentication failed" : `HTTP ${response.status}`;
                        }
                    } catch (e: any) { lastError = e.message; }
                }

                if (!success) throw new Error(`${lastError} at ${apiUrl}`);
                
                let items: any[] = (apiVersion === 'v3' || apiVersion === 'v2') ? (data.items || []) : Object.keys(data.items || data).map(key => ({ name: key, ...data.items[key], ready: data.items[key].sourceReady }));
                const totalCount = items.length;
                const readyCount = items.filter((i: any) => i.ready).length;
                
                const details: Record<string, any> = { "API Endpoint": apiUrl, "Total Streams": totalCount, "Active (Ready)": readyCount };
                if (totalCount > 0) {
                    details["Streams"] = items.map((i: any) => `${i.name}: ${i.ready ? 'OK' : 'Offline'}`).join(', ');
                }

                let status: HealthState['status'] = 'ok', message = 'All streams active';
                if (totalCount === 0) { status = 'warning'; message = 'No streams configured'; }
                else if (readyCount === 0) { status = 'error'; message = 'All streams offline'; }
                else if (readyCount < totalCount) { status = 'warning'; message = `${readyCount}/${totalCount} streams active`; }

                setStreamHealth({ status, message, details });

            } catch (error: any) {
                setStreamHealth({ status: 'error', message: error.message });
            }
        };

        await Promise.all([checkApi(), checkRelay(), checkSonos(), checkStream(), checkEnergyTrak(), checkWhisker(), checkTempest(), checkLutron(), checkHaywardPool(), checkFlair(), checkCoolMaster(), checkHomeAssistant(), checkWebhook()]);

        setIsLoading(false);
    }, [connections, monitoringEnabled, monitoringWebhookUrl, haWsState, lastHaEventAt, primaryAlarmProvider]);
    
    useEffect(() => {
        checkAllHealth();
        const intervalId = setInterval(checkAllHealth, 30000);
        return () => clearInterval(intervalId);
    }, [checkAllHealth]);
    
    const handleTestWebhook = async () => {
        setIsTestingWebhook(true);
        try {
            await apiSendTestWebhook();
            addNotification('Test webhook sent successfully!', 'success');
        } catch (e: any) {
            addNotification(`Webhook failed: ${e.message}`, 'error');
        } finally {
            setIsTestingWebhook(false);
        }
    };

    return (
        <AdminSection title="System Health & Monitoring" description="Monitor backend services and configure webhook notifications for failures.">
            
            <div className="bg-gray-900 p-4 rounded-lg mb-6 space-y-4 border border-gray-700">
                <h4 className="text-lg font-semibold text-white">Webhook Configuration</h4>
                <AdminToggle
                    label="Enable Webhook Notifications"
                    description="Send an alert to the specified URL when a service enters a failed state."
                    enabled={monitoringEnabled}
                    onToggle={() => updateMonitoringConfig({ enabled: !monitoringEnabled })}
                />
                <AdminInput
                    label="Webhook URL"
                    value={monitoringWebhookUrl}
                    onChange={(e) => updateMonitoringConfig({ webhookUrl: e.target.value })}
                    disabled={!monitoringEnabled}
                    placeholder="Enter your webhook URL (e.g., Discord, Slack, IFTTT)"
                />
                <AdminButton onClick={handleTestWebhook} disabled={!monitoringEnabled || !monitoringWebhookUrl || isTestingWebhook}>
                    {isTestingWebhook ? 'Sending...' : 'Send Test Notification'}
                </AdminButton>
            </div>

            <div className="flex justify-end mb-4">
                 <AdminButton onClick={checkAllHealth} disabled={isLoading} variant="secondary">
                    <IconRefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                    {isLoading ? 'Checking...' : 'Re-check All'}
                </AdminButton>
            </div>

            <div className="space-y-4">
                <StatusCard
                    title="Backend API Server"
                    health={apiHealth}
                    alertCondition="Webhook sent if API server is unreachable or returns error"
                />
                <StatusCard
                    title="SmartThings Relay Server"
                    health={relayHealth}
                    alertCondition="Webhook sent if relay server is unreachable (checked every 30s)"
                />
                <StatusCard
                    title="Stream Server (MediaMTX)"
                    health={streamHealth}
                    alertCondition="Webhook sent if all streams go offline or server unreachable"
                />
                <StatusCard
                    title="Sonos API Server"
                    health={sonosHealth}
                    alertCondition="Webhook sent if Sonos API is unreachable"
                />
                <StatusCard
                    title="EnergyTrak Service"
                    health={energyTrakHealth}
                    icon={<IconZap className="w-8 h-8 text-blue-400" />}
                    alertCondition="Webhook sent if service unreachable, or poll data >5min stale AND origin data >15min stale"
                />
                <StatusCard
                    title="Whisker (Litter Robot)"
                    health={whiskerHealth}
                    icon={<IconCat className="w-8 h-8 text-orange-400" />}
                    alertCondition="Webhook sent if service unreachable or authentication fails"
                />
                <StatusCard
                    title="Tempest Weather"
                    health={tempestHealth}
                    icon={<IconCloudSun className="w-8 h-8 text-sky-400" />}
                    alertCondition="Webhook sent if service unreachable or weather data >10min stale"
                />
                <StatusCard
                    title="Lutron Caseta"
                    health={lutronHealth}
                    icon={<IconLightbulb className="w-8 h-8 text-yellow-400" />}
                    alertCondition="Webhook sent if connection to Lutron bridge is lost"
                />
                <StatusCard
                    title="Hayward Pool"
                    health={haywardPoolHealth}
                    icon={<IconWaves className="w-8 h-8 text-cyan-400" />}
                    alertCondition="Webhook sent if service unreachable or controller connection lost"
                />
                <StatusCard
                    title="Flair HVAC"
                    health={flairHealth}
                    icon={<IconThermometer className="w-8 h-8 text-emerald-400" />}
                    alertCondition="Webhook sent if service unreachable, OAuth fails, or vent/room data stale >3 min"
                />
                <StatusCard
                    title="CoolMaster HVAC"
                    health={coolmasterHealth}
                    icon={<IconThermometer className="w-8 h-8 text-sky-400" />}
                    alertCondition="Webhook sent if service unreachable, gateway unreachable, or unit data stale >3 min"
                />
                <StatusCard
                    title="Home Assistant"
                    health={haHealth}
                    icon={<IconRss className="w-8 h-8 text-orange-400" />}
                    alertCondition="Webhook sent if WebSocket disconnects or no events received in >5 min"
                />
                <StatusCard
                    title="Webhook Monitor"
                    health={webhookHealth}
                    icon={<IconRss className="w-8 h-8 text-purple-400" />}
                    alertCondition="Monitors webhook endpoint reachability"
                />
            </div>
        </AdminSection>
    );
};

export default SystemStatusManager;
