-- Owner's decision 02.11.2026: points taken out of the piggy bank can be
-- spent at once, not from the next day. This replaces the rule of stage 4,
-- part 1 («отложенные баллы нельзя потратить до конца дня»).
--
-- Only private.back_today changes: it always says 0 now, so
--   spendable = balance − piggy bank − waiting shop purchases
-- and the shop, gifts and the parent's queue see the taken back points as
-- free right away. The name and the back_today fields in child_goals and
-- child_shop stay (an app opened before this update still reads them; with 0
-- it shows no «потратить завтра» line). The goal_holds history is not touched.
-- Points returned by a parent cancelling a dream are free at once too.
create or replace function private.back_today(p_child uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select 0
$$;
