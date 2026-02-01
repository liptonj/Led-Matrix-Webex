# Install Wizard Components

This directory contains the firmware installation wizard components and configuration.

## Components

### `InstallWizard`

Main wizard component that orchestrates the installation flow. Manages state for the multi-step installation process.

### `FirmwareInstallStep`

The firmware flashing step. Integrates with ESP Web Tools to flash firmware to the ESP32-S3 device via Web Serial API.

**Key Features:**
- ESP Web Tools integration via `useEspWebTools` hook
- Browser compatibility detection
- Supabase configuration validation
- WiFi setup instructions
- Loading and error states

### `SuccessStep`

Success confirmation step shown after firmware installation completes. Provides next steps for device configuration.

### `EspWebInstallButton`

React wrapper for the ESP Web Tools custom element (`<esp-web-install-button>`).

## Constants (`constants.ts`)

Centralized configuration values for the installation wizard:

- **`ESP_WEB_TOOLS_VERSION`**: Version of ESP Web Tools library used
- **`WIFI_AP_NAME`**: Name of the WiFi access point created by the device during setup
- **`WIFI_AP_IP`**: IP address of the device's configuration portal
- **`SUPPORTED_BROWSERS`**: Map of browsers and their Web Serial API support status
- **`TYPICAL_FLASH_DURATION_SECONDS`**: Expected duration for firmware flashing
- **`TYPICAL_FLASH_DURATION_MAX_SECONDS`**: Maximum expected duration for firmware flashing

## Integration

### Using Constants

```tsx
import { WIFI_AP_NAME, WIFI_AP_IP, SUPPORTED_BROWSERS } from './constants';

// Display WiFi AP name in instructions
<p>Connect to {WIFI_AP_NAME} and navigate to {WIFI_AP_IP}</p>

// Show browser support
{Object.entries(SUPPORTED_BROWSERS).map(([key, { name, supported }]) => (
  <BrowserSupportIndicator key={key} name={name} supported={supported} />
))}
```

### Using the ESP Web Tools Hook

```tsx
import { useEspWebTools } from '@/hooks/useEspWebTools';

function InstallComponent() {
  const { ready, loading, error, manifestUrl, configured } = useEspWebTools();

  if (!configured) {
    return <Alert>Supabase not configured</Alert>;
  }

  if (loading) {
    return <Spinner />;
  }

  if (error) {
    return <Alert variant="danger">{error}</Alert>;
  }

  return <EspWebInstallButton manifest={manifestUrl} />;
}
```

## Architecture

The install wizard follows a clear separation of concerns:

1. **Configuration** (`constants.ts`): All hardcoded values in one place
2. **Business Logic** (`useEspWebTools`): ESP Web Tools integration and state management
3. **Presentation** (Components): UI rendering based on state
4. **Utilities** (`lib/firmware/manifest.ts`): Manifest URL generation

This makes it easy to:
- Update configuration values without touching component code
- Test components by mocking the hook
- Maintain consistent behavior across the app
- Update ESP Web Tools version in one place
