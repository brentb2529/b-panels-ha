"""Token gate for the unauthenticated LAN kiosk endpoints (H-2).

The four kiosk endpoints (idle_config / heartbeat / screenshot / command_channel)
hold no Home Assistant session — the native iPad app is a LAN-trust client. Before
this hardening they were fully open, which let any LAN client read dashboard
topology, spam the event bus, and *hijack* a panel's command channel by
re-registering its installationId. We gate them with a per-install KIOSK TOKEN.

This module is deliberately PURE (no Home Assistant imports) so it is unit-testable
standalone. `__init__.py` wires it to the aiohttp request + the entry-stored token.

Design notes / non-breaking provisioning:
  * The token is generated once and stored in the config entry `data`. The native
    app provisions it the same way it already provisions the LLAT: as a header
    (`X-BPanels-Kiosk-Token`) or a query param (`?kiosk_token=`).
  * Comparison is constant-time (`secrets.compare_digest`) so the gate is not a
    timing oracle.
  * Enabling NO actuation: these endpoints remain receive-only / status sinks. The
    token only authenticates the *caller*; it grants no new capability.
"""

from __future__ import annotations

import secrets


def generate_kiosk_token() -> str:
    """Generate a fresh URL-safe kiosk token."""
    return secrets.token_urlsafe(32)


def extract_presented_token(
    headers: object,
    query: object,
    *,
    header_name: str,
    query_name: str,
) -> str | None:
    """Pull the presented token from request headers or query.

    `headers`/`query` are anything supporting `.get(name)` (aiohttp's
    `request.headers` / `request.query`, or plain dicts in tests). Header wins
    over query. Returns None if neither is present.
    """
    tok = None
    try:
        tok = headers.get(header_name)  # type: ignore[union-attr]
    except Exception:  # noqa: BLE001
        tok = None
    if not tok:
        try:
            tok = query.get(query_name)  # type: ignore[union-attr]
        except Exception:  # noqa: BLE001
            tok = None
    return tok or None


def token_ok(expected: str | None, presented: str | None) -> bool:
    """Constant-time check that the presented token matches the expected one.

    Fail-closed: if no token has been provisioned on the server (`expected`
    falsy) the gate REJECTS — there is no "open" mode, so a misconfigured server
    can never silently expose the endpoints. A correctly-provisioned kiosk
    presents the matching token and is allowed.
    """
    if not expected or not presented:
        return False
    return secrets.compare_digest(str(expected), str(presented))
