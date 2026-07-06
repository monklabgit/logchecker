create type public.request_origin as enum (
  'manual',
  'image',
  'document'
);

create type public.request_status as enum (
  'ready_delivery',
  'delivery_in_route',
  'delivered',
  'ready_pickup',
  'pickup_in_route',
  'returned_stock',
  'cancelled'
);

create type public.material_section as enum (
  'CME',
  'OPME',
  'OTHER'
);

create type public.transport_type as enum (
  'delivery',
  'pickup'
);

create type public.transport_status as enum (
  'available',
  'assigned',
  'in_route',
  'completed',
  'cancelled'
);

create type public.transport_action as enum (
  'created',
  'claimed',
  'started',
  'completed',
  'cancelled'
);

create table public.surgery_requests (
  id uuid primary key default gen_random_uuid(),
  code bigint generated always as identity unique,
  hospital text not null,
  surgeon text not null default '',
  patient text not null default '',
  surgery_date date,
  surgery_time time,
  procedure text not null default '',
  observation text not null default '',
  origin public.request_origin not null default 'manual',
  status public.request_status not null default 'ready_delivery',
  priority smallint not null default 2 check (priority between 1 and 3),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.request_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.surgery_requests(id) on delete cascade,
  section public.material_section not null,
  quantity text not null default '',
  description text not null,
  note text not null default '',
  created_at timestamptz not null default now()
);

