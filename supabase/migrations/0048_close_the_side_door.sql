-- ===========================================================================
-- Livd — 0048 · The window applies to the child tables too
--
-- Found while attacking 0047. A review's ratings, tags and departure reasons do
-- not live on `reviews`; they live in three child tables, and each of those has
-- carried an insert policy since 0004 that asks one question:
--
--     create policy review_categories_insert on review_category_ratings
--       for insert with check (livd_review_is_mine(review_id));
--
-- "Is this your review." Not "is it still published", and not "is it still
-- inside your edit window". So this, as an ordinary signed-in author, against
-- a review of any age and any status:
--
--     POST /rest/v1/review_category_ratings
--     { "review_id": "<mine, from 2024>", "category_key": "value", "rating": 5 }
--
-- succeeded. `review_category_ratings_refresh_stats` then fires and recomputes
-- `property_stats`, so the property's category scores, its overall score and
-- its confidence band all move — on the strength of a rating added to a review
-- that became part of the permanent record a year ago.
--
-- The same door is open on `review_tags`, which feeds "what residents mention
-- most", and on `review_departure_reasons`, which feeds the departure analysis
-- that is the most load-bearing thing this product computes.
--
-- WHY IT WAS INVISIBLE
--
-- Because the application only ever inserts these rows once, in the same
-- breath as the review itself, and nothing in the UI has ever offered a second
-- chance. The policy was written to permit that one moment and it does — it
-- just never stopped permitting it. 0046 made exactly this mistake in the other
-- direction, with a blocklist that was silent about three columns, and the
-- lesson is the same one: a rule that names what is allowed has to name *when*
-- as well as *who*.
--
-- It matters more now than it did last week. 0047 made the ratings correctable
-- inside the window and put a form in front of them; shipping that next to an
-- unbounded insert would make the window a statement about the user interface
-- rather than about the data.
--
-- THE FIX
--
-- One predicate, the same three conditions the review itself is held to, in a
-- SECURITY DEFINER function for the reason 0042 spells out: a policy is
-- evaluated with the querying role's privileges, and that role cannot read
-- `reviews.author_id` since 0040.
--
-- Submission is unaffected. The child rows are inserted seconds after the
-- review, from the same request, and a review seconds old is inside its window
-- by a margin of twenty-four hours.
--
-- `livd_correct_review` is unaffected for a different reason: it is
-- SECURITY DEFINER and does not consult these policies at all. It re-checks
-- the author, the status and the deadline itself, which is what makes it the
-- one path that can replace a set rather than only add to it.
-- ===========================================================================

/**
 * Whether the caller may still write facets onto this review.
 *
 * Theirs, published, and inside the correction window — the same three the
 * review row is held to by `reviews_update_own` and re-checked by
 * `livd_correct_review`. Stated once here so the three policies below cannot
 * drift apart from each other or from the rule on the parent.
 */
create or replace function livd_review_is_open_for_me(target_review uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from reviews r
    where r.id = target_review
      and r.author_id = auth.uid()
      and r.status = 'published'
      and r.created_at > now() - interval '24 hours'
  );
$fn$;

-- Granted to both client roles for the reason in 0042: a policy expression runs
-- with the querying role's privileges, so a role that cannot execute the
-- predicate cannot write the table the policy protects. It answers a boolean
-- about the caller's own review and discloses nothing to anybody else.
grant execute on function livd_review_is_open_for_me(uuid) to anon, authenticated;

comment on function livd_review_is_open_for_me(uuid) is
  'Whether the caller may still write facets onto this review: theirs, published, and inside the 24-hour correction window. The child-table equivalent of reviews_update_own.';

drop policy if exists review_categories_insert on review_category_ratings;
create policy review_categories_insert on review_category_ratings
  for insert to authenticated
  with check (livd_review_is_open_for_me(review_id));

drop policy if exists review_tags_insert on review_tags;
create policy review_tags_insert on review_tags
  for insert to authenticated
  with check (livd_review_is_open_for_me(review_id));

drop policy if exists review_departures_insert on review_departure_reasons;
create policy review_departures_insert on review_departure_reasons
  for insert to authenticated
  with check (livd_review_is_open_for_me(review_id));

-- Still no update or delete policy on any of the three, for any client role.
-- Replacing a set is `livd_correct_review`'s job, and it is the only thing that
-- can do it — so "how did this review's ratings change" has exactly one answer.
