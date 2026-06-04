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
