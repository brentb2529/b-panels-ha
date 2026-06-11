"""Standalone tests for the b_panels admin fleet helpers (task #25).

Pure helpers with no Home Assistant dependency, runnable with
`python3 -m pytest custom_components/b_panels/test_fleet.py` (or as a script).
"""

from datetime import datetime, timezone

from fleet import (
    HEARTBEAT_OFFLINE_AFTER_S,
    HEARTBEAT_STALE_AFTER_S,
    build_heartbeat_record,
    derive_remote_ip,
    freshness_for,
    project_fleet,
)

NOW = datetime(2026, 6, 11, 12, 0, 0, tzinfo=timezone.utc)
NOW_EPOCH = NOW.timestamp()


def _iso_ago(seconds: float) -> str:
    return datetime.fromtimestamp(NOW_EPOCH - seconds, tz=timezone.utc).isoformat()


# ── derive_remote_ip ──────────────────────────────────────────────────────────
def test_derive_prefers_forwarded_for_first_hop():
    assert derive_remote_ip("203.0.113.7, 10.0.0.1", "10.0.0.1") == "203.0.113.7"


def test_derive_falls_back_to_peer():
    assert derive_remote_ip(None, "192.168.1.50") == "192.168.1.50"


def test_derive_none_when_absent():
    assert derive_remote_ip(None, None) is None


def test_derive_rejects_garbage_with_control_chars():
    assert derive_remote_ip("bad\nvalue", "192.168.1.9") == "192.168.1.9"


# ── build_heartbeat_record ────────────────────────────────────────────────────
def test_record_self_reported_ip_wins_over_remote():
    rec = build_heartbeat_record(
        {"installationId": "kiosk-a", "ip": "192.168.1.20"},
        now_iso=NOW.isoformat(),
        remote_ip="10.9.9.9",
    )
    assert rec["ip"] == "192.168.1.20"
    assert rec["ipSource"] == "reported"


def test_record_falls_back_to_remote_ip():
    rec = build_heartbeat_record(
        {"installationId": "kiosk-a"},
        now_iso=NOW.isoformat(),
        remote_ip="10.9.9.9",
    )
    assert rec["ip"] == "10.9.9.9"
    assert rec["ipSource"] == "remote-addr"


def test_record_no_ip_is_honest_none():
    rec = build_heartbeat_record(
        {"installationId": "kiosk-a"}, now_iso=NOW.isoformat()
    )
    assert rec["ip"] is None
    assert rec["ipSource"] is None


def test_record_keeps_only_known_fields_and_caps_strings():
    rec = build_heartbeat_record(
        {
            "installationId": "kiosk-a",
            "name": "Kitchen",
            "version": "1.2.3",
            "currentPanelId": "pool",
            "currentPanelName": "Pool",
            "screenState": "on",
            "online": True,
            "battery": 87,
            "evil": "x" * 999,  # arbitrary key is dropped
        },
        now_iso=NOW.isoformat(),
    )
    assert "evil" not in rec
    assert rec["name"] == "Kitchen"
    assert rec["version"] == "1.2.3"
    assert rec["currentPanelName"] == "Pool"
    assert rec["screenState"] == "on"
    assert rec["battery"] == 87
    assert rec["lastSeen"] == NOW.isoformat()


def test_record_battery_clamped_and_bool_rejected():
    assert build_heartbeat_record({"battery": 150}, now_iso=NOW.isoformat())["battery"] == 100
    assert build_heartbeat_record({"battery": -5}, now_iso=NOW.isoformat())["battery"] == 0
    assert build_heartbeat_record({"battery": True}, now_iso=NOW.isoformat())["battery"] is None
    assert build_heartbeat_record({"battery": "x"}, now_iso=NOW.isoformat())["battery"] is None


def test_record_non_dict_body_is_safe():
    rec = build_heartbeat_record("not-a-dict", now_iso=NOW.isoformat())  # type: ignore[arg-type]
    assert rec["installationId"] == "unknown"


# ── freshness_for ─────────────────────────────────────────────────────────────
def test_freshness_online_when_fresh():
    assert freshness_for(_iso_ago(10), NOW_EPOCH, True) == "online"


