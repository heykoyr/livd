-- ===========================================================================
-- Livd — 0018 · Let account deletion actually unlink a review
--
-- 0017 changed `reviews.author_id` to `on delete set null` so that deleting an
-- account leaves the review standing, severed from its author, exactly as the
-- legal pages promise. Deleting an account then failed outright with "Database
-- error deleting user", and it took a live test to find out why.
--
-- A foreign key performing SET NULL issues an ordinary UPDATE. That UPDATE
-- fires `reviews_guard_update`, whose whole purpose is to stop an author
-- rewriting their review after the fact — and the first thing it checks is
-- whether `author_id` changed. So the guard refused the database's own
-- deletion cascade, and the refusal surfaced three layers up as an opaque
-- error from the auth API.
--
-- The guard was right to be suspicious and wrong about this one case. Nulling
-- an author is not an edit; it is the erasure the person asked for. This
-- teaches it that single transition and nothing wider:
--
--   * author_id must go from something to null. Never null to something, which
--     would be somebody adopting an orphaned review, and never one id to
--     another.
--   * every other guarded column must be untouched in the same statement, so
--     the exemption cannot be used as cover for changing a rating or a status.
--
-- Worth stating plainly what this does not open. There is no delete policy on
-- `reviews` for any role, no update policy that permits setting `author_id`,
-- and `reviews_update_own` still requires `author_id = auth.uid()` — which no
-- null can satisfy. The only thing that can trigger this path is the foreign
-- key, and the only thing that triggers the foreign key is a profile being
-- deleted.
-- ===========================================================================

create or replace function livd_guard_review_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if livd_is_moderator() then
    return new;
  end if;

  -- The account-deletion path: a foreign key severing this review from an
  -- author who no longer exists. Permitted only when it is the *sole* change.
  if old.author_id is not null
     and new.author_id is null
     and new.body               is not distinct from old.body
     and new.would_recommend    is not distinct from old.would_recommend
     and new.status             is not distinct from old.status
     and new.verification_level is not distinct from old.verification_level
     and new.verification_id    is not distinct from old.verification_id
     and new.verified_at        is not distinct from old.verified_at
     and new.property_id        is not distinct from old.property_id
     and new.overall_rating     is not distinct from old.overall_rating
     and new.residency_status   is not distinct from old.residency_status
     and new.moved_in_month     is not distinct from old.moved_in_month
     and new.moved_out_month    is not distinct from old.moved_out_month
     and new.helpful_count      is not distinct from old.helpful_count
     and new.is_demo            is not distinct from old.is_demo then
    return new;
  end if;

  if new.status             is distinct from old.status
     or new.verification_level is distinct from old.verification_level
     or new.verification_id is distinct from old.verification_id
     or new.verified_at     is distinct from old.verified_at
     or new.property_id     is distinct from old.property_id
     or new.author_id       is distinct from old.author_id
     or new.overall_rating  is distinct from old.overall_rating
     or new.residency_status is distinct from old.residency_status
     or new.moved_in_month  is distinct from old.moved_in_month
     or new.moved_out_month is distinct from old.moved_out_month
     or new.helpful_count   is distinct from old.helpful_count
     or new.is_demo         is distinct from old.is_demo then
    raise exception 'Only the written review and recommendation may be corrected';
  end if;

  return new;
end;
$$;

comment on function livd_guard_review_update() is
  'Restricts what an author may change inside their edit window. Permits exactly one system transition: a foreign key nulling author_id when an account is deleted, with every other column untouched.';
