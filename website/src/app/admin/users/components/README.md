# User Management Components

This directory contains the split components from `users/page.tsx`, breaking the 557-line monolith into smaller, focused components.

## Component Structure

### UserCreateForm.tsx
Form for creating new users with the following fields:
- Email (required)
- Password (required, temporary)
- Role (admin or user)

**Props:**
- `saving: boolean` - Form submission in progress
- `onSubmit: (email, password, role) => Promise<void>` - Form submission callback

**Features:**
- Controlled form inputs
- Automatic state reset after successful submission
- Disabled state during submission

### UserTable.tsx
Table wrapper component that manages the user list display:
- Table structure (headers, body)
- Empty state handling
- Iterates over users to render UserRow components

**Props:**
- `users: UserProfile[]` - Array of user profiles
- `devices: Device[]` - Array of available devices
- `assignmentsByUser: AssignmentMap` - Device assignments by user ID
- `devicesBySerial: Record<string, Device>` - Device lookup map
- `activeAdminCount: number` - Count of active admins
- `rowState: Record<string, UserRowState>` - User row state
- `selectedDevice: Record<string, string>` - Selected device per user
- `saving: boolean` - Save operation in progress
- `onRowStateChange: (userId, state) => void` - Row state change callback
- `onSelectedDeviceChange: (userId, serialNumber) => void` - Device selection callback
- `onAssignDevice: (userId) => Promise<void>` - Assign device callback
- `onRemoveAssignment: (assignmentId) => Promise<void>` - Remove assignment callback
- `onUpdateUser: (user) => Promise<void>` - Update user callback
- `onDeleteUser: (user) => Promise<void>` - Delete user callback

### UserRow.tsx
Individual user row with inline editing capabilities:
- Name fields (first name, last name)
- Email field
- Role dropdown (admin/user)
- Disabled checkbox
- Password field (for resetting)
- Assigned devices list with remove buttons
- Device assignment dropdown + assign button
- Save and delete buttons

**Props:**
- `user: UserProfile` - User profile data
- `state: UserRowState` - Current row state
- `isLastActiveAdmin: boolean` - Whether this is the last active admin
- `userAssignments: UserDeviceAssignment[]` - User's device assignments
- `availableDevices: Device[]` - Devices available for assignment
- `devicesBySerial: Record<string, Device>` - Device lookup map
- `selectedDevice: string` - Currently selected device
- `saving: boolean` - Save operation in progress
- `onStateChange: (state) => void` - State change callback
- `onSelectedDeviceChange: (serialNumber) => void` - Device selection callback
- `onAssignDevice: () => Promise<void>` - Assign device callback
- `onRemoveAssignment: (assignmentId) => Promise<void>` - Remove assignment callback
- `onUpdateUser: () => Promise<void>` - Update user callback
- `onDeleteUser: () => Promise<void>` - Delete user callback

**Features:**
- Inline editing for all user fields
- Protected last active admin (can't disable, delete, or change role)
- Device assignment management within the row
- Responsive layout

## Benefits of This Split

1. **Reduced complexity**: Main page is now 262 lines (from 557)
2. **Separation of concerns**:
   - `UserCreateForm`: New user creation
   - `UserTable`: Table structure and logic
   - `UserRow`: Individual user editing
3. **Improved testability**: Each component can be tested independently
4. **Better reusability**: Form and row components can be reused elsewhere
5. **Clearer data flow**: Props make dependencies explicit
6. **Easier maintenance**: Changes to row editing don't affect form creation

## State Management

The main page (`users/page.tsx`) still manages:
- User list fetching and updates
- Device list
- Assignment list
- Global loading/saving/error states
- Row state for each user (for inline editing)
- Selected device for each user (for assignment)

Each component receives only the data and callbacks it needs, following the principle of least privilege.

## Original File Size
- Before: 557 lines
- After: 262 lines in main file + 3 component files
- Total reduction: ~53% in main file complexity
