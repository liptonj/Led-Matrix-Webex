#!/usr/bin/env python3
"""
Remote Serial Bridge - RFC 2217 Server with Supabase Realtime Relay

Creates a local RFC 2217 serial server that PlatformIO can connect to,
relaying serial data through Supabase Realtime WebSocket to either:
- A browser-hosted support session (connect mode)
- An online ESP32 device (direct mode)

Usage:
    # Connect to a browser-hosted support session
    python tools/remote_serial.py connect --session <session-id> [--port 4000]

    # Connect directly to an online device
    python tools/remote_serial.py direct --device <device-uuid-or-serial> [--port 4000]

Environment Variables (auto-loaded from .env):
    NEXT_PUBLIC_SUPABASE_URL - Supabase project URL
    NEXT_PUBLIC_SUPABASE_ANON_KEY - Supabase anon key
    SUPABASE_ADMIN_EMAIL / SUPABASE_ADMIN_PASSWORD - Admin credentials
    Or use --token <jwt> flag to pass a pre-existing JWT

Example:
    # Start the bridge
    python tools/remote_serial.py connect --session abc123def456

    # In another terminal, connect PlatformIO
    pio device monitor --port rfc2217://localhost:4000
"""

import argparse
import asyncio
import base64
import json
import logging
import os
import signal
import socket
import sys
import threading
import time
from typing import Optional, Dict, Any
from urllib.parse import urlparse

try:
    import serial
    import serial.rfc2217
    import websockets
except ImportError as e:
    print(f"Error: Missing required package: {e.name}")
    print("Install with: pip install pyserial websockets")
    sys.exit(1)

try:
    import aiohttp
except ImportError:
    print("Error: Missing required package: aiohttp")
    print("Install with: pip install aiohttp")
    sys.exit(1)


# =============================================================================
# Configuration
# =============================================================================

MAX_BROADCAST_SIZE = 200 * 1024  # 200KB max per broadcast message
HEARTBEAT_INTERVAL = 30  # seconds
RECONNECT_DELAY = 5  # seconds


# =============================================================================
# Environment Variable Loading
# =============================================================================

def load_env_file(env_path: str = ".env") -> Dict[str, str]:
    """Load environment variables from .env file (simple parser, no python-dotenv required)."""
    env_vars = {}
    if not os.path.exists(env_path):
        return env_vars
    
    with open(env_path, "r") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                env_vars[key] = value
    
    return env_vars


def get_env_var(key: str, default: Optional[str] = None) -> Optional[str]:
    """Get environment variable, checking .env file first."""
    # Load .env from workspace root
    workspace_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    env_path = os.path.join(workspace_root, ".env")
    env_vars = load_env_file(env_path)
    
    # Check environment first, then .env file
    return os.environ.get(key) or env_vars.get(key, default)


# =============================================================================
# Virtual Serial Port (for RFC 2217 PortManager)
# =============================================================================

