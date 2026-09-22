-- ===========================================================================
-- Livd — 0051 · Telling people why a sign-in link did not work
--
-- Sign-in links are redeemed with `verifyOtp` on the token hash. When GoTrue
-- refuses one it says `otp_expired` whatever the reason: past its lifetime,
-- already used, or replaced by a newer email. Those need different words — "it
-- expired" sends someone to request a new link, "it was used" tells them they
-- may already be signed in somewhere else — so Livd has to find out which.
--
-- Two facts settle it:
--
--   * Whether Supabase still holds the token. GoTrue deletes a token when it
--     is used and when a newer email replaces it, and leaves an expired one
--     where it is. So a token that is still there, and was refused, expired.
--
--   * Whether Livd redeemed it. Nothing else records that, so this migration
--     adds the smallest record that can: a SHA-256 of the spent token hash and
--     the time. No user, no address, no session. A spent token is worthless,
--     and a digest of one cannot be turned back into anything, but it is
--     hashed anyway so that the table never holds a value GoTrue would
--     recognise. Rows are pruned after two days; a link lives for one hour.
--
-- Neither function is an endpoint. Both are service-role only and called from
-- `/auth/verify` after the fact, never before a verification decides anything.
-- ===========================================================================

create table if not exists public.auth_link_redemptions (
  token_digest text primary key,
  redeemed_at  timestamptz not null default now()
);

comment on table public.auth_link_redemptions is
  'SHA-256 of sign-in token hashes Livd has redeemed, kept two days so a reused link can be described as used. No user or address.';

alter table public.auth_link_redemptions enable row level security;

-- No policies: nothing but the two functions below touches this table.
revoke all on table public.auth_link_redemptions from public, anon, authenticated;

create or replace function public.livd_sign_in_link_status(p_token_hash text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_token_hash is null or length(p_token_hash) not between 16 and 128 then
    return 'unknown';
  end if;

  if exists (
    select 1
    from auth.one_time_tokens t
    where t.token_hash = p_token_hash
      and t.token_type in ('confirmation_token', 'recovery_token')
  ) then
    return 'present';
  end if;

  if exists (
    select 1
    from public.auth_link_redemptions r
    where r.token_digest = encode(sha256(convert_to(p_token_hash, 'UTF8')), 'hex')
  ) then
    return 'used';
  end if;

  return 'unknown';
end;
$$;

comment on function public.livd_sign_in_link_status(text) is
  'present | used | unknown for a sign-in token hash GoTrue has just refused. Service role only.';

create or replace function public.livd_record_sign_in_link_redemption(p_token_hashes text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.auth_link_redemptions where redeemed_at < now() - interval '2 days';

  insert into public.auth_link_redemptions (token_digest)
  select encode(sha256(convert_to(h, 'UTF8')), 'hex')
  from unnest(p_token_hashes) as h
  where h is not null and length(h) between 16 and 128
  on conflict (token_digest) do nothing;
end;
$$;

comment on function public.livd_record_sign_in_link_redemption(text[]) is
  'Records that sign-in token hashes were redeemed, as SHA-256 digests. Service role only.';

-- Supabase's default privileges grant EXECUTE to anon and authenticated
-- directly, so revoking from PUBLIC alone would leave both callable. See 0008.
revoke execute on function public.livd_sign_in_link_status(text)
  from public, anon, authenticated;

revoke execute on function public.livd_record_sign_in_link_redemption(text[])
  from public, anon, authenticated;
