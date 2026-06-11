"""Standalone tests for the b_panels intercom signaling-relay invariants
(feat/panel-intercom).

The relay command (`websocket_intercom_signal`) is an HA-decorated handler whose
behaviour is exercised end-to-end by the Playwright round-trip; these tests guard
the SECURITY-RELEVANT constants/contract the relay depends on so they can't drift
silently:
  * the signal `kind` set is a FIXED enum (the relay can never carry an arbitrary
    message type — voluptuous validates against this exact list);
  * the payload is bounded (the relay rejects anything larger — bounds event-bus
    abuse from an authenticated-but-hostile client);
  * the relay re-fires a dedicated, namespaced event (panels filter on `to`).

Runnable with plain `python3 custom_components/b_panels/test_intercom.py`.
"""

from const import (
    EVENT_INTERCOM_SIGNAL,
    INTERCOM_PAYLOAD_MAX_BYTES,
    INTERCOM_SIGNAL_KINDS,
    WS_INTERCOM_SIGNAL,
)


def test_kinds_are_a_fixed_known_set():
    # The relay accepts ONLY these kinds (voluptuous vol.In). If a new kind is
    # added it must be deliberate — this guards against an accidental widening.
    assert set(INTERCOM_SIGNAL_KINDS) == {
        "presence",
        "invite",
        "accept",
        "decline",
        "ice",
        "bye",
        "busy",
    }


def test_no_actuation_kinds_present():
    # Belt-and-suspenders: NONE of the kinds may resemble a service/actuation
    # verb. The relay carries signaling only; it never drives home equipment.
    forbidden = {"call_service", "turn_on", "turn_off", "open", "close", "unlock", "lock", "set"}
    assert forbidden.isdisjoint(set(INTERCOM_SIGNAL_KINDS))


def test_payload_cap_is_bounded_and_sane():
    # SDP blobs are a few KB; the cap must be small enough to bound abuse but big
    # enough for a real offer/answer. 64 KB matches the heartbeat cap.
    assert 8_000 <= INTERCOM_PAYLOAD_MAX_BYTES <= 256_000


def test_event_and_command_names_are_namespaced():
    assert WS_INTERCOM_SIGNAL == "b_panels/intercom/signal"
    assert EVENT_INTERCOM_SIGNAL == "b_panels_intercom_signal"
    assert WS_INTERCOM_SIGNAL.startswith("b_panels/")
    assert EVENT_INTERCOM_SIGNAL.startswith("b_panels_")


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
