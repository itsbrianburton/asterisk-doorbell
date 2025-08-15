"""Services for the Asterisk Doorbell integration."""
import logging
import voluptuous as vol

from homeassistant.core import HomeAssistant, ServiceCall, callback
from homeassistant.helpers import config_validation as cv

from .const import DOMAIN, STATE_RINGING, STATE_INACTIVE, STATE_ACTIVE

_LOGGER = logging.getLogger(__name__)

SERVICE_CALL = "call"
SERVICE_ANSWERED = "answered"
SERVICE_TERMINATE = "terminate"

CALL_SCHEMA = vol.Schema(
    {
        vol.Required("confbridge"): cv.string,
        vol.Required("extension"): cv.string,
    }
)

ANSWERED_SCHEMA = vol.Schema(
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

    @callback
    def handle_call(call: ServiceCall) -> None:
        """Handle the call service call when someone joins a confbridge."""
        confbridge_id = call.data["confbridge"]
        extension = call.data["extension"]

        _LOGGER.debug("Call notification: extension %s joined confbridge %s", extension, confbridge_id)

        # Update all coordinators in the correct order to avoid race conditions
        # 1. Set confbridge_id first
        # 2. Set extension second
        # 3. Set call_status last (automations trigger on this)
        for entry_id, coordinator in hass.data[DOMAIN].items():
            coordinator.confbridge_id = confbridge_id
            coordinator.async_update_listeners()  # Update confbridge_id sensor

            coordinator.extension = extension
            coordinator.async_update_listeners()  # Update extension sensor

            coordinator.call_status = STATE_RINGING
            coordinator.async_update_listeners()  # Update call_status sensor last

            _LOGGER.info("Updated state to ringing: confbridge=%s, extension=%s", confbridge_id, extension)

    @callback
    def handle_answered(call: ServiceCall) -> None:
        """Handle the answered service call when a call is answered."""
        confbridge_id = call.data["confbridge"]
        extension = call.data["extension"]

        _LOGGER.debug("Answered notification: confbridge %s answered by extension %s", confbridge_id, extension)

        # Update all coordinators in the correct order
        for entry_id, coordinator in hass.data[DOMAIN].items():
            coordinator.confbridge_id = confbridge_id
            coordinator.async_update_listeners()  # Update confbridge_id sensor

            coordinator.extension = extension
            coordinator.async_update_listeners()  # Update extension sensor

            coordinator.call_status = STATE_ACTIVE
            coordinator.async_update_listeners()  # Update call_status sensor last

            _LOGGER.info("Updated state to active: confbridge=%s, extension=%s", confbridge_id, extension)

    @callback
    def handle_terminate(call: ServiceCall) -> None:
        """Handle the terminate service call when a confbridge is ended."""
        confbridge_id = call.data["confbridge"]

        _LOGGER.debug("Terminate notification: confbridge %s ended", confbridge_id)

        # Update all coordinators in the correct order
        for entry_id, coordinator in hass.data[DOMAIN].items():
            coordinator.confbridge_id = confbridge_id
            coordinator.async_update_listeners()  # Update confbridge_id sensor

            coordinator.extension = ""
            coordinator.async_update_listeners()  # Update extension sensor

            coordinator.call_status = STATE_INACTIVE
            coordinator.async_update_listeners()  # Update call_status sensor last

            _LOGGER.info("Updated state to inactive: confbridge=%s", confbridge_id)

    # Register the services
    hass.services.async_register(
        DOMAIN,
        SERVICE_CALL,
        handle_call,
        schema=CALL_SCHEMA,
    )

    hass.services.async_register(
        DOMAIN,
        SERVICE_ANSWERED,
        handle_answered,
        schema=ANSWERED_SCHEMA,
    )

    hass.services.async_register(
        DOMAIN,
        SERVICE_TERMINATE,
        handle_terminate,
        schema=TERMINATE_SCHEMA,
    )


async def async_unload_services(hass: HomeAssistant) -> None:
    """Unload Asterisk Doorbell services."""
    services_to_remove = [SERVICE_CALL, SERVICE_ANSWERED, SERVICE_TERMINATE]

    for service in services_to_remove:
        if hass.services.has_service(DOMAIN, service):
            hass.services.async_remove(DOMAIN, service)