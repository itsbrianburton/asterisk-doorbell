"""The Asterisk Doorbell integration."""
import logging
from datetime import timedelta
from typing import Any, Dict, List, Optional

import aiohttp

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceEntryType
import homeassistant.helpers.device_registry as dr
import homeassistant.helpers.entity_registry as er
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import DOMAIN, STATE_INACTIVE, STATE_ACTIVE, STATE_RINGING
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

    # Create ARI client
    ari_client = AsteriskARIClient(
        hass=hass,
        host=entry.data["host"],
        port=entry.data["port"],
        username=entry.data["username"],
        password=entry.data["password"],
        pjsip_username=entry.data["pjsip_username"],
        pjsip_password=entry.data["pjsip_password"],
    )

    # Extract bridge information from config entry
    confbridges = entry.data.get("confbridges", [])
    bridge_names = {bridge_id: bridge_name for bridge_id, bridge_name in confbridges}
    bridge_ids = [bridge_id for bridge_id, _ in confbridges]

    # Create update coordinator
    coordinator = AsteriskUpdateCoordinator(
        hass,
        ari_client=ari_client,
        confbridges=bridge_ids,
        bridge_names=bridge_names
    )

    await async_setup_view(hass)

    # Perform initial data update
    await coordinator.async_config_entry_first_refresh()

    # Store the coordinator
    hass.data[DOMAIN][entry.entry_id] = coordinator

    # Set up all platforms
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # Create devices for confbridges
    await _create_confbridge_devices(hass, entry, coordinator)

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


async def _create_confbridge_devices(hass, entry, coordinator):
    """Create devices and entities for confbridges."""
    device_registry = dr.async_get(hass)
    entity_registry = er.async_get(hass)

    # Get the configured confbridges
    confbridges = entry.data.get("confbridges", [])

    for bridge_id, bridge_name in confbridges:
        # Create device for this confbridge
        device = device_registry.async_get_or_create(
            config_entry_id=entry.entry_id,
            identifiers={(DOMAIN, f"{entry.entry_id}_{bridge_id}")},
            name=f"Asterisk Bridge {bridge_name}",
            manufacturer="Asterisk",
            model="Bridge",
            entry_type=DeviceEntryType.SERVICE,
        )

        # Create state sensor entity
        entity_registry.async_get_or_create(
            domain="sensor",
            platform=DOMAIN,
            unique_id=f"{entry.entry_id}_{bridge_id}_state",
            config_entry=entry,
            device_id=device.id,
            original_name=f"{bridge_name} State",
            suggested_object_id=f"{bridge_id}_state",
        )

        # Create extension sensor entity
        entity_registry.async_get_or_create(
            domain="sensor",
            platform=DOMAIN,
            unique_id=f"{entry.entry_id}_{bridge_id}_extension",
            config_entry=entry,
            device_id=device.id,
            original_name=f"{bridge_name} Extension",
            suggested_object_id=f"{bridge_id}_extension",
        )


