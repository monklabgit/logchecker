create or replace function public.finalize_transport_evidence_on_task_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'completed' and old.status is distinct from new.status then
    update public.transport_evidence_photos
    set
      finalized_at = coalesce(finalized_at, now()),
      expires_at = now() + interval '30 days'
    where task_id = new.id
      and request_id = new.request_id
      and photo_type::text = new.type::text
      and expires_at > now();
  end if;

  return new;
end;
$$;

drop trigger if exists finalize_transport_evidence_after_task_completion
on public.transport_tasks;

create trigger finalize_transport_evidence_after_task_completion
after update of status on public.transport_tasks
for each row
execute function public.finalize_transport_evidence_on_task_completion();

create or replace function public.finalize_release_evidence_on_request_release()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'ready_pickup' and old.status is distinct from new.status then
    update public.transport_evidence_photos
    set
      finalized_at = coalesce(finalized_at, now()),
      expires_at = now() + interval '30 days'
    where request_id = new.id
      and task_id is null
      and photo_type = 'instrumentator_release'
      and expires_at > now();
  end if;

  return new;
end;
$$;

drop trigger if exists finalize_release_evidence_after_request_release
on public.surgery_requests;

create trigger finalize_release_evidence_after_request_release
after update of status on public.surgery_requests
for each row
execute function public.finalize_release_evidence_on_request_release();
