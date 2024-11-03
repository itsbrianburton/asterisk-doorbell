"""
Many thanks to Thomas Loven's Browser Mod for the template
for using HA Store
"""

import attr
from config.custom_components.browser_mod.store import ConfigStoreData, LISTENER_STORAGE_KEY
from homeassistant.core import HomeAssistant

from homeassistant.helpers.storage import Store

from .const import DOMAIN

STORAGE_VERSION = 1

STORAGE_KEY = f"{DOMAIN}.storage"

LISTENER_STORAGE_KEY = f"{DOMAIN}.config_listeners"


@attr.s
class SettingsStoreData:
	host = attr.field(type=str, default="127.0.0.1")
	port = attr.field(type=int, default=8089)
	username = attr.field(type=str, default="admin")
	password = attr.field(type=str, default=None)

	@classmethod
	def from_dict(cls, data):
		return cls(**data)

	def asdict(self):
		return attr.asdict(self)


@attr.s
class ExtensionsStoreData:
	browserId = attr.field(type=str, default=None)
	extension = attr.field(type=int, default=None)

	@classmethod
	def from_dict(cls, data):
		return cls(**data)

	def asdict(self):
		return attr.asdict(self)


@attr.s
class DoorbellsStoreData:
	ip = attr.field(type=str, default=None)
	name = attr.field(type=str, default="Dahua Doorbell")
	extension = attr.field(type=int, default=None)
	confbridge = attr.field(type=int, default=None)
	calling = attr.field(type=bool, default=False)


	@classmethod
	def from_dict(cls, data):
		return cls(**data)

	def asdict(self):
		return attr.asdict(self)


@attr.s
class ConfigStoreData:
	settings = attr.field(type=SettingsStoreData, factory=SettingsStoreData)
	extensions = attr.field(type=dict[str:ExtensionsStoreData], factory=ExtensionsStoreData)
	doorbells = attr.field(type=dict[str:DoorbellsStoreData], factory=DoorbellsStoreData)

	@classmethod
	def from_dict(cls, data):
		settings = SettingsStoreData.from_dict(data.get("settings", {}))
		extensions = {
			k: ExtensionsStoreData.from_dict(v)
			for k, v in data.get("extensions", {}).items()
		}
		doorbells = {
			k: DoorbellsStoreData.from_dict(v)
			for k, v in data.get("doorbells", {}).items()
		}

		return cls(
			**(
				data
				| {
					"settings": settings,
					"extensions": extensions,
					"doorbells": doorbells
				}
			)
		)

	def asdict(self):
		return attr.asdict(self)


class DahuaDoorbellStore:
	def __init__(self, hass: HomeAssistant):
		self.store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
		self.listeners = []
		self.data = None
		self.dirty = False

	async def save(self):
		if self.dirty:
			await self.store.async_save(attr.asdict(self.data))

	async def load(self):
		stored = await self.store.async_load()
		if stored:
			self.data = ConfigStoreData.from_dict(stored)
		if self.data is None:
			self.data = ConfigStoreData()
			await self.save()
		self.dirty = False

	async def updated(self):
		self.dirty = True
		for listener in self.listeners:
			listener(attr.asdict(self.data))
		await self.save()

	def asdict(self):
		return self.data.asdict()

	def add_listener(self, listener):
		self.listeners.append(callback)

		def remove_listener():
			self.listeners.remove(callback)

		return remove_listener

	def get_extension(self, browserId):
		""" Retrieve current users' extension by browser ID"""
		return self.data.extensions.get(browserId, ExtensionsStoreData())

	async def set_extension(self, browserId, extension, **data):
		extension = self.data.extensions.get(browserId, ExtensionsStoreData())
		extension.__dict__.update(data)
		self.data.extensions[browserId] = extension
		await self.updated()
		
	async def delete_extension(self, browserId):
		del self.data.extensions[browserId]
		await self.updated()

	def get_config(self):
		return {
			"settings": self.data.settings,
			"extensions": self.data.extensions,
			"doorbells": self.data.doorbells
		}
	
	def get_settings(self):
		return self.data.settings
	
	def get_extensions(self):
		return self.data.extensions
	
	def get_doorbells(self):
		return self.data.doorbells

	async def set_doorbells(self, name, **data):
		doorbells = self.data.doorbells.get(name, DoorbellsStoreData())
		doorbells.__dict__.update(data)
		self.data.doorbells[name] = settings
		await self.updated()