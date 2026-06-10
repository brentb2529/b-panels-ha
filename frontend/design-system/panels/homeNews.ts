// Home overview RSS newsfeed — pure projection (feat/home-rss).
//
// DISPLAY-ONLY · NO ACTUATION · NO callService (no import, by construction).
//
// The homeowner wants the RSS newsfeed back on the front page, tastefully — a
// premium "morning-paper glance" that stays SECONDARY to the scenes + area
// cards. This module is the brain of that surface: a PURE, side-effect-free
// projection (exported for unit testing) that turns the raw HA entity feed into
// a small, sorted, capped list of headlines the Home ticker renders.
//
// ── Read path (cleanest for the b-panels SPA) ──
//   HA's core `feedreader` integration FIRES events (no native entity). The
//   b-panels tier reads the SUBSCRIBED entity stream (subscribeEntities), so we
//   bind GENERICALLY to a sensor that carries the feed entries in an attribute
//   — the shape produced by the common `feedparser`/template pattern that turns
//   a feedreader/RSS source into a sensor:
//
//     sensor.<feed>  state = headline count (or latest title)
//       attributes.entries = [ { title, link, published|pubDate, source? }, … ]
//
//   We auto-detect any sensor whose attributes carry an `entries` (or `feed` /
//   `items`) array of headline-shaped objects, OR an explicitly configured id.
//   No site-specific entity id and NO real feed URL is hardcoded in the frontend
//   — the feed URL stays HA/config side. Dev provisions a demo sensor of exactly
//   this shape (see dev-ha/config/packages/home_news_demo.yaml).
//
// ── Security (M-2) ──
//   Feed content is UNTRUSTED. This projection extracts ONLY plain-text-ish
//   fields (title, source) and a link, and the renderer runs every title through
//   the existing `sanitizeHtml` allow-list before injecting it. No raw feed HTML
//   is ever passed to dangerouslySetInnerHTML by this surface. A hostile feed
//   therefore cannot run script in the panel origin or exfiltrate the kiosk LLAT.

import type { HassEntities, HassEntity } from 'home-assistant-js-websocket';

const UNAVAILABLE = new Set(['unavailable', 'unknown', '', 'none', '—']);
const isAvail = (e?: HassEntity) =>
  !!e && !UNAVAILABLE.has(String(e.state).toLowerCase());

// How many headlines the Home ticker keeps. Quiet by design — a glance, not a
// wall of text.
export const NEWS_LIMIT = 6;

export interface NewsHeadline {
  /** Headline title (UNTRUSTED — sanitize before render). */
  title: string;
  /** Source/feed name, e.g. "NPR" (UNTRUSTED — sanitize before render). */
  source: string;
  /** Outbound link (validated to http/https only; '' if unsafe/missing). */
  link: string;
  /** Original publish timestamp (ISO) or null. Drives relative time. */
  publishedIso: string | null;
}

export interface HomeNewsView {
  /** A feed source exists in the entity stream (configured or detected). */
  present: boolean;
  /** The feed source is available (state not unavailable/unknown). */
  available: boolean;
  /** Sorted (newest first), de-duped, capped headlines. */
  headlines: NewsHeadline[];
  /** Source entity id (for debugging / config), or null. */
  entityId: string | null;
}

export interface HomeNewsConfig {
  /** Explicit feed sensor entity id (else auto-detect by entries-shaped attrs). */
  newsEntityId?: string;
  /** Override the headline cap (default NEWS_LIMIT). */
  limit?: number;
}

// Only http(s) links are kept; anything else (javascript:, data:, relative) is
// dropped to '' so a tap can never navigate to a script URI. Whitespace +
// control chars are stripped first so an obfuscated "ht\ttps:" cannot slip past.
const SAFE_LINK_RE = /^https?:\/\//i;
const safeLink = (raw: unknown): string => {
  const v = String(raw ?? '').replace(/[\u0000-\u0020]+/g, '');
  return SAFE_LINK_RE.test(v) ? v : '';
};

const str = (v: unknown): string =>
  (v === null || v === undefined ? '' : String(v)).trim();

// Pull a usable entries array off an entity's attributes. We accept several
// common attribute names produced by the feedparser/template patterns.
const entriesOf = (e: HassEntity): any[] | null => {
  const a = (e.attributes ?? {}) as Record<string, any>;
  const cand = a.entries ?? a.feed ?? a.items ?? a.articles ?? a.headlines;
  return Array.isArray(cand) ? cand : null;
};

// Does an entries item look like a headline? (Must carry a title-ish field.)
const itemTitle = (it: any): string =>
  str(it?.title ?? it?.headline ?? it?.name ?? it?.summary);

// Does this entity look like an RSS/news feed sensor? (entries-shaped attrs).
// Used only for auto-detect when no explicit id is configured.
const looksLikeFeed = (e: HassEntity): boolean => {
  if (!e.entity_id.startsWith('sensor.')) return false;
  const arr = entriesOf(e);
  return !!arr && arr.some((it) => itemTitle(it));
};

const pickPublished = (it: any): string | null => {
  const raw =
    it?.published ?? it?.pubDate ?? it?.pub_date ?? it?.updated ?? it?.date ?? null;
  if (!raw) return null;
  const t = Date.parse(String(raw));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

const pickSource = (it: any, feedFallback: string): string => {
  const s = str(it?.source ?? it?.feed ?? it?.author ?? it?.site);
  return s || feedFallback;
};

// ── Top-level projection ──────────────────────────────────────────────────────
export const projectHomeNews = (
  ents: HassEntities,
  cfg: HomeNewsConfig = {},
): HomeNewsView => {
  let e: HassEntity | undefined;
  if (cfg.newsEntityId && ents[cfg.newsEntityId]) {
    e = ents[cfg.newsEntityId];
  } else if (!cfg.newsEntityId) {
    e = Object.values(ents).find((x) => looksLikeFeed(x));
  }

  if (!e) {
    return { present: false, available: false, headlines: [], entityId: null };
  }

  const available = isAvail(e);
  const feedName =
    str((e.attributes as any)?.friendly_name) ||
    (e.entity_id.split('.').pop() || 'News').replace(/_/g, ' ');
  const raw = entriesOf(e) ?? [];

  const seen = new Set<string>();
  const headlines: NewsHeadline[] = [];
  for (const it of raw) {
    const title = itemTitle(it);
    if (!title) continue;
    // De-dupe on title (case-insensitive). Feeds repeat across refreshes.
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    headlines.push({
      title,
      source: pickSource(it, feedName),
      link: safeLink(it?.link ?? it?.url ?? it?.href),
      publishedIso: pickPublished(it),
    });
  }

  // Newest first (items with no timestamp sink to the bottom, stable order).
  headlines.sort((a, b) => {
    const ta = a.publishedIso ? Date.parse(a.publishedIso) : -Infinity;
    const tb = b.publishedIso ? Date.parse(b.publishedIso) : -Infinity;
    return tb - ta;
  });

  const limit = cfg.limit ?? NEWS_LIMIT;
  return {
    present: true,
    available,
    headlines: headlines.slice(0, Math.max(0, limit)),
    entityId: e.entity_id,
  };
};

// ── Relative-time formatter — "now / 4m / 2h / Mon" for the headline meta. ──
export const fmtRelative = (iso: string | null, nowMs: number): string => {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diff = nowMs - t;
  if (diff < 0) return 'now';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
