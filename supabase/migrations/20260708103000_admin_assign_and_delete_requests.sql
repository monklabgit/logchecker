create or replace function public.assign_transport_task(
  target_task_id uuid,
  target_driver_id uuid,
  action_note text default ''
)
returns public.transport_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.transport_tasks;
  driver public.profiles;
begin
  if not public.is_operations_staff() then
    raise exception 'Not authorized';
  end if;

  select *
  into task
  from public.transport_tasks
  where id = target_task_id
  for update;

  if task.id is null then
    raise exception 'Task not found';
  end if;

  if task.status not in ('available', 'assigned') then
    raise exception 'Only available or assigned tasks can be designated';
  end if;

  select *
  into driver
  from public.profiles
  where id = target_driver_id
    and role = 'driver'
    and active = true;

  if driver.id is null then
    raise exception 'Driver not found';
  end if;

  update public.transport_tasks
  set
    status = 'assigned',
    assigned_driver_id = driver.id,
    claimed_at = coalesce(claimed_at, now()),
    driver_note = trim(coalesce(action_note, driver_note))
  where id = task.id
  returning * into task;

  return task;
end;
$$;

create or replace function public.delete_surgery_request_permanently(
  target_request_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_operations_staff() then
    raise exception 'Not authorized';
  end if;

  if not exists (
    select 1
    from public.surgery_requests
    where id = target_request_id
  ) then
    raise exception 'Request not found';
  end if;

  perform public.sync_request_inventory_status(target_request_id, 'in_stock'::public.inventory_status);

  delete from public.surgery_requests
  where id = target_request_id;
end;
$$;

grant execute on function public.assign_transport_task(uuid, uuid, text) to authenticated;
grant execute on function public.delete_surgery_request_permanently(uuid) to authenticated;

revoke execute on function public.assign_transport_task(uuid, uuid, text) from public, anon;
revoke execute on function public.delete_surgery_request_permanently(uuid) from public, anon;
