import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// useSessionUnlock — in-memory set of PIN-unlocked access-profile ids for the
// OPTIONAL per-user panel scoping (Admin Stage 4, Inc 13).
//
// Unlocking is per SESSION (per page load) and per DEVICE — it lives only in
// React state, never persisted. A page reload clears it (so a walk-up to a
// shared kiosk re-prompts). Most panels are open and never consult this; only a
// scoped panel (panel.visibleToUsers non-empty) checks whether an allowed
// profile is already unlocked.
//
// This is convenience-grade UI scoping, NOT a security boundary, and a
// life-safety takeover always overrides it (the takeover mounts above the
// router and is never gated). Never log PINs.
// ---------------------------------------------------------------------------

interface SessionUnlockValue {
  unlockedUserIds: ReadonlySet<string>;
  /** Mark a profile id as unlocked for the rest of this session. */
  unlockUser: (userId: string) => void;
  isUserUnlocked: (userId: string) => boolean;
}

const Ctx = createContext<SessionUnlockValue | null>(null);

export const SessionUnlockProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const ref = useRef<Set<string>>(new Set());
  const [snapshot, setSnapshot] = useState<Set<string>>(() => new Set());

  const unlockUser = useCallback((userId: string) => {
    if (ref.current.has(userId)) return;
    ref.current.add(userId);
    setSnapshot(new Set(ref.current));
  }, []);

  const isUserUnlocked = useCallback((userId: string) => snapshot.has(userId), [snapshot]);

  const value = useMemo<SessionUnlockValue>(
    () => ({ unlockedUserIds: snapshot, unlockUser, isUserUnlocked }),
    [snapshot, unlockUser, isUserUnlocked],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export function useSessionUnlock(): SessionUnlockValue {
  const ctx = useContext(Ctx);
  if (!ctx) {
    // Fail OPEN: if no provider is mounted, nothing is "locked" — never break
    // navigation because the scoping context is missing.
    return {
      unlockedUserIds: new Set<string>(),
      unlockUser: () => {},
      isUserUnlocked: () => false,
    };
  }
  return ctx;
}
