# Supabase Helper Functions

This directory contains reusable helper functions that consolidate common Supabase patterns used throughout the application. These helpers reduce code duplication, provide consistent error handling, and improve maintainability.

## Overview

The helpers are organized into three main categories:

1. **Query Helpers** - Simplify database queries with timeout and error handling
2. **Edge Function Helpers** - Streamline Edge Function calls with authentication
3. **Realtime Helpers** - Manage realtime subscriptions with consistent lifecycle handling

## Helper Functions

### `queryWithTimeout`

Execute Supabase queries with automatic timeout handling and consistent error management.

**Use Cases:**
- Fetching data from Supabase tables
- Single-row queries with `.single()`
- Queries that need custom timeouts
- Queries with abort signal support

**Example Usage:**

```typescript
import { queryWithTimeout } from '@/lib/supabase/helpers';
import { getSupabase } from '@/lib/supabase/core';

// Fetch all devices with default timeout
const devices = await queryWithTimeout(
  async () => {
    const supabase = await getSupabase();
    return supabase
      .schema("display")
      .from("devices")
      .select("*")
      .order("last_seen", { ascending: false });
  },
  "Timed out while loading devices."
);

// Fetch single record with custom timeout and abort signal
const profile = await queryWithTimeout(
  async () => {
    const supabase = await getSupabase();
    return supabase
      .schema("display")
      .from("user_profiles")
      .select("*")
      .eq("user_id", userId)
      .single();
  },
  "Timed out while loading profile.",
  { 
    timeoutMs: 5000, 
    signal: abortController.signal,
    allowEmpty: true  // Return null instead of throwing on PGRST116
  }
);
```

**Options:**
- `timeoutMs` - Custom timeout in milliseconds (default: 10000)
- `signal` - AbortSignal for cancelling the request
- `allowEmpty` - Return null/empty array for not found errors (PGRST116)

**Replaces Patterns:**
```typescript
// OLD: Repeated pattern across 20+ functions
const supabase = await getSupabase();
const { data, error } = await withTimeout(
  supabase.schema("display").from("table").select(...),
  SUPABASE_REQUEST_TIMEOUT_MS,
  "Timed out while...",
);
if (error) throw error;
return data || [];

// NEW: Single helper call
return await queryWithTimeout(
  async () => {
    const supabase = await getSupabase();
    return supabase.schema("display").from("table").select(...);
  },
  "Timed out while..."
);
```

---

### `callEdgeFunction`

Call Supabase Edge Functions with automatic JWT authentication and consistent error handling.

**Use Cases:**
- Admin operations (user management, OAuth client setup)
- Authenticated Edge Function calls
- Operations requiring custom timeouts
- Debug mode in development

**Example Usage:**

```typescript
import { callEdgeFunction } from '@/lib/supabase/helpers';

// Create a new user
const result = await callEdgeFunction<
  { email: string; password: string; role: string },
  { user_id: string; existing: boolean }
>(
  "admin-create-user",
  { 
    email: "user@example.com", 
    password: "secret", 
    role: "user" 
  }
);

// Update user with custom timeout
await callEdgeFunction(
  "admin-update-user",
  { 
    user_id: userId, 
    email: newEmail 
  },
  { timeoutMs: 15000 }
);

// Call with debug headers (development only)
const client = await callEdgeFunction(
  "admin-upsert-oauth-client",
  { 
    provider: "webex", 
    client_id: "abc123" 
  },
  { debug: true }
);
```

**Options:**
- `headers` - Custom headers to include
- `timeoutMs` - Request timeout in milliseconds
- `debug` - Include debug headers in non-production environments

**Replaces Patterns:**
```typescript
// OLD: Repeated pattern across 4+ functions
const sessionResult = await getSession();
const token = sessionResult.data.session?.access_token;
if (!token) throw new Error("Not authenticated.");
const response = await fetch(`${supabaseUrl}/functions/v1/...`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify(data),
});
const body = await response.json().catch(() => ({}));
if (!response.ok) {
  throw new Error(body?.error || "Failed to...");
}

// NEW: Single helper call
const result = await callEdgeFunction("function-name", data);
```

---

### `createRealtimeSubscription`

Create and manage Supabase Realtime subscriptions with consistent lifecycle handling.

**Use Cases:**
- Subscribe to database table changes (postgres_changes)
- Subscribe to broadcast events
- Manage subscription lifecycle (connect, disconnect, errors)
- Monitor connection status

