# Firmware & Embedded App Code Review

## Date: January 30, 2026
## Focus: Display Loading Issues & Webex SDK Setup

---

## Part 1: Firmware Display Loading Issues

### Critical Issues

#### 1. **Display Page Transition Flicker** (`display_status.cpp:276-290`)

**Problem**: When switching between display pages (STATUS → SENSORS → IN_CALL), the code clears the entire screen and resets all scroll states, causing visible flicker.

```cpp
if (target_page != last_page) {
    dma_display->clearScreen();
    for (int i = 0; i < 4; i++) {
        last_line_keys[i].clear();
    }
    status_scroll.text.clear();
    // ... resets all scroll states
}
```

**Impact**: Users see a black flash when pages rotate every 5 seconds.

**Recommendation**: 
- Use partial screen clears (only clear changed regions)
- Implement double-buffering if hardware supports it
- Add a fade transition instead of instant clear

---

#### 2. **Static Screen State Conflict** (`display_status.cpp:247-252`)

**Problem**: Static screens (`showUnconfigured`, `showConnected`) set `last_static_key`, but when transitioning to dynamic `update()`, the screen is cleared, causing a flash.

```cpp
if (!last_static_key.isEmpty()) {
    last_static_key.clear();
    dma_display->clearScreen();  // Causes flash
}
```

**Impact**: Brief black screen when transitioning from setup screens to status display.

**Recommendation**: 
- Don't clear screen if transitioning from static → dynamic
- Use a flag to track transition state
- Only clear changed regions

---

#### 3. **Race Condition in Display Update Logic** (`main.cpp:896-906`)

**Problem**: The display update logic runs at 30 FPS and checks `embedded_app_connected` state. If this toggles rapidly (e.g., during Supabase realtime connection), the display oscillates between "unconfigured" and "status" screens.

```cpp
const bool has_app_presence = app_state.embedded_app_connected || app_state.supabase_app_connected;
if (app_state.wifi_connected &&
    !app_state.xapi_connected &&
    !app_state.webex_authenticated &&
    !app_state.mqtt_connected &&
    !has_app_presence) {
    matrix_display.showUnconfigured(WiFi.localIP().toString());
    return;
}
```

**Impact**: Display flickers between screens during connection establishment.

**Recommendation**:
- Add debouncing: require state to be stable for 500ms before switching screens
- Add a display state machine with explicit transitions
- Track last screen shown and only change if state persists

---

#### 4. **Realtime Subscription Delay Affects Display** (`main.cpp:360-362`)

**Problem**: Realtime connection is deferred for 15 seconds after boot. During this time, `embedded_app_connected` stays false, so display shows "unconfigured" even if the app is actually connected.

```cpp
app_state.realtime_defer_until = millis() + 15000UL;  // 15 second delay
```

**Impact**: Misleading display state during boot - shows "unconfigured" when app is actually connected.

**Recommendation**:
- Reduce defer time to 5 seconds
- Show "Connecting..." screen during defer period
- Check HTTP polling status before showing "unconfigured"

---

### High Priority Issues

#### 5. **Brightness Applied Every Frame** (`main.cpp:871`)

**Problem**: Config values are read from NVS every 33ms (30 FPS), causing unnecessary overhead.

```cpp
matrix_display.setBrightness(config_manager.getBrightness());
matrix_display.setScrollSpeedMs(config_manager.getScrollSpeedMs());
matrix_display.setPageIntervalMs(config_manager.getPageIntervalMs());
```

**Impact**: 
- Unnecessary NVS reads
- Potential brightness flicker if config changes
- Performance overhead

**Recommendation**:
```cpp
static uint8_t cached_brightness = 0;
static uint16_t cached_scroll_speed = 0;
static uint16_t cached_page_interval = 0;

uint8_t new_brightness = config_manager.getBrightness();
if (new_brightness != cached_brightness) {
    cached_brightness = new_brightness;
    matrix_display.setBrightness(cached_brightness);
}
// Similar for scroll_speed and page_interval
```

---

#### 6. **OTA Lock Not Always Released** (`main.cpp:1166-1167`)

**Problem**: If OTA fails between `showUpdating()` and `performUpdate()`, the display remains locked.

**Impact**: Display frozen if OTA fails unexpectedly.

**Recommendation**: Add try-catch around OTA operations and always call `unlockFromOTA()` in finally block.

---

#### 7. **Low Heap Silent Failure** (`supabase_realtime.cpp:115-126`)

**Problem**: When heap is low, realtime connection silently fails, causing `embedded_app_connected` to remain false.

