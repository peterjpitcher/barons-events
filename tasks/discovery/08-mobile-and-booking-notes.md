# Discovery 08 — Mobile Optimisation + Booking/Customer-Notes Default

**Scope:** READ-ONLY investigation. No code changed. Covers (a) mobile QA — menu/body
overlap, opening planning items on mobile, end-to-end responsive pass; and (b) defaulting
customer notes to enabled when bookings flip disabled→enabled.

**Stack confirmed:** Next.js 16 App Router, React 19, Tailwind v4 (`@theme` tokens in
`src/app/globals.css`), Supabase ref `shofawaztmdxytukhozo`.

---

## 1. Navigation / menu architecture

### Components
| File | Role |
|------|------|
| `src/app/layout.tsx` | Root layout; renders `<AppShell user>` when authed (line 181-185) |
| `src/components/shell/app-shell.tsx` | Server shell: desktop `<aside>` rail + `<AppTopBar>` + `<main>` |
| `src/components/shell/app-topbar.tsx` | Sticky header (`sticky top-0 z-30`), hosts `<MobileNav>` on `md:hidden` |
| `src/components/shell/mobile-nav.tsx` | Mobile hamburger + slide-in drawer (`<md`) |
| `src/components/shell/nav-link.tsx` | Individual nav link / callout link |

### Layout layering (relevant z-index + positioning)
- Outer wrapper: `app-shell.tsx:160` — `min-h-screen ... md:pl-[var(--rail-w)]`
  (`--rail-w: 60px`, `globals.css:85`). On mobile the `pl` is dropped → **no rail/body
  overlap from the desktop sidebar.**
- Desktop sidebar `<aside>`: `app-shell.tsx:168` — `fixed inset-y-0 left-0 z-50 hidden ...
  md:flex`. Hidden below `md`, so it is NOT on screen on phones.
- Topbar `<header>`: `app-topbar.tsx:310-312` — `sticky top-0 z-30 ... backdrop-blur`.
- Main content: `app-shell.tsx:41` — `<main id="main-content" class="flex-1 ... px-4 py-5">`.
- Mobile drawer (`mobile-nav.tsx`):
  - Trigger button `md:hidden` (line 46-53).
  - Scrim overlay `fixed inset-0 z-40 bg-black/40 md:hidden` (line 56-60).
  - Drawer `<aside>` `fixed inset-y-0 left-0 z-50 w-72 ... md:hidden` with
    `translate-x-0 / -translate-x-full` (line 63-66).

### ROOT-CAUSE HYPOTHESIS — "mobile menu/body overlap"
**Primary suspect: `mobile-nav.tsx` does NOT lock body scroll when the drawer is open.**
- The drawer's open/close effect (`mobile-nav.tsx:35-42`) only wires an Escape-key handler.
  It never sets `document.body.style.overflow = "hidden"`.
- Compare with every other overlay in the app, which DO lock scroll and restore it:
  - `src/components/ui/sheet.tsx:136-139`
  - `src/components/ui/confirm-dialog.tsx:36-51`
  - `src/components/planning/planning-modal.tsx:25-31`
  - `src/components/users/deactivate-dialog.tsx:50…`
- Consequence on touch / iOS Safari: with the drawer (`fixed inset-y-0`) open, the page
  body behind the `z-40` scrim is still scrollable. Scroll gestures that start on the
  scrim (or rubber-band) move the underlying page, so page content visibly slides
  *underneath / through* the drawer — the reported "menu/body overlap". The drawer is
  `z-50` over a `z-40` scrim over `z-30` topbar, so static stacking is correct; the defect
  is the missing scroll-lock, not a z-index inversion.

**Secondary contributor (verify on device):** the drawer has no max-height / internal
scroll container — `<nav class="mt-5 flex flex-col gap-4">` (line 90) can exceed viewport
height on short screens with many sections; combined with no body lock, the long drawer
content may itself overflow past the bottom edge.

**Fix direction (not applied):** add a body-scroll-lock effect to `MobileNav` mirroring the
sheet/modal pattern (save `document.body.style.overflow`, set `"hidden"` while open,
restore on close/unmount). Optionally make the drawer body `overflow-y-auto` with a capped
height.

---

## 2. Opening planning items on mobile

