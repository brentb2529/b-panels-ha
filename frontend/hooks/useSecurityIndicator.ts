/**
 * useSecurityIndicator — derives a tri-state SecurityAlertLevel from real
 * UniFi Protect data (useUnifiSurface) and the alarm panel state
 * (useDashboard's alarmState).
 *
 * THREE LEVELS (never fabricated):
 *   'clear'   — no active detections, no recent activity (within RECENT_WINDOW_MS)
 *   'recent'  — no current detection, but activity within RECENT_WINDOW_MS
 *   'active'  — active detection NOW: hasAnyActivity is true, doorbell is ringing,
 *               or multiple simultaneous smart-detect hits, OR alarm panel
 *               reports a VIOLATION.
 *
 * NOTE ON ARM/DISARM: There is NO alarm panel integration in this codebase.
 * The alarmState comes from useDashboard; if it is null (common case today),
 * it is simply ignored. We do NOT fabricate an armed/disarmed status.
 * When a real alarm_control_panel integration is wired, the VIOLATION flag will
 * promote to 'active'. Armed/disarmed display remains the responsibility of
 * the existing ArmingStatusIndicator component.
 *
 * SECURITY CONTRACT: read-only. This hook emits no writes, no HA service calls.
 */

import { useMemo, useEffect, useRef, useState } from 'react';
import { useUnifiSurface } from './useUnifiSurface';
import { useDashboard } from './useDashboard';

export type SecurityAlertLevel = 'clear' | 'recent' | 'active';

/** How long after the last detected activity an event is considered "recent". */
const RECENT_WINDOW_MS = 3 * 60 * 1000; // 3 minutes

export interface SecurityIndicatorState {
  /** Tri-state alert level derived from real UniFi data. */
  level: SecurityAlertLevel;
  /**
   * Human-readable summary line for the indicator tooltip / modal header.
   * Never includes license plate text (PII) or arm/disarm state.
   */
  summary: string;
  /** Count of cameras with active detections right now. */
  activeCameraCount: number;
  /** True when doorbell is ringing on any camera. */
  doorbellActive: boolean;
  /** True when the UniFi surface has at least one camera. */
  hasCameras: boolean;
  /**
   * True while the UniFi surface is loading.
   * Callers should suppress auto-surface of the modal during load.
   */
  isLoading: boolean;
  /**
   * The most recent activity timestamp across all cameras (epoch ms).
   * 0 when no activity has been seen.
   */
  lastActivityAt: number;
}

export function useSecurityIndicator(): SecurityIndicatorState {
  // Live UniFi state
  const { cameras, isLoading, hasAnyActivity } = useUnifiSurface();

  // Alarm panel (may be null — that is the normal case with no alarm integration)
  const { alarmState } = useDashboard() as { alarmState: { securityState?: string; armState?: string } | null };

  // Tick every 15s so 'recent' → 'clear' transitions update promptly
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  return useMemo<SecurityIndicatorState>(() => {
    const now = Date.now();

    // Alarm VIOLATION takes top priority if we ever have a panel
    const alarmViolation = alarmState?.securityState === 'VIOLATION';

    // Compute per-camera flags
    const activeCameras = cameras.filter(
      c => c.motionActive || c.doorbellActive || Object.values(c.detections).some(Boolean) || c.licensePlateDetected
    );
    const doorbellActive = cameras.some(c => c.doorbellActive);

    // Most recent activity timestamp across all cameras
    const lastActivityAt = cameras.reduce(
      (max, c) => Math.max(max, c.lastActivityAt ?? 0),
      0
    );

    const recentActivity = lastActivityAt > 0 && (now - lastActivityAt) < RECENT_WINDOW_MS;

    // Level derivation
    let level: SecurityAlertLevel;
    let summary: string;

    if (alarmViolation || hasAnyActivity) {
      level = 'active';
      if (alarmViolation) {
        summary = 'INTRUSION DETECTED';
      } else if (doorbellActive && activeCameras.length > 0) {
        summary = `Doorbell + ${activeCameras.length} detection${activeCameras.length > 1 ? 's' : ''}`;
      } else if (doorbellActive) {
        summary = 'Doorbell ringing';
      } else if (activeCameras.length === 1) {
        const cam = activeCameras[0];
        const kinds: string[] = [];
        if (cam.detections.person)  kinds.push('person');
        if (cam.detections.vehicle) kinds.push('vehicle');
        if (cam.detections.animal)  kinds.push('animal');
        if (cam.detections.package) kinds.push('package');
        if (cam.motionActive && kinds.length === 0) kinds.push('motion');
        summary = `${cam.name}: ${kinds.join(', ')}`;
      } else {
        summary = `${activeCameras.length} cameras active`;
      }
    } else if (recentActivity) {
      level = 'recent';
      const minsAgo = Math.floor((now - lastActivityAt) / 60_000);
      summary = minsAgo <= 1 ? 'Activity just now' : `Activity ${minsAgo}m ago`;
    } else {
      level = 'clear';
      const cameraCount = cameras.length;
      summary = cameraCount > 0
        ? `${cameraCount} camera${cameraCount > 1 ? 's' : ''} · All clear`
        : 'All clear';
    }

    return {
      level,
      summary,
      activeCameraCount: activeCameras.length,
      doorbellActive,
      hasCameras: cameras.length > 0,
      isLoading,
      lastActivityAt,
    };
  }, [cameras, hasAnyActivity, alarmState, isLoading]);
}
