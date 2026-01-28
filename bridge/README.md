# Webex Bridge Server

WebSocket relay server that connects Webex Embedded Apps to ESP32 displays. The embedded app (running in Webex) handles all Webex SDK/presence logic and sends status updates through this bridge to the display.

## Features

- **WebSocket Server**: Real-time bidirectional communication between Webex apps and ESP32 displays
- **mDNS Discovery**: Automatic service discovery on local networks
- **Device Pairing**: Room-based pairing using alphanumeric codes
- **Device Registration**: Persistent storage of registered devices
- **Command Relay**: Bidirectional command/response protocol

## Quick Start

### Installation

```bash
npm install
```

### Configuration

Create a `.env` file:

```bash
# WebSocket Server Port
WS_PORT=8080

# mDNS Service Name
MDNS_SERVICE_NAME=webex-bridge

# Logging Level (error, warn, info, debug)
LOG_LEVEL=info

# Data Directory (for device storage)
DATA_DIR=./data
```

### Running

**Development:**
```bash
npm run dev
```

**Production:**
```bash
npm run build
npm start
```

## mDNS Discovery

The bridge advertises itself via mDNS for automatic discovery by ESP32 devices.

- **Service Type**: `_webex-bridge._tcp`
- **Default Port**: 8080 (configurable)
- **Service Name**: `webex-bridge` (configurable)

### Testing mDNS

Run the discovery test script:

```bash
node test_mdns.js
```

This will search for active bridge services on the network.

For detailed mDNS troubleshooting, see [MDNS_DISCOVERY.md](./MDNS_DISCOVERY.md).

## Architecture

```
┌──────────────────┐         ┌──────────────────┐
│  Webex Embedded  │◄───────►│  Bridge Server   │
│       App        │  WSS    │  (This Project)  │
│  (Browser/PWA)   │         │                  │
└──────────────────┘         └────────┬─────────┘
                                      │ WS
                                      ▼
                             ┌──────────────────┐
                             │   ESP32 Display  │
                             │   (LED Matrix)   │
                             └──────────────────┘
```

## WebSocket Protocol

### Client Types

- **app**: Webex Embedded App (sends presence/status updates)
- **display**: ESP32 LED Matrix Display (receives status updates)

### Message Types

