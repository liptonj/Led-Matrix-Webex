-- =============================================================================
-- Migration: UUID Identity Migration
-- Date: 2026-02-09
-- Purpose: Migrate from pairing_code-based identity to device_uuid-based identity
-- =============================================================================
--
-- OVERVIEW:
-- This migration makes device_uuid (devices.id) the sole device identifier.
-- Pairing codes become temporary, on-demand tokens that expire after use.
--
-- AFFECTED TABLES:
-- - display.pairings: Change PK from pairing_code to device_uuid
-- - display.commands: Remove pairing_code/serial_number columns
-- - display.devices: Make pairing_code nullable, add expiry
-- - display.connection_heartbeats: Remove pairing_code column
-- - display.oauth_tokens: Remove pairing_code column
--
-- AFFECTED FUNCTIONS:
-- - display.broadcast_commands_changes() - use device_uuid topics
-- - display.pairings_presence_trigger() - remove pairing_code
-- - display.prevent_immutable_device_updates() - remove pairing_code check
-- - public.display_commands_broadcast_trigger() - use device_uuid topics
-- - public.display_firmware_updates_broadcast_trigger() - use device_uuid topics
-- - public.display_heartbeats_broadcast_trigger() - use device_uuid topics
--
-- AFFECTED POLICIES (rewritten to use device_uuid JWT claim):
-- - commands_app_insert, commands_app_select, commands_device_select, commands_device_update
-- - oauth_tokens_device_* policies
-- - pairings_app_select, pairings_app_update, pairings_device_select, pairings_device_update
--
-- DESTRUCTIVE CHANGES (pre-production, clean cut):
-- - Drops pairing_code as PRIMARY KEY on pairings
-- - Drops pairing_code/serial_number columns from commands
-- - Drops pairing_code columns from connection_heartbeats, oauth_tokens
-- - Drops legacy RLS policies
-- =============================================================================

-- begin transaction for safety
begin;

-- =============================================================================
-- PHASE 0: DROP LEGACY RLS POLICIES (must happen before column drops)
-- =============================================================================
-- These policies reference pairing_code/serial_number columns that will be dropped.
-- PostgreSQL requires policies to be dropped before their referenced columns.

-- Drop legacy commands policies that use pairing_code/serial_number
drop policy if exists "commands_app_insert" on display.commands;
drop policy if exists "commands_app_select" on display.commands;
drop policy if exists "commands_device_select" on display.commands;
drop policy if exists "commands_device_update" on display.commands;
drop policy if exists "commands_user_select" on display.commands;

-- Drop legacy oauth_tokens policies that use pairing_code
drop policy if exists "oauth_tokens_device_delete" on display.oauth_tokens;
drop policy if exists "oauth_tokens_device_insert" on display.oauth_tokens;
drop policy if exists "oauth_tokens_device_select" on display.oauth_tokens;
drop policy if exists "oauth_tokens_device_update" on display.oauth_tokens;

-- Drop legacy pairings policies that use pairing_code
drop policy if exists "pairings_app_select" on display.pairings;
drop policy if exists "pairings_app_update" on display.pairings;
drop policy if exists "pairings_device_select" on display.pairings;
drop policy if exists "pairings_device_update" on display.pairings;
drop policy if exists "pairings_user_select" on display.pairings;

-- =============================================================================
-- PHASE 1A: RESTRUCTURE PAIRINGS TABLE
-- =============================================================================

-- Step 1: Add pairing_code_expires_at column to devices (for temporary codes)
alter table display.devices 
add column if not exists pairing_code_expires_at timestamptz;

comment on column display.devices.pairing_code_expires_at is 
  'Expiry timestamp for temporary pairing codes. NULL means code is expired/cleared.';

-- Step 2: Make pairing_code nullable on devices (no longer required after pairing)
-- DESTRUCTIVE: This removes the NOT NULL constraint
alter table display.devices 
alter column pairing_code drop not null;

comment on column display.devices.pairing_code is 
  'Temporary pairing code for initial device setup. Nullable - cleared after user pairs.';

-- Step 3: Add device_uuid to pairings if not exists (should already exist from Phase 3)
alter table display.pairings 
add column if not exists device_uuid uuid;

