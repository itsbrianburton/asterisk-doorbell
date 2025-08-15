from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN


class AsteriskDoorbellEntity(CoordinatorEntity):
	def __init__(self, coordinator, entry_id, name, icon=None):
		super().__init__(coordinator)
		self.entry_id = entry_id
		self._name = name
		self._icon = icon

	@property
	def _data(self):
		return self.coordinator.data or {}

	@property
	def device_info(self):
		return {
			"identifiers": {(DOMAIN, self.entry_id)}
		}