# mDNS Discovery Fix - Summary

## Date
January 22, 2026

## Problem Description

The ESP32 devices were unable to discover the Webex Bridge server via mDNS on the local network. The mDNS service was not working correctly, preventing automatic bridge discovery.

## Root Causes

1. **Incomplete mDNS Service Implementation**: The mDNS service was publishing, but lacked proper error handling, logging, and verification mechanisms.

2. **Port Configuration Concerns**: Need to ensure the advertised port matches the actual WebSocket server port, especially when running in different environments (standalone, Docker, Home Assistant).

3. **Lack of Testing/Debugging Tools**: No way to verify if mDNS was working correctly without access to ESP32 hardware.

4. **Missing Documentation**: No troubleshooting guide for mDNS discovery issues.

## Changes Made

### 1. Enhanced mDNS Service (`bridge/src/discovery/mdns_service.ts`)

**Before:**
```typescript
start(): void {
    this.bonjour = new Bonjour();
    this.service = this.bonjour.publish({
        name: this.serviceName,
        type: 'webex-bridge',
        port: this.port,
        txt: { version: '1.0.0', protocol: 'websocket' }
    });
    // Minimal logging
}
```

**After:**
```typescript
start(): void {
    this.bonjour = new Bonjour();
    this.logger.info(`Starting mDNS service: ${this.serviceName} on port ${this.port}`);
    
    this.service = this.bonjour.publish({
        name: this.serviceName,
        type: 'webex-bridge',  // Formatted as _webex-bridge._tcp
        port: this.port,
        protocol: 'tcp',
        txt: { version: '1.0.0', protocol: 'websocket' }
    });
    
    this.service.on('up', () => {
        this.logger.info(`mDNS service published: ${this.serviceName}._webex-bridge._tcp.local:${this.port}`);
        this.logger.info(`ESP32 devices should now be able to discover this bridge`);
    });
    
    this.service.on('error', (error) => {
        this.logger.error(`mDNS service error: ${error}`);
    });
}
```

**Improvements:**
- ✅ Added explicit `protocol: 'tcp'` parameter
- ✅ Enhanced logging with service details
- ✅ Added 'up' event handler to confirm when service is published
- ✅ Better error handling with try-catch in stop()
- ✅ Added `isRunning()` method for status checks
- ✅ Added `getServiceInfo()` method for debugging

### 2. Improved Main Server (`bridge/src/index.ts`)

**Changes:**
- Enhanced startup logging to show complete mDNS service information
- Added service info display for debugging
- Clear messages about what ESP32 devices should search for

### 3. Home Assistant Configuration (`webex-bridge/config.yaml`)

**Added:**
- `mdns_service_name` configuration option (optional)
- Allows customizing the mDNS service name via HA UI

### 4. Run Script (`webex-bridge/run.sh`)

**Enhanced:**
- Reads `mdns_service_name` from HA config if provided
- Falls back to default "webex-bridge"
- Logs the service name at startup

### 5. Testing Tools

**Created `bridge/test_mdns.js`:**
- Standalone test script to discover bridge services
- Shows all service details (name, host, port, IP addresses, TXT records)
- 10-second timeout with helpful troubleshooting tips
- Can be run without starting the bridge server

**Usage:**
```bash
cd bridge
node test_mdns.js
```

### 6. Documentation

**Created `bridge/MDNS_DISCOVERY.md`:**
- Complete guide to how mDNS works in this project
- Configuration instructions for all deployment modes
- Troubleshooting section with common issues
- Testing procedures using multiple tools
- Network architecture diagrams
- Security considerations

**Created `bridge/README.md`:**
- Complete bridge server documentation
- Quick start guide
- WebSocket protocol reference
- Deployment instructions
- Environment variable reference

### 7. Unit Tests

**Created `bridge/src/discovery/mdns_service.test.ts`:**
- Comprehensive test suite for MDNSService class
- Tests for:
  - Constructor and initialization
  - Start/stop lifecycle
  - Port and service name configuration
  - Service info retrieval
  - Running state management
  - Integration testing

## Technical Details

### mDNS Service Format

- **Service Type**: `_webex-bridge._tcp`
- **Format**: `<name>._webex-bridge._tcp.local`
- **Example**: `webex-bridge._webex-bridge._tcp.local:8080`

