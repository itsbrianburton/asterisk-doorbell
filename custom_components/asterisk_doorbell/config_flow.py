"""Config flow for Asterisk Doorbell integration."""
import logging
from typing import Any, Dict

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.data_entry_flow import FlowResult

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

STEP_USER_DATA_SCHEMA = vol.Schema(
    {
        vol.Required("asterisk_host"): str,
        vol.Required("websocket_port", default=8089): int,
    }
)


class AsteriskDoorbellConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Asterisk Doorbell."""

    VERSION = 1

    async def async_step_user(self, user_input=None) -> FlowResult:
        """Handle the initial step."""
        errors = {}

        if user_input is not None:
            # Create the entry directly since no confbridge configuration is needed
            return self.async_create_entry(
                title=f"Asterisk @ {user_input['asterisk_host']}",
                data=user_input,
            )

        return self.async_show_form(
            step_id="user",
            data_schema=STEP_USER_DATA_SCHEMA,
            errors=errors,
            description_placeholders={
                "docs_url": "https://github.com/itsbrianburton/asterisk-doorbell-integration"
            },
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        """Create the options flow."""
        return AsteriskDoorbellOptionsFlow(config_entry)


class AsteriskDoorbellOptionsFlow(config_entries.OptionsFlow):
    """Asterisk Doorbell options flow."""

    def __init__(self, config_entry):
        """Initialize options flow."""
        self.config_entry = config_entry

    async def async_step_init(self, user_input=None):
        """Manage the options."""
        errors = {}

        # Set default values from current config
        default_values = {
            "asterisk_host": self.config_entry.data.get("asterisk_host", ""),
            "websocket_port": self.config_entry.data.get("websocket_port", 8089),
        }

        if user_input is not None:
            # Update the config entry
            return self.async_create_entry(
                title="",
                data=user_input,
            )

        # Create schema with default values
        schema = vol.Schema(
            {
                vol.Required("asterisk_host", default=default_values["asterisk_host"]): str,
                vol.Required("websocket_port", default=default_values["websocket_port"]): int,
            }
        )

        return self.async_show_form(
            step_id="init",
            data_schema=schema,
            errors=errors,
        )