**Supported Subscription Types:**

1. **postgres_changes** - Database table change events
   - Events: `INSERT`, `UPDATE`, `DELETE`, `*` (all)
   - Supports filters (e.g., `pairing_code=eq.ABC123`)

2. **broadcast** - Custom realtime events
   - Used for device logs and custom messages

**Example Usage:**

```typescript
import { createRealtimeSubscription } from '@/lib/supabase/helpers';

// Subscribe to all device changes
const unsubscribe = await createRealtimeSubscription<Device>(
  "admin-devices",
  {
    type: "postgres_changes",
    event: "*",
    schema: "display",
    table: "devices"
  },
  {
    onMessage: (payload) => {
      console.log("Device changed:", payload);
      // payload contains: { eventType, new, old }
    },
    onStatusChange: (subscribed) => {
      setConnected(subscribed);
    },
    onError: (error) => {
      console.error("Subscription error:", error);
    }
  }
);

// Clean up when component unmounts
useEffect(() => {
  return () => {
    unsubscribe();
  };
}, []);

// Subscribe to filtered updates
const unsubscribe = await createRealtimeSubscription<Pairing>(
  `pairing-${pairingCode}`,
  {
    type: "postgres_changes",
    event: "UPDATE",
    schema: "display",
    table: "pairings",
    filter: `pairing_code=eq.${pairingCode}`
  },
  {
    onMessage: (payload) => {
      setPairingData(payload.new);
    }
  }
);

// Subscribe to broadcast events (device logs)
const unsubscribe = await createRealtimeSubscription<DeviceLog>(
  `device_logs:${serialNumber}`,
  {
    type: "broadcast",
    event: "log"
  },
  {
    onMessage: (log) => {
      console.log("New log:", log);
    }
  }
);
```

**Replaces Patterns:**
```typescript
// OLD: Repeated subscription pattern across 4+ functions
const supabase = await getSupabase();
const channel = supabase
  .channel("channel-name")
  .on("postgres_changes", { event: "*", schema: "display", table: "devices" }, (payload) => {
    onChange(payload);
  })
  .subscribe((status) => {
    if (status === "SUBSCRIBED") {
      onStatusChange?.(true);
    } else if (status === "CHANNEL_ERROR") {
      onError?.("Failed to subscribe");
      onStatusChange?.(false);
    }
    // ... more status handling
  });
return () => {
  supabase.removeChannel(channel);
};

// NEW: Single helper call
const unsubscribe = await createRealtimeSubscription(
  "channel-name",
  { type: "postgres_changes", event: "*", schema: "display", table: "devices" },
  { onMessage: onChange, onStatusChange, onError }
);
```

---

## Migration Guide

### Before (Duplicated Code)

```typescript
// devices.ts - Query pattern repeated 20+ times
export async function getDevices(): Promise<Device[]> {
  const supabase = await getSupabase();
  const { data, error } = await withTimeout(
    supabase.schema("display").from("devices").select(DEVICE_COLUMNS),
    SUPABASE_REQUEST_TIMEOUT_MS,
    "Timed out while loading devices.",
  );
  if (error) throw error;
  return data || [];
}

// users.ts - Edge function pattern repeated 4+ times
export async function createUserWithRole(email: string, password: string, role: string) {
  const sessionResult = await getSession();
  const token = sessionResult.data.session?.access_token;
  if (!token) throw new Error("Not authenticated.");
  
  const response = await fetch(`${supabaseUrl}/functions/v1/admin-create-user`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ email, password, role }),
  });
  
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || "Failed to create user.");
  return body;
}

// pairings.ts - Subscription pattern repeated 4+ times
export async function subscribeToPairing(pairingCode: string, onUpdate: (pairing: Partial<Pairing>) => void) {
  const supabase = await getSupabase();
  const channel = supabase
    .channel(`pairing-${pairingCode}`)
    .on("postgres_changes", { event: "UPDATE", schema: "display", table: "pairings", filter: `pairing_code=eq.${pairingCode}` }, (payload) => {
      onUpdate(payload.new as Partial<Pairing>);
    })
    .subscribe((status) => {
      // 20+ lines of status handling...
    });
  return () => { supabase.removeChannel(channel); };
}
```

### After (Using Helpers)

