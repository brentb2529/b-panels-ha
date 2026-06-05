
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useDashboard } from '../hooks/useDashboard';
import { DeviceService } from '../types';
import { IconCheckCircle, IconXCircle, IconAlertTriangle, IconRefreshCw, IconServer, IconInfo, IconRss } from './icons';

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
// #endregion

interface HealthState {
    status: 'ok' | 'warning' | 'error' | 'checking' | 'disabled';
    message: string;
    details?: Record<string, any>;
}

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

// HA-only System page. The original tracked a dozen api-server-era microservices
// (SmartThings relay, Sonos, EnergyTrak, Whisker, Tempest, Lutron, Hayward,
// Flair, CoolMaster, the Node backend, and a webhook monitor). None of those
// exist in this build, so only the two checks that mean something here remain:
// Home Assistant (the WebSocket the whole app rides on) and the optional camera
// stream server (MediaMTX, when an RTSP connection is configured).
const SystemStatusManager = () => {
    const { connections, addNotification, haWsState, lastHaEventAt, primaryAlarmProvider } = useDashboard();
    const [isLoading, setIsLoading] = useState(false);

    const [streamHealth, setStreamHealth] = useState<HealthState>({ status: 'checking', message: 'Checking...' });
    const [haHealth, setHaHealth] = useState<HealthState>({ status: 'checking', message: 'Checking...' });

    const prevHealthStates = useRef<Record<string, HealthState>>({});

    const healthServices = useMemo(() => ([
        { name: 'Home Assistant', state: haHealth },
        { name: 'Stream Server (MediaMTX)', state: streamHealth },
    ]), [haHealth, streamHealth]);

    // Surface a global UI notification whenever a tracked service newly fails.
    useEffect(() => {
        const currentStates: Record<string, HealthState> = {};
        let hasChanges = false;

        healthServices.forEach(service => {
            currentStates[service.name] = service.state;
            const prevStatus = prevHealthStates.current[service.name]?.status;
            const currentStatus = service.state.status;

            if (currentStatus !== prevStatus) {
                hasChanges = true;
                if (currentStatus === 'error' && prevStatus && prevStatus !== 'error') {
                    addNotification(`System Alert: ${service.name} is in a failed state.`, 'error');
                }
            }
        });

        if (hasChanges) {
            prevHealthStates.current = currentStates;
        }
    }, [healthServices, addNotification]);

    const checkAllHealth = useCallback(async () => {
        setIsLoading(true);

        const rtspConnection = connections.find(c => c.id === DeviceService.RTSP);

        const fetchWithTimeout = (url: string, options = {}, timeout = 5000) => {
            return Promise.race([
                fetch(url, options),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Request timed out')), timeout)
                )
            ]);
        };

        // Home Assistant Health — the WebSocket state is the primary signal.
        const checkHomeAssistant = async () => {
            if (haWsState === 'disconnected') {
                setHaHealth({ status: 'error', message: 'WebSocket disconnected — reconnecting' });
                return;
            }
            if (haWsState === 'connecting') {
                setHaHealth({ status: 'warning', message: 'WebSocket connecting…' });
                return;
            }
            const details: Record<string, string> = {};
            if (primaryAlarmProvider === 'ha') {
                const haConnection = connections.find(c => c.id === DeviceService.HomeAssistant);
                details['Alarm Entity'] = (haConnection as any)?.haAlarmEntityId || 'alarm_control_panel.alarmo';
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

        // Stream Server (MediaMTX) — only when an RTSP connection is configured.
        const checkStream = async () => {
            if (!rtspConnection || !rtspConnection.enabled) {
                setStreamHealth({ status: 'disabled', message: 'No RTSP connection configured' });
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

        await Promise.all([checkHomeAssistant(), checkStream()]);

        setIsLoading(false);
    }, [connections, haWsState, lastHaEventAt, primaryAlarmProvider]);

    useEffect(() => {
        checkAllHealth();
        const intervalId = setInterval(checkAllHealth, 30000);
        return () => clearInterval(intervalId);
    }, [checkAllHealth]);

    return (
        <AdminSection title="System Health" description="Status of the services this dashboard depends on.">
            <div className="flex justify-end mb-4">
                 <AdminButton onClick={checkAllHealth} disabled={isLoading} variant="secondary">
                    <IconRefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                    {isLoading ? 'Checking...' : 'Re-check All'}
                </AdminButton>
            </div>

            <div className="space-y-4">
                <StatusCard
                    title="Home Assistant"
                    health={haHealth}
                    icon={<IconRss className="w-8 h-8 text-orange-400" />}
                    alertCondition="Alerts if the WebSocket disconnects or no events arrive in >5 min"
                />
                <StatusCard
                    title="Stream Server (MediaMTX)"
                    health={streamHealth}
                    alertCondition="Alerts if all camera streams go offline or the server is unreachable"
                />
            </div>
        </AdminSection>
    );
};

export default SystemStatusManager;
