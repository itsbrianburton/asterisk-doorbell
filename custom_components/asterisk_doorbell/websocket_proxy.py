"""WebSocket proxy for Asterisk Doorbell integration."""
import logging
import asyncio
import aiohttp
from aiohttp import web, WSMsgType
from typing import Optional

from homeassistant.core import HomeAssistant
from homeassistant.components.http import HomeAssistantView

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)


class AsteriskWebSocketProxyView(HomeAssistantView):
	"""WebSocket proxy to forward connections to Asterisk server."""

	url = "/api/asterisk_doorbell/ws"
	name = "api:asterisk_doorbell:websocket_proxy"
	requires_auth = False  # We'll validate through other means if needed

	def __init__(self, hass: HomeAssistant):
		"""Initialize the proxy view."""
		self.hass = hass

	async def get(self, request):
		"""Handle WebSocket upgrade and proxy to Asterisk."""
		# Get Asterisk configuration from integration settings
		asterisk_config = await self._get_asterisk_config()
		if not asterisk_config:
			return web.Response(text="Asterisk configuration not found", status=503)

		asterisk_host = asterisk_config.get("asterisk_host")
		asterisk_port = asterisk_config.get("asterisk_websocket_port", 8089)

		if not asterisk_host:
			return web.Response(text="Asterisk host not configured", status=503)

		# Upgrade to WebSocket
		ws_client = web.WebSocketResponse(protocols=['sip'])
		await ws_client.prepare(request)

		_LOGGER.debug(f"WebSocket proxy: Client connected, forwarding to ws://{asterisk_host}:{asterisk_port}/ws")

		# Connect to Asterisk WebSocket (insecure)
		asterisk_url = f"ws://{asterisk_host}:{asterisk_port}/ws"

		try:
			session = aiohttp.ClientSession()
			ws_asterisk = await session.ws_connect(
				asterisk_url,
				protocols=['sip'],
				timeout=aiohttp.ClientTimeout(total=10)
			)

			_LOGGER.debug(f"WebSocket proxy: Connected to Asterisk at {asterisk_url}")

			# Start bidirectional forwarding
			await self._proxy_websocket_messages(ws_client, ws_asterisk, session)

		except Exception as e:
			_LOGGER.error(f"WebSocket proxy: Failed to connect to Asterisk: {e}")
			await ws_client.close(code=1011, message=f"Upstream connection failed: {e}")

		return ws_client

	async def _get_asterisk_config(self) -> Optional[dict]:
		"""Get Asterisk configuration from integration."""
		try:
			# Find the first asterisk_doorbell config entry
			entries = self.hass.config_entries.async_entries(DOMAIN)
			if entries:
				entry = entries[0]
				return entry.data
			return None
		except Exception as e:
			_LOGGER.error(f"Failed to get Asterisk config: {e}")
			return None

	async def _proxy_websocket_messages(self, ws_client, ws_asterisk, session):
		"""Bidirectionally proxy messages between client and Asterisk."""

		async def forward_client_to_asterisk():
			"""Forward messages from client to Asterisk."""
			try:
				async for msg in ws_client:
					if msg.type == WSMsgType.TEXT:
						_LOGGER.debug(f"Proxy C→A: {msg.data[:100]}...")
						await ws_asterisk.send_str(msg.data)
					elif msg.type == WSMsgType.BINARY:
						_LOGGER.debug("Proxy C→A: Binary message")
						await ws_asterisk.send_bytes(msg.data)
					elif msg.type == WSMsgType.ERROR:
						_LOGGER.error(f"WebSocket client error: {ws_client.exception()}")
						break
					elif msg.type == WSMsgType.CLOSE:
						_LOGGER.debug("Client WebSocket closed")
						break
			except Exception as e:
				_LOGGER.error(f"Error forwarding client→asterisk: {e}")
			finally:
				if not ws_asterisk.closed:
					await ws_asterisk.close()

		async def forward_asterisk_to_client():
			"""Forward messages from Asterisk to client."""
			try:
				async for msg in ws_asterisk:
					if msg.type == WSMsgType.TEXT:
						_LOGGER.debug(f"Proxy A→C: {msg.data[:100]}...")
						await ws_client.send_str(msg.data)
					elif msg.type == WSMsgType.BINARY:
						_LOGGER.debug("Proxy A→C: Binary message")
						await ws_client.send_bytes(msg.data)
					elif msg.type == WSMsgType.ERROR:
						_LOGGER.error(f"WebSocket Asterisk error: {ws_asterisk.exception()}")
						break
					elif msg.type == WSMsgType.CLOSE:
						_LOGGER.debug("Asterisk WebSocket closed")
						break
			except Exception as e:
				_LOGGER.error(f"Error forwarding asterisk→client: {e}")
			finally:
				if not ws_client.closed:
					await ws_client.close()

		# Run both forwarding tasks concurrently
		try:
			await asyncio.gather(
				forward_client_to_asterisk(),
				forward_asterisk_to_client(),
				return_exceptions=True
			)
		except Exception as e:
			_LOGGER.error(f"WebSocket proxy error: {e}")
		finally:
			# Cleanup
			try:
				if not ws_client.closed:
					await ws_client.close()
				if not ws_asterisk.closed:
					await ws_asterisk.close()
				await session.close()
			except Exception as e:
				_LOGGER.error(f"Error during WebSocket cleanup: {e}")

			_LOGGER.debug("WebSocket proxy: Connection closed")


def setup_websocket_proxy(hass: HomeAssistant):
	"""Set up the WebSocket proxy."""
	proxy_view = AsteriskWebSocketProxyView(hass)
	hass.http.register_view(proxy_view)
	_LOGGER.info("WebSocket proxy registered at /api/asterisk_doorbell/ws")