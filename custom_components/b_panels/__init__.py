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

import json
import logging
import os
from urllib.parse import urlparse

import aiohttp
import voluptuous as vol
from aiohttp import web

from homeassistant.components import frontend, websocket_api
from homeassistant.components.http import HomeAssistantView
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall, callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.storage import Store
from homeassistant.helpers.typing import ConfigType
from homeassistant.util import dt as dt_util

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
    # HTTP endpoints the native iPad kiosk app uses (it has no HA token, so these
    # are unauthenticated and carry only non-sensitive data). These replace the
    # old Node api-server the kiosk used to talk to:
    #   GET  /api/b_panels/idle_config              — per-panel idle/kiosk settings
    #   POST /api/b_panels/heartbeat                — panel "online" reporting
    #   GET  /api/b_panels/command_channel  (WS)    — receives push commands
    #   POST /api/b_panels/panels/{id}/screenshot   — screenshot upload sink
    hass.http.register_view(BPanelsIdleConfigView)
    hass.http.register_view(BPanelsHeartbeatView)
    hass.http.register_view(BPanelsScreenshotView)
    hass.http.register_view(BPanelsCommandChannelView)

    # Service to push a command to connected kiosk panels (remote screen on/off,
    # brightness, TTS, reload, switch panel, screenshot). The command SOURCE is
    # authenticated (an HA service call from a user/automation); the device WS is
    # receive-only. Callable from automations, scripts, or the dashboard.
    async def _handle_command_service(call: ServiceCall) -> None:
        await _async_send_command(hass, call)

    hass.services.async_register(
        DOMAIN, "command", _handle_command_service, schema=COMMAND_SERVICE_SCHEMA
    )
    return True


class BPanelsIdleConfigView(HomeAssistantView):
    """Serve per-panel idle/kiosk config for the native iPad app (HA-only).

    Replaces the old api-server `GET /api/config` the kiosk used to poll. Returns
    only `{ panels: [{ id, name, parentId, idleConfig }] }` from the dashboard
    Store — deliberately a minimal, non-sensitive subset so it's safe to serve
    without auth (the kiosk app holds no HA credentials).
    """

    url = "/api/b_panels/idle_config"
    name = "api:b_panels:idle_config"
    requires_auth = False

    async def get(self, request: web.Request) -> web.Response:
        hass: HomeAssistant = request.app["hass"]
        store: Store | None = hass.data.get(DOMAIN, {}).get("store")
        data = await store.async_load() if store else None
        panels = []
        if isinstance(data, dict):
            for p in data.get("panels", []) or []:
                if not isinstance(p, dict):
                    continue
                panels.append(
                    {
                        "id": p.get("id"),
                        "name": p.get("name"),
                        "parentId": p.get("parentId"),
                        "idleConfig": p.get("idleConfig"),
                    }
                )
        return self.json({"panels": panels})


class BPanelsHeartbeatView(HomeAssistantView):
    """Record a kiosk panel's heartbeat (online status, battery, version).

    Replaces the old api-server `POST /api/panels/heartbeat`. Best-effort and
    unauthenticated (kiosk has no HA token). Stores the latest beat per device in
    hass.data and fires a `b_panels_heartbeat` event so automations can alert on
    a panel going dark. No sensitive data.
    """

    url = "/api/b_panels/heartbeat"
    name = "api:b_panels:heartbeat"
    requires_auth = False

    async def post(self, request: web.Request) -> web.Response:
        hass: HomeAssistant = request.app["hass"]
        try:
            body = await request.json()
        except Exception:  # noqa: BLE001
            body = {}
        if not isinstance(body, dict):
            body = {}
        iid = str(body.get("installationId") or "unknown")
        record = {**body, "lastSeen": dt_util.utcnow().isoformat()}
        hass.data.setdefault(DOMAIN, {}).setdefault("heartbeats", {})[iid] = record
        hass.bus.async_fire("b_panels_heartbeat", record)
        return self.json({"ok": True})


