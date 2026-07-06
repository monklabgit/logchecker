create table public.hospitals (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null default '',
  loading_access text not null default '',
  cme_location text not null default '',
  opme_location text not null default '',
  surgical_center_location text not null default '',
  notes text not null default '',
  maps_query text not null default '',
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index hospitals_name_unique_idx on public.hospitals (lower(name));
create index hospitals_active_name_idx on public.hospitals (active, name);

create trigger hospitals_set_updated_at
  before update on public.hospitals
  for each row execute procedure public.set_updated_at();

alter table public.hospitals enable row level security;

create policy "Authenticated users can read active hospitals"
on public.hospitals for select
to authenticated
using (active = true or public.is_admin());

create policy "Admins can create hospitals"
on public.hospitals for insert
to authenticated
with check (public.is_admin() and created_by = auth.uid());

create policy "Admins can update hospitals"
on public.hospitals for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

grant select, insert, update on public.hospitals to authenticated;

alter table public.surgery_requests
add column hospital_id uuid references public.hospitals(id);

create index surgery_requests_hospital_idx on public.surgery_requests(hospital_id);

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
  selected_hospital public.hospitals;
  item jsonb;
  hospital_name text;
begin
  if not public.is_operations_staff() then
    raise exception 'Not authorized';
  end if;

  if nullif(request_data ->> 'hospital_id', '') is not null then
    select *
    into selected_hospital
    from public.hospitals
    where id = (request_data ->> 'hospital_id')::uuid
      and active = true;
  end if;

  hospital_name := coalesce(
    nullif(trim(selected_hospital.name), ''),
    nullif(trim(coalesce(request_data ->> 'hospital', '')), '')
  );

  if hospital_name is null then
    raise exception 'Hospital is required';
  end if;

  insert into public.surgery_requests (
    hospital_id,
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
    selected_hospital.id,
    hospital_name,
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
    hospital_name,
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