-- Step 4: Backfill device_uuid in pairings from devices table
update display.pairings p
set device_uuid = d.id
from display.devices d
where p.serial_number = d.serial_number
  and p.device_uuid is null;

-- Step 5: Make device_uuid NOT NULL after backfill
-- DESTRUCTIVE: Rows without matching devices will fail
alter table display.pairings 
alter column device_uuid set not null;

-- Step 6a: Drop foreign keys that depend on pairings_pkey BEFORE dropping the PK
alter table display.commands 
drop constraint if exists commands_pairing_code_fkey;

alter table display.connection_heartbeats 
drop constraint if exists connection_heartbeats_pairing_code_fkey;

-- Step 6b: Drop the OLD primary key (pairing_code)
-- DESTRUCTIVE: This removes pairing_code as primary key
alter table display.pairings 
drop constraint if exists pairings_pkey;

-- Step 7: Add NEW primary key (device_uuid)
alter table display.pairings 
add primary key (device_uuid);

-- Step 8: Make pairing_code nullable on pairings
alter table display.pairings 
alter column pairing_code drop not null;

-- Step 9: Add partial unique index for non-null pairing codes (for lookup during pairing)
drop index if exists display.idx_pairings_pairing_code;
drop index if exists display.idx_pairings_pairing_code_unique;
create unique index idx_pairings_pairing_code_unique 
on display.pairings (pairing_code) 
where pairing_code is not null;

comment on index display.idx_pairings_pairing_code_unique is 
  'Partial unique index for active pairing codes (only enforced when not null)';

-- Step 10: Add pairing_code_expires_at to pairings
alter table display.pairings 
add column if not exists pairing_code_expires_at timestamptz;

comment on column display.pairings.pairing_code_expires_at is 
  'Expiry timestamp for temporary pairing codes. NULL means code is expired/cleared.';

-- Step 11: Add foreign key from pairings.device_uuid to devices.id
alter table display.pairings 
drop constraint if exists pairings_device_uuid_fkey;

alter table display.pairings 
add constraint pairings_device_uuid_fkey 
foreign key (device_uuid) references display.devices(id) on delete cascade;

-- =============================================================================
-- PHASE 1B: RESTRUCTURE COMMANDS TABLE
-- =============================================================================

-- Step 1: (FK commands_pairing_code_fkey already dropped in Phase 1A Step 6a)

-- Step 2: Make device_uuid NOT NULL (should already have values from Phase 3)
-- Backfill any missing device_uuid from devices table first
update display.commands c
set device_uuid = d.id
from display.devices d
where c.serial_number = d.serial_number
  and c.device_uuid is null;

-- DESTRUCTIVE: Commands without matching devices will fail
alter table display.commands 
alter column device_uuid set not null;

-- Step 3: Add foreign key from commands.device_uuid to devices.id
alter table display.commands 
drop constraint if exists commands_device_uuid_fkey;

alter table display.commands 
add constraint commands_device_uuid_fkey 
foreign key (device_uuid) references display.devices(id) on delete cascade;

-- Step 4: Drop pairing_code column from commands
-- DESTRUCTIVE: Removes pairing_code data
alter table display.commands 
drop column if exists pairing_code;

-- Step 5: Drop serial_number column from commands (redundant with device_uuid)
-- DESTRUCTIVE: Removes serial_number data
alter table display.commands 
drop column if exists serial_number;

-- Step 6: Update indexes to use device_uuid only
drop index if exists display.idx_commands_pairing_code;
drop index if exists display.idx_commands_pending;

create index if not exists idx_commands_device_uuid on display.commands (device_uuid);
create index if not exists idx_commands_pending_uuid on display.commands (device_uuid, status, expires_at) 
  where status = 'pending';

comment on index display.idx_commands_device_uuid is 'Index for device_uuid lookups on commands';
comment on index display.idx_commands_pending_uuid is 'Composite index for pending commands by device_uuid';

-- =============================================================================
-- PHASE 1C: UPDATE CONNECTION_HEARTBEATS TABLE
-- =============================================================================

-- Step 1: (FK connection_heartbeats_pairing_code_fkey already dropped in Phase 1A Step 6a)

-- Step 2: Drop pairing_code column
-- DESTRUCTIVE: Removes pairing_code data
alter table display.connection_heartbeats 
drop column if exists pairing_code;

