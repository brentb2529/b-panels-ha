// Live AKVO Movable Floor feed for the safety-critical surface.
//
// Owns one subscribeEntities subscription (NO polling). Tracks connection
// health so the surface can show a stale/reconnecting indicator. Exposes the
// composite AkvoState, the evaluated safety gate, and the single gated request
// action.
//
// SAFETY: we do NOT optimistically claim motion. The only "optimistic" UI is a
// short-lived "requesting" flag set when we issue a request, cleared as soon as
// real state reflects motion (floors_moving) or the active configuration
// changes (or after a timeout). Floor position/motion/fault always come from
// real entity state — never from a local guess.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { HassEntities } from 'home-assistant-js-websocket';
import { subscribeEntities } from '../services/haClient';
import {
    buildAkvoState,
    evaluateGate,
    requestConfiguration,
    cancelMovement,
    type AkvoGate,
    type AkvoState,
} from '../services/akvo';

type ConnStatus = 'connecting' | 'live' | 'stale';

// How long the "requesting" flag persists if neither motion nor a config change
// is observed (e.g. the controller rejected the request). After this we clear it
// and fall back to plain real state.
const REQUESTING_TTL_MS = 12000;

export interface UseAkvoFloor {
    state: AkvoState;
    gate: AkvoGate;
    status: ConnStatus;
    // The preset whose request is currently in flight (pre-motion), or null.
    requestingPreset: string | null;
    // Issue the gated request. Returns true if the command was actually sent
    // (gate open + valid preset), false if it was blocked.
    requestConfiguration: (preset: string) => Promise<boolean>;
    // Cancel/STOP the running request by selecting the sentinel option. NOT
    // gated — always permitted (stopping must work while moving/faulted). This
    // is a request-channel cancel, NOT the certified hardware E-stop. Returns
    // false only when there is no select / no sentinel option to select.
    cancelMovement: () => Promise<boolean>;
}

const EMPTY_STATE: AkvoState = {
    present: false,
    anyAvailable: false,
    mainFloorPosition: null,
    bajaPosition: null,
    positionUnit: 'm',
    mainFloorMotorCurrent: null,
    bajaMotorCurrent: null,
    activeConfiguration: null,
    systemReady: null,
    systemFault: null,
    emergencyStop: null,
    floorsMoving: null,
    badModbusComm: null,
    readyForExternalCommands: null,
    faults: [],
    requestSelect: null,
};

export function useAkvoFloor(): UseAkvoFloor {
    const [state, setState] = useState<AkvoState>(EMPTY_STATE);
    const [status, setStatus] = useState<ConnStatus>('connecting');
    const [requestingPreset, setRequestingPreset] = useState<string | null>(null);

    const lastEntitiesRef = useRef<HassEntities>({});
    const requestingRef = useRef<{ preset: string; at: number } | null>(null);

    const recompute = useCallback(() => {
        const next = buildAkvoState(lastEntitiesRef.current);
        // Clear the "requesting" flag once real state shows motion or the active
        // configuration has reached the requested preset, or after the TTL.
        const req = requestingRef.current;
        if (req) {
            const reached =
                next.floorsMoving === true ||
                (next.activeConfiguration && next.activeConfiguration === req.preset) ||
                Date.now() - req.at > REQUESTING_TTL_MS;
            if (reached) {
                requestingRef.current = null;
                setRequestingPreset(null);
            }
        }
        setState(next);
    }, []);

    useEffect(() => {
        let unsub: (() => void) | null = null;
        let cancelled = false;
        let staleTimer: ReturnType<typeof setTimeout> | null = null;
        const armStaleTimer = () => {
            if (staleTimer) clearTimeout(staleTimer);
            staleTimer = setTimeout(() => setStatus('stale'), 30000);
        };

        const start = async () => {
            try {
                unsub = await subscribeEntities((entities) => {
                    if (cancelled) return;
                    lastEntitiesRef.current = entities;
                    setStatus('live');
                    armStaleTimer();
                    recompute();
                });
            } catch {
                if (!cancelled) setStatus('stale');
            }
        };
        start();

        return () => {
            cancelled = true;
            if (staleTimer) clearTimeout(staleTimer);
            if (unsub) unsub();
        };
    }, [recompute]);

    // Expire a stuck "requesting" flag even with no entity push.
    useEffect(() => {
        const id = setInterval(() => {
            const req = requestingRef.current;
            if (req && Date.now() - req.at > REQUESTING_TTL_MS) {
                requestingRef.current = null;
                setRequestingPreset(null);
            }
        }, 2000);
        return () => clearInterval(id);
    }, []);

    const doRequest = useCallback(async (preset: string): Promise<boolean> => {
        // Re-evaluate the gate against the freshest state at issue time — the UI
        // also gates, this is defense-in-depth.
        const fresh = buildAkvoState(lastEntitiesRef.current);
        const gate = evaluateGate(fresh);
        if (!gate.enabled) return false;
        requestingRef.current = { preset, at: Date.now() };
        setRequestingPreset(preset);
        try {
            const sent = await requestConfiguration(fresh, preset);
            if (!sent) {
                requestingRef.current = null;
                setRequestingPreset(null);
            }
            return sent;
        } catch {
            requestingRef.current = null;
            setRequestingPreset(null);
            return false;
        }
    }, []);

    // Cancel/STOP — always permitted, never gated. Uses the freshest state at
    // call time so the correct sentinel/entity is selected even mid-move. We
    // also immediately clear any pending "requesting" flag so the UI reflects
    // the cancel without waiting for the next entity push.
    const doCancel = useCallback(async (): Promise<boolean> => {
        const fresh = buildAkvoState(lastEntitiesRef.current);
        requestingRef.current = null;
        setRequestingPreset(null);
        try {
            return await cancelMovement(fresh);
        } catch {
            return false;
        }
    }, []);

    const gate = evaluateGate(state);

    return { state, gate, status, requestingPreset, requestConfiguration: doRequest, cancelMovement: doCancel };
}
