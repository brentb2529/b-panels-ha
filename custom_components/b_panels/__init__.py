"""The B-Panels integration.

B-Panels is a HACS-distributed, full-screen smart-home dashboard panel for
Home Assistant. This integration does three things and nothing more:

  1. Serves the pre-built React SPA (./frontend) as a static directory.
  2. Registers a full-screen sidebar panel that loads the SPA in an iframe.
  3. Exposes two websocket commands so the SPA can persist its dashboard
     layout in Home Assistant's own storage (no external database).

All device data and control flows through Home Assistant's existing
websocket API using the signed-in user's session — the integration adds no
auth of its own and stores no tokens.
"""

from __future__ import annotations

import logging
import os
from urllib.parse import urlparse

import aiohttp
import voluptuous as vol

from homeassistant.components import frontend, websocket_api
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.storage import Store
from homeassistant.helpers.typing import ConfigType

from .const import (
    DOMAIN,
    FRONTEND_DIR,
    FRONTEND_INDEX,
    FRONTEND_URL_BASE,
    PANEL_ICON,
    PANEL_TITLE,
    PANEL_URL_PATH,
    STORAGE_KEY,
    STORAGE_VERSION,
    WS_CONFIG_GET,
    WS_CONFIG_SAVE,
    WS_GENERATOR,
    WS_RSS,
)