-- Step 3: Add foreign key from device_uuid to devices.id (if not exists)
alter table display.connection_heartbeats 
drop constraint if exists connection_heartbeats_device_uuid_fkey;

alter table display.connection_heartbeats 
drop constraint if exists connection_heartbeats_device_uuid_fkey;

alter table display.connection_heartbeats 
add constraint connection_heartbeats_device_uuid_fkey 
foreign key (device_uuid) references display.devices(id) on delete cascade;

-- Step 4: Update indexes
drop index if exists display.idx_heartbeats_pairing;

-- =============================================================================
-- PHASE 1D: UPDATE OAUTH_TOKENS TABLE
-- =============================================================================

-- Step 1: Drop pairing_code indexes
drop index if exists display.oauth_tokens_pairing_code_idx;
drop index if exists display.oauth_tokens_pairing_idx;

-- Step 2: Drop pairing_code column
-- DESTRUCTIVE: Removes pairing_code data
alter table display.oauth_tokens 
drop column if exists pairing_code;

-- Step 3: Ensure device_uuid index exists
create index if not exists idx_oauth_tokens_device_uuid 
on display.oauth_tokens (device_uuid) where device_uuid is not null;

-- =============================================================================
-- PHASE 1E: REWRITE BROADCAST TRIGGERS TO USE DEVICE_UUID
-- =============================================================================

-- Replace broadcast_commands_changes to use device:uuid:events topic
create or replace function display.broadcast_commands_changes()
returns trigger
language plpgsql
as $$
declare
  topic text;
  device_id uuid;
