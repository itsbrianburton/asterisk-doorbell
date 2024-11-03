from .const import (
	DOMAIN
)

async def async_setup_services(hass):
	def handle_dingdong(call):

		#do something


	hass.services.async_register(DOMAIN, 'dingdong', handle_dingdong)