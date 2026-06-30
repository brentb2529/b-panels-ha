import { describe, it, expect } from 'vitest';
import { isChunkLoadError } from './lazyWithRetry';

// Recovery is only as good as the detector — a missed message means a black
// screen instead of a self-heal. Cover every browser's phrasing.
describe('isChunkLoadError', () => {
  it('detects Chrome dynamic-import failure', () => {
    expect(isChunkLoadError(new Error('Failed to fetch dynamically imported module: https://x/assets/LightingPanel-DsrYpW7e.js'))).toBe(true);
  });
  it('detects Firefox dynamic-import failure', () => {
    expect(isChunkLoadError(new Error('error loading dynamically imported module: https://x/assets/PoolPanel-uVJHHVpl.js'))).toBe(true);
  });
  it('detects Safari module-script failure', () => {
    expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true);
  });
  it('detects legacy ChunkLoadError by name', () => {
    const e = new Error('Loading chunk 5 failed.'); e.name = 'ChunkLoadError';
    expect(isChunkLoadError(e)).toBe(true);
  });
  it('does NOT flag an ordinary render error', () => {
    expect(isChunkLoadError(new Error("Cannot read properties of undefined (reading 'map')"))).toBe(false);
  });
  it('does NOT flag a generic network error', () => {
    expect(isChunkLoadError(new Error('NetworkError when attempting to fetch resource.'))).toBe(false);
  });
  it('is null/undefined safe', () => {
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});