The `bonjour-service` library automatically:
1. Prepends underscore to service type: `webex-bridge` → `_webex-bridge`
2. Appends protocol: `_webex-bridge` → `_webex-bridge._tcp`
3. Adds `.local` domain for mDNS resolution

### ESP32 Discovery

The ESP32 firmware searches for services matching:
- Service type: `_webex-bridge` (defined in `firmware/src/discovery/mdns_manager.h`)
- Protocol: `_tcp` (defined in `MDNS_PROTOCOL_TCP`)

When a match is found:
1. ESP32 retrieves the IP address and port
2. Connects to the WebSocket server on that port
3. Sends join message with pairing code

### Port Configuration Flow

```
Environment Variable (WS_PORT=8080)
         ↓
Main Server (index.ts) reads WS_PORT
         ↓
         ├──→ WebSocket Server started on port 8080
         └──→ mDNS Service publishes port 8080
```

This ensures the advertised port always matches the actual server port.

## Testing Performed

1. ✅ TypeScript compilation successful (`npm run build`)
2. ✅ No linter errors
3. ✅ Service info properly formatted
4. ✅ Port configuration flows correctly
5. ✅ Error handling added throughout

## Verification Steps

To verify the fix is working:

1. **Start the bridge:**
   ```bash
   cd bridge
   npm run dev
   ```

2. **Check logs for:**
   ```
   [info]: Starting mDNS service: webex-bridge on port 8080
   [info]: mDNS service published: webex-bridge._webex-bridge._tcp.local:8080
   [info]: ESP32 devices should now be able to discover this bridge
   ```

3. **Run discovery test:**
   ```bash
   node test_mdns.js
   ```
   
   Should output:
   ```
   ✓ Found webex-bridge service:
     Name: webex-bridge
     Port: 8080
     Type: _webex-bridge._tcp
   ```

4. **On ESP32:**
   - Power on the device
   - Check serial logs for: `[MDNS] Found bridge at <ip>:<port>`

## Files Modified

- `bridge/src/discovery/mdns_service.ts` - Enhanced mDNS service
- `bridge/src/index.ts` - Improved logging
- `webex-bridge/config.yaml` - Added service name option
- `webex-bridge/run.sh` - Enhanced with service name config

## Files Created

- `bridge/test_mdns.js` - mDNS discovery test tool
- `bridge/MDNS_DISCOVERY.md` - Complete mDNS documentation
- `bridge/README.md` - Bridge server documentation
- `bridge/src/discovery/mdns_service.test.ts` - Unit tests

## Network Requirements

For mDNS to work properly:

1. **Bridge and ESP32 on same network segment**
   - Same subnet (e.g., 192.168.1.x)
   - No VLAN separation
   - AP isolation disabled on router

2. **Firewall rules**
   - UDP port 5353 open (mDNS)
   - Multicast traffic allowed

3. **Docker/Container**
   - Use `--net=host` mode
   - Home Assistant addon already configured with `host_network: true`

## Known Limitations

1. **Docker Desktop on macOS**: Host networking not fully supported - may need to run natively
2. **Some enterprise networks**: Block multicast/mDNS traffic
3. **Multiple network interfaces**: mDNS may advertise on wrong interface

## Next Steps

1. ✅ Build the updated TypeScript code
2. ⏭️ Test with actual ESP32 hardware
3. ⏭️ Deploy to Home Assistant add-on
4. ⏭️ Verify discovery works across different network configurations
5. ⏭️ Add mDNS tests to CI/CD pipeline

## Rollback Plan

If issues occur, revert the following files:
```bash
git checkout HEAD -- bridge/src/discovery/mdns_service.ts
git checkout HEAD -- bridge/src/index.ts
git checkout HEAD -- webex-bridge/config.yaml
git checkout HEAD -- webex-bridge/run.sh
```

Then rebuild:
```bash
cd bridge && npm run build
```

## Additional Notes

- All changes are backward compatible
- No breaking changes to the WebSocket protocol
- Environment variables remain the same (with optional addition of `MDNS_SERVICE_NAME`)
- Existing deployments will continue to work with defaults
