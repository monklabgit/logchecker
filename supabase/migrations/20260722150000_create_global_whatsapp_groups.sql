create table if not exists public.whatsapp_group_settings (
  singleton boolean primary key default true check (singleton),
  logistics_group_jid text not null default '',
  logistics_group_name text not null default '',
  kit_control_group_jid text not null default '',
  kit_control_group_name text not null default '',
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.whatsapp_group_settings (
  singleton,
  logistics_group_jid,
  logistics_group_name,
  kit_control_group_jid,
  kit_control_group_name
)
select
  true,
  connection.group_jid,
  connection.group_name,
  connection.kit_control_group_jid,
  connection.kit_control_group_name
from public.user_whatsapp_connections connection
join auth.users app_user on app_user.id = connection.profile_id
where lower(app_user.email) = 'email@teste.com.br'
limit 1
on conflict (singleton) do update
set
  logistics_group_jid = excluded.logistics_group_jid,
  logistics_group_name = excluded.logistics_group_name,
  kit_control_group_jid = excluded.kit_control_group_jid,
  kit_control_group_name = excluded.kit_control_group_name,
  updated_at = now();

insert into public.whatsapp_group_settings (singleton)
values (true)
on conflict (singleton) do nothing;

alter table public.whatsapp_group_settings enable row level security;

drop policy if exists "Authenticated users can read global WhatsApp groups"
on public.whatsapp_group_settings;
create policy "Authenticated users can read global WhatsApp groups"
on public.whatsapp_group_settings for select
to authenticated
using (true);

drop policy if exists "Admins can update global WhatsApp groups"
on public.whatsapp_group_settings;
create policy "Admins can update global WhatsApp groups"
on public.whatsapp_group_settings for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

grant select, update on public.whatsapp_group_settings to authenticated;