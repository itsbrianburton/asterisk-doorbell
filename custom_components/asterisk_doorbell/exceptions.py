from homeassistant import exceptions

class CannotConnect(exceptions.HomeAssistantError):
	"""Error to indicate we cannot connect."""


class InvalidHost(exceptions.HomeAssistantError):
	"""Error to indicate there is an invalid hostname."""


class InvalidPort(exceptions.HomeAssistantError):
	"""Error to indicate there is an invalid port."""


class InvalidAuth(exceptions.HomeAssistantError):
	"""Error to indicate there is an invalid username/credentials."""