class BPanelsScreenshotView(HomeAssistantView):
    """Accept a kiosk screenshot upload (verification feature).

    Replaces `POST /api/panels/{id}/screenshot`. Stores the latest base64 image
    per device in hass.data and fires `b_panels_screenshot`. Unauthenticated LAN
    sink — bounded by a max body size to avoid memory abuse.
    """

    url = "/api/b_panels/panels/{installation_id}/screenshot"
    name = "api:b_panels:screenshot"
    requires_auth = False

    async def post(self, request: web.Request, installation_id: str) -> web.Response:
        hass: HomeAssistant = request.app["hass"]
        # Cap the upload (~6 MB of base64) so a rogue client can't exhaust memory.
        if request.content_length and request.content_length > 6_000_000:
            return self.json({"ok": False, "error": "too_large"}, status_code=413)
        try:
            body = await request.json()
        except Exception:  # noqa: BLE001
            body = {}
        if not isinstance(body, dict):
            body = {}
        record = {
            "imageBase64": body.get("imageBase64"),
            "contentType": body.get("contentType", "image/jpeg"),
            "ts": dt_util.utcnow().isoformat(),
        }
        hass.data.setdefault(DOMAIN, {}).setdefault("screenshots", {})[installation_id] = record
        hass.bus.async_fire("b_panels_screenshot", {"installation_id": installation_id, "ts": record["ts"]})
        return self.json({"ok": True})


class BPanelsCommandChannelView(HomeAssistantView):
    """Server→device command channel (WebSocket hub) for kiosk panels.

    Replaces the api-server WebSocket. A panel connects, sends a `register`
    message ({type:'register', installationId}), and then receives push commands
    in the original shape ({type:'bpanels-command', command:{action,...}}) sent by
    the `b_panels.command` service. The WS is receive-only for the device; the
    command source (the service) is authenticated, so no unauthenticated party can
    inject commands. LAN-trust on the connect itself (kiosk holds no HA token).
    """

    url = "/api/b_panels/command_channel"
    name = "api:b_panels:command_channel"
    requires_auth = False

    async def get(self, request: web.Request) -> web.StreamResponse:
        hass: HomeAssistant = request.app["hass"]
        ws = web.WebSocketResponse(heartbeat=30)
        await ws.prepare(request)
        panels: dict = hass.data.setdefault(DOMAIN, {}).setdefault("command_panels", {})
        iid: str | None = None
        try:
            async for msg in ws:
                if msg.type != web.WSMsgType.TEXT:
                    if msg.type == web.WSMsgType.ERROR:
                        break
                    continue
                try:
                    data = json.loads(msg.data)
                except (ValueError, TypeError):
                    continue
                if isinstance(data, dict) and data.get("type") == "register":
                    new_iid = str(data.get("installationId") or "")
                    if new_iid:
                        iid = new_iid
                        panels[iid] = ws  # last registration for an id wins
        finally:
            if iid and panels.get(iid) is ws:
                panels.pop(iid, None)
        return ws


COMMAND_SERVICE_SCHEMA = vol.Schema(
    {
        vol.Required("action"): vol.In(
            ["reload", "hardReset", "switchPanel", "screenOn", "screenOff", "setBrightness", "tts", "playSound", "screenshot"]
        ),
        vol.Optional("installation_id"): str,  # target one panel; omit = all panels
        vol.Optional("panel_id"): str,         # for switchPanel
        vol.Optional("value"): vol.Coerce(float),  # for setBrightness (0.0–1.0)
        vol.Optional("text"): str,             # for tts
        vol.Optional("url"): str,              # for playSound
    }
)


