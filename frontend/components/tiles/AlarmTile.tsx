
import React from 'react';
import { Device, TileConfig, STHMState, DeviceType } from '../../types';
import { useDashboard } from '../../hooks/useDashboard';
import { IconShield, IconShieldCheck, IconShieldAlert, IconShieldOff } from '../icons';
import TileWrapper from './TileWrapper';
import UnknownTile from './UnknownTile';
import { fluidIcon, fluidText2xl, fluidTextXs, fluidGap } from './tileScale';

// Hero shield treatment: the arm-state icon sits in a dimensional disc with a
// top-lit sheen and a colored glow keyed to the state (green = disarmed/ready,
// amber = armed-home, red = armed-away/intrusion). Makes the system state the
// instant focal point of the tile.
const ShieldHalo = ({ color, glow, children }: { color: string; glow: boolean; children: React.ReactNode }) => (
    <div
        className="relative flex items-center justify-center rounded-full shrink-0"
        style={{
            width: 'clamp(2.75rem, 34cqmin, 5rem)',
            aspectRatio: '1 / 1',
            background: 'radial-gradient(circle at 38% 30%, rgb(255 255 255 / 0.22), rgb(255 255 255 / 0.04) 70%, transparent)',
            border: '1px solid rgb(255 255 255 / 0.30)',
            boxShadow: glow
                ? `inset 0 1px 0 rgb(255 255 255 / 0.30), inset 0 -3px 8px rgb(0 0 0 / 0.25), 0 0 22px -2px ${color}`
                : 'inset 0 1px 0 rgb(255 255 255 / 0.30), inset 0 -3px 8px rgb(0 0 0 / 0.25)',
        }}
    >
        {children}
    </div>
);