class VirtualSerialPort:
    """
    Virtual serial port that relays data through WebSocket instead of hardware.
    
    Implements the interface that serial.rfc2217.PortManager expects:
    - read() / write() for data
    - dtr / rts properties for control signals
    - baudrate property for baud rate changes
    - in_waiting property for available data
    """
    
    def __init__(self, on_data_out, on_signal_change, on_baud_change):
        self._on_data_out = on_data_out  # Callback(bytes) -> None
        self._on_signal_change = on_signal_change  # Callback(dtr, rts) -> None
        self._on_baud_change = on_baud_change  # Callback(baudrate) -> None
        
        self._dtr = False
        self._rts = False
        self._baudrate = 115200
        self._rx_buffer = bytearray()
        self._rx_lock = threading.Lock()
        
    def read(self, size: int = 1) -> bytes:
        """Read data from the virtual RX buffer."""
        with self._rx_lock:
            if len(self._rx_buffer) == 0:
                return b""
            data = bytes(self._rx_buffer[:size])
            self._rx_buffer = self._rx_buffer[size:]
            return data
    
    def write(self, data: bytes) -> int:
        """Write data (relays to WebSocket via callback)."""
        if data:
            self._on_data_out(data)
        return len(data)
    
    def feed_data(self, data: bytes):
        """Feed received data into the RX buffer (called by WebSocket handler)."""
        with self._rx_lock:
            self._rx_buffer.extend(data)
    
    @property
    def dtr(self) -> bool:
        return self._dtr
    
    @dtr.setter
    def dtr(self, value: bool):
        if self._dtr != value:
            self._dtr = value
            self._on_signal_change(self._dtr, self._rts)
    
    @property
    def rts(self) -> bool:
        return self._rts
    
    @rts.setter
    def rts(self, value: bool):
        if self._rts != value:
            self._rts = value
            self._on_signal_change(self._dtr, self._rts)
    
    @property
    def baudrate(self) -> int:
        return self._baudrate
    
    @baudrate.setter
    def baudrate(self, value: int):
        if self._baudrate != value:
            self._baudrate = value
            self._on_baud_change(value)
    
    @property
    def in_waiting(self) -> int:
        """Return number of bytes available in RX buffer."""
        with self._rx_lock:
            return len(self._rx_buffer)
    
    def get_settings(self):
        """Return current settings dict (for compatibility with real serial ports)."""
        return {
            "baudrate": self._baudrate,
            "dtr": self._dtr,
            "rts": self._rts,
        }
    
    def apply_settings(self, settings: Dict[str, Any]):
        """Apply settings dict (for compatibility with real serial ports)."""
        if "baudrate" in settings:
            self.baudrate = settings["baudrate"]
        if "dtr" in settings:
            self.dtr = settings["dtr"]
        if "rts" in settings:
            self.rts = settings["rts"]


# =============================================================================
# Phoenix Channels WebSocket Client
# =============================================================================

