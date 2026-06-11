"""Constants for the B-Panels integration."""

DOMAIN = "b_panels"

# Sidebar panel
PANEL_URL_PATH = "b-panels"
PANEL_TITLE = "B-Panels"
PANEL_ICON = "mdi:view-dashboard-variant"

# Static asset mount (the built Vite SPA lives in ./frontend and is served here).
# Must match `base` in frontend/vite.config.ts.
FRONTEND_URL_BASE = "/b_panels_frontend"
FRONTEND_DIR = "frontend"
FRONTEND_INDEX = f"{FRONTEND_URL_BASE}/index.html"

# Dashboard config persistence (replaces the legacy SQLite app_config row).
STORAGE_KEY = "b_panels.dashboard_config"
STORAGE_VERSION = 1

# --- Kiosk endpoint hardening (H-2) ------------------------------------------
# The four LAN kiosk endpoints (idle_config/heartbeat/screenshot/command_channel)
# carry no HA session, so they are gated by a per-install KIOSK TOKEN instead of
# HA auth. The token is generated once and stored in the config entry's `data`
# (NOT in the dashboard config blob, so it never leaks via the open config/get).
# The native iPad app provisions it exactly like the LLAT — as a header
# (`X-BPanels-Kiosk-Token`) or a query param (`?kiosk_token=`).
CONF_KIOSK_TOKEN = "kiosk_token"
KIOSK_TOKEN_HEADER = "X-BPanels-Kiosk-Token"
KIOSK_TOKEN_QUERY = "kiosk_token"
# Heartbeat body cap (H-2): heartbeats are tiny status JSON; reject anything that
# isn't, to bound memory + event-bus abuse from an unauthenticated LAN client.
HEARTBEAT_MAX_BYTES = 64_000
# Bound the in-memory maps an unauthenticated client can grow.
MAX_TRACKED_PANELS = 256

# Websocket command types used by the SPA (services/haClient.ts).
WS_CONFIG_GET = "b_panels/config/get"
WS_CONFIG_SAVE = "b_panels/config/save"
# Returns the provisioning info (kiosk token + endpoint hints) so an ADMIN can
# provision the native iPad kiosk app. Admin-gated (never readable by the kiosk
# LLAT / non-admin session).
WS_KIOSK_INFO = "b_panels/kiosk/info"
# Server-side RSS/Atom fetch proxy (CORS-safe; SSRF-guarded) for the News tile.
WS_RSS = "b_panels/rss"
# Server-side JSON fetch proxy for the Generator tile. Unlike WS_RSS this
# deliberately allows LAN/private hosts, because generator/local-device APIs
# (e.g. an EnergyTrak/genmon poller) live on the local network. It is gated by
# Home Assistant auth (admin-only) and restricted to http(s).
WS_GENERATOR = "b_panels/generator"

# --- Panel-to-panel intercom signaling relay (feat/panel-intercom) -----------
# A thin WebRTC signaling fan-out: a panel sends a small envelope over its
# AUTHENTICATED Home Assistant websocket (the SPA's own HA session) and the
# server re-fires it as an HA event addressed to the target panel's
# `installation_id`. This is token-gated by HA auth itself (the connection must
# be an authenticated HA user) — it adds NO unauthenticated endpoint and reuses
# no LAN-token kiosk channel. It carries ONLY signaling (SDP/ICE/call control);
# it actuates NO home equipment.
WS_INTERCOM_SIGNAL = "b_panels/intercom/signal"
# The HA event the relay re-fires; every panel subscribes and filters on `to`.
EVENT_INTERCOM_SIGNAL = "b_panels_intercom_signal"
# Allowed signal kinds (presence + call-control + WebRTC negotiation). Fixed set
# so the relay can never be coerced into carrying arbitrary message types.
#   presence : lightweight roster announce (to:"*") so panels can list each other
#   invite/accept/decline/busy/bye : call control
#   ice : WebRTC ICE candidate exchange
INTERCOM_SIGNAL_KINDS = (
    "presence",
    "invite",
    "accept",
    "decline",
    "ice",
    "bye",
    "busy",
)
# Cap the signaling payload (SDP blobs are a few KB; ICE candidates tiny). Bound
# it so an authenticated-but-buggy/hostile client can't spray huge events.
INTERCOM_PAYLOAD_MAX_BYTES = 64_000
