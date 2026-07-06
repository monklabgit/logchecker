do $$
declare
  target_user_id uuid;
begin
  select id
  into target_user_id
  from auth.users
  where lower(email) = lower('email@teste.com.br')
  limit 1;

  if target_user_id is null then
    raise exception 'User email@teste.com.br was not found';
  end if;

  update public.profiles
  set
    role = 'admin',
    active = true,
    updated_at = now()
  where id = target_user_id;

  if not found then
    raise exception 'Profile for email@teste.com.br was not found';
  end if;
end;
$$;
