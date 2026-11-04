import { describe, it, expect } from 'vitest';
import type { HassEntities } from 'home-assistant-js-websocket';
import { readSnapshot, stepVoice, siblingSensors, type VoiceView } from './useVoiceSatellite';

const SAT = 'assist_satellite.vaca_kitchen_small_panel';
const st = (state: string) => ({ state, attributes: {} });
const ents = (sat: string, stt = 'old question', tts = 'old answer') =>
  ({ [SAT]: st(sat), 'sensor.vaca_kitchen_small_panel_stt': st(stt), 'sensor.vaca_kitchen_small_panel_tts': st(tts) } as unknown as HassEntities);
const HIDDEN: VoiceView = { phase: 'idle', visible: false, heard: '', reply: '' };

describe('voice satellite overlay', () => {
  it('derives VACA sibling sensor ids', () => {
    expect(siblingSensors(SAT)).toEqual({ stt: 'sensor.vaca_kitchen_small_panel_stt', tts: 'sensor.vaca_kitchen_small_panel_tts' });
  });

  it('maps unknown satellite states to idle and blanks unknown text', () => {
    const s = readSnapshot({ [SAT]: st('weird') } as unknown as HassEntities, SAT);
    expect(s).toEqual({ phase: 'idle', stt: '', tts: '' });
  });

  it('walks a full interaction without showing the previous answer', () => {
    const base = { stt: 'old question', tts: 'old answer' };
    let v = stepVoice(HIDDEN, base, readSnapshot(ents('listening'), SAT));
    expect(v).toMatchObject({ phase: 'listening', visible: true, heard: '', reply: '' });
    v = stepVoice(v, base, readSnapshot(ents('processing', 'what time is it'), SAT));
    expect(v).toMatchObject({ phase: 'processing', heard: 'what time is it', reply: '' });
    v = stepVoice(v, base, readSnapshot(ents('responding', 'what time is it', '5:57 PM'), SAT));
    expect(v).toMatchObject({ phase: 'responding', heard: 'what time is it', reply: '5:57 PM' });
    v = stepVoice(v, base, readSnapshot(ents('idle', 'what time is it', '5:57 PM'), SAT));
    expect(v).toMatchObject({ phase: 'idle', visible: true, reply: '5:57 PM' }); // lingers; hook hides after LINGER_MS
  });

  it('stays hidden while the satellite is idle', () => {
    const v = stepVoice(HIDDEN, { stt: '', tts: '' }, readSnapshot(ents('idle'), SAT));
    expect(v.visible).toBe(false);
  });
});
