# Firmware Utilities

Centralized utilities for firmware manifest URL generation and configuration checks.

## Functions

### `getManifestUrl()`

Generates the base firmware manifest URL from the Supabase Edge Function.

**Returns:** `string | null`
- Returns the manifest URL if Supabase is configured
- Returns `null` if `NEXT_PUBLIC_SUPABASE_URL` is not set

**Example:**
```typescript
import { getManifestUrl } from '@/lib/firmware/manifest';

const url = getManifestUrl();
if (url) {
  const response = await fetch(url);
  const manifest = await response.json();
}
```

### `getEspWebToolsManifestUrl()`

Generates the ESP Web Tools format manifest URL. This format is specifically designed for the ESP Web Tools flashing interface.

**Returns:** `string | null`
- Returns the ESP Web Tools manifest URL if Supabase is configured
- Returns `null` if `NEXT_PUBLIC_SUPABASE_URL` is not set

**Example:**
```typescript
import { getEspWebToolsManifestUrl } from '@/lib/firmware/manifest';

const manifestUrl = getEspWebToolsManifestUrl();
if (manifestUrl) {
  return <EspWebInstallButton manifest={manifestUrl} />;
}
```

### `isManifestConfigured()`

Checks if the manifest system is properly configured.

**Returns:** `boolean`
- `true` if Supabase URL is configured
- `false` otherwise

**Example:**
```typescript
import { isManifestConfigured } from '@/lib/firmware/manifest';

if (!isManifestConfigured()) {
  return (
    <Alert variant="danger">
      Please configure NEXT_PUBLIC_SUPABASE_URL to enable firmware downloads
    </Alert>
  );
}
```

## Architecture

All manifest URL generation is centralized in this module to ensure:

1. **Single Source of Truth**: One place to update URL format
2. **Consistent Behavior**: All manifest-related code uses the same logic
3. **Easy Testing**: Mock this module to test components
4. **Type Safety**: TypeScript ensures correct usage

## Usage Throughout App

This module is used by:

- **`useManifest` hook**: Fetches firmware manifest data
- **`useEspWebTools` hook**: Provides manifest URL for ESP Web Tools
- **`FirmwareInstallStep` component**: Installation UI
- **Firmware pages**: Display firmware versions and downloads

## Environment Variables

Required environment variable:

- **`NEXT_PUBLIC_SUPABASE_URL`**: Base URL of your Supabase project (e.g., `https://yourproject.supabase.co`)

The manifest functions will return `null` if this is not configured, allowing components to gracefully handle the missing configuration.

## Testing

See `__tests__/manifest.test.ts` for comprehensive test coverage including:

- URL generation with various configurations
- Null handling when not configured
- Edge cases (empty strings, trailing slashes)
- Consistency between utility functions
