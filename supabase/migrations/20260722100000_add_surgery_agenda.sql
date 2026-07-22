insert into public.role_access_scopes (role, access_key, enabled)
values
  ('pending', 'view_agenda', false),
  ('admin', 'view_agenda', true),
  ('office', 'view_agenda', true),
  ('driver', 'view_agenda', false),
  ('instrumentator', 'view_agenda', true)
on conflict (role, access_key) do nothing;
alter table public.surgery_requests
add column if not exists assigned_instrumentator_id uuid references public.profiles(id) on delete set null;

create index if not exists surgery_requests_instrumentator_date_idx
on public.surgery_requests (assigned_instrumentator_id, surgery_date, surgery_time);

create or replace function public.list_active_instrumentators()
returns table (id uuid, full_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_operations_staff() and not public.current_user_has_access('view_agenda') then
    raise exception 'Not authorized';
  end if;

  return query
  select profile.id, profile.full_name
  from public.profiles profile
  where profile.role = 'instrumentator'
    and profile.active = true
  order by profile.full_name;
end;
$$;

create or replace function public.list_surgery_agenda(period_start date, period_end date)
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
  assigned_instrumentator_id uuid,
  assigned_instrumentator_name text
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
    request.assigned_instrumentator_id,
    instrumentator.full_name
  from public.surgery_requests request
  left join public.profiles instrumentator on instrumentator.id = request.assigned_instrumentator_id
  where request.surgery_date between period_start and period_end
    and request.status <> 'cancelled'
  order by request.surgery_date, request.surgery_time nulls last, request.code;
end;
$$;

create or replace function public.assign_request_instrumentator(
  target_request_id uuid,
  target_instrumentator_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.current_user_role() not in ('admin', 'office') then
    raise exception 'Not authorized';
  end if;

  if target_instrumentator_id is not null and not exists (
    select 1
    from public.profiles profile
    where profile.id = target_instrumentator_id
      and profile.role = 'instrumentator'
      and profile.active = true
  ) then
    raise exception 'Invalid instrumentator';
  end if;

  update public.surgery_requests
  set assigned_instrumentator_id = target_instrumentator_id
  where id = target_request_id;

  if not found then
    raise exception 'Request not found';
  end if;
end;
$$;

create or replace function public.create_surgery_request(
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
  selected_hospital public.hospitals;
  selected_inventory_item_id uuid;
  selected_instrumentator_id uuid;
  item jsonb;
  hospital_name text;
begin
  if not public.is_operations_staff() then
    raise exception 'Not authorized';
  end if;

  if nullif(request_data ->> 'hospital_id', '') is not null then
    select *
    into selected_hospital
    from public.hospitals
    where id = (request_data ->> 'hospital_id')::uuid
      and active = true;
  end if;

  if nullif(request_data ->> 'assigned_instrumentator_id', '') is not null then
    select profile.id
    into selected_instrumentator_id
    from public.profiles profile
    where profile.id = (request_data ->> 'assigned_instrumentator_id')::uuid
      and profile.role = 'instrumentator'
      and profile.active = true;

    if selected_instrumentator_id is null then
      raise exception 'Invalid instrumentator';
    end if;
  end if;

  hospital_name := coalesce(
    nullif(trim(selected_hospital.name), ''),
    nullif(trim(coalesce(request_data ->> 'hospital', '')), '')
  );

  if hospital_name is null then
    raise exception 'Hospital is required';
  end if;

  insert into public.surgery_requests (
    hospital_id,
    hospital,
    surgeon,
    patient,
    surgery_date,
    surgery_time,
    procedure,
    insurance,
    assigned_instrumentator_id,
    observation,
    origin,
    priority,
    created_by
  )
  values (
    selected_hospital.id,
    hospital_name,
    trim(coalesce(request_data ->> 'surgeon', '')),
    trim(coalesce(request_data ->> 'patient', '')),
    nullif(request_data ->> 'surgery_date', '')::date,
    nullif(request_data ->> 'surgery_time', '')::time,
    trim(coalesce(request_data ->> 'procedure', '')),
    trim(coalesce(request_data ->> 'insurance', '')),
    selected_instrumentator_id,
    trim(coalesce(request_data ->> 'observation', '')),
    coalesce(nullif(request_data ->> 'origin', '')::public.request_origin, 'manual'),
    coalesce(nullif(request_data ->> 'priority', '')::smallint, 2),
    auth.uid()
  )
  returning id into new_request_id;

  for item in select value from jsonb_array_elements(coalesce(items_data, '[]'::jsonb))
  loop
    if trim(coalesce(item ->> 'description', '')) <> '' then
      selected_inventory_item_id := null;

      if nullif(item ->> 'inventory_item_id', '') is not null then
        select inventory.id
        into selected_inventory_item_id
        from public.inventory_items inventory
        where inventory.id = (item ->> 'inventory_item_id')::uuid;
      end if;

      insert into public.request_items (
        request_id,
        inventory_item_id,
        section,
        quantity,
        description,
        note
      )
      values (
        new_request_id,
        selected_inventory_item_id,
        coalesce(nullif(item ->> 'section', '')::public.material_section, 'OTHER'),
        trim(coalesce(item ->> 'quantity', '')),
        trim(item ->> 'description'),
        trim(coalesce(item ->> 'note', ''))
      );
    end if;
  end loop;

  insert into public.transport_tasks (
    request_id,
    type,
    status,
    origin_label,
    destination_label,
    scheduled_for,
    created_by
  )
  values (
    new_request_id,
    'delivery',
    'available',
    'Estoque',
    hospital_name,
    case
      when nullif(request_data ->> 'surgery_date', '') is null then null
      else (
        (request_data ->> 'surgery_date')::date
        + coalesce(nullif(request_data ->> 'surgery_time', '')::time, time '00:00')
      )::timestamptz
    end,
    auth.uid()
  );

  return new_request_id;
end;
$$;

grant execute on function public.list_active_instrumentators() to authenticated;
grant execute on function public.list_surgery_agenda(date, date) to authenticated;
grant execute on function public.assign_request_instrumentator(uuid, uuid) to authenticated;

revoke execute on function public.list_active_instrumentators() from public, anon;
revoke execute on function public.list_surgery_agenda(date, date) from public, anon;
revoke execute on function public.assign_request_instrumentator(uuid, uuid) from public, anon;
