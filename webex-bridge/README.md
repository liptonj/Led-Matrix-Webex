# Webex Bridge - Home Assistant Add-on

[![Open your Home Assistant instance and show the add add-on repository dialog with a specific repository URL pre-filled.](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fliptonj%2FLed-Matrix-Webex)

This add-on runs the Webex Bridge server for real-time presence updates to your LED Matrix Display.

## Installation

1. Click the button above, or manually add this repository to Home Assistant:
   - Go to **Settings** → **Add-ons** → **Add-on Store**
   - Click the three dots (⋮) in the top right → **Repositories**
   - Add: `https://github.com/liptonj/Led-Matrix-Webex`

2. Find "Webex Bridge" in the add-on store and click **Install**

3. Configure your Webex OAuth credentials in the add-on settings

4. Start the add-on

## Configuration

You need a Webex Integration for OAuth credentials. See the [full documentation](DOCS.md) for setup instructions.

| Option | Required | Description |
|--------|----------|-------------|
| `webex_client_id` | Yes | Webex Integration Client ID |
| `webex_client_secret` | Yes | Webex Integration Client Secret |
| `webex_refresh_token` | Yes | OAuth refresh token |
| `ws_port` | No | WebSocket port (default: 8080) |
| `log_level` | No | Log verbosity (default: info) |

## How it works

```
Webex Cloud  →  This Add-on  →  ESP32 LED Matrix
   (OAuth)      (WebSocket)       (mDNS discovery)
```

The ESP32 automatically discovers the bridge via mDNS at `webex-bridge.local`.

## Support

- [Documentation](DOCS.md)
- [GitHub Issues](https://github.com/liptonj/Led-Matrix-Webex/issues)
