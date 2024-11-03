DOMAIN = "dahua_doorbell"

CLIENT = "client"

AUTO_RECONNECT = "auto_reconnect"

PLATFORMS = [
    "binary_sensor"
]

COMPONENT_NAME = "Dahua Doorbell"
COMPONENT_PATH = "custom_components/%s" % DOMAIN
FRONTEND_SCRIPT_URL = "dahua-doorbell.js"
SETTINGS_SCRIPT_URL = "dahua-doorbell-settings.js"
SETTINGS_PANEL_URL = "dahua-doorbell"

DATA_EXTENSIONS = "extensions"
DATA_DOORBELLS = "doorbells"
DATA_SETTINGS = "settings"
DATA_STORE = "store"

WEBSOCKET = {
    "AMI_CONFIG": f"{DOMAIN}/ami/config",
    "AMI_CONNECT": f"{DOMAIN}/ami/connect",
    "AMI_ACTION": f"{DOMAIN}/ami/action",
    "AMI_DISCONNECT": f"{DOMAIN}/ami/disconnect",
    "BROWSER_REGISTER": f"{DOMAIN}/browser/register",
    "BROWSER_UNREGISTER": f"{DOMAIN}/browser/unregister",
    "INIT": f"{DOMAIN}/init",
    "SETTINGS_READ": f"{DOMAIN}/settings",
    "SETTINGS_UPDATE": f"{DOMAIN}/settings/update",
    "VTO_REGISTER": f"{DOMAIN}/vto/register",
    "VTO_UNREGISTER": f"{DOMAIN}/vto/unregister"
}

STATES = {
    "NOT_INUSE": "Not in use",
    "INUSE": "In use",
    "BUSY": "Busy",
    "UNAVAILABLE": "Unavailable",
    "RINGING": "Ringing",
    "RINGINUSE": "Ringing in use",
    "ONHOLD": "On hold",
    "UNKNOWN": "Unknown",
}

STATE_ICONS = {
    "Not in use": "mdi:phone-hangup",
    "In use": "mdi:phone-in-talk",
    "Busy": "mdi:phone-in-talk",
    "Unavailable": "mdi:phone-off",
    "Ringing": "mdi:phone-ring",
    "Ringing in use": "mdi:phone-ring",
    "On hold": "mdi:phone-paused",
    "Unknown": "mdi:phone-off",
}

PJSIP_LOADED = "pjsip_loaded"