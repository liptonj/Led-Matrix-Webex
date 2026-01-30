drop policy if exists admin_users_admin_read on display.admin_users;

create policy admin_users_self_read
on display.admin_users
for select
using (
  auth.role() = 'service_role'
  or auth.uid() = user_id
);
