"""The Asterisk Doorbell integration."""
import logging
from typing import Dict

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceEntryType
import homeassistant.helpers.device_registry as dr
import homeassistant.helpers.entity_registry as er

from .const import DOMAIN, STATE_INACTIVE
from .services import async_setup_services, async_unload_services
from .view import async_setup_view
from .websocket_api import async_register_websocket_commands

_LOGGER = logging.getLogger(__name__)

PLATFORMS = ["sensor"]


async def async_setup(hass: HomeAssistant, config: Dict) -> bool:
    """Set up the Asterisk Doorbell integration."""
    # Set up services
    await async_setup_services(hass)

    # Register websocket commands
    async_register_websocket_commands(hass)

    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Asterisk Doorbell from a config entry."""
    # Store an instance of the "module" that will be available to platforms
    hass.data.setdefault(DOMAIN, {})

    # Create simple coordinator (no confbridge configuration needed)
    coordinator = GlobalAsteriskCoordinator(hass)

    await async_setup_view(hass)

    # Store the coordinator
    hass.data[DOMAIN][entry.entry_id] = coordinator

    # Set up all platforms
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # Create a single device for the integration
    await _create_integration_device(hass, entry)

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)

    # Clean up
    if unload_ok and entry.entry_id in hass.data[DOMAIN]:
        hass.data[DOMAIN].pop(entry.entry_id)

    # If this is the last config entry being removed, unload services
    if not hass.data[DOMAIN]:
        await async_unload_services(hass)

    return unload_ok


async def _create_integration_device(hass, entry):
    """Create a single device for the integration."""
    device_registry = dr.async_get(hass)
    entity_registry = er.async_get(hass)

    # Create device for the integration
    device = device_registry.async_get_or_create(
        config_entry_id=entry.entry_id,
        identifiers={(DOMAIN, entry.entry_id)},
        name="Asterisk Doorbell",
        manufacturer="Asterisk",
        model="Doorbell Integration",
        entry_type=DeviceEntryType.SERVICE,
    )

    # Create the three global sensor entities
    entity_registry.async_get_or_create(
        domain="sensor",
        platform=DOMAIN,
        unique_id=f"{entry.entry_id}_call_status",
        config_entry=entry,
        device_id=device.id,
        original_name="Asterisk Doorbell Call Status",
        suggested_object_id="asterisk_doorbell_call_status",
    )

    entity_registry.async_get_or_create(
        domain="sensor",
        platform=DOMAIN,
        unique_id=f"{entry.entry_id}_confbridge_id",
        config_entry=entry,
        device_id=device.id,
        original_name="Asterisk Doorbell Confbridge ID",
        suggested_object_id="asterisk_doorbell_confbridge_id",
    )

    entity_registry.async_get_or_create(
        domain="sensor",
        platform=DOMAIN,
        unique_id=f"{entry.entry_id}_extension",
        config_entry=entry,
        device_id=device.id,
        original_name="Asterisk Doorbell Extension",
        suggested_object_id="asterisk_doorbell_extension",
    )


class GlobalAsteriskCoordinator:
    """Global coordinator for Asterisk doorbell that manages the three sensor states."""

    def __init__(self, hass):
        """Initialize the coordinator."""
        self.hass = hass
        self._listeners = set()

        # Initialize the three global state values
        self.call_status = STATE_INACTIVE
        self.confbridge_id = ""
        self.extension = ""

    def async_add_listener(self, update_callback):
        """Add a listener for state updates."""
        self._listeners.add(update_callback)

    def async_remove_listener(self, update_callback):
        """Remove a listener."""
        self._listeners.discard(update_callback)

    def async_update_listeners(self):
        """Update all listeners."""
        for update_callback in self._listeners:
            update_callback()