import sys
import json
from asterisk.ami import AMIClient

from homeassistant.core import HomeAssistant

from .exceptions import CannotConnect, InvalidAuth

class AMI:
	def __init__(self, hass: HomeAssistant, host: str, port: int, username: str, password: str) -> None:
		self._host = host
		self._port = port
		self._username = username
		self._password = password
		self._hass = hass

		self.clients = []
		self.vtos = []

	async def test_connection(self) -> bool:
		"""
		Method used to test connection to Asterisk server
		during setup and reconfiguration
		"""
		client = AMIClient(
			address=self._host,
			port=self._port
		)

		try:
			result = client.login(
				username=self._username,
				secret=self._password
			)

			if result.response.is_error():
				if result.response.keys["Message"] == "Authentication failed":
					raise InvalidAuth
				else:
					raise CannotConnect(result.response.keys["Message"])
		except ConnectionRefusedError:
			raise CannotConnect
		except Exception as e:
			raise CannotConnect(e)

		return True

class BrowserModClient:
	def __init__(self, browser_id: str, extension: int, ami: AMI) -> None:
		self._id = browser_id
		self._extension = extension
		self.ami = ami

	@property
	def id(self) -> str:
		return self._id

class DahuaVTOClient:
	def __init__(self, extension: int, name: str, ami: AMI) -> None:
		self._id = extension
		self._extension = extension
		self._name = name
		self.ami = ami

	@property
	def id(self) -> str:
		return self._id