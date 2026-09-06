-- ===========================================================================
-- Livd — 0009 · Rate limiting that survives more than one instance
--
-- The limiter counted in process memory. On one machine that is correct and
-- fast; on Vercel it means every serverless instance keeps its own tally, so
-- the real limit is the configured one multiplied by however many instances
-- happen to be warm. `rate_limit_events` existed for this from 0002 and had
-- nothing writing to it.
--
-- One function, called once per check, doing all of it in a single round trip:
-- prune, record, count, and report when a slot next frees up.
--
-- Two deliberate choices:
--
-- * A sliding window, not a fixed one. A fixed window lets someone spend the
--   whole allowance at 11:59 and the whole allowance again at 12:00. Counting
--   backwards from now removes that seam, and the events table makes it no
--   harder to compute.
--
-- * A transaction-scoped advisory lock. Without it, concurrent requests can
--   each count before the others' inserts are visible and all be allowed —
--   which is exactly the burst the limit exists to stop. The lock is held for
--   microseconds and is keyed per actor, so it serialises one person's
--   requests and nobody else's.
--
-- `actor_hash` is a salted digest, never an IP address. Livd does not need to
-- know where anyone is, only that two requests came from the same place.
-- ===========================================================================

create or replace function livd_rate_limit_hit(
  p_bucket         text,
  p_actor_hash     text,
  p_window_seconds integer
)
returns table (hit_count integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  window_start timestamptz := now() - make_interval(secs => p_window_seconds);
  oldest       timestamptz;
  total        integer;
begin
  if p_window_seconds is null or p_window_seconds <= 0 then
    raise exception 'window must be a positive number of seconds';
  end if;

  -- Serialise this actor's concurrent requests, and only this actor's.
  perform pg_advisory_xact_lock(hashtext(p_bucket || ':' || p_actor_hash));

  -- This actor's expired events, removed on the same index lookup the count
  -- below uses. Keeps an active actor's rows bounded by the window rather than
  -- by however long it is until the nightly sweep.
  delete from rate_limit_events
  where bucket_key = p_bucket
    and actor_hash = p_actor_hash
    and occurred_at < window_start;

  insert into rate_limit_events (bucket_key, actor_hash) values (p_bucket, p_actor_hash);

  select count(*)::integer, min(occurred_at)
    into total, oldest
  from rate_limit_events
  where bucket_key = p_bucket
    and actor_hash = p_actor_hash
    and occurred_at >= window_start;

  -- When the oldest event in the window ages out, a slot frees up. That is the
  -- honest answer to "how long until I can try again", not the window length.
  return query select total, oldest + make_interval(secs => p_window_seconds);
end;
$$;

comment on function livd_rate_limit_hit(text, text, integer) is
  'Records one request and returns the sliding-window count for that actor. Service role only: it is called from Server Actions, never from a browser.';

-- Sweeps actors that stopped calling mid-window and left rows behind. The
-- longest configured window is 24 hours (claim submissions), so anything older
-- than two days cannot affect any decision.
create or replace function livd_prune_rate_limit_events()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from rate_limit_events where occurred_at < now() - interval '2 days';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
--
-- Neither function is an endpoint. `revoke ... from public` alone would not do
-- it: Supabase's default privileges grant EXECUTE directly to anon,
-- authenticated and service_role, so PUBLIC is one grant of four. See 0008.
--
-- service_role keeps its grant and is the only caller. A browser-callable
-- version would let anyone holding the anon key write unbounded rows under
-- actor hashes of their own invention.
-- ---------------------------------------------------------------------------

revoke execute on function livd_rate_limit_hit(text, text, integer)
  from public, anon, authenticated;

revoke execute on function livd_prune_rate_limit_events()
  from public, anon, authenticated;