_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = vol.Schema({DOMAIN: vol.Schema({})}, extra=vol.ALLOW_EXTRA)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Set up shared resources (websocket commands) once for the integration."""
    websocket_api.async_register_command(hass, websocket_get_config)
    websocket_api.async_register_command(hass, websocket_save_config)
    websocket_api.async_register_command(hass, websocket_rss)
    websocket_api.async_register_command(hass, websocket_generator)
    return True


def _is_blocked_rss_host(host: str) -> bool:
    """Block loopback / link-local / private hosts to prevent SSRF."""
    h = (host or "").lower()
    if h in ("", "localhost", "::1") or h.endswith(".local"):
        return True
    if h.startswith(("127.", "10.", "192.168.", "169.254.", "0.")):
        return True
    # 172.16.0.0 – 172.31.255.255
    if h.startswith("172."):
        try:
            return 16 <= int(h.split(".")[1]) <= 31
        except (IndexError, ValueError):
            return False
    return False


@websocket_api.websocket_command(
    {vol.Required("type"): WS_RSS, vol.Required("url"): str}
)
@websocket_api.async_response
async def websocket_rss(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict,
) -> None:
    """Fetch an RSS/Atom feed server-side (CORS-safe) for the News tile.

    Returns the raw feed body; the SPA parses it client-side. SSRF-guarded to
    public http(s) hosts only.
    """
    url = msg["url"]
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        connection.send_error(msg["id"], "invalid_url", "Only http(s) URLs are allowed.")
        return
    if _is_blocked_rss_host(parsed.hostname or ""):
        connection.send_error(msg["id"], "blocked_target", "Internal hosts are not allowed.")
        return
    try:
        session = async_get_clientsession(hass)
        async with session.get(
            url,
            timeout=aiohttp.ClientTimeout(total=12),
            headers={"User-Agent": "B-Panels/1.0 (+home-assistant)"},
        ) as resp:
            if resp.status != 200:
                connection.send_error(msg["id"], "fetch_failed", f"Feed returned HTTP {resp.status}")
                return
            body = await resp.text()
        connection.send_result(msg["id"], {"body": body})
    except Exception as err:  # noqa: BLE001 - surface any fetch error to the UI
        connection.send_error(msg["id"], "fetch_error", str(err))


@websocket_api.require_admin
@websocket_api.websocket_command(
    {vol.Required("type"): WS_GENERATOR, vol.Required("url"): str}
)
@websocket_api.async_response
async def websocket_generator(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict,
) -> None:
    """Fetch a generator/local-device JSON document server-side for the tile.

    The endpoint URL is supplied by (and stored in) the dashboard config, not
    hardcoded — so this ships clean in a public repo. Unlike the RSS proxy this
    deliberately permits LAN/private hosts, because generator pollers (e.g. an
    EnergyTrak/genmon site-details API) live on the local network. Admin-only
    and http(s)-only to bound the SSRF surface. Read-only: GET, no body sent.
    """
    url = msg["url"]
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        connection.send_error(msg["id"], "invalid_url", "Only http(s) URLs are allowed.")
        return
    try:
        session = async_get_clientsession(hass)
        async with session.get(
            url,
            timeout=aiohttp.ClientTimeout(total=12),
            headers={"User-Agent": "B-Panels/1.0 (+home-assistant)"},
        ) as resp:
            if resp.status != 200:
                connection.send_error(msg["id"], "fetch_failed", f"Endpoint returned HTTP {resp.status}")
                return
            data = await resp.json(content_type=None)
        connection.send_result(msg["id"], {"data": data})
    except Exception as err:  # noqa: BLE001 - surface any fetch error to the UI
        connection.send_error(msg["id"], "fetch_error", str(err))


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Serve the SPA and register the sidebar panel."""
    store: Store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
    hass.data.setdefault(DOMAIN, {})["store"] = store

    frontend_path = os.path.join(os.path.dirname(__file__), FRONTEND_DIR)
    if not os.path.isfile(os.path.join(frontend_path, "index.html")):
        # Built assets ship inside HACS release zips. A source checkout without
        # a build still loads the integration so config/storage works; the panel
        # just shows an empty iframe until `vite build` has run.
        _LOGGER.warning(
            "B-Panels frontend not built yet (no %s/index.html). "
            "Run `npm install && npm run build` in the frontend project.",
            frontend_path,
        )
        os.makedirs(frontend_path, exist_ok=True)

    # Serve the built SPA. Use the async API where available (HA 2024.7+),
    # falling back to the legacy sync registration on older cores.
    await _async_register_static(hass, FRONTEND_URL_BASE, frontend_path)

    if PANEL_URL_PATH not in hass.data.get(f"{DOMAIN}_panels", set()):
        frontend.async_register_built_in_panel(
            hass,
            component_name="iframe",
            sidebar_title=PANEL_TITLE,
            sidebar_icon=PANEL_ICON,
            frontend_url_path=PANEL_URL_PATH,
            config={"url": FRONTEND_INDEX},
            require_admin=False,
        )
        hass.data.setdefault(f"{DOMAIN}_panels", set()).add(PANEL_URL_PATH)

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Remove the sidebar panel when the integration is unloaded."""
    if PANEL_URL_PATH in hass.data.get(f"{DOMAIN}_panels", set()):
        frontend.async_remove_panel(hass, PANEL_URL_PATH)
        hass.data[f"{DOMAIN}_panels"].discard(PANEL_URL_PATH)
    return True


async def _async_register_static(
    hass: HomeAssistant, url_path: str, path: str
) -> None:
    """Register a static directory across HA core versions."""
    try:
        from homeassistant.components.http import StaticPathConfig

        await hass.http.async_register_static_paths(
            [StaticPathConfig(url_path, path, cache_headers=False)]
        )
    except ImportError:
        # Pre-2024.7 cores: synchronous registration.
        hass.http.register_static_path(url_path, path, cache_headers=False)


@websocket_api.websocket_command({vol.Required("type"): WS_CONFIG_GET})
@websocket_api.async_response
async def websocket_get_config(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict,
) -> None:
    """Return the stored dashboard config (or null on first run)."""
    store: Store | None = hass.data.get(DOMAIN, {}).get("store")
    data = await store.async_load() if store else None
    connection.send_result(msg["id"], data)


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): WS_CONFIG_SAVE,
        vol.Required("config"): dict,
    }
)
@websocket_api.async_response
async def websocket_save_config(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict,
) -> None:
    """Persist the dashboard config. Admin-only."""
    store: Store | None = hass.data.get(DOMAIN, {}).get("store")
    if store is None:
        connection.send_error(msg["id"], "not_ready", "Storage not initialized")
        return
    await store.async_save(msg["config"])
    connection.send_result(msg["id"], {"success": True})
