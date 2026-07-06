create table if not exists public.role_access_scopes (
  role public.user_role not null,
  access_key text not null,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (role, access_key)
);

alter table public.role_access_scopes enable row level security;

drop trigger if exists role_access_scopes_set_updated_at on public.role_access_scopes;
create trigger role_access_scopes_set_updated_at
  before update on public.role_access_scopes
  for each row execute procedure public.set_updated_at();

insert into public.role_access_scopes (role, access_key, enabled)
values
  ('pending', 'view_dashboard', false),
  ('pending', 'create_requests', false),
  ('pending', 'manage_hospitals', false),
  ('pending', 'manage_users', false),
  ('pending', 'claim_routes', false),
  ('pending', 'complete_delivery', false),
  ('pending', 'release_materials', false),
  ('pending', 'complete_pickup', false),
  ('pending', 'view_evidence', false),
  ('pending', 'manage_whatsapp', false),
  ('admin', 'view_dashboard', true),
  ('admin', 'create_requests', true),
  ('admin', 'manage_hospitals', true),
  ('admin', 'manage_users', true),
  ('admin', 'claim_routes', true),
  ('admin', 'complete_delivery', true),
  ('admin', 'release_materials', true),
  ('admin', 'complete_pickup', true),
  ('admin', 'view_evidence', true),
  ('admin', 'manage_whatsapp', true),
  ('office', 'view_dashboard', true),
  ('office', 'create_requests', true),
  ('office', 'manage_hospitals', false),
  ('office', 'manage_users', false),
  ('office', 'claim_routes', false),
  ('office', 'complete_delivery', false),
  ('office', 'release_materials', true),
  ('office', 'complete_pickup', false),
  ('office', 'view_evidence', true),
  ('office', 'manage_whatsapp', true),
  ('driver', 'view_dashboard', true),
  ('driver', 'create_requests', false),
  ('driver', 'manage_hospitals', false),
  ('driver', 'manage_users', false),
  ('driver', 'claim_routes', true),
  ('driver', 'complete_delivery', true),
  ('driver', 'release_materials', false),
  ('driver', 'complete_pickup', true),
  ('driver', 'view_evidence', true),
  ('driver', 'manage_whatsapp', true),
  ('instrumentator', 'view_dashboard', true),
  ('instrumentator', 'create_requests', false),
  ('instrumentator', 'manage_hospitals', false),
  ('instrumentator', 'manage_users', false),
  ('instrumentator', 'claim_routes', false),
  ('instrumentator', 'complete_delivery', false),
  ('instrumentator', 'release_materials', true),
  ('instrumentator', 'complete_pickup', false),
  ('instrumentator', 'view_evidence', true),
  ('instrumentator', 'manage_whatsapp', true)
on conflict (role, access_key) do nothing;

drop policy if exists "Authenticated users can read role access scopes" on public.role_access_scopes;
create policy "Authenticated users can read role access scopes"
on public.role_access_scopes for select
to authenticated
using (true);

drop policy if exists "Admins can manage role access scopes" on public.role_access_scopes;
create policy "Admins can manage role access scopes"
on public.role_access_scopes for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

grant select, insert, update, delete on public.role_access_scopes to authenticated;

create or replace function public.admin_list_profiles()
returns table (
  id uuid,
  email text,
  full_name text,
  role public.user_role,
  active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only administrators can list users';
  end if;

  return query
  select
    profiles.id,
    coalesce(users.email, '') as email,
    profiles.full_name,
    profiles.role,
    profiles.active,
    profiles.created_at,
    profiles.updated_at
  from public.profiles
  left join auth.users on users.id = profiles.id
  order by profiles.created_at desc;
end;
$$;

grant execute on function public.admin_list_profiles() to authenticated;
