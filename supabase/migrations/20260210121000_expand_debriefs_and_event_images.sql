alter table public.events
  add column if not exists event_image_path text;

alter table public.debriefs
  add column if not exists baseline_attendance integer,
  add column if not exists baseline_wet_takings numeric(12,2),
  add column if not exists baseline_food_takings numeric(12,2),
  add column if not exists guest_sentiment_notes text,
  add column if not exists operational_notes text,
  add column if not exists would_book_again boolean,
  add column if not exists next_time_actions text;

alter table public.debriefs
  add column if not exists actual_total_takings numeric(12,2)
    generated always as (coalesce(wet_takings, 0::numeric) + coalesce(food_takings, 0::numeric)) stored,
  add column if not exists baseline_total_takings numeric(12,2)
    generated always as (coalesce(baseline_wet_takings, 0::numeric) + coalesce(baseline_food_takings, 0::numeric)) stored,
  add column if not exists sales_uplift_value numeric(12,2)
    generated always as (
      (coalesce(wet_takings, 0::numeric) + coalesce(food_takings, 0::numeric))
      -
      (coalesce(baseline_wet_takings, 0::numeric) + coalesce(baseline_food_takings, 0::numeric))
    ) stored,
  add column if not exists sales_uplift_percent numeric(8,2)
    generated always as (
      case
        when (coalesce(baseline_wet_takings, 0::numeric) + coalesce(baseline_food_takings, 0::numeric)) > 0::numeric then
          round(
            (
              (
                (coalesce(wet_takings, 0::numeric) + coalesce(food_takings, 0::numeric))
                -
                (coalesce(baseline_wet_takings, 0::numeric) + coalesce(baseline_food_takings, 0::numeric))
              )
              /
              (coalesce(baseline_wet_takings, 0::numeric) + coalesce(baseline_food_takings, 0::numeric))
            ) * 100::numeric,
            2
          )
        else null
      end
    ) stored;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'debriefs_baseline_attendance_check'
  ) then
    alter table public.debriefs
      add constraint debriefs_baseline_attendance_check
      check (baseline_attendance is null or baseline_attendance >= 0);
  end if;
end
$$;

notify pgrst, 'reload schema';
