// Shared between BookingForm (client component) and createBookingAction (server action).
// Captured verbatim in customer_consent_events.consent_wording at the time of each booking,
// so the audit record is immune to future changes to this string.
// Changing this wording requires a code deployment.

export const MARKETING_CONSENT_WORDING =
  "Keep me updated with events, offers and news from Barons Pub Company. You can unsubscribe at any time.";
