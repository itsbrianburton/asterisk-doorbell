"""Config flow for Asterisk Doorbell integration."""
import logging
from typing import Any, Dict, List, Tuple

import aiohttp
import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers import selector

from .const import DOMAIN, DEFAULT_ARI_PORT

_LOGGER = logging.getLogger(__name__)

STEP_USER_DATA_SCHEMA = vol.Schema(
    {
        vol.Required("host"): str,
        vol.Required("port", default=DEFAULT_ARI_PORT): int,
        vol.Required("username"): str,
        vol.Required("password"): str,
        vol.Required("pjsip_username"): str,
        vol.Required("pjsip_password"): str,
    }
)


class AsteriskDoorbellConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Asterisk Doorbell."""

    VERSION = 1

    def __init__(self):
        """Initialize the config flow."""
        self.ari_data = None
        self.confbridges = []

    async def async_step_user(self, user_input=None) -> FlowResult:
        """Handle the initial step."""
        errors = {}

        # Set default values
        default_values = {
            "host": "",
            "port": DEFAULT_ARI_PORT,
            "username": "",
            "password": "",
            "pjsip_username": "",
            "pjsip_password": "",
        }

        # Update with existing user input if available
        if user_input is not None:
            default_values.update(user_input)

            # Validate the connection to Asterisk ARI
            host = user_input["host"]
            port = user_input["port"]
            username = user_input["username"]
            password = user_input["password"]
            pjsip_username = user_input["pjsip_username"]
            pjsip_password = user_input["pjsip_password"]

            # Test ARI connection
            valid = await self.test_ari_connection(host, port, username, password)

            if valid:
                # Store the ARI data for later use
                self.ari_data = user_input

                # Proceed to the manual bridge configuration step
                return await self.async_step_manual_bridges()
            else:
                errors["base"] = "cannot_connect"

        # Create schema with default values
        schema = vol.Schema(
            {
                vol.Required("host", default=default_values["host"]): str,
                vol.Required("port", default=default_values["port"]): int,
                vol.Required("username", default=default_values["username"]): str,
                vol.Required("password", default=default_values["password"]): str,
                vol.Required("pjsip_username", default=default_values["pjsip_username"]): str,
                vol.Required("pjsip_password", default=default_values["pjsip_password"]): str,
            }
        )

        return self.async_show_form(
            step_id="user",
            data_schema=schema,
            errors=errors,
        )

    async def async_step_manual_bridges(self, user_input=None) -> FlowResult:
        """Handle the manual bridge configuration step."""
        errors = {}

        if user_input is not None:
            # Process the bridge configurations
            confbridges = []

            # Extract bridge configurations from user input
            for i in range(1, 6):  # Support up to 5 bridges
                bridge_id = user_input.get(f"bridge_id_{i}")
                bridge_name = user_input.get(f"bridge_name_{i}")

                if bridge_id and bridge_name:
                    confbridges.append((bridge_id, bridge_name))

            # Store confbridges and complete setup
            return self.async_create_entry(
                title=f"Asterisk @ {self.ari_data['host']}",
                data={
                    **self.ari_data,
                    "confbridges": confbridges,
                },
            )

        # Create schema for manual bridge configuration
        schema = vol.Schema(
            {
                vol.Optional("bridge_id_1"): str,
                vol.Optional("bridge_name_1", default="Conference 1"): str,
                vol.Optional("bridge_id_2"): str,
                vol.Optional("bridge_name_2", default="Conference 2"): str,
                vol.Optional("bridge_id_3"): str,
                vol.Optional("bridge_name_3", default="Conference 3"): str,
                vol.Optional("bridge_id_4"): str,
                vol.Optional("bridge_name_4", default="Conference 4"): str,
                vol.Optional("bridge_id_5"): str,
                vol.Optional("bridge_name_5", default="Conference 5"): str,
            }
        )

        return self.async_show_form(
            step_id="manual_bridges",
            data_schema=schema,
            errors=errors,
            description_placeholders={
                "host": self.ari_data["host"],
            },
        )

    async def test_ari_connection(self, host: str, port: int, username: str, password: str) -> bool:
        """Test connection to Asterisk ARI."""
        try:
            _LOGGER.debug("Testing connection to Asterisk ARI at %s:%s", host, port)

            # Create basic auth for ARI
            auth = aiohttp.BasicAuth(username, password)

            # Try to connect to ARI ping endpoint to check if ARI is accessible
            ping_url = f"http://{host}:{port}/ari/asterisk/ping"

            _LOGGER.debug("Connecting to ARI ping endpoint: %s", ping_url)

            async with aiohttp.ClientSession(auth=auth) as session:
                async with session.get(ping_url) as response:
                    _LOGGER.debug("ARI response status: %s", response.status)

                    if response.status == 200:
                        return True
                    else:
                        _LOGGER.error("Failed to connect to ARI: %s", response.status)
                        return False

        except aiohttp.ClientError as err:
            _LOGGER.error("Error connecting to Asterisk ARI: %s", err)
            return False
        except Exception as err:
            _LOGGER.exception("Unexpected error connecting to Asterisk ARI: %s (%s)",
                             err, type(err).__name__)
            return False

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
        self.ari_data = dict(config_entry.data)
        self.confbridges = []

    async def async_step_init(self, user_input=None):
        """Manage the options."""
        errors = {}

        # Set default values from current config
        default_values = {
            "host": self.ari_data.get("host", ""),
            "port": self.ari_data.get("port", DEFAULT_ARI_PORT),
            "username": self.ari_data.get("username", ""),
            "password": self.ari_data.get("password", ""),
            "pjsip_username": self.ari_data.get("pjsip_username", ""),
            "pjsip_password": self.ari_data.get("pjsip_password", ""),
        }

        if user_input is not None:
            # Update defaults with current input
            default_values.update(user_input)

            # Try to validate the connection
            valid = await self.test_ari_connection(
                default_values["host"],
                default_values["port"],
                default_values["username"],
                default_values["password"]
            )

            if valid:
                self.ari_data.update(default_values)
                return await self.async_step_edit_bridges()
            else:
                errors["base"] = "cannot_connect"

        # Create schema with default values
        schema = vol.Schema(
            {
                vol.Required("host", default=default_values["host"]): str,
                vol.Required("port", default=default_values["port"]): int,
                vol.Required("username", default=default_values["username"]): str,
                vol.Required("password", default=default_values["password"]): str,
                vol.Required("pjsip_username", default=default_values["pjsip_username"]): str,
                vol.Required("pjsip_password", default=default_values["pjsip_password"]): str,
            }
        )

        return self.async_show_form(
            step_id="init",
            data_schema=schema,
            errors=errors,
        )

    async def async_step_edit_bridges(self, user_input=None) -> FlowResult:
        """Handle editing bridge configurations."""
        errors = {}

        # Get current bridges
        current_bridges = self.config_entry.data.get("confbridges", [])

        if user_input is not None:
            # Process the bridge configurations
            confbridges = []

            # Extract bridge configurations from user input
            for i in range(1, 6):  # Support up to 5 bridges
                bridge_id = user_input.get(f"bridge_id_{i}")
                bridge_name = user_input.get(f"bridge_name_{i}")

                if bridge_id and bridge_name:
                    confbridges.append((bridge_id, bridge_name))

            # Store confbridges and complete setup
            return self.async_create_entry(
                title="",
                data={
                    **self.ari_data,
                    "confbridges": confbridges,
                },
            )

        # Prepare defaults based on existing bridges
        defaults = {}
        for i, (bridge_id, bridge_name) in enumerate(current_bridges[:5], 1):
            defaults[f"bridge_id_{i}"] = bridge_id
            defaults[f"bridge_name_{i}"] = bridge_name

        # Create schema for bridge configuration
        schema = vol.Schema(
            {
                vol.Optional("bridge_id_1", default=defaults.get("bridge_id_1", "")): str,
                vol.Optional("bridge_name_1", default=defaults.get("bridge_name_1", "Conference 1")): str,
                vol.Optional("bridge_id_2", default=defaults.get("bridge_id_2", "")): str,
                vol.Optional("bridge_name_2", default=defaults.get("bridge_name_2", "Conference 2")): str,
                vol.Optional("bridge_id_3", default=defaults.get("bridge_id_3", "")): str,
                vol.Optional("bridge_name_3", default=defaults.get("bridge_name_3", "Conference 3")): str,
                vol.Optional("bridge_id_4", default=defaults.get("bridge_id_4", "")): str,
                vol.Optional("bridge_name_4", default=defaults.get("bridge_name_4", "Conference 4")): str,
                vol.Optional("bridge_id_5", default=defaults.get("bridge_id_5", "")): str,
                vol.Optional("bridge_name_5", default=defaults.get("bridge_name_5", "Conference 5")): str,
            }
        )

        return self.async_show_form(
            step_id="edit_bridges",
            data_schema=schema,
            errors=errors,
            description_placeholders={
                "host": self.ari_data["host"],
            },
        )

    async def test_ari_connection(self, host: str, port: int, username: str, password: str) -> bool:
        """Test connection to Asterisk ARI."""
        try:
            _LOGGER.debug("Testing connection to Asterisk ARI at %s:%s", host, port)

            # Create basic auth for ARI
            auth = aiohttp.BasicAuth(username, password)

            # Try to connect to ARI ping endpoint to check if ARI is accessible
            ping_url = f"http://{host}:{port}/ari/asterisk/ping"

            _LOGGER.debug("Connecting to ARI ping endpoint: %s", ping_url)

            async with aiohttp.ClientSession(auth=auth) as session:
                async with session.get(ping_url) as response:
                    _LOGGER.debug("ARI response status: %s", response.status)

                    if response.status == 200:
                        return True
                    else:
                        _LOGGER.error("Failed to connect to ARI: %s", response.status)
                        return False

        except aiohttp.ClientError as err:
            _LOGGER.error("Error connecting to Asterisk ARI: %s", err)
            return False
        except Exception as err:
            _LOGGER.exception("Unexpected error connecting to Asterisk ARI: %s (%s)",
                             err, type(err).__name__)
            return False