const AlarmTile = ({ device, tile, isEditor, cornerClassName }: { device: Device; tile: TileConfig; isEditor?: boolean; cornerClassName?: string }) => {
    const { setAlarmStatus, requestPin, armingState, devices, sensorAliases, notifyingSensorIds, sthmState: globalSthmState } = useDashboard();
    const isLocked = !!tile.isLocked;

    // A real alarm_control_panel device has a plain arm-state string for
    // device.state; the rich STHMState (open sensors, modes, violation, entry
    // delay) lives in the global alarm state populated from the HA websocket.
    // Prefer an STHMState object on the device (synthetic panel) else the global.
    const deviceState = device.state;
    const sthmState: STHMState | null =
        (deviceState && typeof deviceState === 'object' && 'armState' in (deviceState as any))
            ? (deviceState as STHMState)
            : globalSthmState;

    // No alarm state yet (panel still connecting, or no alarm_control_panel) —
    // show a neutral "connecting" placeholder rather than an error tile.
    if (!sthmState || typeof sthmState.armState === 'undefined') {
        return (
            <TileWrapper label={tile.label || 'Security'} isProtected isLocked={isLocked} isEditor={isEditor} className={cornerClassName}>
                <div className="flex-1 flex flex-col items-center justify-center text-center gap-2">
                    <ShieldHalo color="#9ca3af" glow={false}>
                        <IconShield className="text-gray-300" style={fluidIcon(2)} />
                    </ShieldHalo>
                    <p className="text-gray-400" style={fluidTextXs}>Waiting for alarm…</p>
                </div>
            </TileWrapper>
        );
    }

    // Open sensor labels — HA uses haOpenSensors dict; ST uses notifyingSensorIds filter
    const openSensorLabels = React.useMemo(() => {
        if (sthmState.haOpenSensors !== undefined) {
            const openSensors = sthmState.haOpenSensors;
            if (!openSensors || Object.keys(openSensors).length === 0) return [];
            return Object.keys(openSensors).map(entityId => {
                const d = devices.find(dev => dev.id === entityId);
                return (sensorAliases?.[entityId] || d?.name || entityId).trim();
            }).filter(Boolean).sort((a, b) => a.localeCompare(b));
        }
        if (!notifyingSensorIds || notifyingSensorIds.length === 0) return [];
        const triggering = new Set(notifyingSensorIds);
        return devices
            .filter(d => triggering.has(d.id) && d.state === true)
            .map(d => (sensorAliases?.[d.id] || d.name || '').trim())
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b));
    }, [sthmState.haOpenSensors, devices, sensorAliases, notifyingSensorIds]);

    const isViolation = sthmState.securityState === 'VIOLATION';
    const isReady = armingState === 'ready';

    // HA: check if a specific arm mode is available (from alarmo_ready_to_arm_modes_updated)
    const isModeAvailable = (mode: 'away' | 'home') => {
        if (!sthmState.haAvailableModes) return true;
        return sthmState.haAvailableModes.includes(mode);
    };

    const handleAction = (status: 'DISARMED' | 'ARMED_STAY' | 'ARMED_AWAY') => {
        if (isEditor || isLocked) return;
        requestPin((pin) => { setAlarmStatus(status, pin); });
    };

    // Shared depth styling for the bold full-bleed state backgrounds: a top-lit
    // gradient (not a flat fill) plus a bevel so the colored card reads as a
    // lifted, physical surface. Applied via Tailwind arbitrary values since the
    // colored states intentionally override TileWrapper's surface.
    const stateShadow = 'shadow-[inset_0_1px_0_rgb(255_255_255/0.18),inset_0_-4px_10px_rgb(0_0_0/0.30),var(--elev-1)]';

    // --- INTRUSION STATE ---
    if (isViolation) {
        const faultReason = sthmState.violatingSensors.length > 0
            ? sthmState.violatingSensors.map(s => s.name).join(', ')
            : 'Unknown';

        return (
            <TileWrapper
                label={tile.label || 'Security'}
                isActive={true}
                className={`!p-0 !bg-[linear-gradient(160deg,#ef4444_0%,#dc2626_55%,#991b1b_100%)] ${stateShadow} animate-pulse ${cornerClassName || ''} border-0`}
                isEditor={isEditor}
                isLocked={isLocked}
            >
                <div className="flex-1 flex flex-col justify-center items-center text-center w-full min-h-0 overflow-hidden p-2" style={fluidGap(0.5)}>
                    <ShieldHalo color="#fecaca" glow={true}>
                        <IconShieldAlert className="!text-white" style={{ ...fluidIcon(2.5), filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.4))' }} />
                    </ShieldHalo>
                    <p className="font-black !text-white uppercase tracking-widest" style={{ ...fluidText2xl, textShadow: '0 1px 3px rgba(0,0,0,0.45)' }}>INTRUSION</p>
                    <p className="!text-red-50 truncate w-full font-bold px-2" style={fluidTextXs} title={`Triggered by: ${faultReason}`}>
                        Trigger: {faultReason}
                    </p>
                </div>
                <div className="w-full p-3">
                    <button
                        onClick={() => handleAction('DISARMED')}
                        className="w-full py-3 bg-white text-red-600 rounded-control font-black text-lg hover:bg-gray-100 transition-all shadow-[inset_0_1px_0_rgb(255_255_255/0.6),0_3px_8px_-1px_rgb(0_0_0/0.45)] active:scale-[0.97] active:shadow-[inset_0_2px_5px_rgb(0_0_0/0.25)] uppercase tracking-wider"
                        disabled={isEditor || isLocked}
                    >
                        DISARM SYSTEM
                    </button>
                </div>
            </TileWrapper>
        );
    }

    // Each arm state: a bold gradient field + hero glow color + crisp white text.
    const statusConfig = {
        disarmed: {
            text: 'Disarmed',
            icon: IconShieldCheck,
            grad: 'linear-gradient(160deg,#16a34a_0%,#15803d_55%,#14532d_100%)',
            glowColor: '#86efac',
        },
        armedStay: {
            text: 'Armed Stay',
            icon: IconShield,
            grad: 'linear-gradient(160deg,#ea580c_0%,#c2410c_55%,#7c2d12_100%)',
            glowColor: '#fdba74',
        },
        armedAway: {
            text: 'Armed Away',
            icon: IconShieldAlert,
            grad: 'linear-gradient(160deg,#dc2626_0%,#b91c1c_55%,#7f1d1d_100%)',
            glowColor: '#fca5a5',
        },
    }[sthmState.armState] || {
        text: 'Unknown',
        icon: IconShield,
        grad: 'linear-gradient(160deg,#4b5563_0%,#374151_55%,#1f2937_100%)',
        glowColor: '#9ca3af',
    };

    const Icon = statusConfig.icon;
    const isArmed = sthmState.armState === 'armedStay' || sthmState.armState === 'armedAway';

    const btnBase = "flex-1 rounded-control font-bold transition-all flex items-center justify-center gap-2 uppercase tracking-wide active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100";
    const btnScaleStyle: React.CSSProperties = {
        paddingTop: 'clamp(0.25rem, 4cqh, 0.75rem)',
        paddingBottom: 'clamp(0.25rem, 4cqh, 0.75rem)',
        fontSize: 'clamp(0.625rem, 4.5cqh, 0.875rem)',
    };
    const controlBarStyle: React.CSSProperties = {
        padding: 'clamp(0.375rem, 4cqh, 0.75rem)',
        gap: 'clamp(0.375rem, 3cqh, 0.75rem)',
    };

    // Raised, pressable controls: a translucent dark glass with a bright top
    // highlight that flips to an inset on press (matches TileButton's feel) for
    // secondary actions; a solid white raised key for the primary disarm.
    const btnSecondary = "!text-white border border-white/35 bg-white/15 backdrop-blur-sm shadow-[inset_0_1px_0_rgb(255_255_255/0.30),0_2px_5px_-1px_rgb(0_0_0/0.3)] hover:bg-white/25 active:shadow-[inset_0_2px_5px_rgb(0_0_0/0.3)]";
    const btnPrimary = "bg-white text-gray-900 border border-white/60 shadow-[inset_0_1px_0_rgb(255_255_255/0.6),0_3px_8px_-1px_rgb(0_0_0/0.45)] hover:bg-gray-100 active:shadow-[inset_0_2px_5px_rgb(0_0_0/0.25)]";

    const armError = sthmState.haArmError ?? null;

    return (
        <TileWrapper
            label={tile.label || 'Security'}
            className={`!p-0 !bg-[${statusConfig.grad}] ${stateShadow} ${cornerClassName || ''} border-0`}
            isProtected={true}
            isLocked={isLocked}
            isEditor={isEditor}
        >
            <div className="flex-1 flex flex-col justify-center items-center text-center w-full p-2 min-h-0" style={fluidGap(0.4)}>
                <ShieldHalo color={statusConfig.glowColor} glow={isArmed || sthmState.armState === 'disarmed'}>
                    <Icon className="!text-white" style={{ ...fluidIcon(2.25), filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.4))' }} />
                </ShieldHalo>

                <p className="font-black !text-white tracking-tight" style={{ ...fluidText2xl, textShadow: '0 1px 3px rgba(0,0,0,0.45)' }}>
                    {statusConfig.text}
                </p>

                {/* Arm error (e.g. open sensor blocked arming) */}
                {armError && (
                    <div className="flex flex-col items-center gap-1 max-w-full px-2">
                        <div className="flex items-center gap-2 bg-black/40 px-3 py-1.5 rounded-full backdrop-blur-sm shadow-sm">
                            <span className="w-2.5 h-2.5 rounded-full bg-red-300 shadow-[0_0_6px_rgba(252,165,165,0.8)]" />
                            <p className="!text-white font-bold uppercase tracking-wider" style={fluidTextXs}>
                                Cannot Arm: {armError.reason === 'open_sensors' ? 'Sensors Open' : armError.reason}
                            </p>
                        </div>
                        {armError.sensors.length > 0 && (
                            <ul className="flex flex-col items-center gap-0.5 px-3 text-center">
                                {armError.sensors.slice(0, 3).map(eid => {
                                    const d = devices.find(dev => dev.id === eid);
                                    const label = sensorAliases?.[eid] || d?.name || eid;
                                    return (
                                        <li key={eid} className="!text-red-50/90 font-medium leading-tight max-w-[18rem] truncate" style={fluidTextXs} title={label}>
                                            {label}
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                )}

                {!isArmed && !isReady && !armError && (
                    <div className="flex flex-col items-center gap-1.5 mt-1 max-w-full">
                        <div className="flex items-center gap-2 bg-black/30 px-4 py-1.5 rounded-full backdrop-blur-sm shadow-sm">
                            <span className="w-2.5 h-2.5 rounded-full bg-yellow-300 animate-pulse shadow-[0_0_8px_rgba(253,224,71,0.7)]" />
                            <p className="!text-white font-bold uppercase tracking-wider" style={fluidTextXs}>
                                Sensors Open
                            </p>
                        </div>
                        {openSensorLabels.length > 0 && (
                            <ul className="flex flex-col items-center gap-0.5 px-3 text-center">
                                {openSensorLabels.slice(0, 5).map(label => (
                                    <li
                                        key={label}
                                        className="!text-yellow-50/90 font-medium leading-tight max-w-[18rem] truncate"
                                        style={fluidTextXs}
                                        title={label}
                                    >
                                        {label}
                                    </li>
                                ))}
                                {openSensorLabels.length > 5 && (
                                    <li className="!text-yellow-50/70 font-medium leading-tight" style={fluidTextXs}>
                                        +{openSensorLabels.length - 5} more
                                    </li>
                                )}
                            </ul>
                        )}
                    </div>
                )}
            </div>

            {/* Control Bar */}
            <div className="flex w-full bg-black/15 backdrop-blur-sm mt-auto border-t border-white/10" style={controlBarStyle}>
                {isArmed ? (
                    <button
                        onClick={() => handleAction('DISARMED')}
                        className={`${btnBase} ${btnPrimary} w-full`}
                        style={btnScaleStyle}
                        disabled={isEditor || isLocked}
                    >
                        <IconShieldOff style={fluidIcon(1.25)} />
                        Disarm
                    </button>
                ) : (
                    <>
                        <button
                            onClick={() => handleAction('ARMED_STAY')}
                            className={`${btnBase} ${btnSecondary}`}
                            style={btnScaleStyle}
                            disabled={isEditor || isLocked || !isReady || !isModeAvailable('home')}
                            title={!isReady ? 'System not ready to arm' : !isModeAvailable('home') ? 'Mode unavailable' : 'Arm Stay'}
                        >
                            Arm Stay
                        </button>
                        <button
                            onClick={() => handleAction('ARMED_AWAY')}
                            className={`${btnBase} ${btnSecondary}`}
                            style={btnScaleStyle}
                            disabled={isEditor || isLocked || !isReady || !isModeAvailable('away')}
                            title={!isReady ? 'System not ready to arm' : !isModeAvailable('away') ? 'Mode unavailable' : 'Arm Away'}
                        >
                            Arm Away
                        </button>
                    </>
                )}
            </div>
        </TileWrapper>
    );
};

export default AlarmTile;