class AsteriskARIClient:
    """Client for interacting with Asterisk ARI."""

    def __init__(self, hass: HomeAssistant, host: str, port: int, username: str, password: str,
                 pjsip_username: str, pjsip_password: str):
        """Initialize the client."""
        self.hass = hass
        self.host = host
        self.port = port
        self.username = username
        self.password = password
        self.pjsip_username = pjsip_username
        self.pjsip_password = pjsip_password
        self.auth = aiohttp.BasicAuth(username, password)
        self.bridge_names = {}  # Store bridge names for reference

    async def async_get_bridge_status(self, bridge_ids: List[str]) -> Dict[str, str]:
        """Get status of specified bridges."""
        try:
            # Get bridges from ARI
            bridges_url = f"http://{self.host}:{self.port}/ari/bridges"

            async with aiohttp.ClientSession(auth=self.auth) as session:
                async with session.get(bridges_url) as response:
                    if response.status != 200:
                        _LOGGER.error("Failed to get bridges: %s", response.status)
                        return {bridge_id: STATE_INACTIVE for bridge_id in bridge_ids}

                    bridges_data = await response.json()

                    # Create status mapping for all requested bridges
                    status = {bridge_id: STATE_INACTIVE for bridge_id in bridge_ids}

                    # Check active bridges
                    active_bridge_ids = [bridge.get("id", "") for bridge in bridges_data]

                    for bridge_id in bridge_ids:
                        if bridge_id in active_bridge_ids:
                            # Find the bridge data
                            for bridge in bridges_data:
                                if bridge.get("id", "") == bridge_id:
                                    # Check if bridge has channels (participants)
                                    channels = bridge.get("channels", [])
                                    if len(channels) > 0:
                                        status[bridge_id] = STATE_ACTIVE

                    return status

        except aiohttp.ClientError as err:
            _LOGGER.error("Error getting bridge status: %s", err)
            return {bridge_id: STATE_INACTIVE for bridge_id in bridge_ids}
        except Exception as err:
            _LOGGER.exception("Unexpected error getting bridge status: %s", err)
            return {bridge_id: STATE_INACTIVE for bridge_id in bridge_ids}

    async def async_get_bridge_detail(self, bridge_id: str) -> Dict[str, Any]:
        """Get detailed information about a specific bridge."""
        try:
            bridge_url = f"http://{self.host}:{self.port}/ari/bridges/{bridge_id}"

            async with aiohttp.ClientSession(auth=self.auth) as session:
                async with session.get(bridge_url) as response:
                    if response.status != 200:
                        _LOGGER.error("Failed to get bridge detail: %s", response.status)
                        return {}

                    return await response.json()

        except aiohttp.ClientError as err:
            _LOGGER.error("Error getting bridge detail: %s", err)
            return {}
        except Exception as err:
            _LOGGER.exception("Unexpected error getting bridge detail: %s", err)
            return {}

    async def async_dial_into_bridge(self, bridge_id: str, endpoint: str) -> bool:
        """Dial an endpoint into a bridge."""
        try:
            # First create a channel
            channel_url = f"http://{self.host}:{self.port}/ari/channels"
            channel_data = {
                "endpoint": endpoint,
                "extension": endpoint.split('/')[1] if '/' in endpoint else endpoint,
                "context": "from-internal",  # Use appropriate context
                "priority": 1
            }

            _LOGGER.debug("Creating channel with endpoint %s for bridge %s", endpoint, bridge_id)

            async with aiohttp.ClientSession(auth=self.auth) as session:
                async with session.post(channel_url, json=channel_data) as response:
                    if response.status != 200:
                        response_text = await response.text()
                        _LOGGER.error("Failed to create channel: %s - %s", response.status, response_text)
                        return False

                    channel_info = await response.json()
                    channel_id = channel_info.get("id")
                    _LOGGER.debug("Created channel with ID: %s", channel_id)

                    # Create bridge if it doesn't exist
                    bridge_url = f"http://{self.host}:{self.port}/ari/bridges/{bridge_id}"

                    # First check if bridge exists
                    async with session.get(bridge_url) as bridge_response:
                        if bridge_response.status != 200:
                            # Bridge doesn't exist, create it
                            create_bridge_url = f"http://{self.host}:{self.port}/ari/bridges"
                            bridge_create_data = {
                                "type": "mixing",
                                "bridgeId": bridge_id,
                                "name": self.bridge_names.get(bridge_id, f"Bridge {bridge_id}")
                            }

                            _LOGGER.debug("Creating bridge: %s", bridge_id)
                            async with session.post(create_bridge_url, json=bridge_create_data) as create_response:
                                if create_response.status not in (200, 201, 204):
                                    response_text = await create_response.text()
                                    _LOGGER.error("Failed to create bridge: %s - %s", create_response.status,
                                              response_text)
                                    return False

                    # Now add channel to bridge
                    add_url = f"http://{self.host}:{self.port}/ari/bridges/{bridge_id}/addChannel"
                    add_data = {
                        "channel": channel_id
                    }

                    _LOGGER.debug("Adding channel %s to bridge %s", channel_id, bridge_id)
                    async with session.post(add_url, json=add_data) as add_response:
                        if add_response.status not in (200, 204):  # No content response
                            response_text = await add_response.text()
                            _LOGGER.error("Failed to add channel to bridge: %s - %s", add_response.status,
                                      response_text)
                            return False

                        _LOGGER.info("Successfully added channel %s with endpoint %s to bridge %s",
                                 channel_id, endpoint, bridge_id)
                        return True

        except aiohttp.ClientError as err:
            _LOGGER.error("Error dialing into bridge: %s", err)
            return False
        except Exception as err:
            _LOGGER.exception("Unexpected error dialing into bridge: %s", err)
            return False


class AsteriskUpdateCoordinator(DataUpdateCoordinator):
    """Data update coordinator for Asterisk ARI."""

    def __init__(self, hass, ari_client, confbridges, bridge_names):
        """Initialize the coordinator."""
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=timedelta(seconds=30),
        )
        self.ari_client = ari_client
        self.confbridges = confbridges
        self.bridge_names = bridge_names
        self.extension_states = {}  # Store extension and state info for confbridges

        # Initialize extension states
        for bridge_id in self.confbridges:
            self.extension_states[bridge_id] = {
                'extension': '',
                'state': STATE_INACTIVE
            }

    async def _async_update_data(self):
        """Fetch data from Asterisk ARI."""
        try:
            # Check status of all bridges
            status = await self.ari_client.async_get_bridge_status(self.confbridges)

            # Check if any bridges have 'active' states from ARI but 'ringing' from service calls
            # We want to preserve the ringing state in this case
            for bridge_id, bridge_state in status.items():
                if bridge_state == STATE_ACTIVE and bridge_id in self.extension_states:
                    if self.extension_states[bridge_id]['state'] == STATE_RINGING:
                        status[bridge_id] = STATE_RINGING

            return status
        except Exception as err:
            raise UpdateFailed(f"Error communicating with Asterisk: {err}")