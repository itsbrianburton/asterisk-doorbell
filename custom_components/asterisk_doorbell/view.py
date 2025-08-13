import sys
import logging

from homeassistant.components.frontend import add_extra_js_url, async_register_built_in_panel
from homeassistant.components.http import StaticPathConfig

from .const import (
    COMPONENT_NAME,
    COMPONENT_PATH,
    FRONTEND_SCRIPT_URL,
    SETTINGS_PANEL_URL,
    SETTINGS_SCRIPT_URL
)

_LOGGER = logging.getLogger(__name__)

async def async_setup_view(hass):
    _LOGGER.debug(hass.config.path(f"{COMPONENT_PATH}/dist/{FRONTEND_SCRIPT_URL}"))

    # Load the Lovelace card and session manager globally
    await hass.http.async_register_static_paths(
        [
            StaticPathConfig(
                f"/{FRONTEND_SCRIPT_URL}",
                hass.config.path(f"{COMPONENT_PATH}/dist/{FRONTEND_SCRIPT_URL}"),
                True
            ),
            StaticPathConfig(
                f"/{SETTINGS_SCRIPT_URL}",
                hass.config.path(f"{COMPONENT_PATH}/dist/{SETTINGS_SCRIPT_URL}"),
                True
            )
        ]
    )

    add_extra_js_url(hass, f"/{FRONTEND_SCRIPT_URL}")

    async_register_built_in_panel(
        hass=hass,
        component_name="custom",
        sidebar_title=COMPONENT_NAME,
        sidebar_icon="mdi:intercom",
        frontend_url_path=SETTINGS_PANEL_URL,
        require_admin=True,
        config={
            "_panel_custom": {
                "name": "asterisk-doorbell-panel",
                "js_url": f"/{SETTINGS_SCRIPT_URL}"
            }
        }
    )
