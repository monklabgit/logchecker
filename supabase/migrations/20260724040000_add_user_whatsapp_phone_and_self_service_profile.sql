update public.profiles
set phone = ''
where phone is null;

alter table public.profiles
  alter column phone set default '',
  alter column phone set not null;

create or replace function public.normalize_whatsapp_phone(phone_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  normalized_phone text;
begin
  normalized_phone := regexp_replace(coalesce(phone_value, ''), '[^0-9]', '', 'g');

  if normalized_phone = '' then
    return '';
  end if;

  if length(normalized_phone) in (10, 11) then
    normalized_phone := '55' || normalized_phone;
  end if;

  if length(normalized_phone) < 12 or length(normalized_phone) > 15 then
    raise exception 'Invalid WhatsApp number';
  end if;

  return normalized_phone;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    left(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 120),
    public.normalize_whatsapp_phone(new.raw_user_meta_data ->> 'phone')
  );
  return new;
end;
$$;

create or replace function public.update_own_profile(
  target_full_name text,
  target_phone text
)
returns table (
  id uuid,
  full_name text,
  phone text,
  role public.user_role,
  active boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_name text;
  normalized_phone text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  normalized_name := left(trim(coalesce(target_full_name, '')), 120);
  if normalized_name = '' then
    raise exception 'Name is required';
  end if;

  normalized_phone := public.normalize_whatsapp_phone(target_phone);
  if normalized_phone = '' then
    raise exception 'WhatsApp number is required';
  end if;

  update public.profiles profile
  set
    full_name = normalized_name,
    phone = normalized_phone
  where profile.id = auth.uid();

  if not found then
    raise exception 'Profile not found';
  end if;

  return query
  select profile.id, profile.full_name, profile.phone, profile.role, profile.active
  from public.profiles profile
  where profile.id = auth.uid();
end;
$$;

drop function if exists public.admin_list_profiles();
create function public.admin_list_profiles()
returns table (
  id uuid,
  email text,
  full_name text,
  phone text,
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
  if not public.current_user_has_access('manage_users') then
    raise exception 'User cannot manage users';
  end if;

  return query
  select
    profile.id::uuid,
    coalesce(auth_user.email::text, '')::text,
    profile.full_name::text,
    profile.phone::text,
    profile.role::public.user_role,
    profile.active::boolean,
    profile.created_at::timestamptz,
    profile.updated_at::timestamptz
  from public.profiles profile
  left join auth.users auth_user on auth_user.id = profile.id
  order by profile.created_at desc;
end;
$$;

grant execute on function public.update_own_profile(text, text) to authenticated;
grant execute on function public.admin_list_profiles() to authenticated;
revoke execute on function public.update_own_profile(text, text) from public, anon;
revoke execute on function public.admin_list_profiles() from public, anon;
revoke execute on function public.normalize_whatsapp_phone(text) from public, anon, authenticated;