class PhoenixClient:
    """Phoenix Channels WebSocket client for Supabase Realtime."""
    
    def __init__(self, supabase_url: str, anon_key: str, access_token: str, channel_topic: str):
        self.supabase_url = supabase_url.rstrip("/")
        self.anon_key = anon_key
        self.access_token = access_token
        self.channel_topic = channel_topic
        
        # Extract host from URL
        parsed = urlparse(supabase_url)
        self.host = parsed.netloc or parsed.path.split("/")[0]
        
        # WebSocket connection
        self.ws: Optional[websockets.WebSocketServerProtocol] = None
        self.connected = False
        self.subscribed = False
        
        # Message tracking
        self.msg_ref = 0
        self.join_ref = 0
        
        # Event handlers
        self.on_broadcast: Optional[callable] = None
        
        # Reconnection
        self._reconnect_task: Optional[asyncio.Task] = None
        self._should_reconnect = True
        
    def build_message(self, topic: str, event: str, payload: Dict[str, Any], ref: Optional[int] = None) -> str:
        """Build a Phoenix Channels message."""
        if ref is None:
            self.msg_ref += 1
            ref = self.msg_ref
        
        msg = {
            "topic": topic,
            "event": event,
            "payload": payload,
            "ref": str(ref),
        }
        
        # Include join_ref for certain events
        if event in ("phx_join", "access_token", "broadcast", "presence", "phx_leave"):
            if self.join_ref > 0:
                msg["join_ref"] = str(self.join_ref)
        
        return json.dumps(msg)
    
    async def connect(self):
        """Connect to Supabase Realtime WebSocket."""
        ws_url = f"wss://{self.host}/realtime/v1/websocket?apikey={self.anon_key}&vsn=1.0.0"
        logging.info(f"Connecting to {ws_url.replace(self.anon_key, '<redacted>')}")
        
        try:
            self.ws = await websockets.connect(ws_url)
            self.connected = True
            logging.info("WebSocket connected")
            
            # Start receive loop
            asyncio.create_task(self._receive_loop())
            
            # Join channel
            await self.join_channel()
            
        except Exception as e:
            logging.error(f"WebSocket connection failed: {e}")
            self.connected = False
            raise
    
    async def join_channel(self):
        """Join the Phoenix channel."""
        self.join_ref += 1
        
        payload = {
            "config": {
                "broadcast": {"self": False},
                "presence": {"key": ""},
                "private": True,
            },
            "access_token": self.access_token,
        }
        
        message = self.build_message(self.channel_topic, "phx_join", payload, self.join_ref)
        await self.ws.send(message)
        logging.info(f"Sent phx_join to {self.channel_topic}")
    
    async def send_broadcast(self, event: str, payload: Dict[str, Any]):
        """Send a broadcast message on the channel."""
        if not self.connected or not self.subscribed:
            logging.warning("Cannot send broadcast: not connected/subscribed")
            return
        
        broadcast_payload = {
            "event": event,
            "payload": payload,
        }
        
        message = self.build_message(self.channel_topic, "broadcast", broadcast_payload)
        await self.ws.send(message)
    
    async def send_heartbeat(self):
        """Send heartbeat message."""
        if not self.connected:
            return
        
        message = self.build_message("phoenix", "heartbeat", {})
        await self.ws.send(message)
    
    async def _receive_loop(self):
        """Receive and handle WebSocket messages."""
        try:
            async for message in self.ws:
                try:
                    data = json.loads(message)
                    await self._handle_message(data)
                except json.JSONDecodeError as e:
                    logging.error(f"Failed to parse message: {e}")
                except Exception as e:
                    logging.error(f"Error handling message: {e}")
        except websockets.exceptions.ConnectionClosed:
            logging.warning("WebSocket connection closed")
            self.connected = False
            self.subscribed = False
            if self._should_reconnect:
                await self._reconnect()
        except Exception as e:
            logging.error(f"Receive loop error: {e}")
            self.connected = False
            self.subscribed = False
    
    async def _handle_message(self, data: Dict[str, Any]):
        """Handle incoming Phoenix message."""
        topic = data.get("topic", "")
        event = data.get("event", "")
        payload = data.get("payload", {})
        
        # Handle heartbeat reply
        if topic == "phoenix" and event == "phx_reply":
            return
        
        # Handle channel join reply
        if event == "phx_reply" and topic == self.channel_topic:
            status = payload.get("status", "error")
            if status == "ok":
                self.subscribed = True
                logging.info("Successfully joined channel")
            else:
                reason = payload.get("response", {}).get("reason", "unknown")
                logging.error(f"Join failed: {reason}")
            return
        
        # Handle broadcast events
        if event == "broadcast" and topic == self.channel_topic:
            broadcast_event = payload.get("event", "")
            broadcast_payload = payload.get("payload", {})
            
            if self.on_broadcast:
                self.on_broadcast(broadcast_event, broadcast_payload)
            return
    
    async def _reconnect(self):
        """Reconnect with exponential backoff."""
        delay = RECONNECT_DELAY
        while self._should_reconnect:
            logging.info(f"Reconnecting in {delay} seconds...")
            await asyncio.sleep(delay)
            
            try:
                await self.connect()
                return
            except Exception as e:
                logging.error(f"Reconnection failed: {e}")
                delay = min(delay * 2, 60)  # Max 60 seconds
    
    async def close(self):
        """Close WebSocket connection."""
        self._should_reconnect = False
        if self.ws:
            await self.ws.close()
        self.connected = False
        self.subscribed = False


# =============================================================================
# RFC 2217 Server with WebSocket Relay
# =============================================================================

