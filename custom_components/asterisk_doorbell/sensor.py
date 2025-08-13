"""Sensor platform for Asterisk Doorbell integration."""
import logging

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN, STATE_INACTIVE, CONF_SENSOR_STATE, CONF_SENSOR_EXTENSION

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up sensors based on a config entry."""
    coordinator = hass.data[DOMAIN][config_entry.entry_id]

    # Create entities for each bridge
    entities = []
    for bridge_id in coordinator.confbridges:
        # Add state sensor
        entities.append(
            AsteriskBridgeStateSensor(
                coordinator,
                bridge_id,
                config_entry.entry_id,
            )
        )

        # Add extension sensor
        entities.append(
            AsteriskBridgeExtensionSensor(
                coordinator,
                bridge_id,
                config_entry.entry_id,
            )
        )

    async_add_entities(entities)


class AsteriskBridgeStateSensor(CoordinatorEntity, SensorEntity):
    """Sensor for Asterisk bridge state."""

    def __init__(self, coordinator, bridge_id, entry_id):
        """Initialize the sensor."""
        super().__init__(coordinator)

        self._bridge_id = bridge_id
        self._entry_id = entry_id

        # Try to get a nicer name from coordinator bridge_names
        bridge_name = coordinator.bridge_names.get(bridge_id, bridge_id)

        self._attr_name = f"{bridge_name} State"
        self._attr_unique_id = f"{entry_id}_{bridge_id}_state"

        # Link to the device created in __init__.py
        self._attr_device_info = {
            "identifiers": {(DOMAIN, f"{entry_id}_{bridge_id}")},
        }

    @property
    def native_value(self):
        """Return the state of the sensor."""
        # First check if we have a saved state in extension_states
        if hasattr(self.coordinator, 'extension_states') and self._bridge_id in self.coordinator.extension_states:
            state = self.coordinator.extension_states[self._bridge_id]['state']
            if state:
                return state

        # Otherwise use the data from ARI (active/inactive)
        if self.coordinator.data and self._bridge_id in self.coordinator.data:
            return self.coordinator.data[self._bridge_id]

        return STATE_INACTIVE

    @property
    def icon(self):
        """Return the icon to use in the frontend."""
        if self.native_value == "active":
            return "mdi:phone-in-talk"
        elif self.native_value == "ringing":
            return "mdi:phone-ring"
        return "mdi:phone-off"

    @property
    def extra_state_attributes(self):
        """Return additional attributes about the bridge."""
        return {
            "bridge_id": self._bridge_id,
        }


class AsteriskBridgeExtensionSensor(CoordinatorEntity, SensorEntity):
    """Sensor for Asterisk bridge extension."""

    def __init__(self, coordinator, bridge_id, entry_id):
        """Initialize the sensor."""
        super().__init__(coordinator)

        self._bridge_id = bridge_id
        self._entry_id = entry_id

        # Try to get a nicer name from coordinator bridge_names
        bridge_name = coordinator.bridge_names.get(bridge_id, bridge_id)

        self._attr_name = f"{bridge_name} Extension"
        self._attr_unique_id = f"{entry_id}_{bridge_id}_extension"

        # Link to the device created in __init__.py
        self._attr_device_info = {
            "identifiers": {(DOMAIN, f"{entry_id}_{bridge_id}")},
        }

    @property
    def native_value(self):
        """Return the extension number."""
        # Get extension from coordinator data
        if hasattr(self.coordinator, 'extension_states') and self._bridge_id in self.coordinator.extension_states:
            return self.coordinator.extension_states[self._bridge_id]['extension']

        return ""

    @property
    def icon(self):
        """Return the icon to use in the frontend."""
        if self.native_value:
            return "mdi:phone-dial"
        return "mdi:phone-off"

    @property
    def extra_state_attributes(self):
        """Return additional attributes about the extension."""
        # Get associated state
        state = STATE_INACTIVE
        if hasattr(self.coordinator, 'extension_states') and self._bridge_id in self.coordinator.extension_states:
            state = self.coordinator.extension_states[self._bridge_id]['state']

        return {
            "bridge_id": self._bridge_id,
            "state": state,
        }