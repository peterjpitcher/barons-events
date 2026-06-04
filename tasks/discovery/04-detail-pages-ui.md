# Discovery 04 — Detail Pages UI (Planning detail rebase + Event detail cleanup + Debrief pin/persist)

Read-only investigation. No code changed. Repo: `/Users/peterpitcher/Cursor/BARONS-BaronsHub`.

---

## 1. The "new event detail page" (BaronsHub 1.1 redesign)

**The 1.1 redesign is git commit `1df0b13` "Roll out BaronsHub 1.1 redesign"** (2026-05-26). It touched ~50+ files including `src/app/events/[eventId]/page.tsx` (per `docs/NewDesignRolloutPlan.md` line 74: "Event detail header, summary cards, sections, and actions").

**The event detail page IS `src/app/events/[eventId]/page.tsx` (649 lines).** It is a server component. Layout:

- `EventPageHeader` (title, status, delete/revert actions) — line 554
- A "quick info bar" (assignee / created-by / manager / Bookings link) — lines 564–583
- `EventForm` (`@/components/events/event-form.tsx`, mode="edit", `readOnly={!canEdit}`) — the main editable surface — line 586
- A "Lower cards grid" (`grid gap-6 lg:grid-cols-2`) — lines 602–636 — containing the cards below
- `SopDrawer` (linked SOP tasks) — line 638

### Card inventory (all defined inline in `page.tsx` unless noted) — file:line

| Card | Variable | Defined at | Rendered at | Notes |
|---|---|---|---|---|
| Booking settings | `<BookingSettingsCard>` | `src/components/events/booking-settings-card.tsx` (imported, line 4) | `page.tsx:604` | Only when `canEdit`. Booking enabled, capacity, max tickets, SEO slug, SMS promo, booking URL/type. |
| Attachments | `<AttachmentsPanel>` | external component | `page.tsx:618` | — |
| Proposal decision | `<ProposalDecisionCard>` | external component | `page.tsx:627` | Only `canPreReview`. |
| Review decision | `reviewDecisionCard` | `page.tsx:386–396` | `page.tsx:630` | Only `canReview`; wraps `<DecisionForm>`. |
| **Assignment** (REMOVE) | `assignmentCard` | **`page.tsx:342–384`** | `page.tsx:631` | CardTitle text: **"Assignment"** (`page.tsx:345`). Assignee `<Select>` + update form. |
| **Reviewer timeline** (REMOVE) | `reviewerTimelineCard` | **`page.tsx:398–425`** | `page.tsx:632` | CardTitle text: **"Reviewer timeline"** (`page.tsx:401`). Lists `event.approvals`. |
| Audit trail | `auditTrailCard` | `page.tsx:427–472` | `page.tsx:633` | CardTitle "Audit trail". |
| **Post-event debrief** (RETIRE separate card; move button) | `debriefSubmitCard` | **`page.tsx:474–498`** | `page.tsx:634` | CardTitle text: **"Post-event debrief"** (`page.tsx:477`). Contains the **"Add debrief" / "Update debrief" button** at **`page.tsx:492–494`** (`<Link href={/debriefs/${event.id}}>`). Gated by `canSubmitDebrief`. |
| Debrief snapshot | `debriefSnapshotCard` | `page.tsx:500–550` | `page.tsx:635` | CardTitle "Debrief snapshot". Shows attendance/takings/sentiment when `event.debrief` exists. |

### Where is the "Event Details" card?
**Two distinct things share the name — disambiguate before building:**

- **On the event detail page (`/events/[eventId]/page.tsx`): there is NO standalone "Event Details" card.** Core event context is rendered by the **`EventForm`** component (`src/components/events/event-form.tsx`, 1902 lines), used in edit mode (read-only for non-editors). The client's "move Add-debrief button into the Event Details card" most plausibly means *into the EventForm surface* on this page. **AMBIGUITY — see questions.**
- **`src/components/events/event-detail-summary.tsx` (`EventDetailSummary`, 279 lines)** IS a read-only card whose `CardTitle` is literally **"Event details"** (`event-detail-summary.tsx:97`). BUT it is **NOT used by the event detail page** — it is imported only by the debriefs page (`src/app/debriefs/[eventId]/page.tsx`) and the bookings page. So "Event Details card" may refer to this component if the client is thinking of the debrief screen, not the event page.