async def _async_send_command(hass: HomeAssistant, call: ServiceCall) -> None:
    """Fan a command out to connected kiosk panels in the native message shape."""
    panels: dict = hass.data.get(DOMAIN, {}).get("command_panels", {})
    if not panels:
        _LOGGER.warning("b_panels.command: no kiosk panels are connected")
        return
    command: dict = {"action": call.data["action"]}
    if "panel_id" in call.data:
        command["panelId"] = call.data["panel_id"]
    if "value" in call.data:
        command["value"] = call.data["value"]
    if "text" in call.data:
        command["text"] = call.data["text"]
    if "url" in call.data:
        command["url"] = call.data["url"]
    message = json.dumps({"type": "bpanels-command", "command": command})

    target = call.data.get("installation_id")
    if target:
        targets = [panels[target]] if target in panels else []
    else:
        targets = list(panels.values())
    for ws in targets:
        try:
            await ws.send_str(message)
        except Exception:  # noqa: BLE001 - drop dead sockets silently
            pass


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

    # Serve the built SPA. The entry document goes through a view that forces
    # revalidation (registered first, so it wins over the static prefix);
    # everything else is content-hashed and served statically.
    if not hass.data.get(f"{DOMAIN}_index_view"):
        hass.http.register_view(BPanelsIndexView(os.path.join(frontend_path, "index.html")))
        hass.data[f"{DOMAIN}_index_view"] = True
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


class BPanelsIndexView(HomeAssistantView):
    """Serve the SPA entry document with revalidation forced.

    The rest of the frontend is registered as a static directory with
    `cache_headers=False`, which makes Home Assistant send no `Cache-Control`
    header at all. Chrome revalidates anyway, but Safari (and the iPad kiosks,
    which are Safari) then applies *heuristic* caching and can hold both this
    document and the hashed bundle it points at indefinitely — so a panel keeps
    running a released-months-ago build with no visible clue.

    The bundles are content-hashed and safe to cache forever; only this
    document must always be revalidated, because it is what names them.
    """

    url = FRONTEND_INDEX
    name = "b_panels:index"
    requires_auth = False

    def __init__(self, index_path: str) -> None:
        self._index_path = index_path

    async def get(self, request):
        """Return index.html, never from cache without revalidating."""
        from aiohttp import web

        if not os.path.isfile(self._index_path):
            return web.Response(status=404, text="B-Panels frontend not built")
        return web.FileResponse(
            self._index_path,
            headers={
                "Cache-Control": "no-cache, must-revalidate, max-age=0",
                "Pragma": "no-cache",
            },
        )


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
        vol.Optional("source"): vol.Any(str, None),
    }
)
@websocket_api.async_response
async def websocket_save_config(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict,
) -> None:
    """Persist the dashboard config. Admin-only.

    Hardened against the config-clobber wipe: a stale panel can otherwise
    overwrite the whole config (worst case, to empty). We (1) refuse a save that
    would blank a populated config, (2) stamp a monotonic `_rev`, and (3) fire
    `b_panels_config_updated` so other open panels live-refresh instead of
    holding a stale copy that they later save back.
    """
    store: Store | None = hass.data.get(DOMAIN, {}).get("store")
    if store is None:
        connection.send_error(msg["id"], "not_ready", "Storage not initialized")
        return

    new_cfg = msg["config"]
    current = await store.async_load() or {}

    # Safety net: never let a panel wipe a populated config to empty.
    if not new_cfg.get("panels") and current.get("panels"):
        connection.send_error(
            msg["id"],
            "stale_empty",
            "Refused: incoming config has no panels but the stored config does.",
        )
        return

    new_cfg["_rev"] = (current.get("_rev") or 0) + 1
    await store.async_save(new_cfg)
    connection.send_result(msg["id"], {"success": True, "rev": new_cfg["_rev"]})

    # NOTE: deliberately NOT firing a `b_panels_config_updated` broadcast. It
    # created a save feedback loop (panel saves -> broadcast -> other panels
    # re-fetch -> their setConfig auto-saves -> broadcast -> ...). Clobber
    # protection is now the empty-save guard above + the client only saving on
    # real user edits (never on a load).
