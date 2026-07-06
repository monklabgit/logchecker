create table public.user_whatsapp_connections (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  instance_name text not null unique,
  connection_state text not null default 'close',
  group_jid text not null default '',
  group_name text not null default '',
  last_qr_at timestamptz,
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger user_whatsapp_connections_set_updated_at
  before update on public.user_whatsapp_connections
  for each row execute procedure public.set_updated_at();

alter table public.user_whatsapp_connections enable row level security;

create policy "Users can read own WhatsApp connection"
on public.user_whatsapp_connections for select
to authenticated
using (profile_id = auth.uid());

create policy "Users can create own WhatsApp connection"
on public.user_whatsapp_connections for insert
to authenticated
with check (profile_id = auth.uid());

create policy "Users can update own WhatsApp connection"
on public.user_whatsapp_connections for update
to authenticated
using (profile_id = auth.uid())
with check (profile_id = auth.uid());

create policy "Users can delete own WhatsApp connection"
on public.user_whatsapp_connections for delete
to authenticated
using (profile_id = auth.uid());

grant select, insert, update, delete on public.user_whatsapp_connections to authenticated;