---

## 2. Planning item detail page

**Page: `src/app/planning/[planningItemId]/page.tsx` (107 lines).** Server component. Title metadata: "Planning item · BaronsHub 1.1". Structure:

- `← Back to planning` link — line 61
- `PageHeader` (eyebrow "Planning item", title, venue + task count) — line 64
- 2-col grid (`lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]`) — line 77
  - Left: **`<PlanningItemEditorShell>`** (line 82) + `<AuditTrailPanel>` (line 88)
  - Right: `<AttachmentsPanel>` (line 94)

**`PlanningItemEditorShell`** (`src/app/planning/[planningItemId]/planning-item-editor-shell.tsx`, 38 lines, `"use client"`) is a thin wrapper that renders **`<PlanningItemCard>`** (`src/components/planning/planning-item-card.tsx`, 960 lines) with `onChanged={() => router.refresh()}`. The card is the full inline-edit experience (previously hosted in the now-removed `PlanningModal`).

### Sections the planning detail page renders today (via `PlanningItemCard`)
Inline-editable fields (each with a pencil edit button):
- Title (`planning-item-card.tsx:497`), Type label (`:519`), Status badge (`:541`)
- Target date (`:572`), Owner (`:597`), Recurring (`:673`), Description (`:682`)
- Task list (`PlanningTaskList`), SOP checklist
- **`EventOverlayCard`** (`planning-item-card.tsx:863`) — a **read-only** summary of a linked event: public title/teaser, date, venue, and a single line **"Web copy: Ready/Not yet"** (`:916`), plus "Continue draft"/"Manage" links to `/events/[eventId]`. No booking/ticketing controls.

### ⚠ Sections to remove (website listing, booking, ticketing, booking settings)
**These sections DO NOT currently exist on the planning detail page.** A targeted grep across `src/components/planning/` for `website|booking|ticket|listing|seo_slug|booking_enabled|public_highlights` returned **only** the read-only "Web copy" indicator line (`planning-item-card.tsx:916`). There are no booking-settings / ticketing / website-listing form sections in `PlanningItemCard` or `PlanningItemEditor` (`src/components/planning/planning-item-editor.tsx`, 484 lines — only headings "Create planning work").

**Interpretation:** The removal request only makes sense in the context of the *other* client ask — "use the new event detail page as the base for planning item pages." Today the planning page does NOT share the event detail page; it uses its own `PlanningItemCard`. If the planning page is rebased onto `EventForm` / the event-detail layout, it would *inherit* the website/booking/ticketing/booking-settings sections, which then need stripping. **This is the central scoping ambiguity — see questions.**

### Reusability assessment — sharing the event detail page as a base
- The event detail page's editable core is **`EventForm`** (1902 lines) — large, event-specific (venue spaces, booking format, ticket price, goals, public highlights, artists, debrief prop). It is NOT currently parameterised for "planning item" mode.
- The lower cards (assignment, reviewer timeline, audit, debrief, booking settings) are **defined inline in `page.tsx`**, not extracted into reusable components — so "share the layout" currently means copy-paste unless they are first extracted.
- Planning items and events are **different data models** (`PlanningItem` vs `EventDetail`) with different server fetchers (`getPlanningItemDetail` vs `getEventDetail`) and different field sets. A literal shared component would need a large discriminated-union or heavy prop-gating.
- **Lower-effort path:** reuse the *visual shell* (PageHeader + 2-col cards grid + token classes from `design-primitives.tsx`) rather than the `EventForm` component itself. The planning page already uses the same `app-page` wrapper, `PageHeader`, and card tokens, so it is *visually* aligned already (per the 1.1 rollout, line 79: "Planning detail header and editor shell alignment").
- **Recommendation to surface:** confirm whether "use the event detail page as the base" means (a) visual/layout parity (cheap, mostly done) or (b) a literal shared React component (expensive, needs `EventForm` generalisation). See questions.

---

## 3. Per-user UI preference persistence (for the debrief pin state)

### What exists

**A. Per-user prefs stored as COLUMNS on `public.users` (NOT a `user_preferences` table).**
- There is **no `user_preferences` / `user_settings` / `ui_preferences` table** anywhere (grep of `supabase/migrations/` + `src/` returned nothing).
- The "todo digest preferences" feature (commit `defdbe0`) is the precedent for a per-user preference. It is stored as two columns added by migration **`supabase/migrations/20260525140000_user_todo_digest_preferences.sql`**:
  - `users.todo_digest_frequency text not null default 'weekdays'` (CHECK constraint)
  - `users.todo_digest_last_sent_on date`
