from homeassistant.helpers.update_coordinator import CoordinatorEntity

from asterisk_doorbell import DOMAIN


class AsteriskDoorbellEntity(CoordinatorEntity):
	def __init__(self, coordinator, browserId, extension, name, icon=None):
		super().__init__(coordinator)
		self.browserId = browserId
		self.extension = extension
		self._name = name
		self._icon = icon

	@property
	def _data(self):
		return self.coordinator.data or {}

	@property
	def device_info(self):
		return {
			"identifiers": {(DOMAIN, self.browserId)}
		}