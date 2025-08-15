"""WebSocket API for Asterisk Doorbell integration."""
import logging
import voluptuous as vol
from typing import Dict, Any

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.components.websocket_api import async_register_command

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

@callback
def async_register_websocket_commands(hass: HomeAssistant) -> None:
    """Register websocket commands."""
    async_register_command(hass, websocket_get_settings)
    async_register_command(hass, websocket_get_current_state)


@websocket_api.websocket_command({
    vol.Required("type"): "asterisk_doorbell/get_settings"
})
@callback
def websocket_get_settings(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: Dict[str, Any]
) -> None:
    """Handle get settings command."""
    _LOGGER.debug("WebSocket: Get settings")

    # Initialize settings dict with correct defaults
    settings = {
        "asterisk_host": "",
        "websocket_port": 8089,
    }

    # Find available entry configurations
    entries = hass.config_entries.async_entries(DOMAIN)

    if entries:
        # Get first entry as default
        entry = entries[0]
        entry_data = entry.data

        # Update settings from entry data
        settings.update({
            "asterisk_host": entry_data.get("asterisk_host", ""),
            "websocket_port": entry_data.get("asterisk_websocket_port", 8089),
        })

        _LOGGER.debug(f"WebSocket API returning settings: {settings}")

    connection.send_result(msg["id"], settings)


@websocket_api.websocket_command({
    vol.Required("type"): "asterisk_doorbell/get_current_state"
})
@callback
def websocket_get_current_state(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: Dict[str, Any]
) -> None:
    """Get current doorbell state."""
    _LOGGER.debug("WebSocket: Get current state")

    current_state = {
        "call_status": "inactive",
        "confbridge_id": "",
        "extension": "",
    }

    # Get state from the first coordinator (there should only be one per entry)
    for entry_id, coordinator in hass.data.get(DOMAIN, {}).items():
        current_state = {
            "call_status": getattr(coordinator, 'call_status', 'inactive'),
            "confbridge_id": getattr(coordinator, 'confbridge_id', ''),
            "extension": getattr(coordinator, 'extension', ''),
        }
        break  # Only need the first one since there's one global state

    connection.send_result(msg["id"], current_state)