create table public.transport_tasks (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.surgery_requests(id) on delete cascade,
  type public.transport_type not null,
  status public.transport_status not null default 'available',
  assigned_driver_id uuid references public.profiles(id),
  origin_label text not null default 'Estoque',
  destination_label text not null default '',
  scheduled_for timestamptz,
  claimed_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  driver_note text not null default '',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index one_open_task_per_type
on public.transport_tasks (request_id, type)
where status not in ('completed', 'cancelled');

create table public.transport_events (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.transport_tasks(id) on delete cascade,
  request_id uuid not null references public.surgery_requests(id) on delete cascade,
  action public.transport_action not null,
  from_status public.transport_status,
  to_status public.transport_status not null,
  actor_id uuid references public.profiles(id),
  note text not null default '',
  created_at timestamptz not null default now()
);

create table public.request_documents (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.surgery_requests(id) on delete cascade,
  storage_path text not null unique,
  original_name text not null,
  mime_type text not null default '',
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index surgery_requests_status_idx on public.surgery_requests(status);
create index surgery_requests_surgery_date_idx on public.surgery_requests(surgery_date);
create index request_items_request_idx on public.request_items(request_id);
create index transport_tasks_request_idx on public.transport_tasks(request_id);
create index transport_tasks_driver_idx on public.transport_tasks(assigned_driver_id);
create index transport_tasks_status_idx on public.transport_tasks(status);
create index transport_events_task_idx on public.transport_events(task_id, created_at desc);

create trigger surgery_requests_set_updated_at
  before update on public.surgery_requests
  for each row execute procedure public.set_updated_at();

create trigger transport_tasks_set_updated_at
  before update on public.transport_tasks
  for each row execute procedure public.set_updated_at();

create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select role
  from public.profiles
  where id = auth.uid()
    and active = true;
$$;

create or replace function public.is_operations_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_user_role() in ('admin', 'office'), false);
$$;

create or replace function public.can_view_request(target_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_operations_staff()
    or exists (
      select 1
      from public.transport_tasks task
      where task.request_id = target_request_id
        and (
          task.assigned_driver_id = auth.uid()
          or (
            public.current_user_role() = 'driver'
            and task.status = 'available'
          )
        )
    );
$$;

alter table public.surgery_requests enable row level security;
alter table public.request_items enable row level security;
alter table public.transport_tasks enable row level security;
alter table public.transport_events enable row level security;
alter table public.request_documents enable row level security;

create policy "Authorized users can read requests"
on public.surgery_requests for select
to authenticated
using (public.can_view_request(id));

create policy "Operations can create requests"
on public.surgery_requests for insert
to authenticated
with check (public.is_operations_staff() and created_by = auth.uid());

create policy "Operations can update requests"
on public.surgery_requests for update
to authenticated
using (public.is_operations_staff())
with check (public.is_operations_staff());

create policy "Authorized users can read request items"
on public.request_items for select
to authenticated
using (public.can_view_request(request_id));

create policy "Operations can create request items"
on public.request_items for insert
to authenticated
with check (public.is_operations_staff());

create policy "Operations can update request items"
on public.request_items for update
to authenticated
using (public.is_operations_staff())
with check (public.is_operations_staff());

create policy "Operations can delete request items"
on public.request_items for delete
to authenticated
using (public.is_operations_staff());

create policy "Authorized users can read transport tasks"
on public.transport_tasks for select
to authenticated
using (
  public.is_operations_staff()
  or assigned_driver_id = auth.uid()
  or (public.current_user_role() = 'driver' and status = 'available')
);

create policy "Operations can create transport tasks"
on public.transport_tasks for insert
to authenticated
with check (public.is_operations_staff() and created_by = auth.uid());

create policy "Operations can update transport tasks"
on public.transport_tasks for update
to authenticated
using (public.is_operations_staff())
with check (public.is_operations_staff());

create policy "Authorized users can read transport events"
on public.transport_events for select
to authenticated
using (public.can_view_request(request_id));

create policy "Authorized users can read request documents"
on public.request_documents for select
to authenticated
using (public.can_view_request(request_id));

create policy "Operations can create request documents"
on public.request_documents for insert
to authenticated
with check (public.is_operations_staff() and uploaded_by = auth.uid());

create or replace function public.log_transport_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_action public.transport_action;
begin
  if tg_op = 'INSERT' then
    insert into public.transport_events (
      task_id, request_id, action, from_status, to_status, actor_id
    )
    values (
      new.id, new.request_id, 'created', null, new.status, auth.uid()
    );
    return new;
  end if;

  if old.status is not distinct from new.status then
    return new;
  end if;

  event_action := case new.status
    when 'assigned' then 'claimed'::public.transport_action
    when 'in_route' then 'started'::public.transport_action
    when 'completed' then 'completed'::public.transport_action
    when 'cancelled' then 'cancelled'::public.transport_action
    else 'created'::public.transport_action
  end;

  insert into public.transport_events (
    task_id, request_id, action, from_status, to_status, actor_id, note
  )
  values (
    new.id,
    new.request_id,
    event_action,
    old.status,
    new.status,
    auth.uid(),
    new.driver_note
  );

  return new;
end;
$$;

create trigger transport_task_event
  after insert or update of status on public.transport_tasks
  for each row execute procedure public.log_transport_event();

create or replace function public.create_surgery_request(
  request_data jsonb,
  items_data jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_request_id uuid;
  item jsonb;
begin
  if not public.is_operations_staff() then
    raise exception 'Not authorized';
  end if;

  insert into public.surgery_requests (
    hospital,
    surgeon,
    patient,
    surgery_date,
    surgery_time,
    procedure,
    observation,
    origin,
    priority,
    created_by
  )
  values (
    trim(coalesce(request_data ->> 'hospital', '')),
    trim(coalesce(request_data ->> 'surgeon', '')),
    trim(coalesce(request_data ->> 'patient', '')),
    nullif(request_data ->> 'surgery_date', '')::date,
    nullif(request_data ->> 'surgery_time', '')::time,
    trim(coalesce(request_data ->> 'procedure', '')),
    trim(coalesce(request_data ->> 'observation', '')),
    coalesce(nullif(request_data ->> 'origin', '')::public.request_origin, 'manual'),
    coalesce(nullif(request_data ->> 'priority', '')::smallint, 2),
    auth.uid()
  )
  returning id into new_request_id;

  if trim(coalesce(request_data ->> 'hospital', '')) = '' then
    raise exception 'Hospital is required';
  end if;

  for item in select value from jsonb_array_elements(coalesce(items_data, '[]'::jsonb))
  loop
    if trim(coalesce(item ->> 'description', '')) <> '' then
      insert into public.request_items (
        request_id,
        section,
        quantity,
        description,
        note
      )
      values (
        new_request_id,
        coalesce(nullif(item ->> 'section', '')::public.material_section, 'OTHER'),
        trim(coalesce(item ->> 'quantity', '')),
        trim(item ->> 'description'),
        trim(coalesce(item ->> 'note', ''))
      );
    end if;
  end loop;

  insert into public.transport_tasks (
    request_id,
    type,
    status,
    origin_label,
    destination_label,
    scheduled_for,
    created_by
  )
  values (
    new_request_id,
    'delivery',
    'available',
    'Estoque',
    trim(request_data ->> 'hospital'),
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

create or replace function public.advance_transport_task(
  target_task_id uuid,
  task_action text,
  action_note text default ''
)
returns public.transport_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.transport_tasks;
  role public.user_role;
begin
  select * into task
  from public.transport_tasks
  where id = target_task_id
  for update;

  if task.id is null then
    raise exception 'Task not found';
  end if;

  role := public.current_user_role();

  if task_action = 'claim' then
    if role not in ('driver', 'admin') or task.status <> 'available' then
      raise exception 'Task cannot be claimed';
    end if;

    update public.transport_tasks
    set
      status = 'assigned',
      assigned_driver_id = auth.uid(),
      claimed_at = now(),
      driver_note = trim(coalesce(action_note, ''))
    where id = task.id
    returning * into task;

  elsif task_action = 'start' then
    if task.status <> 'assigned'
      or (task.assigned_driver_id <> auth.uid() and role <> 'admin') then
      raise exception 'Task cannot be started';
    end if;

    update public.transport_tasks
    set
      status = 'in_route',
      started_at = now(),
      driver_note = trim(coalesce(action_note, driver_note))
    where id = task.id
    returning * into task;

    update public.surgery_requests
    set status = case task.type
      when 'delivery' then 'delivery_in_route'::public.request_status
      else 'pickup_in_route'::public.request_status
    end
    where id = task.request_id;

  elsif task_action = 'complete' then
    if task.status <> 'in_route'
      or (task.assigned_driver_id <> auth.uid() and role <> 'admin') then
      raise exception 'Task cannot be completed';
    end if;

    update public.transport_tasks
    set
      status = 'completed',
      completed_at = now(),
      driver_note = trim(coalesce(action_note, driver_note))
    where id = task.id
    returning * into task;

    update public.surgery_requests
    set status = case task.type
      when 'delivery' then 'delivered'::public.request_status
      else 'returned_stock'::public.request_status
    end
    where id = task.request_id;

  else
    raise exception 'Unknown action';
  end if;

  return task;
end;
$$;

create or replace function public.release_request_for_pickup(
  target_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.surgery_requests;
  new_task_id uuid;
begin
  if public.current_user_role() not in ('admin', 'office', 'instrumentator') then
    raise exception 'Not authorized';
  end if;

  select * into request_row
  from public.surgery_requests
  where id = target_request_id
  for update;

  if request_row.status <> 'delivered' then
    raise exception 'Request is not ready to be released';
  end if;

  insert into public.transport_tasks (
    request_id,
    type,
    status,
    origin_label,
    destination_label,
    created_by
  )
  values (
    request_row.id,
    'pickup',
    'available',
    request_row.hospital,
    'Estoque',
    auth.uid()
  )
  returning id into new_task_id;

  update public.surgery_requests
  set status = 'ready_pickup'
  where id = request_row.id;

  return new_task_id;
end;
$$;

grant select, insert, update on public.surgery_requests to authenticated;
grant select, insert, update, delete on public.request_items to authenticated;
grant select, insert, update on public.transport_tasks to authenticated;
grant select on public.transport_events to authenticated;
grant select, insert on public.request_documents to authenticated;
grant usage, select on sequence public.surgery_requests_code_seq to authenticated;
grant execute on function public.create_surgery_request(jsonb, jsonb) to authenticated;
grant execute on function public.advance_transport_task(uuid, text, text) to authenticated;
grant execute on function public.release_request_for_pickup(uuid) to authenticated;
revoke execute on function public.create_surgery_request(jsonb, jsonb) from public, anon;
revoke execute on function public.advance_transport_task(uuid, text, text) from public, anon;
revoke execute on function public.release_request_for_pickup(uuid) from public, anon;

insert into storage.buckets (id, name, public)
values ('request-documents', 'request-documents', false)
on conflict (id) do nothing;

create policy "Operations can upload request documents"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'request-documents'
  and public.is_operations_staff()
);

create policy "Authorized users can read stored request documents"
on storage.objects for select
to authenticated
using (
  bucket_id = 'request-documents'
  and exists (
    select 1
    from public.request_documents document
    where document.storage_path = name
      and public.can_view_request(document.request_id)
  )
);

alter publication supabase_realtime add table public.surgery_requests;
alter publication supabase_realtime add table public.transport_tasks;
alter publication supabase_realtime add table public.transport_events;
