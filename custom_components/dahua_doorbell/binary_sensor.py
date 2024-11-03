import logging

from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity import Entity
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from . import AmiConfigEntry
from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

async def async_setup_entry(
		hass: HomeAssistant,
		config_entry: AmiConfigEntry,
		async_add_entities: AddEntitiesCallback
) -> None:
	new_devices = []

	if new_devices:
		async_add_entities(new_devices)

class ConfBridgeSensor(Entity):
	should_poll = False

	def __init__(self, device):
		self._device = device

	@property
	def device_info(self):
		return {
			"identifiers": {(DOMAIN, self._device.extension)},
			"name": f"Conf Bridge {self._device.extension}"
		}
