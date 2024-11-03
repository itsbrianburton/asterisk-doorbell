"""
Set up Websocket API Commands

These commands are used from the Settings page to manage the intercom
configuration easily
"""
import sys
from asterisk.ami import AMIClient, AutoReconnect

from homeassistant.components import websocket_api

from homeassistant.components.websocket_api import ActiveConnection, async_register_command, \
    result_message

from homeassistant.core import callback, HomeAssistant

import voluptuous as vol

from .const import DOMAIN, WEBSOCKET, DATA_STORE, DATA_SETTINGS

async def async_setup_connection(hass):

    @websocket_api.websocket_command({
        vol.Required("type"): WEBSOCKET["AMI_CONFIG"],
        vol.Required("host"): str,
        vol.Required("port"): int,
        vol.Required("username"): str,
        vol.Required("password"): str
    })
    @websocket_api.async_response
    async def handle_ami_config(hass, connection, msg):
        """Save the configuration info for the AMI service"""
        return True

    @websocket_api.websocket_command({
        vol.Required("type"): WEBSOCKET["AMI_CONNECT"],
        vol.Required("host"): str,
        vol.Required("port"): int,
        vol.Required("username"): str,
        vol.Required("password"): str
    })
    @websocket_api.async_response
    async def handle_ami_connect(hass, connection, msg):
        """Connect to the /hopefully/ running AMI service"""
        return True

    @websocket_api.websocket_command({
        vol.Required("type"): WEBSOCKET["AMI_ACTION"],
        vol.Required("action"): str,
        vol.Optional("params"): dict
    })
    @websocket_api.async_response
    async def handle_ami_action(hass, connection, msg):
        """Send actions to the AMI service and prepare the response"""
        return True

    @websocket_api.websocket_command({
        vol.Required("type"): WEBSOCKET["BROWSER_REGISTER"],
        vol.Required("browserId"): str
    })
    @websocket_api.async_response
    async def handle_browser_register(hass, connection, msg):
        # Temp response
        connection.send_message(result_message(
            msg["id"], {
                "browserId": msg["browserId"],
                "extension": 201
            }
        ))

    @websocket_api.websocket_command({
        vol.Required("type"): WEBSOCKET["BROWSER_UNREGISTER"],
        vol.Required("browserId"): str
    })
    @websocket_api.async_response
    async def handle_browser_unregister(hass, connection, msg):
        # Temp response
        connection.send_message(result_message(
            msg["id"], {
                "browserId": msg["browserId"],
                "extension": None
            }
        ))

    @websocket_api.websocket_command({
        vol.Required("type"): WEBSOCKET["INIT"]
    })
    def handle_init(hass: HomeAssistant, connection: ActiveConnection, msg):
        store = hass.data[DOMAIN][DATA_STORE]

        if store is None:
            connection.send_error(msg.id, "500", "Store not initialized")
        else:
            connection.send_message(result_message(
                msg["id"], {
                    "settings": store.get_settings().asdict(),
                    "extensions": store.get_extensions().asdict(),
                    "doorbells": store.get_doorbells().asdict()
                }
            ))

    @websocket_api.websocket_command({
        vol.Required("type"): WEBSOCKET["SETTINGS_READ"]
    })
    def handle_settings_read(hass: HomeAssistant, connection: ActiveConnection, msg):
        store = hass.data[DOMAIN][DATA_STORE]
        settings = store.get_settings()

        if settings is None:
            connection.send_error(msg.id, "404", "Not Found")
        else:
            connection.send_message(result_message(
                msg["id"], {"config": settings.asdict()}))


    @websocket_api.websocket_command({
        vol.Required("type"): WEBSOCKET["VTO_REGISTER"],
        vol.Required("ip"): str,
        vol.Optional("params"): dict
    })
    @websocket_api.async_response
    async def handle_vto_register(hass, connection, msg):
        return True

    @websocket_api.websocket_command({
        vol.Required("type"): WEBSOCKET["VTO_UNREGISTER"],
        vol.Required("ip"): str,
        vol.Optional("params"): dict
    })
    @websocket_api.async_response
    async def handle_vto_unregister(hass, connection, msg):
        return True

    async_register_command(hass, handle_ami_config)
    async_register_command(hass, handle_ami_connect)
    async_register_command(hass, handle_ami_action)
    async_register_command(hass, handle_browser_register)
    async_register_command(hass, handle_browser_unregister)
    async_register_command(hass, handle_init)
    async_register_command(hass, handle_settings_read)
    #async_register_command(hass, handle_config_update)
    async_register_command(hass, handle_vto_register)
    async_register_command(hass, handle_vto_unregister)