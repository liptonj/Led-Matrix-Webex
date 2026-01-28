# Bridge Deprecation Plan

This document outlines the deprecation path for the WebSocket bridge as the LED Matrix Webex Display project transitions to Supabase Realtime as the primary communication layer.

## Background

The bridge server has historically served as the realtime hub connecting ESP32 devices (LED displays) and embedded Webex apps running in the browser.

With the introduction of Supabase Realtime and Edge Functions, the bridge responsibilities are being consolidated into Supabase, which provides durable state caching, built-in realtime subscriptions, Edge Functions for authentication, and rate limiting.

## Current Bridge Responsibilities

| Responsibility | Replacement | Status |
|----------------|-------------|--------|
| Realtime pairing | Supabase display.pairings + Realtime | Replaced |
| Command relay | Supabase display.commands queue | Replaced |
| Device registration | Edge Functions | Replaced |
| Debug log forwarding | Supabase device_logs + Realtime | Replaced |
| mDNS discovery | Keep for local network | Retained |

## Deprecation Phases

### Phase A: Bridge Optional, Supabase Primary (Current)

Changes:
- New firmware uses Supabase Edge Functions for all communication
- Embedded app uses exchange-pairing-code for authentication
- App subscribes to display.pairings for realtime device state
- Commands queued via insert-command Edge Function
- Device polls commands via poll-commands Edge Function

Bridge Status:
- Remains deployed and running
- Handles legacy devices on older firmware versions
- No new features added to bridge

Monitoring:
- Track bridge WebSocket connections in logs
- Compare bridge traffic vs Supabase Edge Function calls

### Phase A+1: Monitor for Zero Bridge Usage

Timeline: After firmware rollout reaches 95% adoption

Criteria to Proceed:
- Zero active WebSocket connections to bridge for 7+ days
- All devices on firmware v1.5.2+ (Supabase-native)
- No bridge-related errors in device logs
- Embedded app feature flag enabled for all users

Actions:
- Set bridge to read-only mode
- Monitor for errors or complaints
- Prepare for Phase B

### Phase B: Bridge Retired or mDNS-Only

Timeline: 30+ days after Phase A+1 success

Option 1: Full Retirement (Recommended)
- Bridge server decommissioned
- mDNS discovery via device-only (ESP32 advertises itself)
- Local network discovery via device built-in mDNS responder

Option 2: mDNS-Only Mode
- Bridge continues as lightweight mDNS relay
- No WebSocket functionality

## mDNS Discovery: Local Network Fallback

mDNS discovery is retained for local network scenarios:
- Direct device web UI access via webex-display.local
- Initial WiFi configuration before cloud connectivity
- Debugging and development

### Device mDNS Advertisement

The ESP32 firmware advertises via ESPmDNS library:
- Service: _http._tcp
- Instance: webex-display-XXXX
- Port: 80
- TXT Records: serial, version, pairing_code

### Discovery Methods After Bridge Retirement

1. Device built-in mDNS: ESP32 advertises webex-display.local
2. App discovery: Prompt user for local IP or use browser APIs
3. QR code: Device shows QR code with local URL for setup

## Rollback Considerations

If issues arise during deprecation:

1. Phase A Rollback: Re-enable bridge as primary
2. Firmware Rollback: OTA push older bridge-based firmware
3. Feature Flag: Set USE_SUPABASE_REALTIME=false in app env

See rollback_procedure.md for detailed steps.

## Configuration Changes

### Firmware

Old (bridge-based):
- BRIDGE_URL: wss://bridge.example.com/ws
- USE_BRIDGE_REALTIME: true

New (Supabase-based):
- SUPABASE_URL: https://xxx.supabase.co
- USE_SUPABASE_REALTIME: true

### Embedded App Environment

Old:
- NEXT_PUBLIC_BRIDGE_URL: wss://bridge.example.com
- NEXT_PUBLIC_USE_SUPABASE_EDGE_FUNCTIONS: false

New:
- NEXT_PUBLIC_SUPABASE_URL: https://xxx.supabase.co
- NEXT_PUBLIC_USE_SUPABASE_EDGE_FUNCTIONS: true

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Device Supabase firmware adoption | >95% | OTA tracking |
| Bridge connection count | 0 | Bridge metrics |
| Edge Function success rate | >99% | Supabase dashboard |
| Realtime subscription health | >99% uptime | Supabase metrics |
| User-reported issues | 0 critical | Support tickets |

## Timeline Summary

Phase A (Now): Supabase primary, bridge backup, monitor adoption

Phase A+1 (95% adoption): Bridge read-only, 7-day monitoring

Phase B (30+ days later): Bridge decommissioned, mDNS via device

## Related Documentation

- Supabase Setup Guide: supabase_setup.md
- Rollback Procedure: rollback_procedure.md
