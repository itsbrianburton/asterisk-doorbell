DOMAIN = "asterisk_doorbell"
CLIENT = "client"

AUTO_RECONNECT = "auto_reconnect"

COMPONENT_NAME = "Asterisk Doorbell"
COMPONENT_PATH = "custom_components/%s" % DOMAIN
FRONTEND_SCRIPT_URL = "asterisk-doorbell.js"
SETTINGS_SCRIPT_URL = "asterisk-doorbell-settings.js"
SETTINGS_PANEL_URL = "asterisk-doorbell"

DEFAULT_ARI_PORT = 8088

# Service names
SERVICE_DIAL_EXTENSION = "dial_extension"
SERVICE_CALL = "call"
SERVICE_TERMINATE = "terminate"

# State names
STATE_ACTIVE = "active"
STATE_INACTIVE = "inactive"
STATE_RINGING = "ringing"

# Entity types
CONF_SENSOR_STATE = "conf_state"
CONF_SENSOR_EXTENSION = "conf_extension"

# Entity types
CONF_SENSOR = "conf_sensor"

DATA_EXTENSIONS = "extensions"
DATA_DOORBELLS = "doorbells"
DATA_SETTINGS = "settings"
DATA_STORE = "store"