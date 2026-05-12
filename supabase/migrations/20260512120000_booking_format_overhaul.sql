-- Replace the legacy booking_type values with explicit payment and attendance formats.
-- Existing events are migrated to conservative defaults; unreserved formats are
-- for staff to choose manually after this migration.

alter table events
  drop constraint if exists events_booking_type_check;

alter table events
  drop constraint if exists events_free_booking_no_ticket_price_check;

update events
set
  booking_type = case booking_type
    when 'ticketed' then 'paid_seated'
    when 'table_booking' then 'paid_seated'
    when 'free_entry' then 'free_standing'
    when 'mixed' then 'paid_standing'
    else booking_type
  end,
  ticket_price = case
    when booking_type = 'free_entry' then null
    else ticket_price
  end
where booking_type in ('ticketed', 'table_booking', 'free_entry', 'mixed');

update events
set ticket_price = null
where booking_type in ('free_seated', 'free_standing', 'free_standing_unreserved');

alter table events
  add constraint events_booking_type_check
  check (
    booking_type is null
    or booking_type in (
      'free_seated',
      'free_standing',
      'free_standing_unreserved',
      'paid_seated',
      'paid_standing',
      'paid_standing_unreserved',
      'pay_on_arrival_seated',
      'pay_on_arrival_standing',
      'pay_on_arrival_standing_unreserved'
    )
  );

alter table events
  add constraint events_free_booking_no_ticket_price_check
  check (
    booking_type is null
    or booking_type not in ('free_seated', 'free_standing', 'free_standing_unreserved')
    or ticket_price is null
  );
