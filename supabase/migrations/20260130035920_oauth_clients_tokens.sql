-- OAuth clients/tokens storage (secrets stored in vault)

create table if not exists display.oauth_clients (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  client_id text not null,
  client_secret_id uuid not null,
  redirect_uri text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists display.oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  device_id text not null,
  serial_number text not null,
  pairing_code text not null,
  access_token_id uuid not null,
  refresh_token_id uuid null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS
alter table display.oauth_clients enable row level security;
alter table display.oauth_tokens enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='display' and tablename='oauth_clients' and policyname='oauth_clients_admin_select'
  ) then
    create policy oauth_clients_admin_select
      on display.oauth_clients
      for select
      using (exists (select 1 from display.admin_users au where au.user_id = auth.uid()));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='display' and tablename='oauth_clients' and policyname='oauth_clients_admin_insert'
  ) then
    create policy oauth_clients_admin_insert
      on display.oauth_clients
      for insert
      with check (exists (select 1 from display.admin_users au where au.user_id = auth.uid()));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='display' and tablename='oauth_clients' and policyname='oauth_clients_admin_update'
  ) then
    create policy oauth_clients_admin_update
      on display.oauth_clients
      for update
      using (exists (select 1 from display.admin_users au where au.user_id = auth.uid()))
      with check (exists (select 1 from display.admin_users au where au.user_id = auth.uid()));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='display' and tablename='oauth_clients' and policyname='oauth_clients_admin_delete'
  ) then
    create policy oauth_clients_admin_delete
      on display.oauth_clients
      for delete
      using (exists (select 1 from display.admin_users au where au.user_id = auth.uid()));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='display' and tablename='oauth_tokens' and policyname='oauth_tokens_admin_select'
  ) then
    create policy oauth_tokens_admin_select
      on display.oauth_tokens
      for select
      using (exists (select 1 from display.admin_users au where au.user_id = auth.uid()));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='display' and tablename='oauth_tokens' and policyname='oauth_tokens_device_select'
  ) then
    create policy oauth_tokens_device_select
      on display.oauth_tokens
      for select
      using (
        (auth.jwt() ->> 'device_id') is not null and (auth.jwt() ->> 'device_id') = device_id
        or (auth.jwt() ->> 'serial_number') is not null and (auth.jwt() ->> 'serial_number') = serial_number
        or (auth.jwt() ->> 'pairing_code') is not null and (auth.jwt() ->> 'pairing_code') = pairing_code
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='display' and tablename='oauth_tokens' and policyname='oauth_tokens_device_insert'
  ) then
    create policy oauth_tokens_device_insert
      on display.oauth_tokens
      for insert
      with check (
        (auth.jwt() ->> 'device_id') is not null and (auth.jwt() ->> 'device_id') = device_id
        or (auth.jwt() ->> 'serial_number') is not null and (auth.jwt() ->> 'serial_number') = serial_number
        or (auth.jwt() ->> 'pairing_code') is not null and (auth.jwt() ->> 'pairing_code') = pairing_code
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='display' and tablename='oauth_tokens' and policyname='oauth_tokens_device_update'
  ) then
    create policy oauth_tokens_device_update
      on display.oauth_tokens
      for update
      using (
        (auth.jwt() ->> 'device_id') is not null and (auth.jwt() ->> 'device_id') = device_id
        or (auth.jwt() ->> 'serial_number') is not null and (auth.jwt() ->> 'serial_number') = serial_number
        or (auth.jwt() ->> 'pairing_code') is not null and (auth.jwt() ->> 'pairing_code') = pairing_code
      )
      with check (
        (auth.jwt() ->> 'device_id') is not null and (auth.jwt() ->> 'device_id') = device_id
        or (auth.jwt() ->> 'serial_number') is not null and (auth.jwt() ->> 'serial_number') = serial_number
        or (auth.jwt() ->> 'pairing_code') is not null and (auth.jwt() ->> 'pairing_code') = pairing_code
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='display' and tablename='oauth_tokens' and policyname='oauth_tokens_device_delete'
  ) then
    create policy oauth_tokens_device_delete
      on display.oauth_tokens
      for delete
      using (
        (auth.jwt() ->> 'device_id') is not null and (auth.jwt() ->> 'device_id') = device_id
        or (auth.jwt() ->> 'serial_number') is not null and (auth.jwt() ->> 'serial_number') = serial_number
        or (auth.jwt() ->> 'pairing_code') is not null and (auth.jwt() ->> 'pairing_code') = pairing_code
      );
  end if;
end $$;

create index if not exists oauth_tokens_device_id_idx on display.oauth_tokens (device_id);
create index if not exists oauth_tokens_serial_number_idx on display.oauth_tokens (serial_number);
create index if not exists oauth_tokens_pairing_code_idx on display.oauth_tokens (pairing_code);
create index if not exists oauth_tokens_provider_idx on display.oauth_tokens (provider);
create unique index if not exists oauth_tokens_provider_device_idx on display.oauth_tokens (provider, device_id);