- Read/write path: server action **`src/actions/account.ts`** (`updateCommunicationPreferences`-style action) reads/writes `users.todo_digest_frequency`; helper enums in **`src/lib/communication-preferences.ts`**; UI form **`src/components/account/communication-preferences-form.tsx`** on `src/app/account/page.tsx`. Types in `src/lib/supabase/database.types.ts:2205+`.
- **This is the established pattern for "persist X per user": add a column to `public.users`, write via a server action with audit logging, read in the server component.** RLS already governs `public.users`.

**B. localStorage for per-BROWSER UI toggles (NOT per-account).**
- `src/components/events/events-board.tsx` persists view state in localStorage: keys `events-board-view` (line 119) and `events-board-hide-past` (line 120), read at lines 214/251, written at 246/259.
- This is the only real localStorage UI-pref usage. `src/app/layout.tsx:116–125` only feature-detects/guards localStorage availability (Safari private-mode hardening).
- Trade-off: localStorage is simplest (no migration, no server round-trip) but is **per-device, per-browser**, not "per user" across devices. The client said "persist the pinned state **per user**" — if that means *per user account* (syncs across devices), localStorage does not satisfy it; a `users` column does. **See questions.**

### No existing "pin / sticky card" pattern
- Grep for `pin|pinned|sticky|collapse|expanded` found only: a `sticky top-0` topbar (`app-topbar.tsx:312`), SOP template `expanded` toggles (`sop-template-editor.tsx`), and planning task notes `expanded` (`planning-task-list.tsx`). **No pin affordance and no card-pinning persistence exist** — both the UI control and the persistence store would be net-new.

---

## QUESTIONS FOR HUMAN

1. **Confirm the "new event detail page" identity.** Findings point to `src/app/events/[eventId]/page.tsx` (the 1.1 redesign, commit `1df0b13`). Confirm this is the intended base — and NOT the read-only `EventDetailSummary` card (`event-detail-summary.tsx`, used on the debriefs/bookings screens).

2. **"Event Details card" disambiguation (for moving the Add-debrief button).** The event detail page has no card literally titled "Event details" — core fields are rendered by the `EventForm` component. The only component titled "Event details" is `EventDetailSummary`, which the event page does not use. Where exactly should the "Add debrief" button move:
   - (a) Into the `EventForm` surface on `/events/[eventId]` (e.g. a header/footer action of that form), or
   - (b) Into the `EventDetailSummary` card (which lives on the debriefs/bookings screens, not the event page)?

3. **Planning rebase scope — the removal request implies a rebase that hasn't happened.** The planning detail page does NOT currently contain website-listing / booking / ticketing / booking-settings sections (it uses `PlanningItemCard`, which has none). Did you intend:
   - (a) The planning page to be **rebuilt to share the event detail page's component/layout** (inheriting those sections, which we then strip), or
   - (b) Simply to **confirm those sections stay absent** / re-skin the existing `PlanningItemCard` page to match the event-detail look — with no actual section removal needed?

4. **Share component vs trimmed copy.** If planning should share the event detail page (Q3a): do you want a **single shared React component** (requires generalising the 1902-line `EventForm` and extracting the inline cards — high effort), or a **trimmed copy** of the event-detail layout adapted to the `PlanningItem` model (lower coupling, some duplication)?

5. **Where to persist the debrief pin state — per device or per user account?** There is no pin mechanism today. Two precedents exist:
   - **Per-user-account:** add a column to `public.users` (e.g. `debrief_pinned boolean`), following the `todo_digest_frequency` pattern (server action + audit + RLS). Syncs across devices. Requires a migration.
   - **Per-browser:** localStorage, following the `events-board.tsx` pattern. No migration, no server work, but does NOT sync across devices and is lost on cache clear.
   "Persist the pinned state per user" reads as the first option — confirm which you want.

6. **What does "pin" do, exactly?** Is the pin meant to (a) make the debrief area sticky/always-visible while scrolling, (b) move it to the top of the cards grid, or (c) keep it expanded vs collapsed? This changes both the UI control and what value we persist.
