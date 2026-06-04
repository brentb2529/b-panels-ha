"""Config flow for B-Panels.

Single-instance, no user input required. The panel and storage are global, so
one config entry is all that's ever needed; the flow exists purely so the
integration is installable from the UI (a HACS expectation).
"""

from __future__ import annotations

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult

from .const import DOMAIN, PANEL_TITLE


class BPanelsConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for B-Panels."""

    VERSION = 1

    async def async_step_user(self, user_input=None) -> ConfigFlowResult:
        """Create the single config entry."""
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()

        if user_input is None:
            return self.async_show_form(step_id="user")

        return self.async_create_entry(title=PANEL_TITLE, data={})
