create table if not exists public.surgery_request_instrumentators (
  request_id uuid not null references public.surgery_requests(id) on delete cascade,
  instrumentator_id uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (request_id, instrumentator_id)
);

create index if not exists surgery_request_instrumentators_instrumentator_idx
on public.surgery_request_instrumentators (instrumentator_id, request_id);

insert into public.surgery_request_instrumentators (
  request_id,
  instrumentator_id,
  assigned_by
)
select
  request.id,
  request.assigned_instrumentator_id,
  request.created_by
from public.surgery_requests request
where request.assigned_instrumentator_id is not null
on conflict (request_id, instrumentator_id) do nothing;

alter table public.surgery_request_instrumentators enable row level security;

drop policy if exists "Authorized users can read instrumentator assignments"
on public.surgery_request_instrumentators;
create policy "Authorized users can read instrumentator assignments"
on public.surgery_request_instrumentators for select to authenticated
using (
  public.current_user_has_access('view_agenda')
  or public.current_user_has_access('create_requests')
  or public.current_user_has_access('manage_requests')
);

grant select on public.surgery_request_instrumentators to authenticated;

create or replace function public.set_request_instrumentators(
  target_request_id uuid,
  target_instrumentator_ids uuid[] default '{}'::uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_ids uuid[];
  first_instrumentator_id uuid;
begin
  if not public.current_user_has_access('manage_requests') then
    raise exception 'User cannot manage requests';
  end if;

  if not exists (
    select 1 from public.surgery_requests request
    where request.id = target_request_id
  ) then
    raise exception 'Request not found';
  end if;

  select coalesce(array_agg(distinct selected_id), '{}'::uuid[])
  into normalized_ids
  from unnest(coalesce(target_instrumentator_ids, '{}'::uuid[])) selected_id
  where selected_id is not null;

  if exists (
    select 1
    from unnest(normalized_ids) selected_id
    left join public.profiles profile
      on profile.id = selected_id
      and profile.role = 'instrumentator'
      and profile.active = true
    where profile.id is null
  ) then
    raise exception 'Invalid instrumentator';
  end if;

  delete from public.surgery_request_instrumentators assignment
  where assignment.request_id = target_request_id
    and not (assignment.instrumentator_id = any(normalized_ids));

  insert into public.surgery_request_instrumentators (
    request_id,
    instrumentator_id,
    assigned_by
  )
  select target_request_id, selected_id, auth.uid()
  from unnest(normalized_ids) selected_id
  on conflict (request_id, instrumentator_id) do nothing;

  select selected_id
  into first_instrumentator_id
  from unnest(normalized_ids) selected_id
  order by selected_id
  limit 1;

  update public.surgery_requests
  set assigned_instrumentator_id = first_instrumentator_id
  where id = target_request_id;
end;
$$;

create or replace function public.create_surgery_request_with_instrumentators(
  request_data jsonb,
  items_data jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_request_id uuid;
  selected_ids uuid[];
  first_selected_id uuid;
  compatible_request_data jsonb;
begin
  select coalesce(array_agg(distinct selected_id), '{}'::uuid[])
  into selected_ids
  from (
    select nullif(trim(value), '')::uuid as selected_id
    from jsonb_array_elements_text(
      coalesce(request_data -> 'assigned_instrumentator_ids', '[]'::jsonb)
    )
  ) selected
  where selected_id is not null;

  select selected_id
  into first_selected_id
  from unnest(selected_ids) selected_id
  order by selected_id
  limit 1;

  compatible_request_data :=
    (request_data - 'assigned_instrumentator_ids')
    || jsonb_build_object('assigned_instrumentator_id', first_selected_id);

  new_request_id := public.create_surgery_request(
    compatible_request_data,
    items_data
  );

  if exists (
    select 1
    from unnest(selected_ids) selected_id
    left join public.profiles profile
      on profile.id = selected_id
      and profile.role = 'instrumentator'
      and profile.active = true
    where profile.id is null
  ) then
    raise exception 'Invalid instrumentator';
  end if;

  insert into public.surgery_request_instrumentators (
    request_id,
    instrumentator_id,
    assigned_by
  )
  select new_request_id, selected_id, auth.uid()
  from unnest(selected_ids) selected_id
  on conflict (request_id, instrumentator_id) do nothing;
  return new_request_id;
end;
$$;

drop function if exists public.list_surgery_agenda(date, date);
create function public.list_surgery_agenda(period_start date, period_end date)
returns table (
  id uuid,
  code bigint,
  hospital text,
  surgeon text,
  patient text,
  surgery_date date,
  surgery_time time,
  procedure text,
  status public.request_status,
  priority smallint,
  assigned_instrumentator_ids uuid[],
  assigned_instrumentator_names text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.current_user_has_access('view_agenda') then
    raise exception 'Not authorized';
  end if;

  return query
  select
    request.id,
    request.code,
    request.hospital,
    request.surgeon,
    request.patient,
    request.surgery_date,
    request.surgery_time,
    request.procedure,
    request.status,
    request.priority,
    coalesce(assignments.ids, '{}'::uuid[]),
    coalesce(assignments.names, '{}'::text[])
  from public.surgery_requests request
  left join lateral (
    select
      array_agg(profile.id order by profile.full_name) as ids,
      array_agg(profile.full_name order by profile.full_name) as names
    from public.surgery_request_instrumentators assignment
    join public.profiles profile
      on profile.id = assignment.instrumentator_id
    where assignment.request_id = request.id
  ) assignments on true
  where request.surgery_date between period_start and period_end
    and request.status <> 'cancelled'
  order by request.surgery_date, request.surgery_time nulls last, request.code;
end;
$$;

grant execute on function public.set_request_instrumentators(uuid, uuid[]) to authenticated;
grant execute on function public.create_surgery_request_with_instrumentators(jsonb, jsonb) to authenticated;
grant execute on function public.list_surgery_agenda(date, date) to authenticated;

revoke execute on function public.set_request_instrumentators(uuid, uuid[]) from public, anon;
revoke execute on function public.create_surgery_request_with_instrumentators(jsonb, jsonb) from public, anon;
revoke execute on function public.list_surgery_agenda(date, date) from public, anon;
