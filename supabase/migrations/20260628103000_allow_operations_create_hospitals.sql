drop policy if exists "Admins can create hospitals" on public.hospitals;

create policy "Operations can create hospitals"
on public.hospitals for insert
to authenticated
with check (public.is_operations_staff() and created_by = auth.uid());