begin
  -- Use device_uuid for topic (new architecture)
  device_id := coalesce(new.device_uuid, old.device_uuid);
  
  if device_id is null then
    -- Skip broadcast if no device_uuid (shouldn't happen after migration)
    return new;
  end if;
  
  topic := 'device:' || device_id::text || ':events';
  
  perform realtime.broadcast_changes(
    topic,
    'command_changed',
    tg_op,
    tg_table_name,
    tg_table_schema,
    new,
    old,
    'ROW'
  );
  return new;
end;
$$;

comment on function display.broadcast_commands_changes() is 
  'Broadcasts command changes to device:{device_uuid}:events realtime topic';

-- Replace public wrapper for commands broadcast
create or replace function public.display_commands_broadcast_trigger()
returns trigger
language plpgsql
security definer
as $$
declare
  topic text;
  device_id uuid;
begin
  device_id := coalesce(new.device_uuid, old.device_uuid);
  
  if device_id is null then
    return new;
  end if;
  
  topic := 'device:' || device_id::text || ':events';
  
  perform realtime.broadcast_changes(
    topic,
    'command_changed',
    tg_op,
    tg_table_name,
    tg_table_schema,
    new,
    old,
    'ROW'
  );
  return new;
end;
$$;

comment on function public.display_commands_broadcast_trigger() is 
  'Public wrapper for commands broadcast using device_uuid topics';

-- Replace firmware updates broadcast trigger
create or replace function public.display_firmware_updates_broadcast_trigger()
returns trigger
language plpgsql
security definer
as $$
declare
  topic text;
  device_id uuid;
begin
  -- Get device_uuid from the devices table
  device_id := coalesce(new.id, old.id);
  
  if device_id is null then
    return new;
  end if;
  
  topic := 'device:' || device_id::text || ':firmware';
  
  perform realtime.broadcast_changes(
    topic,
    'firmware_update',
    tg_op,
    tg_table_name,
    tg_table_schema,
    new,
    old,
    'ROW'
  );
  return new;
end;
$$;

comment on function public.display_firmware_updates_broadcast_trigger() is 
  'Broadcasts firmware update notifications to device:{device_uuid}:firmware topic';

-- Replace heartbeats broadcast trigger
create or replace function public.display_heartbeats_broadcast_trigger()
returns trigger
language plpgsql
security definer
as $$
declare
  topic text;
  device_id uuid;
begin
  device_id := coalesce(new.device_uuid, old.device_uuid);
  
  if device_id is null then
    return new;
  end if;
  
  topic := 'device:' || device_id::text || ':heartbeats';
  
  perform realtime.broadcast_changes(
    topic,
    'heartbeat_changed',
    tg_op,
    tg_table_name,
    tg_table_schema,
    new,
    old,
    'ROW'
  );
  return new;
end;
$$;

comment on function public.display_heartbeats_broadcast_trigger() is 
  'Broadcasts heartbeat changes to device:{device_uuid}:heartbeats topic';

-- =============================================================================
-- PHASE 1F: UPDATE DATABASE FUNCTIONS
-- =============================================================================

-- Update pairings_presence_trigger to not use pairing_code
create or replace function display.pairings_presence_trigger()
returns trigger
language plpgsql
as $$
begin
  -- Upsert connection heartbeat using device_uuid as key
  insert into display.connection_heartbeats (
    device_uuid,
    app_last_seen,
    app_connected,
    device_last_seen,
    device_connected,
    updated_at
  )
  values (
    new.device_uuid,
    new.app_last_seen,
    new.app_connected,
    new.device_last_seen,
    new.device_connected,
    now()
  )
  on conflict (device_uuid) do update set
    app_last_seen = coalesce(excluded.app_last_seen, display.connection_heartbeats.app_last_seen),
    app_connected = coalesce(excluded.app_connected, display.connection_heartbeats.app_connected),
    device_last_seen = coalesce(excluded.device_last_seen, display.connection_heartbeats.device_last_seen),
    device_connected = coalesce(excluded.device_connected, display.connection_heartbeats.device_connected),
    updated_at = now();
  
  return new;
end;
$$;

comment on function display.pairings_presence_trigger() is 
  'Syncs pairings presence data to connection_heartbeats using device_uuid';

-- Update prevent_immutable_device_updates to not check pairing_code
create or replace function display.prevent_immutable_device_updates()
returns trigger
language plpgsql
as $$
begin
  -- Prevent updates to immutable device identity fields
  -- These fields should NEVER change after initial provisioning
  if old.serial_number is distinct from new.serial_number then
    raise exception 'Cannot update immutable field: serial_number';
  end if;
  
  if old.device_id is distinct from new.device_id then
    raise exception 'Cannot update immutable field: device_id';
  end if;
  
  if old.key_hash is distinct from new.key_hash then
    raise exception 'Cannot update immutable field: key_hash';
  end if;
  
  -- Note: pairing_code is now mutable (can be regenerated on demand)
  
  return new;
end;
$$;

comment on function display.prevent_immutable_device_updates() is 
  'Prevents updates to immutable device identity fields (serial_number, device_id, key_hash)';

-- =============================================================================
-- PHASE 1G: CREATE NEW RLS POLICIES (legacy policies already dropped in Phase 0)
-- =============================================================================

-- Create new commands policies using device_uuid
create policy "commands_app_insert_uuid" on display.commands
  for insert
  with check (
    auth.role() = 'authenticated'
    and (auth.jwt() ->> 'token_type') = 'app'
    and device_uuid = (auth.jwt() ->> 'device_uuid')::uuid
  );

comment on policy "commands_app_insert_uuid" on display.commands is 
  'Apps can insert commands for devices they have app tokens for (by device_uuid)';

create policy "commands_app_select_uuid" on display.commands
  for select
  using (
    auth.role() = 'authenticated'
    and (auth.jwt() ->> 'token_type') = 'app'
    and device_uuid = (auth.jwt() ->> 'device_uuid')::uuid
  );

comment on policy "commands_app_select_uuid" on display.commands is 
  'Apps can select commands for devices they have app tokens for (by device_uuid)';

create policy "commands_device_select_uuid" on display.commands
  for select
  using (
    auth.role() = 'authenticated'
    and (auth.jwt() ->> 'token_type') = 'device'
    and device_uuid = (auth.jwt() ->> 'device_uuid')::uuid
  );

comment on policy "commands_device_select_uuid" on display.commands is 
  'Devices can select their own commands (by device_uuid from JWT)';

create policy "commands_device_update_uuid" on display.commands
  for update
  using (
    auth.role() = 'authenticated'
    and (auth.jwt() ->> 'token_type') = 'device'
    and device_uuid = (auth.jwt() ->> 'device_uuid')::uuid
  );

comment on policy "commands_device_update_uuid" on display.commands is 
  'Devices can update (ack) their own commands (by device_uuid from JWT)';

-- Create new oauth_tokens policies using device_uuid (legacy policies already dropped in Phase 0)
create policy "oauth_tokens_device_delete_uuid" on display.oauth_tokens
  for delete
  using (
    device_uuid is not null
    and device_uuid = (auth.jwt() ->> 'device_uuid')::uuid
  );

comment on policy "oauth_tokens_device_delete_uuid" on display.oauth_tokens is 
  'Devices can delete their own OAuth tokens (by device_uuid from JWT)';

create policy "oauth_tokens_device_insert_uuid" on display.oauth_tokens
  for insert
  with check (
    device_uuid is not null
    and device_uuid = (auth.jwt() ->> 'device_uuid')::uuid
  );

comment on policy "oauth_tokens_device_insert_uuid" on display.oauth_tokens is 
  'Devices can insert their own OAuth tokens (by device_uuid from JWT)';

create policy "oauth_tokens_device_select_uuid_new" on display.oauth_tokens
  for select
  using (
    device_uuid is not null
    and device_uuid = (auth.jwt() ->> 'device_uuid')::uuid
  );

comment on policy "oauth_tokens_device_select_uuid_new" on display.oauth_tokens is 
  'Devices can select their own OAuth tokens (by device_uuid from JWT)';

create policy "oauth_tokens_device_update_uuid" on display.oauth_tokens
  for update
  using (
    device_uuid is not null
    and device_uuid = (auth.jwt() ->> 'device_uuid')::uuid
  )
  with check (
    device_uuid is not null
    and device_uuid = (auth.jwt() ->> 'device_uuid')::uuid
  );

comment on policy "oauth_tokens_device_update_uuid" on display.oauth_tokens is 
  'Devices can update their own OAuth tokens (by device_uuid from JWT)';

-- Create new pairings policies using device_uuid (legacy policies already dropped in Phase 0)
create policy "pairings_app_select_uuid" on display.pairings
  for select
  using (
    auth.role() = 'authenticated'
    and (auth.jwt() ->> 'token_type') = 'app'
    and device_uuid = (auth.jwt() ->> 'device_uuid')::uuid
  );

comment on policy "pairings_app_select_uuid" on display.pairings is 
  'Apps can select pairings for devices they have app tokens for (by device_uuid)';

create policy "pairings_app_update_uuid" on display.pairings
  for update
  using (
    auth.role() = 'authenticated'
    and (auth.jwt() ->> 'token_type') = 'app'
    and device_uuid = (auth.jwt() ->> 'device_uuid')::uuid
  );

comment on policy "pairings_app_update_uuid" on display.pairings is 
  'Apps can update pairings for devices they have app tokens for (by device_uuid)';

create policy "pairings_device_select_uuid" on display.pairings
  for select
  using (
    auth.role() = 'authenticated'
    and (auth.jwt() ->> 'token_type') = 'device'
    and device_uuid = (auth.jwt() ->> 'device_uuid')::uuid
  );

comment on policy "pairings_device_select_uuid" on display.pairings is 
  'Devices can select their own pairing (by device_uuid from JWT)';

create policy "pairings_device_update_uuid" on display.pairings
  for update
  using (
    auth.role() = 'authenticated'
    and (auth.jwt() ->> 'token_type') = 'device'
    and device_uuid = (auth.jwt() ->> 'device_uuid')::uuid
  );

comment on policy "pairings_device_update_uuid" on display.pairings is 
  'Devices can update their own pairing (by device_uuid from JWT)';

-- =============================================================================
-- PHASE 1H: ADD PAIRING CODE CLEANUP FUNCTION
-- =============================================================================

-- Function to clear expired pairing codes
create or replace function display.clear_expired_pairing_codes()
returns integer
language plpgsql
as $$
declare
  cleared_devices integer;
  cleared_pairings integer;
begin
  -- Clear expired codes from devices table
  update display.devices
  set pairing_code = null, pairing_code_expires_at = null
  where pairing_code is not null
    and pairing_code_expires_at is not null
    and pairing_code_expires_at < now();
  get diagnostics cleared_devices = row_count;
  
  -- Clear expired codes from pairings table
  update display.pairings
  set pairing_code = null, pairing_code_expires_at = null
  where pairing_code is not null
    and pairing_code_expires_at is not null
    and pairing_code_expires_at < now();
  get diagnostics cleared_pairings = row_count;
  
  if cleared_devices + cleared_pairings > 0 then
    raise notice 'Cleared expired pairing codes: % devices, % pairings', 
      cleared_devices, cleared_pairings;
  end if;
  
  return cleared_devices + cleared_pairings;
end;
$$;

comment on function display.clear_expired_pairing_codes() is 
  'Clears expired temporary pairing codes from devices and pairings tables';

-- Function to generate a new temporary pairing code for a device
create or replace function display.generate_pairing_code(
  target_device_uuid uuid,
  expiry_minutes integer default 10
)
returns text
language plpgsql
security definer
as $$
declare
  new_code text;
  expiry_time timestamptz;
begin
  -- Generate 6-character alphanumeric code (uppercase for readability)
  new_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
  expiry_time := now() + (expiry_minutes || ' minutes')::interval;
  
  -- Update devices table with new code
  update display.devices
  set pairing_code = new_code,
      pairing_code_expires_at = expiry_time
  where id = target_device_uuid;
  
  -- Also update pairings table
  update display.pairings
  set pairing_code = new_code,
      pairing_code_expires_at = expiry_time
  where device_uuid = target_device_uuid;
  
  return new_code;
end;
$$;

comment on function display.generate_pairing_code(uuid, integer) is 
  'Generates a new temporary pairing code for a device with configurable expiry (default 10 minutes)';

-- Function to clear pairing code after successful pairing
create or replace function display.clear_pairing_code(target_device_uuid uuid)
returns void
language plpgsql
security definer
as $$
begin
  update display.devices
  set pairing_code = null, pairing_code_expires_at = null
  where id = target_device_uuid;
  
  update display.pairings
  set pairing_code = null, pairing_code_expires_at = null
  where device_uuid = target_device_uuid;
end;
$$;

comment on function display.clear_pairing_code(uuid) is 
  'Clears pairing code after successful user pairing (called by exchange-pairing-code)';

-- =============================================================================
-- PHASE 1I: DROP DEVICES UNIQUE CONSTRAINT ON PAIRING_CODE
-- =============================================================================

-- Drop the unique constraint on pairing_code (no longer needed as it's temporary)
alter table display.devices 
drop constraint if exists devices_pairing_code_key;

-- Drop old indexes
drop index if exists display.idx_devices_pairing_code;
drop index if exists display.idx_devices_pairing_code_unique;

-- Create partial unique index (only when pairing_code is not null)
create unique index idx_devices_pairing_code_unique 
on display.devices (pairing_code) 
where pairing_code is not null;

comment on index display.idx_devices_pairing_code_unique is 
  'Partial unique index for active pairing codes on devices (only enforced when not null)';

-- =============================================================================
-- PHASE 1J: ADD PUBLIC WRAPPER FOR RATE LIMIT (if not exists)
-- =============================================================================

-- Create public wrapper for check_rate_limit (used by edge functions)
create or replace function public.display_check_rate_limit(
  rate_key text,
  max_requests integer default 12,
  window_seconds integer default 60
)
returns boolean
language plpgsql
security definer
as $$
begin
  return display.check_rate_limit(rate_key, max_requests, window_seconds);
end;
$$;

comment on function public.display_check_rate_limit(text, integer, integer) is 
  'Public wrapper for display.check_rate_limit, used by edge functions';

-- =============================================================================
-- COMMIT TRANSACTION
-- =============================================================================

commit;

-- =============================================================================
-- POST-MIGRATION NOTES
-- =============================================================================
-- 
-- After running this migration:
-- 1. Deploy updated edge functions that use device_uuid instead of pairing_code
-- 2. Deploy updated firmware that stores device_uuid as primary identity
-- 3. Deploy updated website that queries by device_uuid
-- 4. Run security advisors to verify RLS coverage
--
-- To test pairing code generation:
--   SELECT display.generate_pairing_code('your-device-uuid-here'::uuid, 10);
--
-- To manually clear expired codes:
--   SELECT display.clear_expired_pairing_codes();
--
-- =============================================================================
