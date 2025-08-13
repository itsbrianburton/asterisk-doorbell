"""WebSocket API for Asterisk Doorbell integration."""
import logging
import voluptuous as vol
from typing import Dict, List, Any, Callable

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.components.websocket_api import async_register_command
from homeassistant.core import HomeAssistant

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

@callback
def async_register_websocket_commands(hass: HomeAssistant) -> None:
    """Register websocket commands."""
    async_register_command(hass, websocket_get_settings)
    async_register_command(hass, websocket_get_active_bridges)


@websocket_api.websocket_command({
    vol.Required("type"): "asterisk_doorbell/get_settings"
})
@callback
async def websocket_get_settings(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: Dict[str, Any]
) -> None:
    """Handle get settings command."""
    _LOGGER.debug("WebSocket: Get settings")

    # Initialize settings dict
    settings = {
        "host": "",
        "port": 8088,
        "websocket_port": 8089,
        "username": "",
        "password": "",
        "pjsip_domain": "",
    }

    # Find available entry configurations
    entries = hass.config_entries.async_entries(DOMAIN)

    if entries:
        # Get first entry as default
        entry = entries[0]
        entry_data = entry.data

        # Update settings from entry data
        settings.update({
            "host": entry_data.get("host", ""),
            "port": entry_data.get("port", 8088),
            "username": entry_data.get("pjsip_username", ""),
            "password": entry_data.get("pjsip_password", ""),
            "pjsip_domain": entry_data.get("host", ""),
        })

        # Get coordinator for this entry
        if entry.entry_id in hass.data.get(DOMAIN, {}):
            coordinator = hass.data[DOMAIN].get(entry.entry_id)

            # Get bridge information if available
            if coordinator and hasattr(coordinator, "bridge_names"):
                settings["bridges"] = [
                    {"id": bridge_id, "name": name}
                    for bridge_id, name in coordinator.bridge_names.items()
                ]

    connection.send_result(msg["id"], settings)


@websocket_api.websocket_command({
    vol.Required("type"): "asterisk_doorbell/get_active_bridges"
})
@callback
async def websocket_get_active_bridges(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: Dict[str, Any]
) -> None:
    """Get list of active bridges with their states."""
    _LOGGER.debug("WebSocket: Get active bridges")

    active_bridges = []

    # Scan all entries
    for entry_id, coordinator in hass.data.get(DOMAIN, {}).items():
        if hasattr(coordinator, "extension_states"):
            # Format active bridges with their states
            for bridge_id, bridge_state in coordinator.extension_states.items():
                bridge_name = coordinator.bridge_names.get(bridge_id, bridge_id)
                active_bridges.append({
                    "id": bridge_id,
                    "name": bridge_name,
                    "state": bridge_state.get("state", "inactive"),
                    "extension": bridge_state.get("extension", ""),
                })

    connection.send_result(msg["id"], active_bridges)