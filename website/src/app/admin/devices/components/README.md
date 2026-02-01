# Device Detail Panel Components

This directory contains the split components from `DeviceDetailPanel.tsx`, breaking the 647-line monolith into smaller, focused components.

## Component Structure

### DeviceInfoCard.tsx
Displays basic device information including:
- Device name and firmware version
- Access status (Active/Disabled/Blacklisted/Awaiting approval)
- Realtime subscription status

**Props:**
- `device: Device` - Device data
- `pairingStatus: SubscriptionStatus` - Pairing subscription status
- `commandStatus: SubscriptionStatus` - Command subscription status
- `logStatus: SubscriptionStatus` - Log subscription status

### DeviceActionsPanel.tsx
Contains all device action buttons:
- Toggle debug mode
- Approve device
- Enable/disable device
- Blacklist/unblacklist device
- Delete device
- Send reboot command

**Props:**
- `device: Device` - Device data
- `debugUpdating: boolean` - Debug update in progress
- `accessUpdating: boolean` - Access update in progress
- `commandSubmitting: boolean` - Command submission in progress
- `onToggleDebug: () => void` - Toggle debug callback
- `onApprove: () => void` - Approve device callback
- `onToggleDisabled: () => void` - Toggle disabled callback
- `onToggleBlacklisted: () => void` - Toggle blacklist callback
- `onDelete: () => void` - Delete device callback
- `onSendReboot: () => void` - Send reboot command callback

### DeviceTelemetryPanel.tsx
Displays device telemetry data:
- Webex status
- Call status (in call, camera on, mic muted)
- RSSI and temperature

**Props:**
- `pairing: Pairing | null` - Pairing data
- `pairingStatus: SubscriptionStatus` - Subscription status
- `pairingError: string | null` - Error message if any

### DeviceLogsPanel.tsx
Real-time device logs viewer with filtering:
- Live log streaming
- Filter by log level (all, info, warn, error, debug)
- Displays last 200 logs

**Props:**
- `logs: DeviceLog[]` - Filtered logs array
- `logsLoading: boolean` - Loading state
- `logsError: string | null` - Error message
- `logStatus: SubscriptionStatus` - Subscription status
- `logFilter: 'all' | DeviceLog['level']` - Current filter
- `onFilterChange: (filter) => void` - Filter change callback

### DeviceCommandsPanel.tsx
Device commands viewer with pagination:
- Command history
- Filter by status (pending, acked, failed, expired, all)
- Pagination support
- Click to view command response

**Props:**
- `commands: Command[]` - Commands array
- `commandError: string | null` - Error message
- `commandStatus: SubscriptionStatus` - Subscription status
- `commandFilter: 'all' | Command['status']` - Current filter
- `commandCount: number` - Total command count
- `commandPage: number` - Current page
- `commandTotalPages: number` - Total pages
- `onFilterChange: (filter) => void` - Filter change callback
- `onPageChange: (page) => void` - Page change callback
- `onShowResponse: (title, body) => void` - Show response callback

### CommandResponseModal.tsx
Modal for displaying command response JSON:
- Displays response body
- Close button

**Props:**
- `isOpen: boolean` - Modal open state
- `title: string` - Modal title
- `body: Record<string, unknown> | null` - Response body
- `onClose: () => void` - Close callback

## Benefits of This Split

1. **Smaller file sizes**: Each component is < 150 lines
2. **Single responsibility**: Each component has one clear purpose
3. **Easier testing**: Can test components in isolation
4. **Better reusability**: Components can be reused elsewhere if needed
5. **Improved maintainability**: Easier to find and modify specific functionality
6. **Clearer dependencies**: Props make data flow explicit

## Original File Size
- Before: 647 lines
- After: 424 lines in main file + 6 component files (avg ~100 lines each)
- Total reduction: ~35% in main file complexity
