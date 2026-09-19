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

# Websocket command types used by the SPA (services/haClient.ts).
WS_CONFIG_GET = "b_panels/config/get"
WS_CONFIG_SAVE = "b_panels/config/save"
# Server-side RSS/Atom fetch proxy (CORS-safe; SSRF-guarded) for the News tile.
WS_RSS = "b_panels/rss"
# Server-side JSON fetch proxy for the Generator tile. Unlike WS_RSS this
# deliberately allows LAN/private hosts, because generator/local-device APIs
# (e.g. an EnergyTrak/genmon poller) live on the local network. It is gated by
# Home Assistant auth (admin-only) and restricted to http(s).
WS_GENERATOR = "b_panels/generator"

# ---------------------------------------------------------------- irrigation
# GeoDrops soil probes + Rachio irrigation history. See docs/GEODROPS.md.
# Credentials live in the config entry (HA .storage), never on disk.
CONF_GEODROPS_SA = "geodrops_service_account"
CONF_GEODROPS_PROBES = "geodrops_probes"

# GeoDrops publishes on a 30-minute grid, so polling faster only burns quota.
GEODROPS_SCAN_INTERVAL_MINUTES = 30

# Rachio zone/schedule switches carry no state_class, so HA keeps NO long-term
# statistics for them: runs exist only as recorder state changes and vanish at
# the purge horizon (~10 days). We persist them ourselves or irrigation history
# is unrecoverable.
IRRIGATION_STORAGE_KEY = "b_panels.irrigation_runs"
IRRIGATION_STORAGE_VERSION = 1
IRRIGATION_RUN_RETENTION_DAYS = 730

# Attributes the irrigation entities are stamped with. The SPA groups on these
# rather than on entity_id or friendly_name, because both move when a device is
# renamed or reassigned to an area (see frontend/services/irrigationEntities.ts).
ATTR_IRR_ZONE = "bp_irrigation_zone"
ATTR_IRR_FIELD = "bp_irrigation_field"
ATTR_IRR_LABEL = "bp_irrigation_label"
ATTR_IRR_SCHEDULE_ENTITY = "bp_irrigation_schedule_entity"
ATTR_IRR_ZONE_ENTITIES = "bp_irrigation_zone_entities"
