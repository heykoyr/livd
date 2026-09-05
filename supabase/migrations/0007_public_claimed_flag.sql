-- ===========================================================================
-- Livd — 0007 · Publicly visible "this property is claimed"
--
-- The property page shows a badge saying an owner or manager has claimed the
-- property, and says plainly that they can reply but not remove reviews. That
-- is a fact a visitor is entitled to know — it is part of how they read the
-- responses beneath.
--
-- But `property_claims` is readable only by the claimant and by moderators,
-- so a signed-out visitor reading through the anonymous client saw nothing and
-- every property rendered as unclaimed. Found by pointing the app at a real
-- database; invisible against the local adapter, which has no RLS.
--
-- Opening up `property_claims` would have been the quick fix and the wrong
-- one: it would expose `claimant_id`, tying a property to a specific user
-- account. Instead the single public bit lives on the rollup table that is
-- already public, and nothing else about the claim is disclosed.
-- ===========================================================================

alter table property_stats
  add column if not exists is_claimed boolean not null default false;

comment on column property_stats.is_claimed is
  'Whether an approved claim exists. The only publicly visible fact about a claim — the claimant''s identity is never exposed.';

create or replace function livd_sync_property_claimed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  affected uuid := coalesce(new.property_id, old.property_id);
begin
  insert into property_stats (property_id, is_claimed)
  values (
    affected,
    exists (
      select 1 from property_claims
      where property_id = affected and status = 'approved'
    )
  )
  on conflict (property_id) do update
    set is_claimed = excluded.is_claimed,
        updated_at = now();

  return coalesce(new, old);
end;
$$;

revoke execute on function livd_sync_property_claimed() from public;

create trigger property_claims_sync_flag
  after insert or update or delete on property_claims
  for each row execute function livd_sync_property_claimed();

-- Backfill for any claims that already exist.
update property_stats ps
set is_claimed = exists (
  select 1 from property_claims c
  where c.property_id = ps.property_id and c.status = 'approved'
);
