// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeArmState, isAlarmTruthMismatch } from '../hooks/useDashboard';
import { projectArm } from '../design-system/panels/useSecurityEntities';

// ─────────────────────────────────────────────────────────────────────────────
// LIVE-VERIFY (dev) for the production-failure hardening (lessons A–E). HA at the
// dev box requires a credentialed token to render the full SPA against a live
// alarm entity (blocked in this sandbox). Instead we drive the REAL fixed code
// paths with the exact entity shapes the failures produced and record the
// outcomes as machine-checked evidence under daily/. Every assertion here is the
// behaviour a human would have eyeballed in the running panel.
// ─────────────────────────────────────────────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url));
const evidenceDir = resolve(here, '../../../daily/2026-06-11/prod-hardening');

const lines: string[] = [];
const log = (s: string) => { lines.push(s); };

describe('LIVE-VERIFY prod-failure hardening (lessons A–E)', () => {
  it('A1 — an unavailable/absent/unknown alarm shows "Status Unknown", NOT Disarmed', () => {
    log('## A1 — alarm false-"Disarmed" (SAFETY)\n');
    for (const raw of ['unavailable', 'unknown', '', undefined, 'some_future_mode']) {
      const arm = normalizeArmState(raw);
      // SecurityPanel hero word + tone for that same raw state:
      const view = projectArm(raw === undefined ? undefined : ({ state: raw, attributes: {}, last_changed: null } as any));
      const greenSafe = view.tone === 'ready' || view.word === 'Disarmed';
      log(`- raw=\`${String(raw)}\` → armState=\`${arm}\`, hero word=\`${view.word}\`, tone=\`${view.tone}\` → green-safe? **${greenSafe ? 'YES (BUG)' : 'no'}**`);
      expect(arm).not.toBe('disarmed');
      expect(greenSafe).toBe(false);
    }
    log('');
  });

  it('A1 — an explicit armed/disarmed state still renders correctly', () => {
    expect(normalizeArmState('armed_away')).toBe('armedAway');
    expect(projectArm({ state: 'armed_away', attributes: {}, last_changed: null } as any).tone).toBe('away');
    expect(normalizeArmState('disarmed')).toBe('disarmed');
    expect(projectArm({ state: 'disarmed', attributes: {}, last_changed: null } as any).tone).toBe('ready');
    log('## A1 — explicit states pass through');
    log('- `armed_away` → armedAway / away tone (red)');
    log('- `disarmed` (clear) → disarmed / ready tone (green) — the ONLY path to green\n');
  });

  it('A2 — a stale snapshot vs cached → truth-reconcile flags a DEFINITE mismatch', () => {
    log('## A2 — independent truth-reconcile (the proven root fix)\n');
    // The canonical incident: panel cached "Disarmed" but the alarm is armed.
    const cached: any = { armState: 'disarmed', phase: 'idle' };
    const liveArmed = { state: 'armed_away', attributes: {} };
    const mismatch = isAlarmTruthMismatch(liveArmed, cached);
    log(`- cached arm=\`disarmed\`, live getStates() snapshot=\`armed_away\` → mismatch? **${mismatch}** → forceReconnect()`);
    expect(mismatch).toBe(true);
    // No false positive when they agree or on first mount.
    expect(isAlarmTruthMismatch({ state: 'disarmed', attributes: {} }, cached)).toBe(false);
    expect(isAlarmTruthMismatch({ state: 'armed_away' }, null)).toBe(false);
    log('- agreeing snapshot → no reconnect; null cache (first mount) → no reconnect (no thrash)\n');
  });

  it('writes the evidence file', () => {
    mkdirSync(evidenceDir, { recursive: true });
    const header = [
      '# Prod-failure hardening — live-verify evidence (dev)',
      '',
      `Generated: ${new Date().toISOString()} by services/prodHardeningVerify.test.ts`,
      '',
      'HA at the dev box needs a credentialed token to render the full SPA against a',
      'live alarm entity (blocked in-sandbox). These assertions drive the REAL fixed',
      'code paths with the exact entity shapes the production failures produced.',
      '',
    ].join('\n');
    writeFileSync(resolve(evidenceDir, 'live-verify-A-truth.md'), header + lines.join('\n') + '\n');
    expect(true).toBe(true);
  });
});

// Suppress noisy console from imported module init in jsdom.
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
