alter table "public"."events"
  add column if not exists "booking_type" text,
  add column if not exists "ticket_price" numeric(10, 2),
  add column if not exists "terms_and_conditions" text,
  add column if not exists "public_highlights" text[];

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'events_booking_type_check'
  ) then
    alter table "public"."events"
      add constraint events_booking_type_check
      check (
        booking_type is null
        or booking_type in ('ticketed', 'table_booking', 'free_entry', 'mixed')
      );
  end if;
end
$$;

notify pgrst, 'reload schema';
