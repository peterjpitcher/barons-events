/**
 * Shown in place of the booking form when an event takes no bookings.
 *
 * Deliberately carries no call to action and no colour-only signal: the text
 * itself states the situation.
 */
export function BookingUnavailableNotice({ message }: { message: string }) {
  return (
    <div className="rounded-[8px] bg-[var(--paper)] border border-[var(--hair)] p-6 text-center shadow-card">
      <p className="text-[var(--slate)] font-medium">{message}</p>
    </div>
  );
}
