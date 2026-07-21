alter table public.surgery_requests
add column if not exists insurance text not null default '';

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
        select id
        into selected_inventory_item_id
        from public.inventory_items
        where id = (item ->> 'inventory_item_id')::uuid;
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

