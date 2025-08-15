DOMAIN = "asterisk_doorbell"

COMPONENT_NAME = "Asterisk Doorbell"
COMPONENT_PATH = "custom_components/%s" % DOMAIN
FRONTEND_SCRIPT_URL = "asterisk-doorbell.js"
SETTINGS_SCRIPT_URL = "asterisk-doorbell-settings.js"
SETTINGS_PANEL_URL = "asterisk-doorbell"

# Service names
SERVICE_CALL = "call"
SERVICE_ANSWERED = "answered"
SERVICE_TERMINATE = "terminate"

# State names
STATE_ACTIVE = "active"
STATE_INACTIVE = "inactive"
STATE_RINGING = "ringing"