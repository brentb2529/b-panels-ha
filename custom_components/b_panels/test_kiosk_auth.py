"""Standalone tests for the b_panels kiosk token gate (H-2).

Pure helpers with no Home Assistant dependency, runnable with plain
`python3 -m pytest custom_components/b_panels/test_kiosk_auth.py` (or as a script).
"""

from kiosk_auth import (
    extract_presented_token,
    generate_kiosk_token,
    token_ok,
)

HEADER = "X-BPanels-Kiosk-Token"
QUERY = "kiosk_token"


def test_generate_token_is_long_and_unique():
    a = generate_kiosk_token()
    b = generate_kiosk_token()
    assert a != b
    assert len(a) >= 32


def test_token_ok_accepts_matching():
    assert token_ok("secret-tok", "secret-tok") is True


def test_token_ok_rejects_wrong():
    assert token_ok("secret-tok", "WRONG") is False


def test_token_ok_fail_closed_when_no_server_token():
    # No provisioned server token -> reject even an empty presented token.
    assert token_ok(None, "anything") is False
    assert token_ok("", "anything") is False


def test_token_ok_rejects_missing_presented():
    assert token_ok("secret-tok", None) is False
    assert token_ok("secret-tok", "") is False


def test_extract_prefers_header():
    presented = extract_presented_token(
        {HEADER: "from-header"},
        {QUERY: "from-query"},
        header_name=HEADER,
        query_name=QUERY,
    )
    assert presented == "from-header"


def test_extract_falls_back_to_query():
    presented = extract_presented_token(
        {},
        {QUERY: "from-query"},
        header_name=HEADER,
        query_name=QUERY,
    )
    assert presented == "from-query"


def test_extract_none_when_absent():
    presented = extract_presented_token(
        {}, {}, header_name=HEADER, query_name=QUERY
    )
    assert presented is None


def test_end_to_end_provisioned_kiosk_allowed_anon_rejected():
    server_tok = generate_kiosk_token()
    # Correctly provisioned kiosk (header) is allowed.
    good = extract_presented_token(
        {HEADER: server_tok}, {}, header_name=HEADER, query_name=QUERY
    )
    assert token_ok(server_tok, good) is True
    # Provisioned via query param is allowed.
    good_q = extract_presented_token(
        {}, {QUERY: server_tok}, header_name=HEADER, query_name=QUERY
    )
    assert token_ok(server_tok, good_q) is True
    # Anonymous LAN client (no token) is rejected.
    anon = extract_presented_token({}, {}, header_name=HEADER, query_name=QUERY)
    assert token_ok(server_tok, anon) is False
    # Wrong token rejected.
    wrong = extract_presented_token(
        {HEADER: "guess"}, {}, header_name=HEADER, query_name=QUERY
    )
    assert token_ok(server_tok, wrong) is False


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
