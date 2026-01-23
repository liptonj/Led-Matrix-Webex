# mDNS Discovery - Verification Checklist

Use this checklist to verify that mDNS discovery is working correctly between the bridge server and ESP32 devices.

## Pre-Flight Checks

### Network Requirements

- [ ] Bridge server and ESP32 are on the same network subnet
- [ ] Router/AP has "AP Isolation" or "Client Isolation" **disabled**
- [ ] Firewall allows UDP port 5353 (mDNS)
- [ ] Multicast/broadcast traffic is not blocked
- [ ] No VLANs separating the devices

### Bridge Server Setup

- [ ] Node.js 18+ installed
- [ ] Dependencies installed: `npm install`
- [ ] Code built: `npm run build`
- [ ] `.env` file created with `WS_PORT` configured
- [ ] Port 8080 (or configured port) is available

## Step 1: Start Bridge Server

```bash
cd bridge
npm run dev
```

### Expected Log Output

Look for these log messages:

```
[info]: Starting Webex Bridge Server...
[info]: Device store initialized (0 devices)
[info]: WebSocket server started on port 8080
[info]: Starting mDNS service: webex-bridge on port 8080
[info]: mDNS service published: webex-bridge._webex-bridge._tcp.local:8080
[info]: ESP32 devices should now be able to discover this bridge
[info]: Webex Bridge Server is running on port 8080
[info]: mDNS service: webex-bridge._webex-bridge._tcp.local:8080
[info]: ESP32 devices can discover this bridge by searching for "_webex-bridge._tcp" service
```

### Verification

- [ ] All startup messages appear without errors
- [ ] "mDNS service published" message appears
- [ ] Port number matches WS_PORT configuration

## Step 2: Test mDNS Discovery (From Computer)

### Option A: Using Test Script

```bash
cd bridge
node test_mdns.js
```

### Expected Output

```
=== mDNS Discovery Test ===

Searching for _webex-bridge._tcp services on the local network...

✓ Found webex-bridge service:
  Name: webex-bridge
  Host: hostname.local
  Port: 8080
  Type: _webex-bridge._tcp
  Full Name: webex-bridge._webex-bridge._tcp.local
  IP Addresses:
    - 192.168.1.100
  TXT Records:
    version: 1.0.0
    protocol: websocket
```

### Verification

- [ ] Service is discovered within 10 seconds
- [ ] IP address matches bridge server's IP
- [ ] Port matches configured WS_PORT
- [ ] TXT records are present

### Option B: Using System Tools

**macOS:**
```bash
dns-sd -B _webex-bridge._tcp
```

**Linux:**
```bash
avahi-browse -r _webex-bridge._tcp
```

### Verification

- [ ] Service appears in system tool output
- [ ] Service details match expected values

## Step 3: Test from ESP32

### Power On ESP32

Connect to serial monitor (115200 baud) and look for these messages during boot:

```
[INIT] Starting mDNS...
[MDNS] Started with hostname: webex-display.local
[MDNS] Advertising HTTP service on port 80
```

### Check Discovery Logs

When the ESP32 tries to discover the bridge, look for:

```
[MDNS] Searching for bridge server...
[MDNS] Found bridge at 192.168.1.100:8080
[BRIDGE] Connecting to 192.168.1.100:8080 with pairing code: ABC123
```

### Verification

- [ ] mDNS starts successfully on ESP32
- [ ] Bridge is discovered (not "No bridge server found")
- [ ] IP and port match the bridge server
- [ ] WebSocket connection is established

## Step 4: Connection Verification

### On Bridge Server Logs

After ESP32 connects, you should see:

```
[info]: New connection: client-1234567890
[info]: Device registered: esp32-001
[info]: Display joined room ABC123
```

### On ESP32 Serial Monitor

```
[BRIDGE] Connected to bridge
[BRIDGE] Joined room ABC123
[BRIDGE] Status: paired
```

### Verification

- [ ] Bridge logs show new connection
- [ ] ESP32 successfully joins room
- [ ] No reconnection loops or errors

## Troubleshooting

### Issue: "No bridge server found" on ESP32

**Possible Causes:**

1. **Different subnets**
   - Bridge: `192.168.1.100`
   - ESP32: `192.168.2.50`
   - **Fix**: Connect to same network

2. **AP Isolation enabled**
   - Router setting prevents devices from seeing each other
   - **Fix**: Disable AP isolation in router settings

