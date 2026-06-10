import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDashboard } from '../hooks/useDashboard';
import { useSessionUnlock } from '../hooks/useSessionUnlock';
import { getDeviceDefaultPanelId } from '../design-system/shell/usePanelDefault';
import { panelRequiresUnlock, findUnlockingUser } from '../services/panelScoping';
import PinPadModal from './PinPadModal';
import { IconLock } from './icons';

// ---------------------------------------------------------------------------
// PanelScopeGate — OPTIONAL per-user PIN gate for a scoped panel (Inc 13).
//
// Wraps the Dashboard route. For the COMMON case (open panel, or this device's
// default, or an already-unlocked profile) it renders children unchanged — zero
// overhead, no gate. Only when the target panel is scoped AND not yet unlocked
// on this device does it render a PIN prompt instead of the panel body.
//
// IMPORTANT invariants (memory: bpanels-navigation-ia + akvo/life-safety):
//   • Default-OPEN: a panel with no/empty visibleToUsers is never gated.
//   • Local-first: the device's own default panel is always open on that device.
//   • Life-safety OVERRIDE: the takeover overlay mounts ABOVE the router
//     (App.tsx) and is unaffected by this gate — it annunciates over the PIN
//     prompt too. This gate only ever blocks the ordinary panel body.
//
// Convenience-grade only — not a security boundary. Never log PINs.
// ---------------------------------------------------------------------------

const PanelScopeGate: React.FC<{ panelId: string | undefined; children: React.ReactNode }> = ({ panelId, children }) => {
  const { panels, users } = useDashboard();
  const { unlockedUserIds, unlockUser } = useSessionUnlock();
  const navigate = useNavigate();
  const [shakeKey, setShakeKey] = useState(0);

  const panel = useMemo(() => panels.find((p) => p.id === panelId), [panels, panelId]);
  const deviceDefaultPanelId = getDeviceDefaultPanelId();

  // Unknown panel or no scoping needed -> render straight through.
  const needsUnlock = !!panel && panelRequiresUnlock(panel, { deviceDefaultPanelId, unlockedUserIds });
  if (!panel || !needsUnlock) return <>{children}</>;

  const onConfirm = async (pin: string): Promise<boolean> => {
    const uid = findUnlockingUser(pin, panel, users);
    if (uid) {
      unlockUser(uid);   // unlocks this profile for the session -> children render
      return true;
    }
    setShakeKey((k) => k + 1);
    return false;
  };

  // Render the PIN prompt INSTEAD of the panel body. Backdrop explains the gate.
  return (
    <div className="relative h-full w-full flex items-center justify-center bg-gray-900/95">
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center px-6">
        <IconLock className="w-10 h-10 text-amber-400 mb-3" />
        <h2 className="text-xl font-semibold text-white">“{panel.name}” is scoped</h2>
        <p className="text-sm text-gray-400 mt-1 max-w-sm">
          Enter the PIN for a profile allowed to open this panel. Convenience-grade scoping — a life-safety alert always shows regardless.
        </p>
      </div>
      <PinPadModal
        key={shakeKey}
        onClose={() => navigate(deviceDefaultPanelId ? `/dashboard/${deviceDefaultPanelId}` : '/')}
        onConfirm={onConfirm}
      />
    </div>
  );
};

export default PanelScopeGate;
