import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useHomeNews } from './useHomeNews';
import { fmtRelative, type NewsHeadline } from './homeNews';
import { sanitizeHtml } from '../../utils/sanitizeHtml';

// ---------------------------------------------------------------------------
// HomeNewsTicker — the RSS newsfeed, back on the Home overview (feat/home-rss).
//
// A tasteful "morning-paper glance": a slim liquid-glass strip that quietly
// rotates the latest headlines (title · source · relative time), SECONDARY to
// the scenes + area cards. Tapping the strip expands a small popover that lists
// the kept headlines and (when a safe link exists) a "View source" affordance
// that opens the article in a NEW TAB — there is no in-panel web browsing.
//
// ── Security (M-2) ──
//   Feed text is UNTRUSTED. Every headline title + source runs through the
//   shared `sanitizeHtml` allow-list before it is injected (which strips
//   script/iframe/on*/javascript: vectors), and outbound links were already
//   constrained to http(s) in the projection (`safeLink`). A hostile/compromised
//   feed therefore cannot run script in the panel origin (same-origin with HA)
//   or exfiltrate the kiosk LLAT. `target=_blank` carries rel=noopener.
//
// ── Posture ──
//   DISPLAY-ONLY. No callService, no actuation. Renders NOTHING when no feed is
//   present (graceful absence — Home stays clean with no real feed configured).
//
// All markup is under `.hp-scope .hp-news` (HomePanel mounts it inside the
// scope) and all CSS is namespaced `hp-news-*` in homePanel.css, so it never
// restyles other panels or the legacy dashboard.
// ---------------------------------------------------------------------------

const ROTATE_MS = 7000;

const RssGlyph = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 11a9 9 0 0 1 9 9" /><path d="M4 4a16 16 0 0 1 16 16" /><circle cx="5" cy="19" r="1" />
  </svg>
);
const ExtGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

// Render a sanitized headline title/source as inert text. We sanitize (which
// neutralizes any markup) then strip to text content — the ticker shows plain
// headline text, never live feed markup.
const SafeText = ({ value, className }: { value: string; className?: string }) => {
  const clean = useMemo(() => {
    const sanitized = sanitizeHtml(value);
    // Decode the sanitized fragment back to text-only so we never inject markup
    // on this surface at all (defense in depth atop the allow-list).
    if (typeof document !== 'undefined') {
      const tmp = document.createElement('div');
      tmp.innerHTML = sanitized;
      return tmp.textContent || '';
    }
    return sanitized;
  }, [value]);
  return <span className={className}>{clean}</span>;
};

const HomeNewsTicker = ({ newsEntityId }: { newsEntityId?: string }) => {
  const news = useHomeNews(newsEntityId ? { newsEntityId } : {});
  const [idx, setIdx] = useState(0);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const items = news.headlines;
  const count = items.length;

  // Advance the marquee. Pause while the expanded popover is open.
  useEffect(() => {
    if (open || count <= 1) return;
    const id = window.setInterval(() => setIdx((i) => (i + 1) % count), ROTATE_MS);
    return () => window.clearInterval(id);
  }, [open, count]);

  // Keep relative times fresh on the strip + popover.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // Clamp the rotating index if the feed shrinks.
  useEffect(() => {
    if (idx >= count && count > 0) setIdx(0);
  }, [count, idx]);

  // Close the popover on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Graceful absence: no feed configured/detected, or it has no headlines.
  if (!news.present) return null;

  if (count === 0) {
    return (
      <div className="hp-news hp-news-empty" role="status" aria-label="Newsfeed">
        <span className="hp-news-kicker"><RssGlyph /> Headlines</span>
        <span className="hp-news-empty-txt">
          {news.available ? 'No headlines right now' : 'Feed unavailable'}
        </span>
      </div>
    );
  }

  const cur = items[Math.min(idx, count - 1)] as NewsHeadline;

  return (
    <div className={`hp-news${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="hp-news-strip"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Latest headlines — tap to expand"
        title="Latest headlines"
      >
        <span className="hp-news-kicker"><RssGlyph /> Headlines</span>
        <span className="hp-news-cur" key={idx /* re-trigger the fade on advance */}>
          <SafeText value={cur.title} className="hp-news-title" />
          <span className="hp-news-meta">
            <SafeText value={cur.source} className="hp-news-src" />
            {fmtRelative(cur.publishedIso, now) && (
              <span className="hp-news-time num"> · {fmtRelative(cur.publishedIso, now)}</span>
            )}
          </span>
        </span>
        {count > 1 && (
          <span className="hp-news-dots" aria-hidden="true">
            {items.map((_, i) => (
              <span key={i} className={`hp-news-dot${i === Math.min(idx, count - 1) ? ' on' : ''}`} />
            ))}
          </span>
        )}
        <svg className="hp-news-chev" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><polyline points={open ? '18 15 12 9 6 15' : '6 9 12 15 18 9'} /></svg>
      </button>

      {open && (
        <div className="hp-news-list" role="region" aria-label="Recent headlines">
          {items.map((it, i) => (
            <div className="hp-news-row" key={i}>
              <span className="hp-news-row-rail" aria-hidden="true" />
              <div className="hp-news-row-body">
                <SafeText value={it.title} className="hp-news-row-title" />
                <div className="hp-news-row-meta">
                  <SafeText value={it.source} className="hp-news-src" />
                  {fmtRelative(it.publishedIso, now) && (
                    <span className="hp-news-time num"> · {fmtRelative(it.publishedIso, now)}</span>
                  )}
                </div>
              </div>
              {it.link && (
                <a
                  className="hp-news-row-link"
                  href={it.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  title="View source in a new tab"
                  aria-label="View source"
                >
                  <ExtGlyph />
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default HomeNewsTicker;
