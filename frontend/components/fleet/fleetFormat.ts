// Pure formatting helpers for the admin fleet view (task #25). No side effects.

export const EMDASH = '—';

// Compact "x ago" relative label from a seconds age. Returns EMDASH for null.
export const relAge = (seconds: number | null | undefined): string => {
  if (seconds == null || !Number.isFinite(seconds)) return EMDASH;
  const s = Math.max(0, Math.round(seconds));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h ago`;
};

// "online for" duration label from seconds. Negative/null ⇒ EMDASH.
export const durationLabel = (seconds: number | null | undefined): string => {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return EMDASH;
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
};

// Format an ISO timestamp to a short local clock+date, or EMDASH.
export const fmtWhen = (iso: string | null | undefined, now = Date.now()): string => {
  if (!iso) return EMDASH;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return EMDASH;
  const d = new Date(ms);
  const sameDay = new Date(now).toDateString() === d.toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return sameDay ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
};

export const batteryLabel = (pct: number | null | undefined): string =>
  pct == null || !Number.isFinite(pct) ? EMDASH : `${Math.round(pct)}%`;