### How items open (all confirmed)
There is **no modal** anymore. `planning-item-editor-shell.tsx:14-21` documents that the
PlanningModal was removed (issue 04) and opening now means **navigating to the detail route
`/planning/[planningItemId]`** (`src/app/planning/[planningItemId]/page.tsx`).

Open handlers in `src/components/planning/planning-board.tsx`, all `router.push(...)`:
- Board compact card: `onOpenDetails` → `router.push('/planning/'+id)` — **line 759**
  (only when `canEditItem`).
- Calendar view: `onOpenPlanningItem` — **line 799-800** (only when `canCreatePlanningItems`).
- List view: `onOpenPlanningItem` — **line 813-814** (only when `canCreatePlanningItems`).
- Todos-by-person: `onOpenPlanningItemId` — **line 832** (always wired).

Leaf render of the open affordance:
- List view: `planning-list-view.tsx:117-130` — a real `<button onClick={onOpenPlanningItem}>`.
- Calendar view: `planning-calendar-view.tsx:165` — `<button onClick={onOpenPlanningItem}>`.
- Board compact card: `planning-item-card.tsx:472-475` — small "Manage" ghost `<Button>`
  inside the card (the only tappable open target on the card).

### ROOT-CAUSE HYPOTHESIS — "opening planning items on mobile"
Two independent causes, both plausible; needs device repro to confirm which the client hit:

**(A) Native HTML5 drag on the card swallows taps (board view).**
- The compact card root `<article>` is `draggable={canDrag}` with `onDragStart`
  (`planning-item-card.tsx:377-378`, also full card 485-486). `canDrag` is true on the
  board (cards receive `onDragStart`).
- There is **no dnd-kit / touch-drag library and no PointerSensor/TouchSensor** anywhere
  (grep confirms only native `draggable` + `onDragStart`/`onDrop`). Native HTML5 DnD is
  unreliable on touch and the `draggable` attribute can intercept the touchstart/tap and
  long-press, so tapping the card area (or the small "Manage" button, line 472) can fail to
  register or trigger a drag instead. The list/calendar views use plain `<button>` and are
  not draggable, so they should open fine **for users who can edit**.

**(B) Open is gated behind edit/create permission → silent no-op for view-only users.**
- List/calendar/board-card open handlers are only passed when
  `canCreatePlanningItems(userRole, venueId)` / `canEditVenueLinkedPlanning(...)` is true
  (`planning-board.tsx:759, 799-800, 813-814`). When false, `onOpenPlanningItem` /
  `onOpenDetails` is `undefined`:
  - List/calendar buttons still render but `onClick={() => onOpenPlanningItem?.(...)}`
    does nothing (optional-chaining no-op) — `planning-list-view.tsx:120`,
    `planning-calendar-view.tsx:165`.
  - Board card hides the "Manage" button entirely (`planning-item-card.tsx:472`
    `{onOpenDetails ? ...}`).
- So an `executive` (view-only), or an `office_worker` looking at an item outside their
  venue, sees items they cannot open. This is **not mobile-specific** but reads as "can't
  open planning items" and may be conflated with the mobile report.

**Fix direction (not applied):** for (A) prefer gating `draggable` to non-touch / pointer:
fine, or wrap cards in a tap target that navigates regardless of drag; minimally, ensure
the "Manage"/open control is a large, non-draggable button. For (B) decide whether
view-only roles should be able to open the read-only detail page (the detail page itself
only requires `canViewPlanning` — `[planningItemId]/page.tsx:27` — so navigation would
succeed; the gate is purely in the board UI).

---

## 3. End-to-end mobile inventory (prioritised by severity)

Tailwind breakpoints in use across the app: `sm: md: lg: xl: 2xl:`. Tokens:
`--rail-w:60px`, `--rail-w-open:224px` (`globals.css:85-86`). `.metric-grid` has explicit
mobile collapse at `max-width:560px` (`globals.css`). `.data-table-shell` provides
`overflow-x:auto` for tables (`globals.css:231`).

