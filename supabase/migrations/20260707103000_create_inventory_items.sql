create type public.inventory_category as enum (
  'instrumental',
  'opme'
);

create type public.inventory_status as enum (
  'in_stock',
  'in_route',
  'hospital',
  'consigned'
);

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  category public.inventory_category not null,
  description text not null,
  quantity text not null default '',
  kit text not null default '',
  cjk text not null default '',
  status public.inventory_status not null default 'in_stock',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index inventory_items_category_idx on public.inventory_items(category);
create index inventory_items_status_idx on public.inventory_items(status);
create index inventory_items_cjk_idx on public.inventory_items(cjk);
create index inventory_items_description_idx on public.inventory_items using gin (to_tsvector('portuguese', description));

alter table public.inventory_items enable row level security;

create trigger inventory_items_set_updated_at
  before update on public.inventory_items
  for each row execute procedure public.set_updated_at();

drop policy if exists "Admins and office can read inventory" on public.inventory_items;
create policy "Admins and office can read inventory"
on public.inventory_items for select
to authenticated
using (public.current_user_role() in ('admin', 'office'));

drop policy if exists "Admins and office can create inventory" on public.inventory_items;
create policy "Admins and office can create inventory"
on public.inventory_items for insert
to authenticated
with check (public.current_user_role() in ('admin', 'office'));

drop policy if exists "Admins and office can update inventory" on public.inventory_items;
create policy "Admins and office can update inventory"
on public.inventory_items for update
to authenticated
using (public.current_user_role() in ('admin', 'office'))
with check (public.current_user_role() in ('admin', 'office'));

drop policy if exists "Admins can delete inventory" on public.inventory_items;
create policy "Admins can delete inventory"
on public.inventory_items for delete
to authenticated
using (public.is_admin());

grant select, insert, update, delete on public.inventory_items to authenticated;

insert into public.role_access_scopes (role, access_key, enabled)
values
  ('pending', 'manage_inventory', false),
  ('admin', 'manage_inventory', true),
  ('office', 'manage_inventory', true),
  ('driver', 'manage_inventory', false),
  ('instrumentator', 'manage_inventory', false)
on conflict (role, access_key) do nothing;
