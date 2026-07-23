alter type public.transport_action
add value if not exists 'evidence_deleted';

insert into public.role_access_scopes (role, access_key, enabled)
values
  ('pending', 'delete_evidence', false),
  ('admin', 'delete_evidence', true),
  ('office', 'delete_evidence', true),
  ('driver', 'delete_evidence', false),
  ('instrumentator', 'delete_evidence', false)
on conflict (role, access_key) do update
set enabled = excluded.enabled;