"""Server-side gating + secret-stripping helpers for the b_panels config save.

Pure dict transforms with NO Home Assistant imports, so they are unit-testable
standalone. Used by `websocket_save_config` in `__init__.py` as defense-in-depth.

IMPORTANT: none of this enables any actuation. `_enforce_equipment_gating` only
records the honest `equipmentGated` safety flag on always-gated tile types (so a
client cannot persist a config that clears it); `strip_secret_keys` removes
plaintext credentials so the open (non-admin) `config/get` read cannot leak one.
"""

from __future__ import annotations

# Tile types that are ALWAYS equipment-gated. Mirrors
# `ALWAYS_EQUIPMENT_GATED_TYPES` in frontend/components/tileTypes.tsx — keep the
# two lists in sync.
ALWAYS_EQUIPMENT_GATED_TILE_TYPES = frozenset(
    {"alarm", "arming-status", "lock", "akvo-floor", "panic", "garage-cover", "pool-body"}
)

# Secret-bearing connection keys that must never be persisted (H-1). Mirrors the
# fields removed from `ServiceConnection` in frontend/types.ts.
SECRET_CONNECTION_KEYS = frozenset(
    {
        "apiKey",
        "apiToken",
        "lutronClientKey",
        "lutronClientCert",
        "lutronCaCert",
        "energytrakMagicLink",
        "whiskerPassword",
        "tempestApiToken",
        "haywardPassword",
        "flairClientSecret",
        "coolmasterPassword",
        "smartPlugPassword",
        "haAlarmCode",
    }
)


def enforce_equipment_gating(new_cfg: dict) -> int:
    """Force `gatingFlags.equipmentGated=true` on every always-gated tile.

    Returns the count of tiles where the flag had to be (re)forced (i.e. it was
    missing or not exactly True) — a tamper signal the caller logs. Mutates
    `new_cfg` in place.
    """
    forced = 0
    for panel in new_cfg.get("panels") or []:
        if not isinstance(panel, dict):
            continue
        for tile in panel.get("tiles") or []:
            if not isinstance(tile, dict):
                continue
            if tile.get("tileType") in ALWAYS_EQUIPMENT_GATED_TILE_TYPES:
                flags = tile.get("gatingFlags")
                if not isinstance(flags, dict):
                    flags = {}
                if flags.get("equipmentGated") is not True:
                    forced += 1
                flags["equipmentGated"] = True
                tile["gatingFlags"] = flags
    return forced


def strip_secret_keys(new_cfg: dict) -> int:
    """Remove any secret-bearing key from every connection. Returns the count."""
    stripped = 0
    for conn in new_cfg.get("connections") or []:
        if not isinstance(conn, dict):
            continue
        for key in list(conn.keys()):
            if key in SECRET_CONNECTION_KEYS:
                del conn[key]
                stripped += 1
    return stripped


def config_has_secrets(cfg: dict) -> bool:
    """True if any connection in the config carries a secret-bearing key.

    Used by tests / a verification gate to assert the persisted config (which
    the open `config/get` returns) carries no credentials.
    """
    for conn in (cfg or {}).get("connections") or []:
        if isinstance(conn, dict) and any(k in SECRET_CONNECTION_KEYS for k in conn):
            return True
    return False
