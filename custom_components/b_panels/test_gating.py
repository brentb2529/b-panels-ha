"""Standalone tests for the b_panels server-side gating + secret-stripping.

Pure-dict helpers with no Home Assistant dependency, runnable with plain
`python3 -m pytest custom_components/b_panels/test_gating.py` (or as a script).
"""

from gating import (
    SECRET_CONNECTION_KEYS,
    config_has_secrets,
    enforce_equipment_gating,
    evaluate_config_save,
    strip_secret_keys,
)


# ── config-clobber guards (production-failure lessons D) ─────────────────────


def test_evaluate_accepts_a_normal_first_save():
    v = evaluate_config_save({"panels": [{"id": "p1"}]}, None, None)
    assert v["action"] == "accept"
    assert v["next_rev"] == 1


def test_evaluate_accepts_and_increments_rev():
    cur = {"panels": [{"id": "p1"}], "_rev": 4}
    v = evaluate_config_save({"panels": [{"id": "p1"}, {"id": "p2"}]}, cur, 4)
    assert v["action"] == "accept"
    assert v["next_rev"] == 5


def test_evaluate_refuses_empty_over_populated():
    cur = {"panels": [{"id": "p1"}], "_rev": 2}
    v = evaluate_config_save({"panels": []}, cur, 2)
    assert v["action"] == "refuse"
    assert v["code"] == "stale_empty"


def test_evaluate_refuses_stale_rev():
    # A stale panel started from rev 3 but the store has advanced to 7.
    cur = {"panels": [{"id": "p1"}], "_rev": 7}
    v = evaluate_config_save({"panels": [{"id": "p1"}]}, cur, 3)
    assert v["action"] == "refuse"
    assert v["code"] == "stale_rev"
    assert v["stored_rev"] == 7


def test_evaluate_accepts_when_client_rev_matches_current():
    cur = {"panels": [{"id": "p1"}], "_rev": 7}
    v = evaluate_config_save({"panels": [{"id": "p1"}]}, cur, 7)
    assert v["action"] == "accept"
    assert v["next_rev"] == 8


def test_evaluate_accepts_when_client_rev_omitted_legacy():
    # Legacy clients that don't send client_rev still save (empty-guard protects).
    cur = {"panels": [{"id": "p1"}], "_rev": 7}
    v = evaluate_config_save({"panels": [{"id": "p1"}]}, cur, None)
    assert v["action"] == "accept"
    assert v["next_rev"] == 8


def test_evaluate_empty_guard_takes_precedence_over_rev():
    # An empty incoming config is refused as stale_empty even if the rev is fine.
    cur = {"panels": [{"id": "p1"}], "_rev": 2}
    v = evaluate_config_save({"panels": []}, cur, 2)
    assert v["code"] == "stale_empty"


def test_enforce_forces_missing_gating_flag():
    cfg = {"panels": [{"tiles": [{"tileType": "lock"}]}]}
    forced = enforce_equipment_gating(cfg)
    assert forced == 1
    assert cfg["panels"][0]["tiles"][0]["gatingFlags"]["equipmentGated"] is True


def test_enforce_reforces_cleared_flag():
    cfg = {"panels": [{"tiles": [{"tileType": "alarm", "gatingFlags": {"equipmentGated": False}}]}]}
    forced = enforce_equipment_gating(cfg)
    assert forced == 1
    assert cfg["panels"][0]["tiles"][0]["gatingFlags"]["equipmentGated"] is True


def test_enforce_leaves_non_gated_tile_alone():
    cfg = {"panels": [{"tiles": [{"tileType": "switch"}]}]}
    forced = enforce_equipment_gating(cfg)
    assert forced == 0
    assert "gatingFlags" not in cfg["panels"][0]["tiles"][0]


def test_enforce_idempotent_when_already_set():
    cfg = {"panels": [{"tiles": [{"tileType": "garage-cover", "gatingFlags": {"equipmentGated": True}}]}]}
    assert enforce_equipment_gating(cfg) == 0


def test_strip_removes_all_secret_keys():
    cfg = {
        "connections": [
            {
                "id": "Lutron",
                "lutronClientKey": "leak",
                "lutronManualIp": "192.168.1.5",
            },
            {"id": "HomeAssistant", "apiKey": "leak2", "haAlarmCode": "1234", "haAlarmEntityId": "alarm_control_panel.alarmo"},
        ]
    }
    stripped = strip_secret_keys(cfg)
    assert stripped == 3
    # Non-secret config retained.
    assert cfg["connections"][0]["lutronManualIp"] == "192.168.1.5"
    assert cfg["connections"][1]["haAlarmEntityId"] == "alarm_control_panel.alarmo"
    # No secret survives.
    assert not config_has_secrets(cfg)


def test_config_has_secrets_detects_a_secret():
    assert config_has_secrets({"connections": [{"id": "X", "apiToken": "t"}]}) is True
    assert config_has_secrets({"connections": [{"id": "X", "haAlarmEntityId": "a"}]}) is False
    assert config_has_secrets({}) is False


def test_every_known_secret_key_is_stripped():
    cfg = {"connections": [{"id": "X", **{k: "v" for k in SECRET_CONNECTION_KEYS}}]}
    strip_secret_keys(cfg)
    assert not config_has_secrets(cfg)
    assert cfg["connections"][0] == {"id": "X"}


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
