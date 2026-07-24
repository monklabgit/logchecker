alter table public.surgery_requests
add column if not exists release_observation text not null default '';

drop function if exists public.release_request_for_pickup_with_evidence(uuid);

create function public.release_request_for_pickup_with_evidence(
  target_request_id uuid,
  action_observation text default ''
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

  update public.surgery_requests request
  set release_observation = left(trim(coalesce(action_observation, '')), 2000)
  where request.id = target_request_id;

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

grant execute on function public.release_request_for_pickup_with_evidence(uuid, text) to authenticated;
revoke execute on function public.release_request_for_pickup_with_evidence(uuid, text) from public, anon;