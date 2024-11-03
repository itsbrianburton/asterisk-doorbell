"""
Integration setup
"""

import logging


from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .ami import AMI
from .connection import async_setup_connection
from .const import AUTO_RECONNECT, CLIENT, DATA_STORE, DATA_EXTENSIONS, DATA_DOORBELLS, DATA_SETTINGS, DOMAIN, PLATFORMS, PJSIP_LOADED
from .service import async_setup_services
from .store import DahuaDoorbellStore
from .view import async_setup_view


_LOGGER = logging.getLogger(__name__)

# Our AMI Config Entry to store connection details
type AmiConfigEntry = ConfigEntry[AMI]

async def async_setup(hass: HomeAssistant, config: any) -> bool:
    config_store = DahuaDoorbellStore(hass)
    await config_store.load()

    hass.data[DOMAIN] = {
        DATA_DOORBELLS: {},
        DATA_SETTINGS: {},
        DATA_EXTENSIONS: {},
        DATA_STORE: config_store
    }

    f = open()

    return True

"""
Set up the Config Entry
"""
async def async_setup_entry(hass: HomeAssistant, entry: AmiConfigEntry) -> bool:
    """
    Store an instance of the AMI class
    """
    entry.runtime_data = AMI(
        hass,
        entry.data["host"],
        entry.data["port"],
        entry.data["username"],
        entry.data["password"]
    )

    # Load our platforms
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # Inject card and settings JS and set up Settings menu
    await async_setup_view(hass)

    # Set up Websocket commands
    await async_setup_connection(hass)

    # Services
    await async_setup_services(hass)

    return True

"""
Unload the config entry when an entry/configured device is to be
removed.
"""
async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    result = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)

    return result