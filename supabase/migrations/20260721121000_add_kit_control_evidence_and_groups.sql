alter table public.user_whatsapp_connections
add column if not exists kit_control_group_jid text not null default '',
add column if not exists kit_control_group_name text not null default '';

create or replace function public.current_user_has_access(target_access_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select profile.active
        and (
          profile.role = 'admin'
          or coalesce(scope.enabled, false)
        )
      from public.profiles profile
      left join public.role_access_scopes scope
        on scope.role = profile.role
       and scope.access_key = target_access_key
      where profile.id = auth.uid()
    ),
    false
  );
$$;

grant execute on function public.current_user_has_access(text) to authenticated;
revoke execute on function public.current_user_has_access(text) from public, anon;

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
    or (
      photo_type = 'kit_control'
      and task_id is null
      and public.current_user_has_access('create_requests')
      and exists (
        select 1
        from public.surgery_requests request
        where request.id = request_id
          and request.status <> 'cancelled'
      )
    )
  )
);

drop policy if exists "Authorized users can delete draft evidence photos"
on public.transport_evidence_photos;

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
    or (
      photo_type = 'kit_control'
      and task_id is null
      and public.current_user_has_access('create_requests')
    )
  )
);

create or replace function public.finalize_kit_control_evidence(target_request_id uuid)
returns setof public.transport_evidence_photos
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.current_user_has_access('create_requests') then
    raise exception 'User cannot manage kit control evidence';
  end if;

  if not exists (
    select 1
    from public.surgery_requests request
    where request.id = target_request_id
      and request.status <> 'cancelled'
  ) then
    raise exception 'Request not found or cancelled';
  end if;

  if not exists (
    select 1
    from public.transport_evidence_photos photo
    where photo.request_id = target_request_id
      and photo.task_id is null
      and photo.photo_type = 'kit_control'
      and photo.expires_at > now()
  ) then
    raise exception 'At least one kit control photo is required';
  end if;

  return query
  update public.transport_evidence_photos
  set
    finalized_at = coalesce(finalized_at, now()),
    expires_at = now() + interval '30 days'
  where request_id = target_request_id
    and task_id is null
    and photo_type = 'kit_control'
    and expires_at > now()
  returning *;
end;
$$;

grant execute on function public.finalize_kit_control_evidence(uuid) to authenticated;
revoke execute on function public.finalize_kit_control_evidence(uuid) from public, anon;
