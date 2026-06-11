"""Pure helpers for the admin Panels & Data-Sources fleet status view (task #25).

NO Home Assistant imports — pure functions over plain dicts/strings so they are
unit-testable standalone (`python3 test_fleet.py`). Used by the heartbeat view
and the admin-only `b_panels/fleet/get` websocket command in `__init__.py`.

Security posture (mirrors the rest of b_panels):
  * READ-ONLY diagnostics. Nothing here actuates any equipment.
  * The heartbeat ingest stays H-2 token-gated + size-capped in __init__.py; the
    helpers below only BOUND + sanitize what gets stored (a small known field
    set, capped string lengths) so an unauthenticated LAN client can't spray
    arbitrary JSON onto the event bus / into hass.data.
  * The fleet PROJECTION (online/stale/offline from heartbeat freshness) is
    served only via the ADMIN-only WS command — never an unauthenticated path.
"""

from __future__ import annotations

# Heartbeat freshness thresholds (seconds). A kiosk beats roughly every ~30s; we
# treat a beat as ONLINE while fresh, STALE once it lapses, and OFFLINE once it
# has been silent long enough that the panel is almost certainly dark.
HEARTBEAT_STALE_AFTER_S = 90
HEARTBEAT_OFFLINE_AFTER_S = 300

# Cap the lengths of free-form string fields we store from the (token-gated but
# still external) kiosk heartbeat, so a buggy/hostile client can't bloat memory.
_MAX_STR = 64
_MAX_LONG_STR = 128


def _clip(value, limit: int = _MAX_STR) -> str | None:
    """Coerce to a length-capped string, or None when absent."""
    if value is None:
        return None
    s = str(value)
    return s[:limit] if s else None


def _clean_ip(value) -> str | None:
    """Accept a plausible IP/host string from the kiosk self-report.

    We don't hard-validate the format (it's display-only diagnostics), but we cap
    length and reject anything with control/space characters so it can't be used
    to inject markup into the admin view downstream.
    """
    if value is None:
        return None
    s = str(value).strip()
    if not s or len(s) > 45:  # max IPv6 textual length is 45
        return None
    if any(ord(c) < 0x20 or c in " <>\"'\t\n\r" for c in s):
        return None
    return s


def derive_remote_ip(forwarded_for: str | None, peer_ip: str | None) -> str | None:
    """Best-effort source IP when the kiosk can't self-report it.

    Prefer the left-most X-Forwarded-For hop (the original client when HA sits
    behind a trusted reverse proxy), else the raw peer address. Display-only.
    """
    if forwarded_for:
        first = forwarded_for.split(",")[0].strip()
        cleaned = _clean_ip(first)
        if cleaned:
            return cleaned
    return _clean_ip(peer_ip)


def build_heartbeat_record(
    body: dict,
    *,
    now_iso: str,
    self_reported_ip=None,
    remote_ip: str | None = None,
) -> dict:
    """Project a raw heartbeat POST body into the small stored record.

    Only a known, bounded set of status fields is kept (never the caller's whole
    arbitrary JSON). The kiosk may self-report its LAN `ip`; if it can't, the
    caller passes the derived request remote-addr as `remote_ip`. `ipSource`
    records which we used (display-only honesty in the admin view).
    """
    if not isinstance(body, dict):
        body = {}

    self_ip = _clean_ip(self_reported_ip if self_reported_ip is not None else body.get("ip"))
    if self_ip:
        ip, ip_source = self_ip, "reported"
    elif remote_ip:
        ip, ip_source = remote_ip, "remote-addr"
    else:
        ip, ip_source = None, None

    battery = body.get("battery")
    # battery is a 0..100 number when present; keep it numeric or None.
    if isinstance(battery, bool):  # bool is an int subclass — reject
        battery = None
    elif isinstance(battery, (int, float)):
        battery = max(0, min(100, round(float(battery))))
    else:
        battery = None

    return {
        "installationId": _clip(body.get("installationId") or "unknown"),
        "name": _clip(body.get("name")),
        "online": bool(body.get("online", True)),
        "battery": battery,
        "version": _clip(body.get("version")),
        "ip": ip,
        "ipSource": ip_source,
        # what panel/dashboard the kiosk is currently showing (display-only)
        "currentPanelId": _clip(body.get("currentPanelId")),
        "currentPanelName": _clip(body.get("currentPanelName"), _MAX_LONG_STR),
        # screen power/dim state, if the native app reports it
        "screenState": _clip(body.get("screenState")),
        "lastSeen": now_iso,
    }


def _parse_iso(ts: str | None) -> float | None:
    """Parse an ISO-8601 timestamp to epoch seconds (UTC-naive tolerant)."""
    if not ts:
        return None
    from datetime import datetime

    s = str(ts)
    # Python's fromisoformat handles "+00:00" but not a trailing "Z".
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    return dt.timestamp()


def freshness_for(last_seen_iso: str | None, now_epoch: float, online_flag: bool) -> str:
    """Classify a panel's connection status from heartbeat freshness.

    Returns 'online' | 'stale' | 'offline'. A panel that explicitly reported
    `online: false` (graceful shutdown) is offline regardless of recency. We
    NEVER imply a panel is online purely from a stale record — freshness wins.
    """
    last = _parse_iso(last_seen_iso)
    if last is None:
        return "offline"
    age = now_epoch - last
    if age < 0:
        age = 0
    if age >= HEARTBEAT_OFFLINE_AFTER_S:
        return "offline"
    if age >= HEARTBEAT_STALE_AFTER_S:
        return "stale"
    return "online" if online_flag else "offline"


def project_fleet(beats: dict, now_epoch: float) -> list[dict]:
    """Project the heartbeat registry into the admin fleet view rows.

    Each row carries the stored record plus a derived `status`
    (online/stale/offline) and `lastSeenAgeS` (seconds since last beat) so the
    admin UI can render "online for / last seen" without re-parsing timestamps.
    Sorted by installationId for stable rendering. READ-ONLY projection.
    """
    rows: list[dict] = []
    if not isinstance(beats, dict):
        return rows
    for iid, rec in beats.items():
        if not isinstance(rec, dict):
            continue
        last_iso = rec.get("lastSeen")
        online_flag = bool(rec.get("online", True))
        status = freshness_for(last_iso, now_epoch, online_flag)
        last = _parse_iso(last_iso)
        age = None if last is None else max(0, round(now_epoch - last))
        rows.append({**rec, "installationId": rec.get("installationId") or str(iid),
                     "status": status, "lastSeenAgeS": age})
    rows.sort(key=lambda r: str(r.get("installationId") or ""))
    return rows
