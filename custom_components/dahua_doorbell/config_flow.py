import logging

from homeassistant import config_entries
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed, ConfigEntryNotReady
from typing import Any
import voluptuous as vol

from .const import DOMAIN
from .ami import AMI
from .exceptions import CannotConnect, InvalidHost, InvalidPort, InvalidAuth

_LOGGER = logging.getLogger(__name__)

DATA_SCHEMA = vol.Schema({
	vol.Required("host", default="127.0.0.1"): str,
	vol.Required("port", default=5038): int,
	vol.Required("username", default="admin"): str,
	vol.Optional("password", default=""): str
})


# Validate AMI connection input data
async def validate_input(hass: HomeAssistant, data: dict) -> dict[str, Any]:
	if len(data["host"]) < 3:
		raise InvalidHost

	if data["port"] < 1 or data["port"] > 65535:
		raise InvalidPort

	if len(data["username"]) < 1:
		raise ConfigEntryAuthFailed

	# Password is optional
	client = AMI(
		hass,
		data["host"],
		data["port"],
		data["username"],
		data["password"]
	)

	try:
		result = await client.test_connection()
	except CannotConnect as e:
		raise ConfigEntryNotReady(e)
	except InvalidAuth as e:
		raise ConfigEntryAuthFailed
	except Exception as e:
		raise ConfigEntryNotReady(e)


	return True


class ConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
	VERSION = 1
	CONNECTION_CLASS = config_entries.CONN_CLASS_LOCAL_POLL

	async def async_step_user(self, user_input=None):
		errors = {}

		if user_input is not None:
			try:
				result = await validate_input(self.hass, data=user_input)

				return self.async_create_entry(
					title="Asterisk AMI", data=user_input)
			except ConfigEntryNotReady as e:
				errors["base"] = "cannot_connect"
			except CannotConnect:
				errors["base"] = "cannot_connect"
			except InvalidHost:
				errors["host"] = "cannot_connect"
			except InvalidPort:
				errors["port"] = "cannot_connect"
			except ConfigEntryAuthFailed:
				errors["username"] = "invalid_auth"
			except Exception as e:
				_LOGGER.exception("Unexpected exception")
				errors["base"] = "unknown"

		return self.async_show_form(
			step_id="user", data_schema=DATA_SCHEMA, errors=errors
		)


