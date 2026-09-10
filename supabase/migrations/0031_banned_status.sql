-- ===========================================================================
-- Livd — 0031 · The banned status
--
-- One enum value, alone, because Postgres will not let a new one be *used* in
-- the transaction that adds it and Supabase applies each migration inside one.
-- 0032 builds the sanction system on top.
--
-- Why `banned` is separate from `suspended` rather than a suspension with no
-- end date: they mean different things to the person on the receiving end and
-- to whoever reviews the decision later. A suspension is a pause with a date
-- attached. A ban is a conclusion, and conflating the two makes it impossible
-- to tell, six months on, whether somebody was meant to come back.
-- ===========================================================================

alter type user_status add value if not exists 'banned' after 'suspended';
