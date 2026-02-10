alter table "public"."events"
  add column if not exists "check_in_cutoff_minutes" integer,
  add column if not exists "age_policy" text,
  add column if not exists "accessibility_notes" text,
  add column if not exists "cancellation_window_hours" integer;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'events_check_in_cutoff_minutes_check'
  ) then
    alter table "public"."events"
      add constraint events_check_in_cutoff_minutes_check
      check (
        check_in_cutoff_minutes is null
        or (check_in_cutoff_minutes >= 0 and check_in_cutoff_minutes <= 1440)
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'events_cancellation_window_hours_check'
  ) then
    alter table "public"."events"
      add constraint events_cancellation_window_hours_check
      check (
        cancellation_window_hours is null
        or (cancellation_window_hours >= 0 and cancellation_window_hours <= 720)
      );
  end if;
end
$$;

notify pgrst, 'reload schema';
