-- migration: create support_sessions table for remote support console
-- purpose: track remote support sessions where end users connect their esp32
-- devices via usb and admins get interactive serial console access
-- affected: creates display.support_sessions table with rls policies

-- create the support_sessions table
create table if not exists display.support_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  admin_id uuid references auth.users(id) on delete set null,
  status text not null default 'waiting'
    check (status in ('waiting', 'active', 'closed')),
  device_serial text,
  device_chip text,
  device_firmware text,
  created_at timestamptz not null default now(),
  joined_at timestamptz,
  closed_at timestamptz,
  close_reason text
);

comment on table display.support_sessions is 'Remote support sessions for interactive serial console access. Users create sessions by connecting devices via USB, admins join to get remote serial access.';

-- indexes for common query patterns
create index if not exists idx_support_sessions_user_id
  on display.support_sessions(user_id);

create index if not exists idx_support_sessions_status
  on display.support_sessions(status)
  where status in ('waiting', 'active');

create index if not exists idx_support_sessions_created_at
  on display.support_sessions(created_at);

-- enable row level security
alter table display.support_sessions enable row level security;

-- rls: authenticated users can view their own sessions
create policy "Users can view their own support sessions"
  on display.support_sessions
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- rls: admins can view all support sessions
create policy "Admins can view all support sessions"
  on display.support_sessions
  for select
  to authenticated
  using (
    exists (
      select 1 from display.user_profiles
      where user_profiles.user_id = (select auth.uid())
        and user_profiles.role in ('admin', 'superadmin')
    )
  );

-- rls: authenticated users can create their own sessions
create policy "Users can create their own support sessions"
  on display.support_sessions
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

-- rls: users can update their own sessions (e.g., close session, update device info)
create policy "Users can update their own support sessions"
  on display.support_sessions
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- rls: admins can update any session (e.g., join session, close session)
create policy "Admins can update any support session"
  on display.support_sessions
  for update
  to authenticated
  using (
    exists (
      select 1 from display.user_profiles
      where user_profiles.user_id = (select auth.uid())
        and user_profiles.role in ('admin', 'superadmin')
    )
  )
  with check (
    exists (
      select 1 from display.user_profiles
      where user_profiles.user_id = (select auth.uid())
        and user_profiles.role in ('admin', 'superadmin')
    )
  );

-- rls: users can delete their own sessions
create policy "Users can delete their own support sessions"
  on display.support_sessions
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- rls: admins can delete any session
create policy "Admins can delete any support session"
  on display.support_sessions
  for delete
  to authenticated
  using (
    exists (
      select 1 from display.user_profiles
      where user_profiles.user_id = (select auth.uid())
        and user_profiles.role in ('admin', 'superadmin')
    )
  );

-- enable realtime for this table so admin dashboard can see new/updated sessions
alter publication supabase_realtime add table display.support_sessions;

-- stale session cleanup function
-- closes sessions that have been open for more than 24 hours
-- called on page load or optionally via cron
create or replace function display.cleanup_stale_sessions()
returns integer
language plpgsql
security definer
as $$
declare
  closed_count integer;
begin
  update display.support_sessions
  set status = 'closed',
      closed_at = now(),
      close_reason = 'stale_cleanup'
  where status in ('waiting', 'active')
    and created_at < now() - interval '24 hours';

  get diagnostics closed_count = row_count;
  return closed_count;
end;
$$;

comment on function display.cleanup_stale_sessions() is 'Closes support sessions older than 24 hours. Safety net for orphaned sessions where the user closed their browser without ending the session.';

-- grant execute to authenticated and service_role (matches set_latest_release pattern)
grant execute on function display.cleanup_stale_sessions() to authenticated;
grant execute on function display.cleanup_stale_sessions() to service_role;
