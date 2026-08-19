-- =============================================================================
-- Landing-page call-to-action buttons
-- =============================================================================
-- Until now a custom booking_url short-circuited /l/<slug> with a 308 redirect,
-- so the customer never saw the event page we had written for them. The landing
-- page now always renders and the custom link becomes the primary button.
--
-- Three nullable columns support that:
--   * booking_cta_label   overrides the button text derived from booking_type
--                         (e.g. "Buy your seats"). Applies to both the external
--                         link button and the in-app booking form.
--   * secondary_cta_label / secondary_cta_url
--                         an optional extra button under the primary one, for
--                         things like a menu, a table booking, or an enquiry.
--
-- All three are nullable with no default, so every existing row keeps today's
-- behaviour until someone fills them in.
-- =============================================================================

begin;

alter table public.events
  add column if not exists booking_cta_label text,
  add column if not exists secondary_cta_label text,
  add column if not exists secondary_cta_url text;

comment on column public.events.booking_cta_label is
  'Optional override for the landing-page booking button text. Falls back to the booking_type CTA.';
comment on column public.events.secondary_cta_label is
  'Optional label for an extra landing-page button. Requires secondary_cta_url.';
comment on column public.events.secondary_cta_url is
  'Optional http(s) destination for the extra landing-page button. Requires secondary_cta_label.';

-- Labels: non-blank and short enough to fit a button on a phone.
alter table public.events
  drop constraint if exists events_booking_cta_label_length;
alter table public.events
  add constraint events_booking_cta_label_length check (
    booking_cta_label is null
    or char_length(btrim(booking_cta_label)) between 1 and 40
  );

alter table public.events
  drop constraint if exists events_secondary_cta_label_length;
alter table public.events
  add constraint events_secondary_cta_label_length check (
    secondary_cta_label is null
    or char_length(btrim(secondary_cta_label)) between 1 and 40
  );

-- The extra button is only renderable with both halves, so reject half a pair
-- at the database rather than silently dropping it at render time.
alter table public.events
  drop constraint if exists events_secondary_cta_pair;
alter table public.events
  add constraint events_secondary_cta_pair check (
    (secondary_cta_label is null and secondary_cta_url is null)
    or (secondary_cta_label is not null and secondary_cta_url is not null)
  );

-- Defence in depth against a javascript:/data: href reaching a customer's
-- browser. The server action validates too; this is the backstop.
alter table public.events
  drop constraint if exists events_secondary_cta_url_scheme;
alter table public.events
  add constraint events_secondary_cta_url_scheme check (
    secondary_cta_url is null
    or secondary_cta_url ~* '^https?://[^\s]+$'
  );

commit;
