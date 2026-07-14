alter table public.transport_evidence_photos
add column if not exists finalized_at timestamptz;

-- Photos created before draft support were only uploaded while completing an action.
update public.transport_evidence_photos
set finalized_at = created_at
where finalized_at is null;

create index if not exists transport_evidence_task_draft_idx
on public.transport_evidence_photos(task_id, finalized_at)
where finalized_at is null;

drop policy if exists "Authorized users can create evidence photos"
on public.transport_evidence_photos;

create policy "Authorized users can create evidence photos"
on public.transport_evidence_photos for insert
to authenticated
with check (
  uploaded_by = auth.uid()
  and finalized_at is null
  and expires_at <= now() + interval '31 days'
  and (
    (
      photo_type in ('delivery', 'pickup')
      and exists (
        select 1
        from public.transport_tasks task
        where task.id = task_id
          and task.request_id = request_id
          and task.type::text = photo_type::text
          and task.status = 'in_route'
          and (
            task.assigned_driver_id = auth.uid()
            or public.current_user_role() = 'admin'
          )
      )
    )
    or (
      photo_type = 'instrumentator_release'
      and task_id is null
      and public.current_user_role() in ('admin', 'office', 'instrumentator')
      and exists (
        select 1
        from public.surgery_requests request
        where request.id = request_id
          and request.status = 'delivered'
      )
    )
  )
);

create policy "Authorized users can delete draft evidence photos"
on public.transport_evidence_photos for delete
to authenticated
using (
  finalized_at is null
  and uploaded_by = auth.uid()
  and (
    (
      photo_type in ('delivery', 'pickup')
      and exists (
        select 1
        from public.transport_tasks task
        where task.id = task_id
          and task.request_id = request_id
          and task.status = 'in_route'
          and (
            task.assigned_driver_id = auth.uid()
            or public.current_user_role() = 'admin'
          )
      )
    )
    or (
      photo_type = 'instrumentator_release'
      and task_id is null
      and public.current_user_role() in ('admin', 'office', 'instrumentator')
      and exists (
        select 1
        from public.surgery_requests request
        where request.id = request_id
          and request.status = 'delivered'
      )
    )
  )
);

grant delete on public.transport_evidence_photos to authenticated;

create or replace function public.complete_transport_task_with_evidence(
  target_task_id uuid,
  action_note text default 'Foto registrada'
)
returns public.transport_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.transport_tasks;
begin
  select * into task
  from public.transport_tasks
  where id = target_task_id;

  if task.id is null then
    raise exception 'Task not found';
  end if;

  if not exists (
    select 1
    from public.transport_evidence_photos photo
    where photo.task_id = task.id
      and photo.request_id = task.request_id
      and photo.photo_type::text = task.type::text
      and photo.expires_at > now()
  ) then
    raise exception 'At least one evidence photo is required';
  end if;

  task := public.advance_transport_task(target_task_id, 'complete', action_note);

  update public.transport_evidence_photos
  set
    finalized_at = coalesce(finalized_at, now()),
    expires_at = now() + interval '30 days'
  where task_id = task.id
    and request_id = task.request_id
    and photo_type::text = task.type::text
    and expires_at > now();

  return task;
end;
$$;

create or replace function public.release_request_for_pickup_with_evidence(
  target_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_task_id uuid;
begin
  if not exists (
    select 1
    from public.transport_evidence_photos photo
    where photo.request_id = target_request_id
      and photo.task_id is null
      and photo.photo_type = 'instrumentator_release'
      and photo.expires_at > now()
  ) then
    raise exception 'At least one evidence photo is required';
  end if;

  new_task_id := public.release_request_for_pickup(target_request_id);

  update public.transport_evidence_photos
  set
    finalized_at = coalesce(finalized_at, now()),
    expires_at = now() + interval '30 days'
  where request_id = target_request_id
    and task_id is null
    and photo_type = 'instrumentator_release'
    and expires_at > now();

  return new_task_id;
end;
$$;

grant execute on function public.complete_transport_task_with_evidence(uuid, text) to authenticated;
grant execute on function public.release_request_for_pickup_with_evidence(uuid) to authenticated;
revoke execute on function public.complete_transport_task_with_evidence(uuid, text) from public, anon;
revoke execute on function public.release_request_for_pickup_with_evidence(uuid) from public, anon;
