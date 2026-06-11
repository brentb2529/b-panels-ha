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
    CONF_KIOSK_TOKEN,
    DOMAIN,
    FRONTEND_DIR,
    FRONTEND_INDEX,
    FRONTEND_URL_BASE,
    HEARTBEAT_MAX_BYTES,
    KIOSK_TOKEN_HEADER,
    KIOSK_TOKEN_QUERY,
    MAX_TRACKED_PANELS,
    PANEL_ICON,
    PANEL_TITLE,
    PANEL_URL_PATH,
    STORAGE_KEY,
    STORAGE_VERSION,
    EVENT_CONFIG_UPDATED,
    EVENT_INTERCOM_SIGNAL,
    INTERCOM_PAYLOAD_MAX_BYTES,
    INTERCOM_SIGNAL_KINDS,
    WS_CONFIG_GET,
    WS_CONFIG_SAVE,
    WS_GENERATOR,
    WS_INTERCOM_SIGNAL,
    WS_KIOSK_INFO,
    WS_RSS,
)
from .gating import enforce_equipment_gating, evaluate_config_save, strip_secret_keys
from .kiosk_auth import (
    extract_presented_token,
    generate_kiosk_token,
    token_ok,
)

_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = vol.Schema({DOMAIN: vol.Schema({})}, extra=vol.ALLOW_EXTRA)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Set up shared resources (websocket commands) once for the integration."""
    websocket_api.async_register_command(hass, websocket_get_config)
    websocket_api.async_register_command(hass, websocket_save_config)
    websocket_api.async_register_command(hass, websocket_rss)
    websocket_api.async_register_command(hass, websocket_generator)
    websocket_api.async_register_command(hass, websocket_kiosk_info)
    websocket_api.async_register_command(hass, websocket_intercom_signal)
    # HTTP endpoints the native iPad kiosk app uses (it has no HA token, so these
    # are gated by a per-install KIOSK TOKEN — H-2 — instead of HA auth, and
    # carry only non-sensitive data). These replace the old Node api-server the
    # kiosk used to talk to:
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


def _get_kiosk_token(hass: HomeAssistant) -> str | None:
    """Return the provisioned kiosk token (from hass.data), or None."""
    return hass.data.get(DOMAIN, {}).get(CONF_KIOSK_TOKEN)


def _kiosk_authorized(hass: HomeAssistant, request: web.Request) -> bool:
    """True iff the request presents the correct kiosk token (H-2).

    Token is read from the `X-BPanels-Kiosk-Token` header or the `kiosk_token`
    query param. Fail-closed: rejects when no token is provisioned or none is
    presented. This authenticates the LAN kiosk caller; it grants no actuation.
    """
    presented = extract_presented_token(
        request.headers,
        request.query,
        header_name=KIOSK_TOKEN_HEADER,
        query_name=KIOSK_TOKEN_QUERY,
    )
    return token_ok(_get_kiosk_token(hass), presented)


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
        if not _kiosk_authorized(hass, request):
            return self.json({"error": "unauthorized"}, status_code=401)
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
        if not _kiosk_authorized(hass, request):
            return self.json({"error": "unauthorized"}, status_code=401)
        # H-2: cap the body. A heartbeat is tiny status JSON; reject anything
        # larger so an unauthenticated-then-tokened client still can't spray
        # huge payloads onto the event bus / into hass.data.
        if request.content_length and request.content_length > HEARTBEAT_MAX_BYTES:
            return self.json({"ok": False, "error": "too_large"}, status_code=413)
        try:
            raw = await request.read()
        except Exception:  # noqa: BLE001
            raw = b""
        if len(raw) > HEARTBEAT_MAX_BYTES:
            return self.json({"ok": False, "error": "too_large"}, status_code=413)
        try:
            body = json.loads(raw) if raw else {}
        except (ValueError, TypeError):
            body = {}
        if not isinstance(body, dict):
            body = {}
        iid = str(body.get("installationId") or "unknown")
        # H-2: bound what we store — only a small, known set of status fields,
        # never the attacker's whole arbitrary JSON, and cap the number of
        # tracked installations.
        record = {
            "installationId": iid,
            "online": bool(body.get("online", True)),
            "battery": body.get("battery"),
            "version": str(body.get("version"))[:64] if body.get("version") is not None else None,
            "lastSeen": dt_util.utcnow().isoformat(),
        }
        beats: dict = hass.data.setdefault(DOMAIN, {}).setdefault("heartbeats", {})
        if iid not in beats and len(beats) >= MAX_TRACKED_PANELS:
            return self.json({"ok": False, "error": "too_many_panels"}, status_code=429)
        beats[iid] = record
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
        if not _kiosk_authorized(hass, request):
            return self.json({"error": "unauthorized"}, status_code=401)
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
        shots: dict = hass.data.setdefault(DOMAIN, {}).setdefault("screenshots", {})
        if installation_id not in shots and len(shots) >= MAX_TRACKED_PANELS:
            return self.json({"ok": False, "error": "too_many_panels"}, status_code=429)
        shots[installation_id] = record
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
        # H-2: gate the WS upgrade itself with the kiosk token. Without it any
        # LAN client could open the socket and hijack a panel's command channel.
        if not _kiosk_authorized(hass, request):
            return self.json({"error": "unauthorized"}, status_code=401)
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
                    if not new_iid:
                        continue
                    # H-2 anti-hijack: do NOT let a new socket steal an id that a
                    # different live socket already holds ("last registration
                    # wins" let a LAN client intercept another panel's commands).
                    # A panel can re-register its OWN socket (idempotent) or claim
                    # an id whose previous socket is gone; it cannot displace a
                    # live one. The token already authenticates the caller; this
                    # is defence-in-depth against id collision/intercept.
                    existing = panels.get(new_iid)
                    if existing is not None and existing is not ws and not existing.closed:
                        _LOGGER.warning(
                            "b_panels command_channel: rejecting re-registration of "
                            "installationId %r — already held by a live socket",
                            new_iid,
                        )
                        try:
                            await ws.send_str(
                                json.dumps(
                                    {"type": "register-rejected", "reason": "id_in_use"}
                                )
                            )
                        except Exception:  # noqa: BLE001
                            pass
                        continue
                    if len(panels) >= MAX_TRACKED_PANELS and new_iid not in panels:
                        continue
                    iid = new_iid
                    panels[iid] = ws
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

    # H-2: provision the per-install kiosk token. Generate once and persist into
    # the config entry `data` (NOT the dashboard config blob, so the open
    # config/get can never leak it). The native iPad app provisions it the same
    # way it provisions the LLAT (header or `?kiosk_token=`). Migration is
    # transparent: an existing install with no token gets one minted here on the
    # next start, and the admin re-provisions the kiosk from b_panels/kiosk/info.
    token = entry.data.get(CONF_KIOSK_TOKEN)
    if not token:
        token = generate_kiosk_token()
        hass.config_entries.async_update_entry(
            entry, data={**entry.data, CONF_KIOSK_TOKEN: token}
        )
        _LOGGER.warning(
            "B-Panels: provisioned a new kiosk token. The four LAN kiosk "
            "endpoints (idle_config/heartbeat/screenshot/command_channel) now "
            "REQUIRE it. Provision the native iPad app with this token (header "
            "%s or ?%s=). Retrieve it via the admin-only b_panels/kiosk/info "
            "websocket command.",
            KIOSK_TOKEN_HEADER,
            KIOSK_TOKEN_QUERY,
        )
    hass.data[DOMAIN][CONF_KIOSK_TOKEN] = token

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
@websocket_api.websocket_command({vol.Required("type"): WS_KIOSK_INFO})
@websocket_api.async_response
async def websocket_kiosk_info(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict,
) -> None:
    """Return the kiosk provisioning token + hints. ADMIN-ONLY (H-2).

    The native iPad app is provisioned with this token (header
    `X-BPanels-Kiosk-Token` or `?kiosk_token=`) so it can keep calling the four
    LAN kiosk endpoints. Admin-gated so the kiosk's own (non-admin) session can
    never read it back.
    """
    connection.send_result(
        msg["id"],
        {
            "token": _get_kiosk_token(hass),
            "header": KIOSK_TOKEN_HEADER,
            "query_param": KIOSK_TOKEN_QUERY,
        },
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): WS_INTERCOM_SIGNAL,
        vol.Required("to"): str,            # target panel installation_id
        vol.Required("from"): str,          # caller panel installation_id
        vol.Required("kind"): vol.In(list(INTERCOM_SIGNAL_KINDS)),
        vol.Required("callId"): str,        # correlates a single call's messages
        vol.Optional("fromName"): vol.Any(str, None),  # caller room label (display)
        vol.Optional("payload"): vol.Any(dict, str, None),  # SDP / ICE / control
    }
)
@websocket_api.async_response
async def websocket_intercom_signal(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict,
) -> None:
    """Relay a panel-to-panel intercom signal (feat/panel-intercom).

    This is a THIN signaling fan-out for WebRTC call-setup between b-panels
    panels. The SPA is connected over its AUTHENTICATED Home Assistant
    websocket, so this command is gated by HA auth itself — no new
    unauthenticated endpoint, no LAN-token kiosk channel. It carries ONLY
    signaling (SDP/ICE/call-control) and actuates NO home equipment.

    Security posture:
      * Authenticated: only a signed-in HA session can reach this command.
      * Shape-validated + size-capped: `kind` is a fixed enum and the payload is
        bounded (SDP blobs are a few KB) so it can't be used to spray huge
        events onto the bus.
      * Addressed: the server stamps the verified envelope and re-fires it as
        the `b_panels_intercom_signal` event; every panel subscribes and only
        reacts to messages whose `to` matches its own installation_id.

    NO mic is opened here and nothing always-on is established — the receiving
    panel still requires an explicit human Accept before any audio (see the SPA
    privacy model). This is the control plane only.
    """
    payload = msg.get("payload")
    # Bound the payload size (SDP/ICE are small; reject anything large).
    try:
        approx = len(json.dumps(payload)) if payload is not None else 0
    except (TypeError, ValueError):
        connection.send_error(msg["id"], "bad_payload", "Payload is not serializable.")
        return
    if approx > INTERCOM_PAYLOAD_MAX_BYTES:
        connection.send_error(msg["id"], "payload_too_large", "Signaling payload too large.")
        return

    event = {
        "to": str(msg["to"]),
        "from": str(msg["from"]),
        "kind": msg["kind"],
        "callId": str(msg["callId"]),
        "fromName": (str(msg["fromName"])[:80] if msg.get("fromName") else None),
        "payload": payload,
    }
    hass.bus.async_fire(EVENT_INTERCOM_SIGNAL, event)
    connection.send_result(msg["id"], {"relayed": True})


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): WS_CONFIG_SAVE,
        vol.Required("config"): dict,
        vol.Optional("source"): vol.Any(str, None),
        # The `_rev` the saving panel last loaded/saw. Used to REFUSE a stale
        # overwrite: if the stored `_rev` has advanced past this, another panel
        # saved newer edits and this save would clobber them. Omit (or None) to
        # opt out (legacy clients) — the empty-guard still protects them.
        vol.Optional("client_rev"): vol.Any(int, None),
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

    Inc 11 defense-in-depth (no actuation enabled by either):
      - force `gatingFlags.equipmentGated=true` on always-gated tile types and
        log if a client tried to clear it;
      - strip any plaintext secret key from connections (H-1) so the open
        `config/get` read can never leak a credential.
    """
    store: Store | None = hass.data.get(DOMAIN, {}).get("store")
    if store is None:
        connection.send_error(msg["id"], "not_ready", "Storage not initialized")
        return

    new_cfg = msg["config"]
    current = await store.async_load() or {}
    stored_rev = current.get("_rev") or 0

    # Config-clobber guards (empty-over-populated + stale-rev). Pure decision in
    # gating.evaluate_config_save so it is unit-testable without a live socket.
    verdict = evaluate_config_save(new_cfg, current, msg.get("client_rev"))
    if verdict["action"] == "refuse":
        if verdict["code"] == "stale_rev":
            _LOGGER.warning(
                "b_panels config/save: refused a STALE save (client_rev=%s < stored _rev=%s); "
                "a newer config exists. The stale panel must re-fetch before saving.",
                msg.get("client_rev"),
                stored_rev,
            )
        connection.send_error(msg["id"], verdict["code"], verdict["message"])
        return

    # Defense-in-depth: re-force equipment gating + strip secrets before persist.
    forced = enforce_equipment_gating(new_cfg)
    if forced:
        _LOGGER.warning(
            "b_panels config/save: re-forced equipmentGated on %d always-gated "
            "tile(s) that arrived without it (client may have tried to clear "
            "the safety flag)",
            forced,
        )
    stripped = strip_secret_keys(new_cfg)
    if stripped:
        _LOGGER.warning(
            "b_panels config/save: stripped %d plaintext secret field(s) from "
            "connections before persisting (config/get is non-admin readable)",
            stripped,
        )

    new_cfg["_rev"] = verdict["next_rev"]
    await store.async_save(new_cfg)
    connection.send_result(msg["id"], {"success": True, "rev": new_cfg["_rev"]})

    # Config-updated broadcast: tell every OTHER open panel a newer config exists
    # so it re-fetches + reapplies in React (and version-reloads on the `_rev`
    # bump) rather than holding a stale copy it could later save back over the
    # newer one (the clobber/wipe cause). The original feedback-loop risk (panel
    # saves -> broadcast -> other panels re-fetch -> auto-save -> broadcast -> …)
    # is broken on BOTH ends now: (1) the SPA ignores the broadcast carrying its
    # OWN `source` id, and (2) a config that came from a load never triggers a
    # save (justLoadedRef). So this is safe and is the missing live-sync half.
    source = msg.get("source")
    hass.bus.async_fire(
        EVENT_CONFIG_UPDATED,
        {"rev": new_cfg["_rev"], "source": source},
    )
