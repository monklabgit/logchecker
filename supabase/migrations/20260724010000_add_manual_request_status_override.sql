create or replace function public.set_request_status_manually(
  target_request_id uuid,
  target_status public.request_status,
  action_note text default ''
)
returns public.request_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.surgery_requests;
  delivery_driver_id uuid;
  pickup_driver_id uuid;
  new_task_id uuid;
  manual_note text;
  scheduled_at timestamptz;
begin
  if not public.current_user_has_access('manage_requests') then
    raise exception 'User cannot manage requests';
  end if;

  if target_status = 'cancelled'::public.request_status then
    raise exception 'Use the cancellation action to cancel a request';
  end if;

  select *
  into request_row
  from public.surgery_requests
  where id = target_request_id
  for update;

  if request_row.id is null then
    raise exception 'Request not found';
  end if;

  if request_row.status = 'cancelled'::public.request_status then
    raise exception 'Cancelled requests cannot have their status changed manually';
  end if;

  if request_row.status = target_status then
    return request_row.status;
  end if;

  select task.assigned_driver_id
  into delivery_driver_id
  from public.transport_tasks task
  where task.request_id = target_request_id
    and task.type = 'delivery'::public.transport_type
    and task.assigned_driver_id is not null
  order by task.created_at desc
  limit 1;

  select task.assigned_driver_id
  into pickup_driver_id
  from public.transport_tasks task
  where task.request_id = target_request_id
    and task.type = 'pickup'::public.transport_type
    and task.assigned_driver_id is not null
  order by task.created_at desc
  limit 1;

  manual_note := 'Ajuste manual de status: '
    || request_row.status::text
    || ' -> '
    || target_status::text;

  if nullif(trim(coalesce(action_note, '')), '') is not null then
    manual_note := manual_note || ' - ' || trim(action_note);
  end if;

  scheduled_at := case
    when request_row.surgery_date is null then null
    else (
      request_row.surgery_date
      + coalesce(request_row.surgery_time, time '00:00')
    )::timestamptz
  end;

  update public.transport_tasks
  set status = 'cancelled'::public.transport_status,
      driver_note = manual_note
  where request_id = target_request_id
    and status not in ('completed'::public.transport_status, 'cancelled'::public.transport_status);

  if target_status = 'ready_delivery'::public.request_status then
    insert into public.transport_tasks (
      request_id, type, status, origin_label, destination_label,
      scheduled_for, driver_note, created_by
    ) values (
      target_request_id, 'delivery', 'available', 'Estoque', request_row.hospital,
      scheduled_at, manual_note, auth.uid()
    );

  elsif target_status = 'delivery_in_route'::public.request_status then
    insert into public.transport_tasks (
      request_id, type, status, assigned_driver_id, origin_label, destination_label,
      scheduled_for, driver_note, created_by
    ) values (
      target_request_id, 'delivery', 'available', delivery_driver_id, 'Estoque', request_row.hospital,
      scheduled_at, manual_note, auth.uid()
    ) returning id into new_task_id;

    update public.transport_tasks
    set status = 'in_route', started_at = now(), driver_note = manual_note
    where id = new_task_id;

  elsif target_status in (
    'delivered'::public.request_status,
    'ready_pickup'::public.request_status,
    'pickup_in_route'::public.request_status,
    'returned_stock'::public.request_status
  ) then
    if not exists (
      select 1 from public.transport_tasks task
      where task.request_id = target_request_id
        and task.type = 'delivery'::public.transport_type
        and task.status = 'completed'::public.transport_status
    ) then
      insert into public.transport_tasks (
        request_id, type, status, assigned_driver_id, origin_label, destination_label,
        scheduled_for, driver_note, created_by
      ) values (
        target_request_id, 'delivery', 'available', delivery_driver_id, 'Estoque', request_row.hospital,
        scheduled_at, manual_note, auth.uid()
      ) returning id into new_task_id;

      update public.transport_tasks
      set status = 'completed', completed_at = now(), driver_note = manual_note
      where id = new_task_id;
    end if;

    if target_status = 'ready_pickup'::public.request_status then
      insert into public.transport_tasks (
        request_id, type, status, origin_label, destination_label,
        driver_note, created_by
      ) values (
        target_request_id, 'pickup', 'available', request_row.hospital, 'Estoque',
        manual_note, auth.uid()
      );

    elsif target_status = 'pickup_in_route'::public.request_status then
      insert into public.transport_tasks (
        request_id, type, status, assigned_driver_id, origin_label, destination_label,
        driver_note, created_by
      ) values (
        target_request_id, 'pickup', 'available', pickup_driver_id, request_row.hospital, 'Estoque',
        manual_note, auth.uid()
      ) returning id into new_task_id;

      update public.transport_tasks
      set status = 'in_route', started_at = now(), driver_note = manual_note
      where id = new_task_id;

    elsif target_status = 'returned_stock'::public.request_status and not exists (
      select 1 from public.transport_tasks task
      where task.request_id = target_request_id
        and task.type = 'pickup'::public.transport_type
        and task.status = 'completed'::public.transport_status
    ) then
      insert into public.transport_tasks (
        request_id, type, status, assigned_driver_id, origin_label, destination_label,
        driver_note, created_by
      ) values (
        target_request_id, 'pickup', 'available', pickup_driver_id, request_row.hospital, 'Estoque',
        manual_note, auth.uid()
      ) returning id into new_task_id;

      update public.transport_tasks
      set status = 'completed', completed_at = now(), driver_note = manual_note
      where id = new_task_id;
    end if;
  end if;

  update public.surgery_requests
  set status = target_status
  where id = target_request_id;

  perform public.sync_request_inventory_status(
    target_request_id,
    case target_status
      when 'ready_delivery'::public.request_status then 'in_stock'::public.inventory_status
      when 'delivery_in_route'::public.request_status then 'in_route'::public.inventory_status
      when 'delivered'::public.request_status then 'hospital'::public.inventory_status
      when 'ready_pickup'::public.request_status then 'hospital'::public.inventory_status
      when 'pickup_in_route'::public.request_status then 'in_route'::public.inventory_status
      when 'returned_stock'::public.request_status then 'in_stock'::public.inventory_status
      else 'in_stock'::public.inventory_status
    end
  );

  return target_status;
end;
$$;

revoke all on function public.set_request_status_manually(uuid, public.request_status, text) from public, anon;
grant execute on function public.set_request_status_manually(uuid, public.request_status, text) to authenticated;