def test_freshness_stale_after_threshold():
    assert freshness_for(_iso_ago(HEARTBEAT_STALE_AFTER_S + 5), NOW_EPOCH, True) == "stale"


def test_freshness_offline_after_threshold():
    assert freshness_for(_iso_ago(HEARTBEAT_OFFLINE_AFTER_S + 5), NOW_EPOCH, True) == "offline"


def test_freshness_offline_when_explicit_offline_flag():
    # Fresh beat but the panel reported online:false (graceful shutdown).
    assert freshness_for(_iso_ago(5), NOW_EPOCH, False) == "offline"


def test_freshness_offline_when_no_timestamp():
    assert freshness_for(None, NOW_EPOCH, True) == "offline"


def test_freshness_handles_z_suffix():
    z = datetime.fromtimestamp(NOW_EPOCH - 10, tz=timezone.utc).isoformat().replace("+00:00", "Z")
    assert freshness_for(z, NOW_EPOCH, True) == "online"


# ── project_fleet ─────────────────────────────────────────────────────────────
def test_project_fleet_mixed_statuses_sorted():
    beats = {
        "kiosk-c": {"installationId": "kiosk-c", "online": True, "lastSeen": _iso_ago(10)},
        "kiosk-a": {"installationId": "kiosk-a", "online": True, "lastSeen": _iso_ago(HEARTBEAT_STALE_AFTER_S + 30)},
        "kiosk-b": {"installationId": "kiosk-b", "online": True, "lastSeen": _iso_ago(HEARTBEAT_OFFLINE_AFTER_S + 60)},
    }
    rows = project_fleet(beats, NOW_EPOCH)
    assert [r["installationId"] for r in rows] == ["kiosk-a", "kiosk-b", "kiosk-c"]
    by_id = {r["installationId"]: r for r in rows}
    assert by_id["kiosk-c"]["status"] == "online"
    assert by_id["kiosk-a"]["status"] == "stale"
    assert by_id["kiosk-b"]["status"] == "offline"
    assert by_id["kiosk-c"]["lastSeenAgeS"] == 10


def test_project_fleet_offline_by_age_and_absent_lastseen():
    # Polish #3: the OFFLINE pill via the freshness-threshold path (very-old
    # lastSeen) AND the absent-lastSeen path — distinct from the online:false
    # graceful-shutdown branch. Both must classify offline.
    beats = {
        "kiosk-darkroom": {  # very old beat → offline by age
            "installationId": "kiosk-darkroom", "online": True,
            "lastSeen": _iso_ago(HEARTBEAT_OFFLINE_AFTER_S + 20),
        },
        "kiosk-noseen": {  # no lastSeen at all → offline
            "installationId": "kiosk-noseen", "online": True,
        },
        "kiosk-foyer": {  # fresh → online (so the rollup is mixed)
            "installationId": "kiosk-foyer", "online": True, "lastSeen": _iso_ago(8),
        },
    }
    rows = project_fleet(beats, NOW_EPOCH)
    by_id = {r["installationId"]: r for r in rows}
    assert by_id["kiosk-darkroom"]["status"] == "offline"
    assert by_id["kiosk-noseen"]["status"] == "offline"
    assert by_id["kiosk-foyer"]["status"] == "online"
    # the admin UI rollup counts offline from these statuses
    offline = sum(1 for r in rows if r["status"] == "offline")
    assert offline == 2


def test_project_fleet_empty_and_bad_input():
    assert project_fleet({}, NOW_EPOCH) == []
    assert project_fleet("nope", NOW_EPOCH) == []  # type: ignore[arg-type]
    # non-dict rows are skipped
    assert project_fleet({"x": "bad", "y": {"installationId": "y", "lastSeen": _iso_ago(5)}}, NOW_EPOCH) == [
        {"installationId": "y", "lastSeen": _iso_ago(5), "status": "online", "lastSeenAgeS": 5}
    ]


if __name__ == "__main__":
    import sys

    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for fn in fns:
        try:
            fn()
            print(f"PASS {fn.__name__}")
        except AssertionError as e:  # noqa: PERF203
            failed += 1
            print(f"FAIL {fn.__name__}: {e}")
    print(f"\n{len(fns) - failed}/{len(fns)} passed")
    sys.exit(1 if failed else 0)