**Impact**: Display shows "unconfigured" with no indication why.

**Recommendation**: 
- Show warning icon on display when heap is low
- Log to display status screen
- Add visual indicator for connection issues

---

## Part 2: Embedded App Webex SDK Issues

### Critical Issues

#### 1. **Missing Device Media Event Handlers** (`useWebexSDK.ts:282-288`)

**Problem**: The SDK hook doesn't listen to device media events, so `isVideoOn` and `isMuted` are never updated from the SDK.

**Current Code**:
```typescript
app.on("meeting:started", handleMeetingEvent);
app.on("meeting:ended", handleMeetingEvent);
app.on("presence:changed", handlePresenceEvent);
// Missing: device:media:active, device:media:inactive, device:audio:active, device:audio:inactive
```

**Impact**: Camera and mic state from Webex SDK is never reflected in the app, causing display to show incorrect status.

**Recommendation**: Add event handlers:
```typescript
const handleDeviceMediaEvent = useCallback((data: unknown) => {
  const mediaData = data as { type?: string; state?: string };
  if (mediaData.type === 'video') {
    updateState({ isVideoOn: mediaData.state === 'active' });
  } else if (mediaData.type === 'audio') {
    updateState({ isMuted: mediaData.state === 'inactive' });
  }
}, [updateState]);

app.on("device:media:active", handleDeviceMediaEvent);
app.on("device:media:inactive", handleDeviceMediaEvent);
app.on("device:audio:active", handleDeviceMediaEvent);
app.on("device:audio:inactive", handleDeviceMediaEvent);
```

---

#### 2. **SDK Script Version Pinning** (`EmbeddedAppClient.tsx:924`)

**Status**: ✅ **INTENTIONAL** - Using `@latest` is desired for now to get latest features/bug fixes.

```typescript
<Script
  src="https://unpkg.com/@webex/embedded-app-sdk@latest"
  // ...
/>
```

**Note**: Consider pinning to a specific version in production for stability, but keeping `@latest` is fine for development.

---

#### 3. **Race Condition: SDK Load vs Initialization** (`EmbeddedAppClient.tsx:452-456`)

**Problem**: `initialize()` is called when `sdkLoaded` is true, but `window.webex` might not be available yet.

```typescript
useEffect(() => {
  if (sdkLoaded) {
    initialize();  // window.webex might not exist yet
  }
}, [initialize, sdkLoaded]);
```

**Impact**: Initialization may fail silently if SDK isn't fully loaded.

**Recommendation**: The `useWebexSDK` hook already has retry logic (`waitForWebexSDK`), but ensure it's called:
```typescript
useEffect(() => {
  if (sdkLoaded) {
    // Hook will handle waiting for window.webex
    initialize();
  }
}, [initialize, sdkLoaded]);
```

Actually, this is already handled correctly in the hook. The issue is that `sdkLoaded` is set when the script loads, but the SDK might not be ready yet.

---

#### 4. **Missing Space Meeting Events** (`useWebexSDK.ts:282-288`)

**Problem**: Only listening to `meeting:started` but not `space:meeting:started` for Webex Spaces.

**Impact**: Meeting status may not be detected in Webex Spaces.

**Recommendation**: Add space meeting events:
```typescript
app.on("space:meeting:started", handleMeetingEvent);
app.on("space:meeting:ended", handleMeetingEvent);
app.on("space:meeting:joined", handleMeetingEvent);
app.on("space:meeting:left", handleMeetingEvent);
```

---

### High Priority Issues

#### 5. **Initial Status Not Set from SDK** (`useWebexSDK.ts:264-276`)

**Problem**: Initial status is hardcoded to `"active"` if no meeting, but SDK might have a different presence status.

```typescript
updateState({
  status: meeting ? "meeting" : "active",  // Should query SDK for actual status
  // ...
});
```

**Impact**: Display shows incorrect status on initial load.

**Recommendation**: Query presence status from SDK if available:
```typescript
// After getUser, try to get presence
let initialStatus: WebexStatus = "active";
try {
  const presence = await app.context.getPresence?.();
  if (presence?.status) {
    initialStatus = mapPresenceToStatus(presence.status);
  }
} catch {
  // Fallback to active
}
```

---

#### 6. **No Error Recovery for SDK Failures** (`useWebexSDK.ts:289-295`)

**Problem**: If SDK initialization fails, there's no retry mechanism.

**Impact**: App stays in error state permanently.

