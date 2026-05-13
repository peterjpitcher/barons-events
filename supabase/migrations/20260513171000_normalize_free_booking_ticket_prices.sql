-- Ensure all free booking formats have no ticket price, including rows whose
-- booking_type was already correct before client confirmation updates.

update public.events
set
  ticket_price = null,
  updated_at = timezone('utc', now())
where deleted_at is null
  and booking_type in ('free_seated', 'free_standing', 'free_standing_unreserved')
  and ticket_price is not null;
