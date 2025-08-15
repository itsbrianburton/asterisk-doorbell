"""Services for the Asterisk Doorbell integration."""
import logging
import voluptuous as vol
import traceback

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
        vol.Optional("extension", default=""): cv.string,  # Make extension optional with default
    }
)


async def async_setup_services(hass: HomeAssistant) -> None:
    """Set up services for the Asterisk Doorbell integration."""

    _LOGGER.info("Setting up Asterisk Doorbell services...")
    _LOGGER.debug("DOMAIN: %s", DOMAIN)
    _LOGGER.debug("Available data keys: %s", list(hass.data.get(DOMAIN, {}).keys()))

    @callback
    def handle_call(call: ServiceCall) -> None:
        """Handle the call service call when someone joins a confbridge."""
        try:
            _LOGGER.info("=== CALL SERVICE HANDLER STARTED ===")
            _LOGGER.debug("Raw service call object: %s", call)
            _LOGGER.debug("Service call data type: %s", type(call.data))
            _LOGGER.debug("Service call data: %s", call.data)
            _LOGGER.debug("Service call context: %s", call.context)

            # Check if required fields exist
            if "confbridge" not in call.data:
                _LOGGER.error("Missing 'confbridge' field in service call data")
                return
            if "extension" not in call.data:
                _LOGGER.error("Missing 'extension' field in service call data")
                return

            confbridge_id = call.data["confbridge"]
            extension = call.data["extension"]

            _LOGGER.info("Extracted confbridge_id: '%s' (type: %s)", confbridge_id, type(confbridge_id))
            _LOGGER.info("Extracted extension: '%s' (type: %s)", extension, type(extension))

            _LOGGER.debug("Call notification: extension %s joined confbridge %s", extension, confbridge_id)

            # Check if DOMAIN exists in hass.data
            if DOMAIN not in hass.data:
                _LOGGER.error("DOMAIN '%s' not found in hass.data", DOMAIN)
                _LOGGER.debug("Available domains in hass.data: %s", list(hass.data.keys()))
                return

            coordinators = hass.data[DOMAIN]
            _LOGGER.debug("Found %d coordinators", len(coordinators))

            # Update all coordinators in the correct order to avoid race conditions
            # 1. Set confbridge_id first
            # 2. Set extension second
            # 3. Set call_status last (automations trigger on this)
            for entry_id, coordinator in coordinators.items():
                _LOGGER.debug("Updating coordinator for entry_id: %s", entry_id)

                coordinator.confbridge_id = confbridge_id
                _LOGGER.debug("Set confbridge_id to: %s", coordinator.confbridge_id)
                coordinator.async_update_listeners()  # Update confbridge_id sensor

                coordinator.extension = extension
                _LOGGER.debug("Set extension to: %s", coordinator.extension)
                coordinator.async_update_listeners()  # Update extension sensor

                coordinator.call_status = STATE_RINGING
                _LOGGER.debug("Set call_status to: %s", coordinator.call_status)
                coordinator.async_update_listeners()  # Update call_status sensor last

                _LOGGER.info("Updated state to ringing: confbridge=%s, extension=%s", confbridge_id, extension)

            _LOGGER.info("=== CALL SERVICE HANDLER COMPLETED ===")

        except Exception as e:
            _LOGGER.error("Exception in handle_call: %s", str(e))
            _LOGGER.error("Traceback: %s", traceback.format_exc())

    @callback
    def handle_answered(call: ServiceCall) -> None:
        """Handle the answered service call when a call is answered."""
        try:
            _LOGGER.info("=== ANSWERED SERVICE HANDLER STARTED ===")
            _LOGGER.debug("Raw service call object: %s", call)
            _LOGGER.debug("Service call data: %s", call.data)

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

            _LOGGER.info("=== ANSWERED SERVICE HANDLER COMPLETED ===")

        except Exception as e:
            _LOGGER.error("Exception in handle_answered: %s", str(e))
            _LOGGER.error("Traceback: %s", traceback.format_exc())

    @callback
    def handle_terminate(call: ServiceCall) -> None:
        """Handle the terminate service call when a confbridge is ended."""
        try:
            _LOGGER.info("=== TERMINATE SERVICE HANDLER STARTED ===")
            _LOGGER.debug("Raw service call object: %s", call)
            _LOGGER.debug("Service call data: %s", call.data)

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

            _LOGGER.info("=== TERMINATE SERVICE HANDLER COMPLETED ===")

        except Exception as e:
            _LOGGER.error("Exception in handle_terminate: %s", str(e))
            _LOGGER.error("Traceback: %s", traceback.format_exc())

    # Register the services
    _LOGGER.info("Registering service: %s.%s", DOMAIN, SERVICE_CALL)
    try:
        hass.services.async_register(
            DOMAIN,
            SERVICE_CALL,
            handle_call,
            schema=CALL_SCHEMA,
        )
        _LOGGER.info("Successfully registered %s.%s", DOMAIN, SERVICE_CALL)
    except Exception as e:
        _LOGGER.error("Failed to register %s.%s: %s", DOMAIN, SERVICE_CALL, str(e))

    _LOGGER.info("Registering service: %s.%s", DOMAIN, SERVICE_ANSWERED)
    try:
        hass.services.async_register(
            DOMAIN,
            SERVICE_ANSWERED,
            handle_answered,
            schema=ANSWERED_SCHEMA,
        )
        _LOGGER.info("Successfully registered %s.%s", DOMAIN, SERVICE_ANSWERED)
    except Exception as e:
        _LOGGER.error("Failed to register %s.%s: %s", DOMAIN, SERVICE_ANSWERED, str(e))

    _LOGGER.info("Registering service: %s.%s", DOMAIN, SERVICE_TERMINATE)
    try:
        hass.services.async_register(
            DOMAIN,
            SERVICE_TERMINATE,
            handle_terminate,
            schema=TERMINATE_SCHEMA,
        )
        _LOGGER.info("Successfully registered %s.%s", DOMAIN, SERVICE_TERMINATE)
    except Exception as e:
        _LOGGER.error("Failed to register %s.%s: %s", DOMAIN, SERVICE_TERMINATE, str(e))

    _LOGGER.info("All services registered successfully")


async def async_unload_services(hass: HomeAssistant) -> None:
    """Unload Asterisk Doorbell services."""
    _LOGGER.info("Unloading Asterisk Doorbell services...")

    services_to_remove = [SERVICE_CALL, SERVICE_ANSWERED, SERVICE_TERMINATE]

    for service in services_to_remove:
        if hass.services.has_service(DOMAIN, service):
            _LOGGER.debug("Removing service: %s.%s", DOMAIN, service)
            hass.services.async_remove(DOMAIN, service)
            _LOGGER.info("Successfully removed service: %s.%s", DOMAIN, service)
        else:
            _LOGGER.warning("Service %s.%s not found for removal", DOMAIN, service)