**Recommendation**: Add retry logic with exponential backoff:
```typescript
const [retryCount, setRetryCount] = useState(0);
const MAX_RETRIES = 3;

if (err && retryCount < MAX_RETRIES) {
  setTimeout(() => {
    setRetryCount(prev => prev + 1);
    initialize();
  }, Math.pow(2, retryCount) * 1000);
}
```

---

#### 7. **Status Update Not Debounced** (`EmbeddedAppClient.tsx:645-682`)

**Problem**: Status updates are sent to Supabase on every state change, which can be rapid during SDK initialization.

**Impact**: 
- Excessive database writes
- Rate limiting issues
- Display flicker from rapid updates

**Recommendation**: Debounce status updates:
```typescript
const statusUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null);

useEffect(() => {
  if (rtStatus !== 'connected' || !isPaired) return;
  
  // Clear previous timeout
  if (statusUpdateTimeoutRef.current) {
    clearTimeout(statusUpdateTimeoutRef.current);
  }
  
  // Debounce updates by 500ms
  statusUpdateTimeoutRef.current = setTimeout(() => {
    updateAppStateViaEdge({
      webex_status: statusToDisplay,
      // ...
    });
  }, 500);
  
  return () => {
    if (statusUpdateTimeoutRef.current) {
      clearTimeout(statusUpdateTimeoutRef.current);
    }
  };
}, [rtStatus, isPaired, statusToDisplay, cameraOn, micMuted, inCall, displayName]);
```

---

### Medium Priority Issues

#### 8. **Missing SDK Context Methods** (`useWebexSDK.ts:63-72`)

**Problem**: TypeScript interface doesn't include all available SDK methods like `getPresence`, `getSpaces`, etc.

**Impact**: Type safety issues, missing functionality.

**Recommendation**: Expand interface:
```typescript
interface WebexApp {
  onReady: () => Promise<void>;
  context: {
    getUser: () => Promise<{ id: string; displayName: string; email?: string }>;
    getMeeting?: () => Promise<{ id: string; title?: string } | null>;
    getPresence?: () => Promise<{ status: string }>;
    getSpaces?: () => Promise<Array<{ id: string; title?: string }>>;
  };
  listen: () => Promise<void>;
  on: (event: string, callback: (data: unknown) => void) => void;
  off: (event: string, callback?: (data: unknown) => void) => void;
}
```

---

#### 9. **No SDK Version Detection** (`EmbeddedAppClient.tsx`)

**Problem**: No way to detect which SDK version is loaded or if it's compatible.

**Impact**: Hard to debug SDK-related issues.

**Recommendation**: Log SDK version on load:
```typescript
<Script
  src="https://unpkg.com/@webex/embedded-app-sdk@latest"
  strategy="afterInteractive"
  onLoad={() => {
    if (window.webex?.version) {
      console.log('Webex SDK version:', window.webex.version);
      addLog(`Webex SDK ${window.webex.version} loaded`);
    }
    setSdkLoaded(true);
  }}
/>
```

---

## Summary of Recommendations

### Firmware (Display Loading)
1. ✅ Add debouncing for display state transitions (500ms)
2. ✅ Cache config values (brightness, scroll speed) instead of reading every frame
3. ✅ Reduce realtime defer time from 15s to 5s
4. ✅ Add display state machine with explicit transitions
5. ✅ Show warning indicators for connection issues
6. ✅ Fix OTA lock cleanup in error cases

### Embedded App (Webex SDK)
1. ✅ **CRITICAL**: Add device media event handlers (`device:media:active`, `device:audio:active`) - **IMPLEMENTED**
2. ⏸️ Pin SDK version (deferred - using `@latest` is intentional for now)
3. ✅ Add space meeting events (`space:meeting:started`) - **IMPLEMENTED**
4. ✅ Query initial presence status from SDK
5. ✅ Debounce status updates to Supabase (500ms)
6. ✅ Add retry logic for SDK initialization failures
7. ✅ Expand TypeScript interfaces for SDK methods
8. ✅ Log SDK version on load

---

## Priority Fix Order

1. ✅ **Critical**: Add device media event handlers (camera/mic state) - **IMPLEMENTED**
2. ✅ **Critical**: Add space meeting events - **IMPLEMENTED**
3. **Critical**: Fix display state race condition (debouncing) - PENDING
4. **High**: Cache config values in firmware - PENDING
5. **High**: Debounce status updates - PENDING
6. **Medium**: Query initial presence status - PENDING
7. **Deferred**: Pin SDK version (keeping `@latest` for now)
