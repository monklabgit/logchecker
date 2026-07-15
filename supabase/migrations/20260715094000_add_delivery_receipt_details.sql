alter table public.transport_tasks
add column if not exists delivery_received_cme text not null default '',
add column if not exists delivery_received_opme text not null default '',
add column if not exists delivery_observation text not null default '';

drop function if exists public.complete_transport_task_with_evidence(uuid, text);

create function public.complete_transport_task_with_evidence(
  target_task_id uuid,
  action_note text default 'Fotos registradas',
  received_cme text default '',
  received_opme text default '',
  delivery_observation text default ''
)
returns public.transport_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.transport_tasks;
  normalized_cme text := left(trim(coalesce(received_cme, '')), 160);
  normalized_opme text := left(trim(coalesce(received_opme, '')), 160);
  normalized_observation text := left(trim(coalesce(delivery_observation, '')), 1000);
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

  if task.type = 'delivery' then
    if exists (
      select 1 from public.request_items item
      where item.request_id = task.request_id and item.section = 'CME'
    ) and normalized_cme = '' then
      raise exception 'Informe quem recebeu os materiais no CME';
    end if;

    if exists (
      select 1 from public.request_items item
      where item.request_id = task.request_id and item.section = 'OPME'
    ) and normalized_opme = '' then
      raise exception 'Informe quem recebeu os materiais no OPME';
    end if;
  end if;

  task := public.advance_transport_task(target_task_id, 'complete', action_note);

  if task.type = 'delivery' then
    update public.transport_tasks
    set
      delivery_received_cme = normalized_cme,
      delivery_received_opme = normalized_opme,
      delivery_observation = normalized_observation
    where id = task.id
    returning * into task;
  end if;

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

grant execute on function public.complete_transport_task_with_evidence(uuid, text, text, text, text) to authenticated;
revoke execute on function public.complete_transport_task_with_evidence(uuid, text, text, text, text) from public, anon;
