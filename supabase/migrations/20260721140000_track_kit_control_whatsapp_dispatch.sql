alter table public.transport_evidence_photos
add column if not exists whatsapp_first_sent_at timestamptz,
add column if not exists whatsapp_last_sent_at timestamptz,
add column if not exists whatsapp_send_count integer not null default 0;

alter table public.transport_evidence_photos
drop constraint if exists transport_evidence_whatsapp_send_count_check;

alter table public.transport_evidence_photos
add constraint transport_evidence_whatsapp_send_count_check
check (whatsapp_send_count >= 0);

create or replace function public.mark_kit_control_evidence_sent(
  target_request_id uuid,
  target_storage_paths text[]
)
returns setof public.transport_evidence_photos
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.current_user_has_access('create_requests') then
    raise exception 'User cannot send kit control evidence';
  end if;

  if coalesce(array_length(target_storage_paths, 1), 0) = 0 then
    return;
  end if;

  return query
  update public.transport_evidence_photos
  set
    whatsapp_first_sent_at = coalesce(whatsapp_first_sent_at, now()),
    whatsapp_last_sent_at = now(),
    whatsapp_send_count = whatsapp_send_count + 1
  where request_id = target_request_id
    and task_id is null
    and photo_type = 'kit_control'
    and finalized_at is not null
    and expires_at > now()
    and storage_path = any(target_storage_paths)
  returning *;
end;
$$;

grant execute on function public.mark_kit_control_evidence_sent(uuid, text[]) to authenticated;
revoke execute on function public.mark_kit_control_evidence_sent(uuid, text[]) from public, anon;
