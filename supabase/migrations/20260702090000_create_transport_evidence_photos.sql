create type public.evidence_photo_type as enum (
  'delivery',
  'pickup',
  'instrumentator_release'
);

create table public.transport_evidence_photos (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.surgery_requests(id) on delete cascade,
  task_id uuid references public.transport_tasks(id) on delete set null,
  photo_type public.evidence_photo_type not null,
  storage_path text not null unique,
  original_name text not null default '',
  mime_type text not null default '',
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days'
);

create index transport_evidence_request_idx on public.transport_evidence_photos(request_id, created_at desc);
create index transport_evidence_expires_idx on public.transport_evidence_photos(expires_at);

alter table public.transport_evidence_photos enable row level security;

create policy "Authorized users can read evidence photos"
on public.transport_evidence_photos for select
to authenticated
using (
  expires_at > now()
  and public.can_view_request(request_id)
);

create policy "Authorized users can create evidence photos"
on public.transport_evidence_photos for insert
to authenticated
with check (
  uploaded_by = auth.uid()
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
          and task.status in ('in_route', 'completed')
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
          and request.status in ('delivered', 'ready_pickup', 'pickup_in_route', 'returned_stock')
      )
    )
  )
);

grant select, insert on public.transport_evidence_photos to authenticated;

insert into storage.buckets (id, name, public)
values (
  'transport-evidence-photos',
  'transport-evidence-photos',
  false
)
on conflict (id) do nothing;

create policy "Authenticated users can upload evidence photos"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'transport-evidence-photos'
);

create policy "Authorized users can read stored evidence photos"
on storage.objects for select
to authenticated
using (
  bucket_id = 'transport-evidence-photos'
  and exists (
    select 1
    from public.transport_evidence_photos photo
    where photo.storage_path = name
      and photo.expires_at > now()
      and public.can_view_request(photo.request_id)
  )
);

create policy "Photo uploaders can remove evidence upload failures"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'transport-evidence-photos'
  and owner = auth.uid()
);

alter publication supabase_realtime add table public.transport_evidence_photos;
