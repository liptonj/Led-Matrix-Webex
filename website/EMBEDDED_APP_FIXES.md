# Embedded App Realtime Connection Fixes

## Problem

The embedded app's Supabase Realtime connection was timing out and required frequent manual refreshes.

## Root Causes Identified

1. **Missing Realtime Configuration**: The Supabase client was created without explicit realtime connection parameters (timeouts, heartbeat intervals, reconnect logic)
2. **No Stale Connection Detection**: The app couldn't detect when the connection was alive but not receiving updates
3. **Limited Error Logging**: Connection errors didn't provide enough detail for debugging

## Changes Made

### 1. Enhanced Realtime Configuration (`usePairing.ts`)

Added explicit realtime configuration to the Supabase client:

```typescript
realtime: {
  params: {
    eventsPerSecond: 10
  },
  timeout: 30000, // 30 second timeout for operations
  heartbeatIntervalMs: 15000, // Send heartbeat every 15 seconds
  reconnectAfterMs: (tries: number) => {
    // Exponential backoff: 1s, 2s, 4s, 8s, max 10s
    return Math.min(1000 * Math.pow(2, tries), 10000);
  }
}
```

**Benefits:**
- More frequent heartbeats prevent idle connections from timing out
- Exponential backoff prevents overwhelming the server during outages
- 30s timeout ensures operations don't hang indefinitely

### 2. Connection Watchdog

Added a watchdog that monitors connection health:

```typescript
connectionWatchdogRef.current = setInterval(() => {
  const timeSinceLastUpdate = Date.now() - lastPairingSnapshotRef.current;
  const staleThreshold = 120000; // 2 minutes
  if (timeSinceLastUpdate > staleThreshold && rtStatus === 'connected' && !isReconnectingRef.current) {
    addLog(`Connection appears stale (${Math.floor(timeSinceLastUpdate / 1000)}s since last update), forcing reconnect...`);
    if (attemptReconnectRef.current && token) {
      attemptReconnectRef.current(code, token.token);
    }
  }
}, 30000); // Check every 30 seconds
```

**Benefits:**
- Detects "zombie" connections (connected but not receiving updates)
- Automatically forces reconnection after 2 minutes of inactivity
- Prevents the need for manual page refreshes

### 3. Improved Error Handling and Logging

Enhanced subscription callback to provide detailed error messages:

```typescript
.subscribe((status, err) => {
  if (status === 'SUBSCRIBED') { 
    // ...
    addLog('Realtime connection established');
  }
  else if (status === 'CHANNEL_ERROR') {
    const errorMsg = err ? `: ${err.message}` : '';
    addLog(`Realtime channel error${errorMsg}`);
    // ... handle reconnection
  }
  // ... other statuses
});
```

**Benefits:**
- Clearer error messages for debugging
- Separate handling for each error type (CHANNEL_ERROR, CLOSED, TIMED_OUT)
- Logs help diagnose connection issues

### 4. Channel Configuration

Added channel-level configuration for better connection stability:

```typescript
const channel = supabase.channel(`pairing:${code}`, {
  config: {
    broadcast: { self: true },
    presence: { key: 'app' }
  }
})
```

**Benefits:**
- Enables presence tracking
- Allows the app to receive its own broadcast events if needed

### 5. Activity Tracking

Updated the postgres_changes callback to track activity:

```typescript
.on('postgres_changes', { 
  event: 'UPDATE', 
  schema: 'display', 
  table: 'pairings', 
  filter: `pairing_code=eq.${code}` 
}, () => { 
  // Pairing update received - connection is alive
  lastPairingSnapshotRef.current = Date.now();
})
```

**Benefits:**
- Tracks when the last update was received
- Used by the watchdog to detect stale connections

## Testing

All changes passed linting with no errors.

## Expected Behavior After Fix

1. **Stable Long-Running Connections**: The embedded app should maintain a stable realtime connection for hours without timeouts
2. **Automatic Recovery**: If the connection drops, it will automatically reconnect with exponential backoff
3. **Stale Connection Detection**: If the connection appears alive but no updates are received for 2 minutes, it will automatically reconnect
4. **Better Diagnostics**: The debug log will show clear messages about connection state changes

## Monitoring

Users can monitor connection health in the debug panel:
- "Realtime connection established" - successful connection
- "Connection appears stale (Xs since last update), forcing reconnect..." - watchdog triggered
- "Realtime channel error: ..." - connection error details

## Configuration Constants

The following constants control connection behavior (in `constants.ts`):
- `reconnectDelayMs: 2000` - Initial reconnect delay
- `reconnectMaxAttempts: 5` - Maximum reconnection attempts
- `heartbeatIntervalMs: 30000` - App heartbeat interval (separate from realtime heartbeat)

The realtime-specific configuration is hardcoded in `usePairing.ts`:
- Realtime heartbeat: 15 seconds
- Operation timeout: 30 seconds
- Stale connection threshold: 2 minutes
- Watchdog check interval: 30 seconds

## Migration Path

No database or infrastructure changes required. The fix is entirely client-side in the embedded app.

## Related Files

- `website/src/app/embedded/hooks/usePairing.ts` - Main changes
- `website/src/app/embedded/constants.ts` - Configuration (unchanged)
