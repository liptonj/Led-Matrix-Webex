# UI Components

This directory contains reusable UI components for the application. All components follow consistent styling patterns and are fully tested.

## Components

### StatusBadge

A badge component for displaying status indicators with consistent styling.

**Usage:**
```tsx
import { StatusBadge } from '@/components/ui';

<StatusBadge status="online" />
<StatusBadge status="pending" label="Pending Approval" />
<StatusBadge status="approved" showDot={false} />
```

**Props:**
- `status`: `'online' | 'offline' | 'pending' | 'approved' | 'rejected' | 'active' | 'inactive' | 'success' | 'warning' | 'danger' | 'info'` (required)
- `label`: Custom label text (optional, defaults to status-appropriate label)
- `showDot`: Show colored dot indicator (optional, default: `true`)

### Modal

A modal dialog component with backdrop, focus management, and keyboard navigation.

**Usage:**
```tsx
import { Modal, ModalFooter } from '@/components/ui';

<Modal 
  open={isOpen} 
  onClose={() => setIsOpen(false)} 
  title="My Modal"
  size="md"
>
  <p>Modal content here</p>
  
  <ModalFooter>
    <Button onClick={() => setIsOpen(false)}>Cancel</Button>
    <Button variant="primary" onClick={handleSave}>Save</Button>
  </ModalFooter>
</Modal>
```

**Props:**
- `open`: Whether modal is visible (required)
- `onClose`: Callback when modal should close (required)
- `title`: Modal title (optional)
- `size`: `'sm' | 'md' | 'lg' | 'xl'` (optional, default: `'md'`)
- `closeOnOverlayClick`: Allow closing by clicking backdrop (optional, default: `true`)
- `showCloseButton`: Show X button in header (optional, default: `true`)

**Features:**
- Escape key closes modal
- Click outside closes modal (configurable)
- Focus trap keeps keyboard navigation within modal
- Body scroll prevention when open
- Proper ARIA attributes for accessibility

### ConfirmDialog

A confirmation dialog component that replaces `window.confirm()` with a more user-friendly modal.

**Usage:**
```tsx
import { ConfirmDialog, useConfirmDialog } from '@/components/ui';

// Using the hook
const confirmDelete = useConfirmDialog();

<button onClick={confirmDelete.open}>Delete</button>

<ConfirmDialog
  open={confirmDelete.isOpen}
  onClose={confirmDelete.close}
  onConfirm={handleDelete}
  title="Delete Device"
  message="Delete device ESP32-ABC123? This cannot be undone."
  variant="danger"
  confirmLabel="Delete"
  cancelLabel="Cancel"
/>

// Or manage state yourself
const [showConfirm, setShowConfirm] = useState(false);

<ConfirmDialog
  open={showConfirm}
  onClose={() => setShowConfirm(false)}
  onConfirm={handleAction}
  title="Confirm Action"
/>
```

**Props:**
- `open`: Whether dialog is visible (required)
- `onClose`: Callback when dialog should close (required)
- `onConfirm`: Callback when user confirms action (required)
- `title`: Dialog title (optional, default: `'Confirm Action'`)
- `message`: Confirmation message (optional, default: `'Are you sure you want to proceed?'`)
- `confirmLabel`: Text for confirm button (optional, default: `'Confirm'`)
- `cancelLabel`: Text for cancel button (optional, default: `'Cancel'`)
- `variant`: `'default' | 'danger' | 'warning'` (optional, default: `'default'`)
- `loading`: Show loading state on buttons (optional, default: `false`)

**Hook: `useConfirmDialog()`**

Returns an object with:
- `isOpen`: boolean
- `open()`: Function to open dialog
- `close()`: Function to close dialog
- `toggle()`: Function to toggle dialog state

### LoadingState

A component that combines loading spinner and error display patterns. Shows loading spinner, error alert, or content based on state.

**Usage:**
```tsx
import { LoadingState } from '@/components/ui';

// Simple usage
<LoadingState loading={loading} error={error}>
  <DeviceList devices={devices} />
</LoadingState>

// With empty state
<LoadingState 
  loading={loading} 
  error={error}
  isEmpty={devices.length === 0}
  emptyState={<p>No devices found</p>}
>
  <DeviceList devices={devices} />
</LoadingState>

// Custom messages
<LoadingState 
  loading={loading} 
  error={error}
  loadingText="Fetching devices..."
  errorTitle="Failed to Load Devices"
>
  <DeviceList devices={devices} />
</LoadingState>
```

**Props:**
- `loading`: Whether content is loading (required)
- `error`: Error message or Error object (optional)
- `loadingText`: Custom loading message (optional, default: `'Loading...'`)
- `errorTitle`: Custom error title (optional, default: `'Error'`)
- `emptyState`: Content to show when empty (optional)
- `isEmpty`: Whether to show empty state (optional, default: `false`)

**CenteredLoading Component:**

A centered loading spinner for full-page loading states.

```tsx
import { CenteredLoading } from '@/components/ui';

<CenteredLoading text="Loading application..." />
```

## Existing Components

These components already existed and are documented here for reference:

- **Alert**: Alert/notification component with variants (info, success, warning, danger)
- **Button**: Button component with variants and sizes
- **Card**: Card container with header, title, and content sections
- **CodeBlock**: Code display with syntax highlighting
- **Spinner**: Loading spinner in various sizes
- **StatusIndicator**: Status indicator dot
- **Table**: Table component with header, body, row, and cell sub-components

## Design System

All components use CSS variables for theming:

- `--color-surface`: Component background
- `--color-border`: Component borders
- `--color-text`: Primary text
- `--color-text-secondary`: Secondary text
- `--color-bg-hover`: Hover background
- `--color-primary`, `--color-success`, `--color-warning`, `--color-danger`: Semantic colors

## Testing

All components have comprehensive test coverage. Run tests with:

```bash
npm test -- --testPathPattern="components/ui"
```

Each component has:
- Rendering tests
- Interaction tests
- Accessibility tests
- Variant/styling tests
- Ref forwarding tests

## Best Practices

1. **Use semantic variants**: Choose appropriate status/variant based on meaning (e.g., `danger` for destructive actions)
2. **Provide accessible labels**: Always provide meaningful titles and messages for modals/dialogs
3. **Handle loading states**: Use `LoadingState` wrapper instead of manual loading/error handling
4. **Use the hook for confirms**: `useConfirmDialog()` provides cleaner state management
5. **Forward refs**: All components support ref forwarding for advanced use cases