#### Connection
```json
{
  "type": "connection",
  "data": {
    "webex": "connected",
    "clients": 5
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

#### Join Room
```json
{
  "type": "join",
  "code": "ABC123",
  "clientType": "display",
  "deviceId": "esp32-001",
  "display_name": "Conference Room A"
}
```

#### Status Update
```json
{
  "type": "status",
  "status": "meeting",
  "camera_on": true,
  "mic_muted": false,
  "in_call": true,
  "display_name": "John Doe",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

#### Command
```json
{
  "type": "command",
  "command": "brightness",
  "requestId": "req-123",
  "payload": { "level": 75 }
}
```

#### Command Response
```json
{
  "type": "command_response",
  "requestId": "req-123",
  "success": true,
  "data": { "brightness": 75 }
}
```

## Device Storage

Registered devices are persisted to disk in the `DATA_DIR`:

- **Location**: `./data/devices.json` (default)
- **Format**: JSON
- **Auto-save**: Debounced (5 second delay)

## API Endpoints

The bridge is primarily WebSocket-based and does not expose HTTP endpoints beyond the upgrade handshake.

## Development

### Build

```bash
npm run build
```

### Watch Mode

```bash
npm run watch
```

### Lint

```bash
npm run lint
```

### Tests

```bash
npm test
```

## Deployment

### Azure Container Instances (Cloud) ⭐ Recommended

Deploy to Azure for global access with SSL:

```bash
cd bridge
./azure-deploy.sh
```

- **Cost**: ~$8-10/month (or FREE with Azure credit)
- **SSL**: Automatic via Cloudflare
- **Uptime**: 99.9% SLA
- **Access**: Global via `wss://bridge.5ls.us`

See [AZURE.md](./AZURE.md) for quick start or [docs/azure_deployment.md](../docs/azure_deployment.md) for full guide.

### Home Assistant Add-on (Local)

See [../webex-bridge/](../webex-bridge/) for Home Assistant add-on deployment.

- **Cost**: Free (self-hosted)
- **Access**: Local network via mDNS
- **Fallback**: Works when cloud is unavailable

### Standalone Server

1. Build the project:
   ```bash
   npm run build
   ```

2. Set environment variables or create `.env` file

3. Run:
   ```bash
   npm start
   ```

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY dist ./dist
EXPOSE 8080
CMD ["node", "dist/index.js"]
```

Build and run:
```bash
docker build -t webex-bridge .
docker run --net=host -e WS_PORT=8080 webex-bridge
```

**Note**: Use `--net=host` to ensure mDNS works correctly.

### Hybrid Setup (Best Practice)

Run both Azure (cloud) and Home Assistant (local) for redundancy:

```json
{
  "bridge": {
    "url": "wss://bridge.5ls.us",
    "fallback_url": "ws://homeassistant.local:8080"
  }
}
```

ESP32 devices will automatically fail over if cloud bridge is unavailable.

## Troubleshooting

### Bridge Not Starting

1. Check port availability:
   ```bash
   lsof -i :8080
   ```

2. Verify environment variables:
   ```bash
   echo $WS_PORT
   ```

3. Check logs for errors

### ESP32 Cannot Discover Bridge

1. Run mDNS test:
   ```bash
   node test_mdns.js
   ```

2. Verify network connectivity (same subnet)

3. Check firewall rules (port 5353/UDP for mDNS)

4. See [MDNS_DISCOVERY.md](./MDNS_DISCOVERY.md) for detailed troubleshooting

### WebSocket Connection Issues

1. Test with `wscat`:
   ```bash
   npm install -g wscat
   wscat -c ws://localhost:8080
   ```

2. Check bridge logs for connection/disconnection events

3. Verify client is sending proper join message

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WS_PORT` | `8080` | WebSocket server port |
| `MDNS_SERVICE_NAME` | `webex-bridge` | mDNS service name |
| `LOG_LEVEL` | `info` | Logging level (error, warn, info, debug) |
| `DATA_DIR` | `./data` | Directory for persistent storage |
| `SUPABASE_URL` | - | Supabase project URL (required for cloud mode) |
| `SUPABASE_SERVICE_ROLE_KEY` | - | Supabase service role key (required for cloud mode) |
| `REQUIRE_DEVICE_AUTH` | `true` | Require authentication for device/app connections |
| `BRIDGE_APP_TOKEN_SECRET` | - | Secret for signing app JWT tokens (HS256) |
| `ENABLE_BRIDGE_DEBUG_SUBSCRIBE` | `false` | Enable legacy bridge-based debug streaming |

## Authentication Configuration

When Supabase is enabled, the bridge supports authenticated connections for enhanced security.

### Device Authentication (HMAC)

ESP32 displays authenticate using HMAC signatures based on their device key:

1. Device generates HMAC-SHA256 signature of `device_id + timestamp` using its secret key
2. Signature is included in the `join` message
3. Bridge validates signature against stored key hash

### App Authentication (JWT)

Webex Embedded Apps authenticate using short-lived JWT tokens:

1. App calls `exchange-pairing-code` Edge Function with the pairing code
2. Function returns a signed JWT token with the device's serial number
3. App includes token in the `join` message under `app_auth.token`
4. Bridge validates the JWT signature using `BRIDGE_APP_TOKEN_SECRET`

### Configuration

Set `REQUIRE_DEVICE_AUTH=true` (default when Supabase is enabled) to enforce authentication:

```bash
# Require authentication for all connections
REQUIRE_DEVICE_AUTH=true

# Secret for signing app tokens (must match Supabase Edge Function secret)
# Generate with: openssl rand -base64 32
BRIDGE_APP_TOKEN_SECRET=your_32_char_secret_here
```

**Important**: The `BRIDGE_APP_TOKEN_SECRET` must match the secret configured in your Supabase Edge Function secrets for the `exchange-pairing-code` function.

## License

MIT

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and linting
5. Submit a pull request

## Support

For issues and questions:
- Open an issue on GitHub
- See documentation in [/docs](../docs/)
