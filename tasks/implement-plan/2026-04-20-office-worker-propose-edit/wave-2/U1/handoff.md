# Wave 2 — U1 handoff (Tasks 13, 14, 15, 16)

Owner: U1 (Pages & UI Edit-Control Gating)
Branch: `main`
Verification: `npx tsc --noEmit` passes on all changed files (full project clean at handoff time).

## Files changed

| File | What changed | Commit |
|------|--------------|--------|
| `src/app/events/propose/page.tsx` | Swapped `canManageEvents` → `canProposeEvents`; dropped `restrictedVenues` venue filter; pass full venues + `defaultVenueId={user.venueId}` to the form. | `4a56795` |
| `src/components/events/propose-event-form.tsx` | Added optional `defaultVenueId?: string \| null` prop; pre-ticks the default venue when present, falls back to previous "single venue only" auto-select. Absent prop = unchanged behaviour. | `4a56795` |
| `src/app/events/new/page.tsx` | Swapped `canManageEvents` → `canProposeEvents`; dropped `availableVenues` filter; pre-select priority: `?venueId=` query param → `user.venueId` → undefined. | `e40558a` |
| `src/app/events/[eventId]/page.tsx` | Replaced bespoke `canEdit` / `canDelete` logic with a shared `canEditEventFromRow(user, row)` call. Bookings link + `BookingSettingsCard` now gate on the same helper. Imported `canEditEventFromRow`. Passed `canDelete` prop through to `<EventForm>`. | `a065eec`, `218c35c` |
| `src/components/events/event-form.tsx` | Added optional `canDelete?: boolean` prop (default `false`); the inline `<DeleteEventButton>` now renders only when `mode === "edit" && defaultValues?.id && canDelete`. | `218c35c` |

## Commits (four, as required)

1. `4a56795` — `feat(propose): any-venue picker + canProposeEvents gate`
2. `e40558a` — `feat(events/new): any-venue picker + canProposeEvents gate`
3. `a065eec` — `feat(events/edit): canEditEventFromRow gate with soft-delete + status enforcement`
4. `218c35c` — `feat(ui): hide edit controls unless canEditEventFromRow passes`

## Row projection widenings

**None required.** Both data loaders already project all six edit-context fields (`id, venue_id, manager_responsible_id, created_by, status, deleted_at`):

- `getEventDetail()` in `src/lib/events.ts` uses `.select("*, venue:...")` — covers the detail page.
- `listEventsForUser()` in `src/lib/events.ts` also uses `*` — covers the events board (though the board itself renders no edit/cancel/delete/booking buttons inline, so this is defensive coverage).

## Design assumptions recorded

1. **No separate `/events/[eventId]/edit` route exists.** Editing is an inline mode of `src/app/events/[eventId]/page.tsx`, switched on by `canEdit`. Task 15 was therefore applied to the detail page — the canonical gating entry point. The `loadEventEditContext` loader is not called in the UI path because `getEventDetail` already returns the same row (with more fields than the six needed); calling `loadEventEditContext` would be a redundant round-trip. `canEditEventFromRow` operates on the already-loaded row, which matches spec AB-003 v3.1's "avoid a second fetch per row" design goal.

2. **`EventsBoard` renders no inline edit/cancel/delete/booking buttons.** Verified by grep — the board produces calendar/month/matrix/list views of event cards wrapped in `<Link>` navigating to the detail page. No Task 16 widening or gating needed in that component.

3. **Pre-event `approved_pending_details` creator fill-in behaviour is now governed by `canEditEvent`.** The previous bespoke `isCreator && status === "approved_pending_details"` escape hatch has been removed from the UI gate. The spec's `canEditEvent` helper does not grant edit to an office_worker on `approved_pending_details` unless they are also manager_responsible at the venue. If an office_worker proposes a cross-venue event that admin approves, they will NOT see an editable detail page for that event. S1's server-action changes (Tasks 8/9) use `canEditEvent` too, so UI + server stay aligned. If product wants to preserve the creator fill-in workflow across venues, that is a spec change and must happen in R1's helper — not in UI gating.

4. **`canDelete === canEdit === canManageBooking`** on the detail page. All three share `canEditEventFromRow`. The previous narrower `canDelete` (`admin || venue-scoped && draft|needs_revisions`) was widened to match the server action classification table (spec §"Classification of canManageEvents call-sites" — `deleteEventAction` now uses `canEditEvent`). This aligns with plan row 1856.

5. **Events-board `canCreate` button visibility** (lines 180-181 of `events-board.tsx`) was left unchanged. It decides whether to show the "New event" and "Propose an event" navigation buttons; it is NOT a row-level edit gate. Per spec "Nav: no change (the 'Propose an event' child is already visible to office_workers after commit `861b92f`)" this button surface is out of U1's remit and handled elsewhere.

## Self-check against agent brief

- [x] `src/app/events/propose/page.tsx` no longer filters venues by `user.venueId`; shows all active venues.
- [x] `src/app/events/new/page.tsx` no longer filters venues.
- [x] Edit page uses the shared helper and gates on `canEditEvent` (via `canEditEventFromRow`).
- [x] Every edit / cancel / delete / booking button on the detail page is gated on `canEditEventFromRow`.
- [x] Row projections already include all six edit-context fields — no `.select()` widening needed.
- [x] No files under `src/actions/`, `src/lib/roles.ts`, `src/lib/events/*`, or `supabase/migrations/` were modified.
- [x] Four commits landed.
- [x] British English retained throughout.

## Verification

`npx tsc --noEmit` → clean. No `npm run build` was run (per brief — S1 may still be in flight).
