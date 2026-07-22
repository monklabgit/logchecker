insert into public.role_access_scopes (role, access_key, enabled)
values
  ('pending', 'view_requests', false), ('pending', 'manage_requests', false),
  ('admin', 'view_requests', true), ('admin', 'manage_requests', true),
  ('office', 'view_requests', true), ('office', 'manage_requests', true),
  ('driver', 'view_requests', false), ('driver', 'manage_requests', false),
  ('instrumentator', 'view_requests', false), ('instrumentator', 'manage_requests', false)
on conflict (role, access_key) do nothing;

create or replace function public.can_view_request(target_request_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.current_user_has_access('view_requests')
    or (
      public.current_user_has_access('view_dashboard')
      and (
        public.current_user_role() in ('admin', 'office', 'instrumentator')
        or exists (
          select 1 from public.transport_tasks task
          where task.request_id = target_request_id
            and (
              task.assigned_driver_id = auth.uid()
              or (public.current_user_role() = 'driver' and task.status = 'available')
            )
        )
      )
    );
$$;

drop policy if exists "Admins can manage role access scopes" on public.role_access_scopes;
create policy "Authorized users can manage role access scopes"
on public.role_access_scopes for all to authenticated
using (public.current_user_has_access('manage_users'))
with check (public.current_user_has_access('manage_users'));

drop policy if exists "Admins can read all profiles" on public.profiles;
drop policy if exists "Admins can update all profiles" on public.profiles;
create policy "Authorized users can read managed profiles"
on public.profiles for select to authenticated
using (
  public.current_user_has_access('manage_users')
  or public.current_user_has_access('manage_requests')
);
create policy "Authorized users can update managed profiles"
on public.profiles for update to authenticated
using (public.current_user_has_access('manage_users'))
with check (public.current_user_has_access('manage_users'));

create or replace function public.admin_list_profiles()
returns table (
  id uuid, email text, full_name text, role public.user_role,
  active boolean, created_at timestamptz, updated_at timestamptz
)
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.current_user_has_access('manage_users') then
    raise exception 'User cannot manage users';
  end if;
  return query
  select profiles.id::uuid, coalesce(users.email::text, '')::text,
    profiles.full_name::text, profiles.role::public.user_role,
    profiles.active::boolean, profiles.created_at::timestamptz,
    profiles.updated_at::timestamptz
  from public.profiles
  left join auth.users on users.id = profiles.id
  order by profiles.created_at desc;
end;
$$;

drop policy if exists "Operations can create requests" on public.surgery_requests;
drop policy if exists "Operations can update requests" on public.surgery_requests;
create policy "Authorized users can create requests"
on public.surgery_requests for insert to authenticated
with check (public.current_user_has_access('create_requests') and created_by = auth.uid());
create policy "Authorized users can update requests"
on public.surgery_requests for update to authenticated
using (public.current_user_has_access('manage_requests'))
with check (public.current_user_has_access('manage_requests'));

drop policy if exists "Operations can create request items" on public.request_items;
drop policy if exists "Operations can update request items" on public.request_items;
drop policy if exists "Operations can delete request items" on public.request_items;
create policy "Authorized users can create request items"
on public.request_items for insert to authenticated
with check (
  public.current_user_has_access('create_requests')
  or public.current_user_has_access('manage_requests')
);
create policy "Authorized users can update request items"
on public.request_items for update to authenticated
using (public.current_user_has_access('manage_requests'))
with check (public.current_user_has_access('manage_requests'));
create policy "Authorized users can delete request items"
on public.request_items for delete to authenticated
using (public.current_user_has_access('manage_requests'));

drop policy if exists "Authorized users can read transport tasks" on public.transport_tasks;
drop policy if exists "Operations can create transport tasks" on public.transport_tasks;
drop policy if exists "Operations can update transport tasks" on public.transport_tasks;
create policy "Authorized users can read transport tasks"
on public.transport_tasks for select to authenticated
using (public.can_view_request(request_id));
create policy "Authorized users can create transport tasks"
on public.transport_tasks for insert to authenticated
with check (
  (
    public.current_user_has_access('create_requests')
    or public.current_user_has_access('manage_requests')
    or public.current_user_has_access('release_materials')
  )
  and created_by = auth.uid()
);
create policy "Authorized users can update transport tasks"
on public.transport_tasks for update to authenticated
using (public.current_user_has_access('manage_requests'))
with check (public.current_user_has_access('manage_requests'));

drop policy if exists "Authenticated users can read active hospitals" on public.hospitals;
drop policy if exists "Operations can create hospitals" on public.hospitals;
drop policy if exists "Admins can update hospitals" on public.hospitals;
create policy "Authorized users can read hospitals"
on public.hospitals for select to authenticated
using (active = true or public.current_user_has_access('manage_hospitals'));
create policy "Authorized users can create hospitals"
on public.hospitals for insert to authenticated
with check (
  (
    public.current_user_has_access('manage_hospitals')
    or public.current_user_has_access('create_requests')
  ) and created_by = auth.uid()
);
create policy "Authorized users can update hospitals"
on public.hospitals for update to authenticated
using (public.current_user_has_access('manage_hospitals'))
with check (public.current_user_has_access('manage_hospitals'));

drop policy if exists "Admins and office can read inventory" on public.inventory_items;
drop policy if exists "Admins and office can create inventory" on public.inventory_items;
drop policy if exists "Admins and office can update inventory" on public.inventory_items;
drop policy if exists "Admins can delete inventory" on public.inventory_items;
create policy "Authorized users can read inventory"
on public.inventory_items for select to authenticated
using (
  public.current_user_has_access('manage_inventory')
  or public.current_user_has_access('create_requests')
);
create policy "Authorized users can create inventory"
on public.inventory_items for insert to authenticated
with check (
  public.current_user_has_access('manage_inventory')
  or public.current_user_has_access('create_requests')
);
create policy "Authorized users can update inventory"
on public.inventory_items for update to authenticated
using (public.current_user_has_access('manage_inventory'))
with check (public.current_user_has_access('manage_inventory'));
create policy "Authorized users can delete inventory"
on public.inventory_items for delete to authenticated
using (public.current_user_has_access('manage_inventory'));
drop policy if exists "Authorized users can read evidence photos" on public.transport_evidence_photos;
create policy "Authorized users can read evidence photos"
on public.transport_evidence_photos for select to authenticated
using (
  expires_at > now()
  and public.can_view_request(request_id)
  and (
    (finalized_at is not null and public.current_user_has_access('view_evidence'))
    or (
      finalized_at is null
      and (
        uploaded_by = auth.uid()
        or (photo_type = 'kit_control' and public.current_user_has_access('create_requests'))
        or (photo_type = 'instrumentator_release' and public.current_user_has_access('release_materials'))
        or (photo_type = 'delivery' and public.current_user_has_access('complete_delivery'))
        or (photo_type = 'pickup' and public.current_user_has_access('complete_pickup'))
      )
    )
  )
);
drop policy if exists "Authorized users can create evidence photos" on public.transport_evidence_photos;
create policy "Authorized users can create evidence photos"
on public.transport_evidence_photos for insert to authenticated
with check (
  uploaded_by = auth.uid()
  and finalized_at is null
  and expires_at <= now() + interval '31 days'
  and (
    (
      photo_type in ('delivery', 'pickup')
      and (
        (photo_type = 'delivery' and public.current_user_has_access('complete_delivery'))
        or (photo_type = 'pickup' and public.current_user_has_access('complete_pickup'))
      )
      and exists (
        select 1 from public.transport_tasks task
        where task.id = task_id
          and task.request_id = request_id
          and task.type::text = photo_type::text
          and task.status = 'in_route'
          and (
            task.assigned_driver_id = auth.uid()
            or public.current_user_has_access('manage_requests')
          )
      )
    )
    or (
      photo_type = 'instrumentator_release'
      and task_id is null
      and public.current_user_has_access('release_materials')
      and exists (
        select 1 from public.surgery_requests request
        where request.id = request_id and request.status = 'delivered'
      )
    )
    or (
      photo_type = 'kit_control'
      and task_id is null
      and public.current_user_has_access('create_requests')
      and exists (
        select 1 from public.surgery_requests request
        where request.id = request_id and request.status <> 'cancelled'
      )
    )
  )
);

drop policy if exists "Authorized users can delete draft evidence photos" on public.transport_evidence_photos;
create policy "Authorized users can delete draft evidence photos"
on public.transport_evidence_photos for delete to authenticated
using (
  finalized_at is null and uploaded_by = auth.uid()
  and (
    (photo_type = 'delivery' and public.current_user_has_access('complete_delivery'))
    or (photo_type = 'pickup' and public.current_user_has_access('complete_pickup'))
    or (photo_type = 'instrumentator_release' and public.current_user_has_access('release_materials'))
    or (photo_type = 'kit_control' and public.current_user_has_access('create_requests'))
  )
);

drop policy if exists "Authorized users can read stored evidence photos" on storage.objects;
create policy "Authorized users can read stored evidence photos"
on storage.objects for select to authenticated
using (
  bucket_id = 'transport-evidence-photos'
  and exists (
    select 1 from public.transport_evidence_photos photo
    where photo.storage_path = name and photo.expires_at > now()
  )
);

create or replace function public.assign_transport_task(
  target_task_id uuid, target_driver_id uuid, action_note text default ''
)
returns public.transport_tasks
language plpgsql security definer set search_path = ''
as $$
declare
  task public.transport_tasks;
  driver public.profiles;
begin
  if not public.current_user_has_access('manage_requests') then
    raise exception 'User cannot manage requests';
  end if;
  select * into task from public.transport_tasks
  where id = target_task_id for update;
  if task.id is null then raise exception 'Task not found'; end if;
  if task.status not in ('available', 'assigned') then
    raise exception 'Only available or assigned tasks can be designated';
  end if;
  select * into driver from public.profiles
  where id = target_driver_id and role = 'driver' and active = true;
  if driver.id is null then raise exception 'Driver not found'; end if;
  update public.transport_tasks
  set status = 'assigned', assigned_driver_id = driver.id,
      claimed_at = coalesce(claimed_at, now()),
      driver_note = trim(coalesce(action_note, driver_note))
  where id = task.id returning * into task;
  return task;
end;
$$;

create or replace function public.assign_request_instrumentator(
  target_request_id uuid, target_instrumentator_id uuid default null
)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.current_user_has_access('manage_requests') then
    raise exception 'User cannot manage requests';
  end if;
  if target_instrumentator_id is not null and not exists (
    select 1 from public.profiles profile
    where profile.id = target_instrumentator_id
      and profile.role = 'instrumentator' and profile.active = true
  ) then
    raise exception 'Invalid instrumentator';
  end if;
  update public.surgery_requests
  set assigned_instrumentator_id = target_instrumentator_id
  where id = target_request_id;
  if not found then raise exception 'Request not found'; end if;
end;
$$;

create or replace function public.delete_surgery_request_permanently(target_request_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.current_user_has_access('manage_requests') then
    raise exception 'User cannot manage requests';
  end if;
  if not exists (select 1 from public.surgery_requests where id = target_request_id) then
    raise exception 'Request not found';
  end if;
  perform public.sync_request_inventory_status(target_request_id, 'in_stock'::public.inventory_status);
  delete from public.surgery_requests where id = target_request_id;
end;
$$;

create or replace function public.advance_transport_task(
  target_task_id uuid, task_action text, action_note text default ''
)
returns public.transport_tasks
language plpgsql security definer set search_path = ''
as $$
declare
  task public.transport_tasks;
begin
  select * into task from public.transport_tasks
  where id = target_task_id for update;
  if task.id is null then raise exception 'Task not found'; end if;

  if task_action = 'claim' then
    if not public.current_user_has_access('claim_routes') or task.status <> 'available' then
      raise exception 'Task cannot be claimed';
    end if;
    update public.transport_tasks
    set status = 'assigned', assigned_driver_id = auth.uid(),
      claimed_at = now(), driver_note = trim(coalesce(action_note, ''))
    where id = task.id returning * into task;

  elsif task_action = 'start' then
    if not public.current_user_has_access('claim_routes')
      or task.status <> 'assigned'
      or (
        task.assigned_driver_id <> auth.uid()
        and not public.current_user_has_access('manage_requests')
      ) then
      raise exception 'Task cannot be started';
    end if;
    update public.transport_tasks
    set status = 'in_route', started_at = now(),
      driver_note = trim(coalesce(action_note, driver_note))
    where id = task.id returning * into task;
    update public.surgery_requests
    set status = case task.type
      when 'delivery' then 'delivery_in_route'::public.request_status
      else 'pickup_in_route'::public.request_status end
    where id = task.request_id;
    perform public.sync_request_inventory_status(task.request_id, 'in_route'::public.inventory_status);

  elsif task_action = 'complete' then
    if (
      task.type = 'delivery' and not public.current_user_has_access('complete_delivery')
    ) or (
      task.type = 'pickup' and not public.current_user_has_access('complete_pickup')
    ) or task.status <> 'in_route'
      or (
        task.assigned_driver_id <> auth.uid()
        and not public.current_user_has_access('manage_requests')
      ) then
      raise exception 'Task cannot be completed';
    end if;
    update public.transport_tasks
    set status = 'completed', completed_at = now(),
      driver_note = trim(coalesce(action_note, driver_note))
    where id = task.id returning * into task;
    update public.surgery_requests
    set status = case task.type
      when 'delivery' then 'delivered'::public.request_status
      else 'returned_stock'::public.request_status end
    where id = task.request_id;
    perform public.sync_request_inventory_status(
      task.request_id,
      case task.type
        when 'delivery' then 'hospital'::public.inventory_status
        else 'in_stock'::public.inventory_status end
    );
  else
    raise exception 'Unknown action';
  end if;
  return task;
end;
$$;

create or replace function public.release_request_for_pickup(target_request_id uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  request_row public.surgery_requests;
  new_task_id uuid;
begin
  if not public.current_user_has_access('release_materials') then
    raise exception 'User cannot release materials';
  end if;
  select * into request_row from public.surgery_requests
  where id = target_request_id for update;
  if request_row.status <> 'delivered' then
    raise exception 'Request is not ready to be released';
  end if;
  insert into public.transport_tasks (
    request_id, type, status, origin_label, destination_label, created_by
  ) values (
    request_row.id, 'pickup', 'available', request_row.hospital, 'Estoque', auth.uid()
  ) returning id into new_task_id;
  update public.surgery_requests set status = 'ready_pickup'
  where id = request_row.id;
  return new_task_id;
end;
$$;
create or replace function public.create_surgery_request(
  request_data jsonb, items_data jsonb
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  new_request_id uuid;
  selected_hospital public.hospitals;
  selected_inventory_item_id uuid;
  selected_instrumentator_id uuid;
  item jsonb;
  hospital_name text;
begin
  if not public.current_user_has_access('create_requests') then
    raise exception 'User cannot create requests';
  end if;

  if nullif(request_data ->> 'hospital_id', '') is not null then
    select * into selected_hospital from public.hospitals
    where id = (request_data ->> 'hospital_id')::uuid and active = true;
  end if;

  if nullif(request_data ->> 'assigned_instrumentator_id', '') is not null then
    select profile.id into selected_instrumentator_id
    from public.profiles profile
    where profile.id = (request_data ->> 'assigned_instrumentator_id')::uuid
      and profile.role = 'instrumentator' and profile.active = true;
    if selected_instrumentator_id is null then
      raise exception 'Invalid instrumentator';
    end if;
  end if;

  hospital_name := coalesce(
    nullif(trim(selected_hospital.name), ''),
    nullif(trim(coalesce(request_data ->> 'hospital', '')), '')
  );
  if hospital_name is null then raise exception 'Hospital is required'; end if;

  insert into public.surgery_requests (
    hospital_id, hospital, surgeon, patient, surgery_date, surgery_time,
    procedure, insurance, assigned_instrumentator_id, observation,
    origin, priority, created_by
  ) values (
    selected_hospital.id, hospital_name,
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
  ) returning id into new_request_id;

  for item in select value from jsonb_array_elements(coalesce(items_data, '[]'::jsonb))
  loop
    if trim(coalesce(item ->> 'description', '')) <> '' then
      selected_inventory_item_id := null;
      if nullif(item ->> 'inventory_item_id', '') is not null then
        select inventory.id into selected_inventory_item_id
        from public.inventory_items inventory
        where inventory.id = (item ->> 'inventory_item_id')::uuid;
      end if;
      insert into public.request_items (
        request_id, inventory_item_id, section, quantity, description, note
      ) values (
        new_request_id, selected_inventory_item_id,
        coalesce(nullif(item ->> 'section', '')::public.material_section, 'OTHER'),
        trim(coalesce(item ->> 'quantity', '')),
        trim(item ->> 'description'),
        trim(coalesce(item ->> 'note', ''))
      );
    end if;
  end loop;

  insert into public.transport_tasks (
    request_id, type, status, origin_label, destination_label,
    scheduled_for, created_by
  ) values (
    new_request_id, 'delivery', 'available', 'Estoque', hospital_name,
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

grant execute on function public.admin_list_profiles() to authenticated;
grant execute on function public.assign_transport_task(uuid, uuid, text) to authenticated;
grant execute on function public.assign_request_instrumentator(uuid, uuid) to authenticated;
grant execute on function public.delete_surgery_request_permanently(uuid) to authenticated;
grant execute on function public.advance_transport_task(uuid, text, text) to authenticated;
grant execute on function public.release_request_for_pickup(uuid) to authenticated;
grant execute on function public.create_surgery_request(jsonb, jsonb) to authenticated;
create or replace function public.list_active_instrumentators()
returns table (id uuid, full_name text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not (
    public.current_user_has_access('view_agenda')
    or public.current_user_has_access('create_requests')
    or public.current_user_has_access('manage_requests')
  ) then
    raise exception 'Not authorized';
  end if;

  return query
  select profile.id, profile.full_name
  from public.profiles profile
  where profile.role = 'instrumentator' and profile.active = true
  order by profile.full_name;
end;
$$;

grant execute on function public.list_active_instrumentators() to authenticated;