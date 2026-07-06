create policy "Authorized users can read visible event actors"
on public.profiles for select
to authenticated
using (
  exists (
    select 1
    from public.transport_events event
    where event.actor_id = profiles.id
      and public.can_view_request(event.request_id)
  )
);
