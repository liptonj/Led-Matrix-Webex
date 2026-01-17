# Bridge Server Deployment Guide

## Overview

The bridge server provides real-time Webex presence updates via the Webex JavaScript SDK. It's optional but recommended for the best experience without a RoomOS device.

## System Requirements

- Node.js 18.0 or higher
- 512MB RAM minimum
- Always-on device (Raspberry Pi, NAS, server, etc.)
- Network access to both Webex cloud and local LAN

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/Led-Matrix-Webex.git
cd Led-Matrix-Webex/bridge
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment

```bash
cp env.example .env
```

Edit `.env` with your Webex credentials:

```env
WEBEX_CLIENT_ID=your_client_id_here
WEBEX_CLIENT_SECRET=your_client_secret_here
WEBEX_REFRESH_TOKEN=your_refresh_token_here
WS_PORT=8080
MDNS_SERVICE_NAME=webex-bridge
LOG_LEVEL=info
```

### 4. Build and Run

```bash
npm run build
npm start
```

## Production Deployment

### Using PM2 (Recommended)

PM2 provides process management, automatic restarts, and log management.

```bash
# Install PM2 globally
npm install -g pm2

# Start the bridge
pm2 start dist/index.js --name webex-bridge

# Enable startup script
pm2 startup
pm2 save

# View logs
pm2 logs webex-bridge
```

### Using Systemd (Linux)

Create `/etc/systemd/system/webex-bridge.service`:

```ini
[Unit]
Description=Webex Bridge Server
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/Led-Matrix-Webex/bridge
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl enable webex-bridge
sudo systemctl start webex-bridge
sudo systemctl status webex-bridge
```

### Using Docker

Create `Dockerfile`:

```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist

EXPOSE 8080
CMD ["node", "dist/index.js"]
```

Build and run:

```bash
docker build -t webex-bridge .
docker run -d \
  --name webex-bridge \
  --restart unless-stopped \
  -p 8080:8080 \
  --env-file .env \
  webex-bridge
```

## mDNS Service Discovery

The bridge advertises itself via mDNS as `_webex-bridge._tcp.local`. The ESP32 automatically discovers it on the local network.

### Service Details

- **Service Type**: `_webex-bridge._tcp`
- **Default Port**: 8080
- **Hostname**: `webex-bridge.local`

### Firewall Configuration

Ensure the following ports are open:

- **TCP 8080**: WebSocket server (or your configured port)
- **UDP 5353**: mDNS (for service discovery)

## WebSocket Protocol

### Connection

ESP32 connects to: `ws://webex-bridge.local:8080`

### Messages (Bridge -> ESP32)

#### Presence Update

```json
{
  "type": "presence",
  "data": {
    "status": "active",
    "displayName": "John Doe",
    "lastActivity": "2026-01-16T10:30:00.000Z"
  },
  "timestamp": "2026-01-16T10:30:05.123Z"
}
```

#### Connection Status

```json
{
  "type": "connection",
  "data": {
    "webex": "connected",
    "clients": 1
  },
  "timestamp": "2026-01-16T10:30:00.000Z"
}
```

### Messages (ESP32 -> Bridge)

#### Subscribe

```json
{
  "type": "subscribe",
  "deviceId": "webex-display-001"
}
```

#### Ping

```json
{
  "type": "ping"
}
```

## Logging

The bridge uses Winston for logging. Log levels:

- `error`: Critical errors
- `warn`: Warnings
- `info`: General information (default)
- `debug`: Detailed debugging

Set via `LOG_LEVEL` environment variable.

### Log Files (with PM2)

```bash
# View logs
pm2 logs webex-bridge

# Clear logs
pm2 flush webex-bridge
```

## Troubleshooting

### Bridge Not Discovered

1. Check mDNS is working:
   ```bash
   avahi-browse -a  # Linux
   dns-sd -B _webex-bridge._tcp  # macOS
   ```

2. Ensure UDP port 5353 is open

3. Check the bridge is running:
   ```bash
   pm2 status
   ```

### WebSocket Connection Refused

1. Check the bridge is listening:
   ```bash
   netstat -tlnp | grep 8080
   ```

2. Verify firewall allows TCP 8080

### Webex Authentication Failing

1. Check refresh token is valid (expires after 90 days of inactivity)
2. Verify client ID and secret are correct
3. Check logs for specific error messages

### High CPU Usage

1. The Webex SDK maintains an active WebSocket connection - this is normal
2. If CPU is consistently high, check for reconnection loops in logs

## Security Considerations

1. **Token Storage**: The `.env` file contains sensitive credentials. Ensure proper file permissions:
   ```bash
   chmod 600 .env
   ```

2. **Network Security**: The WebSocket server is unencrypted by default. For production, consider:
   - Running behind a reverse proxy with TLS
   - Using a VPN for the local network
   - Restricting access to known ESP32 devices

3. **Updates**: Keep Node.js and dependencies updated for security patches

## Resource Usage

Typical resource consumption on Raspberry Pi 4:

- **CPU**: 1-5% idle, up to 20% during reconnection
- **RAM**: ~100MB
- **Network**: Minimal, mostly WebSocket keepalives
