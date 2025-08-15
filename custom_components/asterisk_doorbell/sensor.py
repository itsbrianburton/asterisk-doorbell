"""Sensor platform for Asterisk Doorbell integration."""
import logging

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN, STATE_INACTIVE

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the three global sensors."""
    coordinator = hass.data[DOMAIN][config_entry.entry_id]

    # Create the three global sensors
    entities = [
        AsteriskCallStatusSensor(coordinator, config_entry.entry_id),
        AsteriskConfbridgeIdSensor(coordinator, config_entry.entry_id),
        AsteriskExtensionSensor(coordinator, config_entry.entry_id),
    ]

    async_add_entities(entities)


class AsteriskCallStatusSensor(SensorEntity):
    """Sensor for call status (updated last to avoid race conditions)."""

    def __init__(self, coordinator, entry_id):
        """Initialize the sensor."""
        self.coordinator = coordinator
        self._entry_id = entry_id

        self._attr_name = "Asterisk Doorbell Call Status"
        self._attr_unique_id = f"{entry_id}_call_status"

        # Link to the device created in __init__.py
        self._attr_device_info = {
            "identifiers": {(DOMAIN, entry_id)},
        }

    async def async_added_to_hass(self):
        """Register with coordinator when added to hass."""
        await super().async_added_to_hass()
        self.coordinator.async_add_listener(self.async_write_ha_state)

    async def async_will_remove_from_hass(self):
        """Unregister from coordinator when removed from hass."""
        await super().async_will_remove_from_hass()
        self.coordinator.async_remove_listener(self.async_write_ha_state)

    @property
    def native_value(self):
        """Return the call status."""
        return getattr(self.coordinator, 'call_status', STATE_INACTIVE)

    @property
    def icon(self):
        """Return the icon to use in the frontend."""
        call_status = self.native_value
        if call_status == "active":
            return "mdi:phone-in-talk"
        elif call_status == "ringing":
            return "mdi:phone-ring"
        return "mdi:phone-off"


class AsteriskConfbridgeIdSensor(SensorEntity):
    """Sensor for confbridge ID."""

    def __init__(self, coordinator, entry_id):
        """Initialize the sensor."""
        self.coordinator = coordinator
        self._entry_id = entry_id

        self._attr_name = "Asterisk Doorbell Confbridge ID"
        self._attr_unique_id = f"{entry_id}_confbridge_id"

        # Link to the device created in __init__.py
        self._attr_device_info = {
            "identifiers": {(DOMAIN, entry_id)},
        }

    async def async_added_to_hass(self):
        """Register with coordinator when added to hass."""
        await super().async_added_to_hass()
        self.coordinator.async_add_listener(self.async_write_ha_state)

    async def async_will_remove_from_hass(self):
        """Unregister from coordinator when removed from hass."""
        await super().async_will_remove_from_hass()
        self.coordinator.async_remove_listener(self.async_write_ha_state)

    @property
    def native_value(self):
        """Return the confbridge ID."""
        return getattr(self.coordinator, 'confbridge_id', "")

    @property
    def icon(self):
        """Return the icon to use in the frontend."""
        return "mdi:bridge"


class AsteriskExtensionSensor(SensorEntity):
    """Sensor for extension."""

    def __init__(self, coordinator, entry_id):
        """Initialize the sensor."""
        self.coordinator = coordinator
        self._entry_id = entry_id

        self._attr_name = "Asterisk Doorbell Extension"
        self._attr_unique_id = f"{entry_id}_extension"

        # Link to the device created in __init__.py
        self._attr_device_info = {
            "identifiers": {(DOMAIN, entry_id)},
        }

    async def async_added_to_hass(self):
        """Register with coordinator when added to hass."""
        await super().async_added_to_hass()
        self.coordinator.async_add_listener(self.async_write_ha_state)

    async def async_will_remove_from_hass(self):
        """Unregister from coordinator when removed from hass."""
        await super().async_will_remove_from_hass()
        self.coordinator.async_remove_listener(self.async_write_ha_state)

    @property
    def native_value(self):
        """Return the extension."""
        return getattr(self.coordinator, 'extension', "")

    @property
    def icon(self):
        """Return the icon to use in the frontend."""
        return "mdi:phone-dial"