3. **Firewall blocking mDNS**
   - Port 5353/UDP blocked
   - **Fix**: Allow mDNS in firewall

4. **Bridge not running**
   - Service not started or crashed
   - **Fix**: Start bridge and check logs

5. **Wrong service type**
   - Mismatch between ESP32 search and bridge advertisement
   - **Fix**: Verify `MDNS_SERVICE_BRIDGE` constant matches

**Test:**
```bash
# On the same machine as bridge
node bridge/test_mdns.js

# If this finds the service, the problem is network-related
# If this doesn't find it, the problem is with the bridge
```

### Issue: mDNS test finds nothing

**Possible Causes:**

1. **Bridge not started**
   - **Fix**: Start bridge with `npm run dev`

2. **mDNS service failed to start**
   - Check bridge logs for errors
   - **Fix**: Restart bridge

3. **System mDNS not working**
   - macOS: Check "Sharing" settings
   - Linux: Install `avahi-daemon`
   - **Fix**: Enable mDNS on system

4. **Port conflict**
   - Another service using port 5353
   - **Fix**: `lsof -i :5353` and kill conflicting process

### Issue: Bridge crashes on startup

**Check:**
- [ ] Node.js version (must be 18+)
- [ ] Dependencies installed (`npm install`)
- [ ] Port not already in use (`lsof -i :8080`)
- [ ] Valid LOG_LEVEL value
- [ ] Write permissions for DATA_DIR

### Issue: ESP32 finds bridge but can't connect

**This indicates:**
- ✅ mDNS is working (discovery successful)
- ❌ WebSocket connection issue

**Check:**
1. Firewall not blocking WebSocket port (8080)
2. Bridge WebSocket server running
3. Correct port number in mDNS record
4. Network allows TCP connections between devices

## Network Diagnostic Commands

### Check Bridge Server IP

```bash
# macOS/Linux
ifconfig | grep "inet "

# Should show something like:
# inet 192.168.1.100 netmask 0xffffff00 broadcast 192.168.1.255
```

### Check ESP32 IP

Available in serial monitor or web interface:
```
IP: 192.168.1.150
```

### Verify Same Subnet

Bridge and ESP32 should have IPs in the same range:
- ✅ Bridge: `192.168.1.100`, ESP32: `192.168.1.150` (same subnet)
- ❌ Bridge: `192.168.1.100`, ESP32: `192.168.2.150` (different subnet)

### Test Network Connectivity

From computer running bridge:
```bash
# Ping ESP32 (replace with actual IP)
ping 192.168.1.150
```

From ESP32 to bridge (if you have shell access):
```bash
ping 192.168.1.100
```

Both should work. If not, there's a network connectivity issue.

## Success Criteria

All of the following should be true:

- [✓] Bridge starts without errors
- [✓] mDNS service publishes successfully
- [✓] Test script finds the bridge service
- [✓] ESP32 discovers bridge via mDNS
- [✓] ESP32 connects to bridge WebSocket
- [✓] Bridge logs show device connection
- [✓] Status updates flow between app and display

## Advanced Diagnostics

### Capture mDNS Traffic (Wireshark/tcpdump)

```bash
# Capture mDNS packets
sudo tcpdump -i any -n udp port 5353

# Look for:
# - PTR queries for _webex-bridge._tcp.local
# - PTR responses with bridge service
# - SRV records with port number
# - A/AAAA records with IP addresses
```

### Check Service with dig

```bash
# Query mDNS directly (macOS)
dns-sd -Q webex-bridge._webex-bridge._tcp.local
```

### Enable Debug Logging

Set in `.env`:
```bash
LOG_LEVEL=debug
```

Restart bridge and check for detailed mDNS logs.

## Documentation References

- [mDNS Discovery Guide](./MDNS_DISCOVERY.md) - Complete mDNS documentation
- [Bridge README](./README.md) - General bridge documentation
- [Fix Summary](./MDNS_FIX_SUMMARY.md) - Details of mDNS implementation

## Need Help?

If you've followed this checklist and mDNS still isn't working:

1. Gather this information:
   - Bridge logs (from startup)
   - ESP32 serial logs
   - Output from `node test_mdns.js`
   - Network configuration (subnet, router model)
   - Operating system and versions

2. Check existing GitHub issues

3. Open a new issue with the gathered information
