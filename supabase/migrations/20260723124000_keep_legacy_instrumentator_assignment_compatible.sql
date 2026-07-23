create or replace function public.assign_request_instrumentator(
  target_request_id uuid,
  target_instrumentator_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.set_request_instrumentators(
    target_request_id,
    case
      when target_instrumentator_id is null then '{}'::uuid[]
      else array[target_instrumentator_id]
    end
  );
end;
$$;

create or replace function public.sync_initial_request_instrumentator_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assigned_instrumentator_id is not null then
    insert into public.surgery_request_instrumentators (
      request_id,
      instrumentator_id,
      assigned_by
    ) values (
      new.id,
      new.assigned_instrumentator_id,
      new.created_by
    )
    on conflict (request_id, instrumentator_id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_initial_request_instrumentator_assignment
on public.surgery_requests;
create trigger sync_initial_request_instrumentator_assignment
after insert on public.surgery_requests
for each row
execute function public.sync_initial_request_instrumentator_assignment();

grant execute on function public.assign_request_instrumentator(uuid, uuid) to authenticated;
revoke execute on function public.assign_request_instrumentator(uuid, uuid) from public, anon;