class RemoteSerialBridge:
    """RFC 2217 server that relays serial data through Supabase Realtime."""
    
    def __init__(self, port: int, phoenix_client: PhoenixClient, mode: str, session_id: Optional[str] = None):
        self.port = port
        self.phoenix_client = phoenix_client
        self.mode = mode  # "connect" or "direct"
        self.session_id = session_id
        
        self.virtual_port = VirtualSerialPort(
            on_data_out=self._on_data_out,
            on_signal_change=self._on_signal_change,
            on_baud_change=self._on_baud_change,
        )
        
        self.rfc2217: Optional[serial.rfc2217.PortManager] = None
        self.server_socket: Optional[socket.socket] = None
        self.client_socket: Optional[socket.socket] = None
        self.alive = False
        self.shutdown_event: Optional[asyncio.Event] = None
        
        # Setup broadcast handler
        self.phoenix_client.on_broadcast = self._on_broadcast
        
        # Direct mode state
        self.device_uuid: Optional[str] = None
        self.user_uuid: Optional[str] = None
        
    async def start(self, shutdown_event: Optional[asyncio.Event] = None):
        """Start the RFC 2217 server and WebSocket client."""
        self.shutdown_event = shutdown_event
        
        # Connect WebSocket
        await self.phoenix_client.connect()
        
        # Start heartbeat task
        asyncio.create_task(self._heartbeat_loop())
        
        # Start RFC 2217 server
        await self._start_rfc2217_server()
    
    async def _heartbeat_loop(self):
        """Send periodic heartbeats."""
        while self.phoenix_client.connected:
            await asyncio.sleep(HEARTBEAT_INTERVAL)
            await self.phoenix_client.send_heartbeat()
    
    async def _start_rfc2217_server(self):
        """Start the RFC 2217 TCP server."""
        self.server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.server_socket.bind(("localhost", self.port))
        self.server_socket.listen(1)
        self.server_socket.setblocking(False)
        
        logging.info(f"RFC 2217 server listening on localhost:{self.port}")
        print(f"\n✓ RFC 2217 server ready at: rfc2217://localhost:{self.port}")
        print("  Connect PlatformIO with: pio device monitor --port rfc2217://localhost:{}\n".format(self.port))
        
        # Accept connections in event loop
        loop = asyncio.get_event_loop()
        while True:
            try:
                # Check for shutdown
                if self.shutdown_event and self.shutdown_event.is_set():
                    break
                
                # Use asyncio.wait_for to allow cancellation
                try:
                    client_socket, addr = await asyncio.wait_for(
                        loop.sock_accept(self.server_socket),
                        timeout=1.0
                    )
                    logging.info(f"Client connected from {addr[0]}:{addr[1]}")
                    await self._handle_client(client_socket)
                except asyncio.TimeoutError:
                    # Timeout is expected - check shutdown and continue
                    continue
            except asyncio.CancelledError:
                break
            except Exception as e:
                if self.shutdown_event and self.shutdown_event.is_set():
                    break
                logging.error(f"Error accepting client: {e}")
    
    async def _handle_client(self, client_socket: socket.socket):
        """Handle a single RFC 2217 client connection."""
        self.client_socket = client_socket
        self.client_socket.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        
        # Initialize RFC 2217 PortManager
        # PortManager expects (serial_instance, redirector, logger=None)
        # redirector needs write() method
        logger = logging.getLogger("rfc2217") if logging.getLogger().level == logging.DEBUG else None
        self.rfc2217 = serial.rfc2217.PortManager(
            self.virtual_port,
            self,
            logger=logger,
        )
        
        # Set initial control signals
        self.virtual_port.rts = True
        self.virtual_port.dtr = True
        
        # Send hello for connect mode
        if self.mode == "connect":
            await self.phoenix_client.send_broadcast("shim_hello", {"type": "pio_bridge"})
        
        self.alive = True
        
        # Start reader task (serial -> socket)
        reader_task = asyncio.create_task(self._reader_loop())
        
        # Start writer loop (socket -> serial)
        try:
            await self._writer_loop()
        finally:
            self.alive = False
            reader_task.cancel()
            try:
                await reader_task
            except asyncio.CancelledError:
                pass
            
            self.client_socket.close()
            self.client_socket = None
            
            # Reset control signals
            self.virtual_port.dtr = False
            self.virtual_port.rts = False
            
            logging.info("Client disconnected")
    
    async def _reader_loop(self):
        """Read from virtual port and send to RFC 2217 client."""
        while self.alive:
            try:
                data = self.virtual_port.read(self.virtual_port.in_waiting or 1)
                if data and self.client_socket and self.rfc2217:
                    # Escape IAC characters for Telnet
                    escaped = b"".join(self.rfc2217.escape(data))
                    self.client_socket.sendall(escaped)
                await asyncio.sleep(0.01)  # Small delay to prevent busy loop
            except Exception as e:
                logging.error(f"Reader loop error: {e}")
                break
    
    async def _writer_loop(self):
        """Read from RFC 2217 client and write to virtual port."""
        loop = asyncio.get_event_loop()
        while self.alive:
            try:
                data = await loop.sock_recv(self.client_socket, 1024)
                if not data:
                    break
                # Filter RFC 2217 commands
                if self.rfc2217:
                    filtered = b"".join(self.rfc2217.filter(data))
                    if filtered:
                        self.virtual_port.write(filtered)
            except Exception as e:
                logging.error(f"Writer loop error: {e}")
                break
    
    def _on_data_out(self, data: bytes):
        """Handle data written to virtual port (relay to WebSocket)."""
        if not self.phoenix_client.subscribed:
            return
        
        if self.mode == "connect":
            # Base64 encode for transmission
            data_b64 = base64.b64encode(data).decode("utf-8")
            
            # Chunk if necessary
            chunk_size = MAX_BROADCAST_SIZE // 2  # Conservative chunk size
            if len(data_b64) > chunk_size:
                # Split into chunks
                for i in range(0, len(data_b64), chunk_size):
                    chunk = data_b64[i:i + chunk_size]
                    asyncio.create_task(self.phoenix_client.send_broadcast(
                        "serial_input",
                        {"data": chunk, "binary": True, "chunk": i // chunk_size}
                    ))
            else:
                asyncio.create_task(self.phoenix_client.send_broadcast(
                    "serial_input",
                    {"data": data_b64, "binary": True}
                ))
        
        elif self.mode == "direct":
            # Parse text lines as commands
            try:
                text = data.decode("utf-8", errors="ignore").strip()
                if not text:
                    return
                
                # Try to parse as "command_name {json_params}"
                # Example: "set_brightness {\"level\": 50}"
                parts = text.split(None, 1)
                if len(parts) == 1:
                    # Just command name, no params
                    command_name = parts[0]
                    params = {}
                else:
                    command_name = parts[0]
                    try:
                        params = json.loads(parts[1])
                    except json.JSONDecodeError:
                        # If JSON parsing fails, treat entire line as command name
                        command_name = text
                        params = {}
                
                # Send command broadcast
                if self.device_uuid:
                    asyncio.create_task(self.phoenix_client.send_broadcast(
                        "command",
                        {
                            "device_uuid": self.device_uuid,
                            "command": {
                                "type": command_name,
                                "params": params
                            }
                        }
                    ))
            except Exception as e:
                logging.error(f"Failed to parse command: {e}")
    
    def _on_signal_change(self, dtr: bool, rts: bool):
        """Handle DTR/RTS signal changes."""
        if not self.phoenix_client.subscribed:
            return
        
        if self.mode == "connect":
            # Relay to support session
            asyncio.create_task(self.phoenix_client.send_broadcast(
                "signal",
                {"dtr": dtr, "rts": rts}
            ))
        elif self.mode == "direct":
            # Check for reset sequence: DTR false, RTS true then DTR false, RTS false
            # This is a common reset pattern
            if not dtr and rts:
                # Potential reset start
                pass
            elif not dtr and not rts:
                # Could be reset completion
                # Send reboot command
                if self.device_uuid:
                    asyncio.create_task(self.phoenix_client.send_broadcast(
                        "command",
                        {
                            "device_uuid": self.device_uuid,
                            "command": {
                                "type": "reboot",
                                "params": {}
                            }
                        }
                    ))
    
    def _on_baud_change(self, baudrate: int):
        """Handle baud rate changes."""
        if not self.phoenix_client.subscribed:
            return
        
        if self.mode == "connect":
            # Relay to support session
            asyncio.create_task(self.phoenix_client.send_broadcast(
                "set_baud",
                {"rate": baudrate}
            ))
        # Direct mode: acknowledge locally (no device involvement needed)
    
    def _on_broadcast(self, event: str, payload: Dict[str, Any]):
        """Handle broadcast events from WebSocket."""
        if self.mode == "connect":
            if event == "serial_output":
                # Receive serial data from browser
                data_b64 = payload.get("data", "")
                if data_b64:
                    try:
                        data = base64.b64decode(data_b64)
                        self.virtual_port.feed_data(data)
                    except Exception as e:
                        logging.error(f"Failed to decode serial_output: {e}")
            
            elif event == "baud_ack":
                # Baud rate change acknowledged
                rate = payload.get("rate")
                logging.debug(f"Baud rate acknowledged: {rate}")
        
        elif self.mode == "direct":
            if event == "debug_log":
                # Format debug log as serial output
                level = payload.get("level", "info")
                message = payload.get("message", "")
                tag = payload.get("metadata", {}).get("tag", "")
                
                # Format: [LEVEL] [tag] message\r\n
                formatted = f"[{level.upper()}]"
                if tag:
                    formatted += f" [{tag}]"
                formatted += f" {message}\r\n"
                
                self.virtual_port.feed_data(formatted.encode("utf-8"))
            
            elif event == "command":
                # Command acknowledgment (ignore for now)
                pass
    
    def write(self, data: bytes):
        """Write to TCP client socket (called by PortManager for RFC 2217 negotiation responses)."""
        if self.client_socket:
            try:
                self.client_socket.sendall(data)
            except Exception as e:
                logging.error(f"Failed to write to TCP client: {e}")


# =============================================================================
# Authentication
# =============================================================================

async def authenticate(supabase_url: str, email: str, password: str) -> str:
    """Authenticate with Supabase and get access token."""
    auth_url = f"{supabase_url.rstrip('/')}/auth/v1/token?grant_type=password"
    
    async with aiohttp.ClientSession() as session:
        async with session.post(
            auth_url,
            json={"email": email, "password": password},
            headers={"Content-Type": "application/json"},
        ) as resp:
            if resp.status != 200:
                error_text = await resp.text()
                raise Exception(f"Authentication failed: HTTP {resp.status} - {error_text}")
            
            data = await resp.json()
            return data["access_token"]


async def get_device_user_uuid(supabase_url: str, anon_key: str, device_identifier: str):
    """Get user_uuid for a device by UUID or serial number."""
    # Try to query devices table
    query_url = f"{supabase_url.rstrip('/')}/rest/v1/display.devices"
    
    async with aiohttp.ClientSession() as session:
        # Try as UUID first
        async with session.get(
            query_url,
            params={"uuid": f"eq.{device_identifier}", "select": "uuid,user_id"},
            headers={"apikey": anon_key, "Authorization": f"Bearer {anon_key}"},
        ) as resp:
            if resp.status == 200:
                data = await resp.json()
                if data and len(data) > 0:
                    return data[0]["uuid"], data[0]["user_id"]
        
        # Try as serial number
        async with session.get(
            query_url,
            params={"serial_number": f"eq.{device_identifier}", "select": "uuid,user_id"},
            headers={"apikey": anon_key, "Authorization": f"Bearer {anon_key}"},
        ) as resp:
            if resp.status == 200:
                data = await resp.json()
                if data and len(data) > 0:
                    return data[0]["uuid"], data[0]["user_id"]
    
    raise Exception(f"Device not found: {device_identifier}")


# =============================================================================
# Main
# =============================================================================

async def main_async(args):
    """Main async function."""
    # Load configuration
    supabase_url = get_env_var("NEXT_PUBLIC_SUPABASE_URL") or args.supabase_url
    anon_key = get_env_var("NEXT_PUBLIC_SUPABASE_ANON_KEY") or args.anon_key
    
    if not supabase_url or not anon_key:
        logging.error("Missing SUPABASE_URL and/or SUPABASE_ANON_KEY")
        sys.exit(1)
    
    # Get access token
    if args.token:
        access_token = args.token
    else:
        email = get_env_var("SUPABASE_ADMIN_EMAIL") or args.email
        password = get_env_var("SUPABASE_ADMIN_PASSWORD") or args.password
        
        if not email or not password:
            logging.error("Missing SUPABASE_ADMIN_EMAIL and/or SUPABASE_ADMIN_PASSWORD (or use --token)")
            sys.exit(1)
        
        logging.info("Authenticating...")
        access_token = await authenticate(supabase_url, email, password)
        logging.info("Authentication successful")
    
    # Determine channel and mode
    if args.mode == "connect":
        session_id = args.session
        if not session_id:
            logging.error("Missing --session for connect mode")
            sys.exit(1)
        
        channel_topic = f"realtime:support:{session_id}"
        
        # Create Phoenix client first
        phoenix_client = PhoenixClient(supabase_url, anon_key, access_token, channel_topic)
        bridge = RemoteSerialBridge(args.port, phoenix_client, "connect", session_id)
    
    elif args.mode == "direct":
        device_identifier = args.device
        if not device_identifier:
            logging.error("Missing --device for direct mode")
            sys.exit(1)
        
        logging.info(f"Looking up device: {device_identifier}")
        device_uuid, user_uuid = await get_device_user_uuid(supabase_url, anon_key, device_identifier)
        logging.info(f"Found device UUID: {device_uuid}, user UUID: {user_uuid}")
        
        channel_topic = f"realtime:user:{user_uuid}"
        
        # Create Phoenix client first
        phoenix_client = PhoenixClient(supabase_url, anon_key, access_token, channel_topic)
        bridge = RemoteSerialBridge(args.port, phoenix_client, "direct")
        bridge.device_uuid = device_uuid
        bridge.user_uuid = user_uuid
    
    else:
        logging.error(f"Unknown mode: {args.mode}")
        sys.exit(1)
    
    # Setup signal handlers
    shutdown_event = asyncio.Event()
    
    def signal_handler(sig, frame):
        logging.info("Shutting down...")
        shutdown_event.set()
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    # Start bridge
    try:
        # Run bridge.start() with shutdown event
        bridge_task = asyncio.create_task(bridge.start(shutdown_event))
        shutdown_task = asyncio.create_task(shutdown_event.wait())
        
        done, pending = await asyncio.wait(
            [bridge_task, shutdown_task],
            return_when=asyncio.FIRST_COMPLETED
        )
        
        # Cancel pending tasks
        for task in pending:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        
    except KeyboardInterrupt:
        logging.info("Interrupted by user")
    finally:
        await phoenix_client.close()
        if bridge.server_socket:
            bridge.server_socket.close()


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Remote Serial Bridge - RFC 2217 server with Supabase Realtime relay",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    
    subparsers = parser.add_subparsers(dest="mode", help="Operation mode")
    
    # Connect mode
    connect_parser = subparsers.add_parser("connect", help="Connect to browser-hosted support session")
    connect_parser.add_argument("--session", required=True, help="Support session ID")
    connect_parser.add_argument("--port", type=int, default=4000, help="RFC 2217 server port (default: 4000)")
    
    # Direct mode
    direct_parser = subparsers.add_parser("direct", help="Connect directly to online device")
    direct_parser.add_argument("--device", required=True, help="Device UUID or serial number")
    direct_parser.add_argument("--port", type=int, default=4000, help="RFC 2217 server port (default: 4000)")
    
    # Common options
    parser.add_argument("--supabase-url", help="Supabase URL (overrides env)")
    parser.add_argument("--anon-key", help="Supabase anon key (overrides env)")
    parser.add_argument("--email", help="Admin email (overrides env)")
    parser.add_argument("--password", help="Admin password (overrides env)")
    parser.add_argument("--token", help="Pre-existing JWT access token")
    parser.add_argument("-v", "--verbose", action="store_true", help="Enable debug logging")
    
    args = parser.parse_args()
    
    if not args.mode:
        parser.print_help()
        sys.exit(1)
    
    # Setup logging
    level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    
    # Run async main
    try:
        asyncio.run(main_async(args))
    except KeyboardInterrupt:
        logging.info("Interrupted")
        sys.exit(0)


if __name__ == "__main__":
    main()