### HIGH
1. **Mobile drawer body-scroll-lock missing** — `mobile-nav.tsx:35-42`. See §1. Causes the
   menu/body overlap. (Severity: high — it's the named bug.)
2. **Planning board cards rely on native HTML5 `draggable` for touch** —
   `planning-item-card.tsx:377-378, 485-486`; no touch sensor anywhere. See §2(A).
   Degrades open + reorder on phones. (High.)
3. **`service-types-manager.tsx` table has no mobile layout** — `grid-cols-[minmax(0,1fr)_auto_auto]`
   header (line 29) + `grid-cols-[minmax(0,1fr)_auto_auto]` rows (line 117) inside a plain
   `overflow-hidden` wrapper (line 28) with **no `md:`/`sm:` gating and no `md:hidden` card
   fallback** (unlike users/event-types managers). Will cram/clip on narrow screens.
   (High for admins on mobile.)

### MEDIUM
4. **Wide fixed-min-width content that only side-scrolls** — acceptable but not ideal on
   phones:
   - `event-calendar.tsx:223` `min-w-[560px]` (inside `overflow-x-auto`, line ~ wrapper).
   - `events-board.tsx:1005` calendar cells `min-w-[9rem]`; `weekly-hours-grid.tsx:203`
     `min-w-[8rem]` per day column (7+ columns → wide horizontal scroll). Tables are
     wrapped in `.data-table-shell` so they scroll rather than break, but UX on phones is
     a long horizontal scroll. (Medium.)
5. **Topbar search hidden on mobile** — `app-topbar.tsx:327` search input is
   `hidden ... md:block`; the ⌘K affordance and search are unavailable on phones with no
   mobile equivalent surfaced in the drawer. (Medium — feature gap, not breakage.)
6. **`event-form.tsx` modals are `fixed inset-0 ... p-4` with `max-w-5xl`** (lines 1454,
   1668) and inner `lg:grid-cols-[2fr_1fr]`. On mobile they stack (good) but there is no
   explicit `max-h` + internal scroll on the outer dialog — tall forms may overflow the
   viewport. Confirm on device. (Medium.)

### LOW / OK
7. Dashboard root grid `xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.85fr)]`
   (`page.tsx:283`) — single column below `xl`, the `360px` min never applies on mobile.
   OK.
8. `users-manager.tsx` (line 41 `md:hidden` cards / 264 `md:block` grid) and
   `event-types-manager.tsx` (line 25 / 161) — **have proper mobile card fallbacks.** OK.
9. Data tables (`CustomersView:66`, `BookingsView:195`, `events/[eventId]/bookings:118`,
   `customers/[id]:109`) all wrapped in `.data-table-shell` → horizontal scroll on mobile.
   Functional; long scroll only. Low.
10. Body scroll-lock in dialogs/sheets/planning-modal all correctly save+restore
    `document.body.style.overflow` — no global lock leak. OK.

---

## 4. Booking enabled + customer-notes field mapping

### Field identities (CONFIRMED against live schema)
`information_schema.columns` for `public.events`:
| DB column (snake_case) | Type | Default | Nullable | camelCase / prop |
|---|---|---|---|---|
| `booking_enabled` | boolean | `false` | NO | `bookingEnabled` |
| `booking_notes_enabled` | boolean | `false` | NO | `bookingNotesEnabled` |
| `total_capacity` | integer | null | YES | `totalCapacity` |
| `max_tickets_per_booking` | integer | `10` | NO | `maxTicketsPerBooking` |
| `sms_promo_enabled` | boolean | `false` | NO | `smsPromoEnabled` |
| `booking_type` / `booking_url` / `seo_slug` | text | null | YES | — |

**"Customer notes" = `booking_notes_enabled` (DB) / `bookingNotesEnabled` (TS).** It is an
event-level flag. When ON it renders an optional "Notes for the team" textarea on the
public booking form: `src/app/l/[slug]/BookingForm.tsx:445-449` (and the per-booking value
is stored as `customer_notes` / `customerNotes`, e.g. payload at `BookingForm.tsx:123,207`;
displayed in `bookings`/`customers` views). The toggle's UI label is literally
"Customer notes enabled / disabled" (`booking-settings-card.tsx:164`) with help text
"Adds an optional notes box to the public booking form for this event."

### Where the toggle lives + the disabled→enabled transition
- UI: `src/components/events/booking-settings-card.tsx`
  - Props (line 21-32): `bookingEnabled`, `bookingNotesEnabled`, etc.
  - State (line 46, 51): `const [bookingEnabled, setBookingEnabled] = useState(initialBookingEnabled);`
    and `const [bookingNotesEnabled, setBookingNotesEnabled] = useState(initialBookingNotesEnabled);`
  - "Bookings" switch `onClick` (line ~150): `setBookingEnabled((v) => !v); setHasUnsavedChanges(true);`
  - "Customer notes" switch `onClick` (line ~272): `setBookingNotesEnabled((v) => !v); ...`
  - Save (line 83-92): calls `updateBookingSettingsAction({ eventId, bookingEnabled,
    totalCapacity, maxTicketsPerBooking, bookingNotesEnabled, bookingUrl, ...smsPromo })`.
  - Mounted from `src/app/events/[eventId]/page.tsx:606-609`
    (`bookingEnabled={Boolean(event.booking_enabled)}`,
    `bookingNotesEnabled={Boolean(event.booking_notes_enabled)}`).
- Server action: `src/actions/events.ts` → `updateBookingSettingsAction` (declared line
  2527; schema `bookingSettingsSchema` line 2506-2514 with `bookingNotesEnabled:
  z.boolean().optional()`). Update payload builds `booking_notes_enabled:
  bookingNotesEnabled ?? false` at **line 2608**; writes via admin client (line 2616-2620);
  audit at line 2627-2641.

### HOOK POINT for "default customer notes to enabled on disabled→enabled"
The requirement is: *when the user flips bookings from disabled to enabled, customer notes
should default to enabled.* There are two viable hook points (decision needed — see
questions):

- **Client (recommended, matches "default"):** in `booking-settings-card.tsx`, in the
  Bookings switch `onClick`, when toggling from `false`→`true`, also set
  `setBookingNotesEnabled(true)` (so the UI reflects the new default and the user can still
  turn it back off before saving). Pseudocode at the existing handler (~line 150).
- **Server (enforced):** in `updateBookingSettingsAction` (`events.ts` ~line 2594-2608),
  detect the transition by reading the current `booking_enabled` from the row already
  fetched (NB: current `select` at line 2563 fetches `id,title,public_title,start_at,
  venue_id,seo_slug,booking_type` — it does **not** currently select `booking_enabled` or
  `booking_notes_enabled`, so add them) and, when `was=false && bookingEnabled=true`,
  default `booking_notes_enabled` to `true` unless the caller explicitly set it.

Note the column already defaults to `false` in the DB, so this is purely application
behaviour for the toggle transition; **no migration is required** for the default itself.

---

## QUESTIONS FOR HUMAN

1. **Confirm "customer notes" identity.** We mapped it to the event-level
   `booking_notes_enabled` flag (the "Customer notes enabled/disabled" toggle on the event
   Booking-settings card, which adds the notes textarea to the public booking form). Is
   that the "customer notes" you mean? (The other thing called notes is the per-booking
   `customer_notes` text value guests submit — but that has no enable/disable default.)

2. **Default behaviour semantics for the transition.** When bookings go disabled→enabled,
   should customer notes:
   - (a) flip ON as an *editable default* the user can still turn off before saving
     (client-side, recommended), or
   - (b) be *forced* ON server-side whenever bookings are enabled, or
   - (c) default ON only on the *first* time bookings are enabled (and respect the user's
     choice thereafter)?

3. **Should the default also apply to NEW events** created with bookings already enabled
   (event create / propose flows), or only to the disabled→enabled toggle on an existing
   event's settings card?

4. **Depth of "review mobile end to end".** Do you want:
   - (a) *targeted bug fixes only* — the two named issues (menu/body overlap +
     opening planning items), plus the one clear mobile-broken screen
     (`service-types-manager`), or
   - (b) a *full responsive overhaul* across all pages (drawer scroll-lock, planning touch
     DnD via a real sensor lib, mobile card layouts for all `fr`-grid tables, mobile search,
     modal max-heights)? (b) is materially larger (touches 10+ files + a DnD library).

5. **Planning open on mobile — which symptom did you hit?** Was it (A) tapping a card on
   the *board* doing nothing / starting a drag, or (B) being unable to open items in a
   role that is view-only (executive / out-of-venue office_worker)? This determines whether
   the fix is touch-DnD handling or the permission gate on the open handlers.
