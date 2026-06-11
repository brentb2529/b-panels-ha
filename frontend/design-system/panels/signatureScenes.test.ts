import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

// ─────────────────────────────────────────────────────────────────────────────
// Signature whole-house scenes (H1) — SAFETY PROOF on the SERVER-SIDE scripts.
//
// The six scene scripts live in the coordinator-owned dev-ha package
//   dev-ha/config/packages/signature_scenes.yaml
// and orchestrate ONLY low-hazard actors (lights/brightness, shades/covers,
// HVAC comfort, Sonos, pool/landscape LIGHTS). The whole point of the feature
// is that the script NEVER auto-actuates a GATED actor (arm/disarm, locks/gates,
// AKVO floor move, pool BODY/pump/heater, CLiC glass, garage). The gated
// finishing step is a separate, explicit, confirm-only UI affordance.
//
// This test greps the actual script source and asserts that — by construction —
// no scene_* script body references any gated domain/service or gated entity.
// If a future edit slips a gated actuation into a scene, this fails.
// ─────────────────────────────────────────────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url));
// The six scene scripts live in the coordinator-owned dev-ha package
// (dev-ha/config/packages/signature_scenes.yaml), which is NOT present in a
// b-panels-ha-only checkout. A version-controlled REFERENCE COPY of the exact
// same file is committed in this repo at dev-ha-config/signature_scenes.yaml so
// this safety proof always runs against the real script source. Prefer the
// coordinator path when present (full integration checkout), else fall back to
// the in-repo reference copy. repo root = frontend/design-system/panels → ../../..
const repoRoot = resolve(here, '../../..');
const candidatePaths = [
  resolve(repoRoot, '../dev-ha/config/packages/signature_scenes.yaml'), // coordinator checkout
  join(repoRoot, 'dev-ha-config/signature_scenes.yaml'),                // in-repo reference copy
];
const pkgPath = candidatePaths.find((p) => existsSync(p)) ?? candidatePaths[0];

// Forbidden in any scene script body: services/domains that drive gated actors.
const FORBIDDEN_SERVICE = [
  'alarm_control_panel.alarm_arm',
  'alarm_control_panel.alarm_disarm',
  'lock.lock',
  'lock.unlock',
  'akvo',                       // any AKVO floor service/entity
  'switch.intellicenter_pool_body',
  'switch.intellicenter_spa_body',
  'pool_body',                  // gated pool body / pump
  'clic',                       // CLiC privacy glass
  'garage',                     // garage door
  'cover.garage',
];

describe('signature scene scripts — server-side safety proof', () => {
  it('the dev-ha package exists', () => {
    expect(existsSync(pkgPath), `expected package at ${pkgPath}`).toBe(true);
  });

  // Extract just the `script:` block (scene_* definitions), stripping the
  // documentation comments + the gated-actor demo helper declarations (which
  // legitimately NAME the gated booleans for the forced-check, but are NOT part
  // of any scene sequence).
  const raw = existsSync(pkgPath) ? readFileSync(pkgPath, 'utf8') : '';
  const scriptIdx = raw.indexOf('\nscript:');
  const scriptBlock = scriptIdx >= 0 ? raw.slice(scriptIdx) : '';
  // Drop comment lines so prose like "never pool body/pump" doesn't trip the grep.
  const scriptCode = scriptBlock
    .split('\n')
    .filter((l) => !l.trim().startsWith('#'))
    .join('\n')
    .toLowerCase();

  it('defines all six scene scripts', () => {
    for (const id of [
      'scene_goodnight', 'scene_wake', 'scene_movie',
      'scene_entertain', 'scene_vacation', 'scene_away_arrival',
    ]) {
      expect(scriptCode, `missing script ${id}`).toContain(`${id}:`);
    }
  });

  it('NO scene script references any gated actor service/entity', () => {
    for (const token of FORBIDDEN_SERVICE) {
      expect(
        scriptCode.includes(token.toLowerCase()),
        `a scene script references the gated token "${token}" — gated actors must never be in a scene`,
      ).toBe(false);
    }
    // Belt-and-braces: no gated_* demo helper is driven by a scene.
    expect(scriptCode).not.toMatch(/gated_/);
  });

  it('scene scripts DO orchestrate the low-hazard actors', () => {
    expect(scriptCode).toContain('light.turn_on');
    expect(scriptCode).toContain('light.turn_off');
    expect(scriptCode).toContain('cover.set_cover_position');
    expect(scriptCode).toContain('climate.set_temperature');
    expect(scriptCode).toContain('media_player.');
  });
});
