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
    profiles.id::uuid,
    coalesce(users.email::text, '')::text as email,
    profiles.full_name::text,
    profiles.role::public.user_role,
    profiles.active::boolean,
    profiles.created_at::timestamptz,
    profiles.updated_at::timestamptz
  from public.profiles
  left join auth.users on users.id = profiles.id
  order by profiles.created_at desc;
end;
$$;

grant execute on function public.admin_list_profiles() to authenticated;
