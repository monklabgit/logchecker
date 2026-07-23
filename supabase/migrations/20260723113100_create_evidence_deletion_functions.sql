create or replace function public.prepare_evidence_photo_deletion(target_photo_id uuid)
returns table (storage_path text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.current_user_has_access('delete_evidence') then
    raise exception 'User cannot delete evidence photos';
  end if;

  return query
  select photo.storage_path
  from public.transport_evidence_photos photo
  where photo.id = target_photo_id
    and public.can_view_request(photo.request_id);

  if not found then
    raise exception 'Evidence photo not found or access denied';
  end if;
end;
$$;

create or replace function public.delete_evidence_photo(target_photo_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  photo public.transport_evidence_photos;
  related_task public.transport_tasks;
  event_id bigint;
  evidence_label text;
begin
  if not public.current_user_has_access('delete_evidence') then
    raise exception 'User cannot delete evidence photos';
  end if;

  select * into photo
  from public.transport_evidence_photos
  where id = target_photo_id
  for update;

  if photo.id is null or not public.can_view_request(photo.request_id) then
    raise exception 'Evidence photo not found or access denied';
  end if;

  if photo.task_id is not null then
    select * into related_task
    from public.transport_tasks
    where id = photo.task_id;
  else
    select * into related_task
    from public.transport_tasks
    where request_id = photo.request_id
    order by created_at desc
    limit 1;
  end if;

  if related_task.id is null then
    raise exception 'Related transport task not found';
  end if;

  evidence_label := case photo.photo_type
    when 'delivery' then 'entrega'
    when 'pickup' then 'retirada'
    when 'instrumentator_release' then 'liberação'
    when 'kit_control' then 'Controle de Kits'
    else 'evidência'
  end;

  delete from public.transport_evidence_photos
  where id = photo.id;

  insert into public.transport_events (
    task_id, request_id, action, from_status, to_status, actor_id, note
  ) values (
    related_task.id,
    photo.request_id,
    'evidence_deleted',
    related_task.status,
    related_task.status,
    auth.uid(),
    'Foto de ' || evidence_label || ' excluída definitivamente.'
  )
  returning id into event_id;

  return event_id;
end;
$$;

grant execute on function public.prepare_evidence_photo_deletion(uuid) to authenticated;
grant execute on function public.delete_evidence_photo(uuid) to authenticated;
revoke execute on function public.prepare_evidence_photo_deletion(uuid) from public, anon;
revoke execute on function public.delete_evidence_photo(uuid) from public, anon;