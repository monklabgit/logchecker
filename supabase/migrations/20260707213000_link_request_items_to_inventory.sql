alter table public.request_items
add column if not exists inventory_item_id uuid references public.inventory_items(id) on delete set null;

create index if not exists request_items_inventory_item_idx
on public.request_items(inventory_item_id);

create or replace function public.sync_request_inventory_status(
  target_request_id uuid,
  next_status public.inventory_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.inventory_items inventory
  set status = next_status
  where exists (
    select 1
    from public.request_items item
    where item.request_id = target_request_id
      and item.inventory_item_id = inventory.id
  );
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

create or replace function public.advance_transport_task(
  target_task_id uuid,
  task_action text,
  action_note text default ''
)
returns public.transport_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.transport_tasks;
  role public.user_role;
begin
  select * into task
  from public.transport_tasks
  where id = target_task_id
  for update;

  if task.id is null then
    raise exception 'Task not found';
  end if;

  role := public.current_user_role();

  if task_action = 'claim' then
    if role not in ('driver', 'admin') or task.status <> 'available' then
      raise exception 'Task cannot be claimed';
    end if;

    update public.transport_tasks
    set
      status = 'assigned',
      assigned_driver_id = auth.uid(),
      claimed_at = now(),
      driver_note = trim(coalesce(action_note, ''))
    where id = task.id
    returning * into task;

  elsif task_action = 'start' then
    if task.status <> 'assigned'
      or (task.assigned_driver_id <> auth.uid() and role <> 'admin') then
      raise exception 'Task cannot be started';
    end if;

    update public.transport_tasks
    set
      status = 'in_route',
      started_at = now(),
      driver_note = trim(coalesce(action_note, driver_note))
    where id = task.id
    returning * into task;

    update public.surgery_requests
    set status = case task.type
      when 'delivery' then 'delivery_in_route'::public.request_status
      else 'pickup_in_route'::public.request_status
    end
    where id = task.request_id;

    perform public.sync_request_inventory_status(task.request_id, 'in_route'::public.inventory_status);

  elsif task_action = 'complete' then
    if task.status <> 'in_route'
      or (task.assigned_driver_id <> auth.uid() and role <> 'admin') then
      raise exception 'Task cannot be completed';
    end if;

    update public.transport_tasks
    set
      status = 'completed',
      completed_at = now(),
      driver_note = trim(coalesce(action_note, driver_note))
    where id = task.id
    returning * into task;

    update public.surgery_requests
    set status = case task.type
      when 'delivery' then 'delivered'::public.request_status
      else 'returned_stock'::public.request_status
    end
    where id = task.request_id;

    perform public.sync_request_inventory_status(
      task.request_id,
      case task.type
        when 'delivery' then 'hospital'::public.inventory_status
        else 'in_stock'::public.inventory_status
      end
    );

  else
    raise exception 'Unknown action';
  end if;

  return task;
end;
$$;

grant execute on function public.sync_request_inventory_status(uuid, public.inventory_status) to authenticated;
revoke execute on function public.sync_request_inventory_status(uuid, public.inventory_status) from public, anon;