```typescript
// devices.ts
import { queryWithTimeout } from './helpers';

export async function getDevices(): Promise<Device[]> {
  return queryWithTimeout(
    async () => {
      const supabase = await getSupabase();
      return supabase.schema("display").from("devices").select(DEVICE_COLUMNS);
    },
    "Timed out while loading devices."
  );
}

// users.ts
import { callEdgeFunction } from './helpers';

export async function createUserWithRole(email: string, password: string, role: string) {
  return callEdgeFunction(
    "admin-create-user",
    { email, password, role }
  );
}

// pairings.ts
import { createRealtimeSubscription } from './helpers';

export async function subscribeToPairing(pairingCode: string, onUpdate: (pairing: Partial<Pairing>) => void) {
  return createRealtimeSubscription(
    `pairing-${pairingCode}`,
    { type: "postgres_changes", event: "UPDATE", schema: "display", table: "pairings", filter: `pairing_code=eq.${pairingCode}` },
    { onMessage: (payload) => onUpdate(payload.new as Partial<Pairing>) }
  );
}
```

---

## Benefits

### Code Reduction
- **~600+ lines eliminated** across 9 Supabase files
- **20+ query functions** consolidated
- **4+ Edge Function calls** unified
- **4+ subscription implementations** standardized

### Consistency
- **Single source of truth** for timeout values
- **Unified error handling** across all queries
- **Standardized subscription lifecycle** management
- **Consistent authentication** for Edge Functions

### Maintainability
- **Easier to update** - Change behavior in one place
- **Easier to test** - Test helpers once, use everywhere
- **Easier to understand** - Clear, documented patterns
- **Type-safe** - Full TypeScript support with generics

### Security
- **Automatic authentication** for Edge Functions
- **Consistent token handling** (no hardcoded patterns)
- **Abort signal support** for cancelling requests
- **Debug mode only in development**

---

## Testing

All helpers have comprehensive test coverage:

```bash
npm test -- src/lib/supabase/helpers/__tests__
```

**Coverage:**
- queryWithTimeout: 100% coverage
- callEdgeFunction: 100% coverage
- createRealtimeSubscription: 100% coverage

**Test Categories:**
- Successful operations
- Error handling
- Timeout handling
- Edge cases
- Type safety
- Multiple concurrent operations

---

## TypeScript Support

All helpers are fully typed with generics:

```typescript
// queryWithTimeout - Infers return type
const devices = await queryWithTimeout<Device>(/* ... */);
// devices: Device[]

// callEdgeFunction - Type-safe request/response
const result = await callEdgeFunction<CreateUserRequest, CreateUserResponse>(/* ... */);
// result: CreateUserResponse

// createRealtimeSubscription - Typed messages
await createRealtimeSubscription<DeviceLog>(/* ... */);
// onMessage receives DeviceLog type
```

---

## Best Practices

1. **Always use helpers for new code** - Don't create new patterns
2. **Migrate existing code incrementally** - Replace duplicated patterns one module at a time
3. **Use TypeScript generics** - Get full type safety
4. **Handle cleanup** - Always call unsubscribe for realtime subscriptions
5. **Use abort signals** - Cancel requests when components unmount
6. **Set appropriate timeouts** - Use custom timeouts for slow operations
7. **Test with helpers** - Mock helpers in tests instead of underlying Supabase calls

---

## Related Files

- **Core Module**: `lib/supabase/core.ts` - Base Supabase configuration
- **Auth Module**: `lib/supabase/auth.ts` - Authentication helpers
- **Types**: `lib/supabase/types.ts` - Shared TypeScript types
- **Devices Module**: `lib/supabase/devices.ts` - Device queries (uses helpers)
- **Pairings Module**: `lib/supabase/pairings.ts` - Pairing subscriptions (uses helpers)
- **Users Module**: `lib/supabase/users.ts` - User management (uses helpers)
- **OAuth Module**: `lib/supabase/oauth.ts` - OAuth client management (uses helpers)

---

## Contributing

When adding new Supabase patterns:

1. Check if an existing helper can be used
2. If not, consider creating a new helper
3. Add comprehensive tests
4. Update this README with examples
5. Migrate existing duplicate code to use the new helper

---

## Version History

- **v1.0.0** - Initial implementation (2026-02-01)
  - queryWithTimeout helper
  - callEdgeFunction helper
  - createRealtimeSubscription helper
  - Comprehensive test coverage
  - Full TypeScript support
