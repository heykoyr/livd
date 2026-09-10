-- ===========================================================================
-- Livd — 0034 · Rename a parameter that shadowed its column
--
-- `livd_decide_authority_request` took a parameter called
-- `documentation_received`, which is also a column on `authority_requests`.
-- The unqualified reference inside the UPDATE was ambiguous between the two,
-- and Postgres resolves that at *call* time rather than at creation — so the
-- function was created without complaint and failed the first time anybody
-- passed that argument.
--
-- Worth recording rather than quietly amending 0033: a parameter that shadows
-- a column is a runtime error waiting for the first person to use it, and it
-- looks perfectly fine in review. The rule that follows is to name parameters
-- so they cannot collide, which is why this one is `docs_received`.
--
-- Dropped and recreated rather than replaced, because a parameter name is part
-- of the signature.
-- ===========================================================================

drop function if exists livd_decide_authority_request(uuid, authority_request_status, text, boolean, uuid);

create or replace function livd_decide_authority_request(
  request_id     uuid,
  new_status     authority_request_status,
  decision_text  text default null,
  docs_received  boolean default null,
  assign_to      uuid default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor    uuid := auth.uid();
  previous authority_request_status;
  concluding boolean;
begin
  if actor is null or not livd_is_trust_admin() then
    raise exception 'Deciding an authority request requires Trust and Safety authorisation'
      using errcode = '42501';
  end if;

  select status into previous from authority_requests where id = request_id for update;
  if previous is null then
    raise exception 'No such request' using errcode = 'P0002';
  end if;

  concluding := new_status in
    ('approved', 'partially_approved', 'declined', 'fulfilled', 'closed');

  if concluding and char_length(btrim(coalesce(decision_text, ''))) < 3 then
    raise exception 'Write the decision before concluding a request' using errcode = '22023';
  end if;

  update authority_requests
  set status = new_status,
      decision = case when concluding then btrim(decision_text) else decision end,
      decided_by = case when concluding then actor else decided_by end,
      decided_at = case when concluding then now() else decided_at end,
      documentation_received = coalesce(docs_received, documentation_received),
      assigned_to = coalesce(assign_to, assigned_to)
  where id = request_id;

  insert into admin_audit_log
    (actor_id, actor_role, action, subject_type, subject_id, outcome, reason, detail)
  select actor, p.role, 'authority_request_updated', 'authority_request', request_id,
         'succeeded', nullif(btrim(coalesce(decision_text, '')), ''),
         jsonb_build_object('from', previous::text, 'to', new_status::text)
  from profiles p where p.id = actor;
end;
$$;

revoke execute on function livd_decide_authority_request(uuid, authority_request_status, text, boolean, uuid)
  from public, anon;
grant execute on function livd_decide_authority_request(uuid, authority_request_status, text, boolean, uuid)
  to authenticated;
