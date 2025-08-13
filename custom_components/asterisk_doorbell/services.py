"""Services for the Asterisk Doorbell integration."""
import logging
import voluptuous as vol

from homeassistant.core import HomeAssistant, ServiceCall, callback
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.entity_component import EntityComponent

from .const import DOMAIN, STATE_RINGING, STATE_INACTIVE

_LOGGER = logging.getLogger(__name__)

SERVICE_DIAL_INTO_BRIDGE = "dial_into_bridge"
SERVICE_CALL = "call"
SERVICE_TERMINATE = "terminate"

DIAL_INTO_BRIDGE_SCHEMA = vol.Schema(
    {
        vol.Required("bridge_id"): cv.string,
        vol.Required("endpoint"): cv.string,
    }
)

CALL_SCHEMA = vol.Schema(
    {
        vol.Required("confbridge"): cv.string,
        vol.Required("extension"): cv.string,
    }
)

TERMINATE_SCHEMA = vol.Schema(
    {
        vol.Required("confbridge"): cv.string,
    }
)


async def async_setup_services(hass: HomeAssistant) -> None:
    """Set up services for the Asterisk Doorbell integration."""

    async def handle_dial_into_bridge(call: ServiceCall) -> None:
        """Handle the dial_into_bridge service call."""
        bridge_id = call.data["bridge_id"]
        endpoint = call.data["endpoint"]

        _LOGGER.debug("Dialing %s into bridge %s", endpoint, bridge_id)

        # Find the right coordinator by looking up an entity with this bridge_id
        found_coordinator = None

        for entry_id, coordinator in hass.data[DOMAIN].items():
            if bridge_id in coordinator.confbridges:
                found_coordinator = coordinator
                break

        if not found_coordinator:
            _LOGGER.error("Bridge ID %s not found in any configured Asterisk server", bridge_id)
            return

        # Use the coordinator's ARI client to dial the endpoint into the bridge
        success = await found_coordinator.ari_client.async_dial_into_bridge(bridge_id, endpoint)

        if success:
            _LOGGER.info("Successfully dialed %s into bridge %s", endpoint, bridge_id)

            # Update the extension state to show connected
            if hasattr(found_coordinator, 'extension_states') and bridge_id in found_coordinator.extension_states:
                # Extract extension from endpoint (e.g., SIP/1001 -> 1001)
                extension_parts = endpoint.split('/')
                extension = extension_parts[1] if len(extension_parts) > 1 else endpoint

                found_coordinator.extension_states[bridge_id] = {
                    'extension': extension,
                    'state': STATE_ACTIVE
                }

                # Force data refresh
                found_coordinator.async_set_updated_data(found_coordinator.data)
        else:
            _LOGGER.error("Failed to dial %s into bridge %s", endpoint, bridge_id)

    @callback
    def handle_call(call: ServiceCall) -> None:
        """Handle the call service call when someone joins a confbridge."""
        confbridge_id = call.data["confbridge"]
        extension = call.data["extension"]

        _LOGGER.debug("Call notification: extension %s joined confbridge %s", extension, confbridge_id)

        # Find all coordinators and update the appropriate one
        for entry_id, coordinator in hass.data[DOMAIN].items():
            if confbridge_id in coordinator.confbridges:
                # Update the states in the coordinator data
                if not hasattr(coordinator, 'extension_states'):
                    coordinator.extension_states = {}

                coordinator.extension_states[confbridge_id] = {
                    'extension': extension,
                    'state': STATE_RINGING
                }

                # Attempt to dial into the bridge using the provided extension
                hass.async_create_task(
                    coordinator.ari_client.async_dial_into_bridge(
                        confbridge_id,
                        f"SIP/{extension}"
                    )
                )

                # Force data refresh
                coordinator.async_set_updated_data(coordinator.data)
                _LOGGER.info("Updated state of confbridge %s to ringing with extension %s",
                             confbridge_id, extension)

    @callback
    def handle_terminate(call: ServiceCall) -> None:
        """Handle the terminate service call when a confbridge is ended."""
        confbridge_id = call.data["confbridge"]

        _LOGGER.debug("Terminate notification: confbridge %s ended", confbridge_id)

        # Find all coordinators and update the appropriate one
        for entry_id, coordinator in hass.data[DOMAIN].items():
            if confbridge_id in coordinator.confbridges:
                # Update the states in the coordinator data
                if not hasattr(coordinator, 'extension_states'):
                    coordinator.extension_states = {}

                coordinator.extension_states[confbridge_id] = {
                    'extension': '',
                    'state': STATE_INACTIVE
                }

                # Also update data to indicate bridge is inactive
                if coordinator.data and confbridge_id in coordinator.data:
                    coordinator.data[confbridge_id] = STATE_INACTIVE

                # Force data refresh
                coordinator.async_set_updated_data(coordinator.data)
                _LOGGER.info("Updated state of confbridge %s to inactive", confbridge_id)

    # Register the services
    hass.services.async_register(
        DOMAIN,
        SERVICE_DIAL_INTO_BRIDGE,
        handle_dial_into_bridge,
        schema=DIAL_INTO_BRIDGE_SCHEMA,
    )

    hass.services.async_register(
        DOMAIN,
        SERVICE_CALL,
        handle_call,
        schema=CALL_SCHEMA,
    )

    hass.services.async_register(
        DOMAIN,
        SERVICE_TERMINATE,
        handle_terminate,
        schema=TERMINATE_SCHEMA,
    )


async def async_unload_services(hass: HomeAssistant) -> None:
    """Unload Asterisk Doorbell services."""
    if hass.services.has_service(DOMAIN, SERVICE_DIAL_INTO_BRIDGE):
        hass.services.async_remove(DOMAIN, SERVICE_DIAL_INTO_BRIDGE)

    if hass.services.has_service(DOMAIN, SERVICE_CALL):
        hass.services.async_remove(DOMAIN, SERVICE_CALL)

    if hass.services.has_service(DOMAIN, SERVICE_TERMINATE):
        hass.services.async_remove(DOMAIN, SERVICE_TERMINATE)