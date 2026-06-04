# Discovery 03 — Event / Planning Data Model, Calendar Duplication & Planning Status Actions

READ-ONLY investigation. No code changed. Supabase ref `shofawaztmdxytukhozo`.

---

## 1. The `events` ↔ `planning_items` relationship

### Schema (live DB)
- `planning_items.event_id uuid NULL` → FK `references events(id) ON DELETE CASCADE`
  (migration `supabase/migrations/20260408120002_add_event_planning_link.sql`).
- **Unique partial index** `idx_planning_items_event_id ON planning_items(event_id) WHERE event_id IS NOT NULL`
  → enforces **at most ONE planning_item per event** ("one planning item per event").
- A linked planning_item is also linked to venues via `planning_item_venues` (join table) and may carry SOP checklist tasks (`planning_tasks`).
- `planning_items` may instead belong to a recurring `planning_series` (via `series_id` + `occurrence_on`); those are standalone (no event).

### Auto-creation flow (every event spawns one planning_item)
`src/lib/events.ts`:
- `createEventPlanningItem(eventId, …)` (line 634): inserts a `planning_items` row with
  `event_id = eventId`, `type_label = "Event"`, `status = "planned"`, `target_date = start_at[:10]`,
  then `syncPlanningItemVenues(...)` and `generateSopChecklist(...)`.
- `ensureEventPlanningItem(eventId, …)` (line 674): idempotent guard — creates one only if none exists.

Callers:
- `src/actions/events.ts:1224` and `:1548` — `createEventPlanningItem` on event-draft creation paths.
- `src/actions/events.ts:966` — `ensureEventPlanningItem` on save.
- `src/actions/sop.ts:676` — `createEventPlanningItem` on SOP propose path.

So: **create an event → get exactly one linked planning_item (type_label "Event") carrying the SOP checklist.**

### Live data counts (at time of discovery)
| Metric | Count |
|---|---|
| Total `planning_items` | 241 |
| `planning_items` with `event_id` (linked) | **95** |
| `planning_items` standalone (`event_id IS NULL`) | **146** |
| Distinct events referenced by linked items | 95 (1:1, unique index holds) |
| Total `events` | 121 |
| Linked items with `type_label='Event'` | 95 (100%) |
| Linked items with other type_label | 0 |
| **Events currently appearing TWICE on the open board** | **33** |

(26 events have no linked planning_item — pre-link legacy events, or proposal/rejected paths that skipped creation.)

### Text diagram
```
                 events (121 rows)
                   │ id
                   │  (1) ──────────────────────────────┐
                   │                                     │ event_id  (unique where not null)
                   ▼                                     ▼
   events.status (8-value vocab)             planning_items (241 rows)
   draft/submitted/needs_revisions/...         ├─ 95 linked (event_id set, type_label "Event")
                                               │     status (5-value vocab) planned/in_progress/...
                                               │     └─ planning_tasks (SOP checklist)  ← SOP agent hangs off here
                                               │     └─ planning_item_venues (venues)
                                               └─ 146 standalone (event_id NULL)
                                                     ├─ series-driven (series_id + occurrence_on)
                                                     └─ ad-hoc one-offs
```
**SOP coordination note:** the SOP "mark incomplete items N/A when date passed (except debrief)" logic operates on `planning_tasks` belonging to a `planning_item`. For event-linked work, those tasks live on the linked planning_item (`planning_items.event_id = events.id`), NOT on the `events` row. The "date passed" reference is `planning_items.target_date` (mirrors `events.start_at[:10]`).

---

## 2. Calendar duplication — root cause (file:line + data flow)

### Data flow
1. `src/app/planning/page.tsx:25-42` calls `listPlanningBoardData(...)` **twice** (board scope + unbounded calendar scope) → passes both into `<PlanningBoard data calendarData …>`.
2. `src/lib/planning/index.ts` → `listPlanningBoardData` (line 496):
   - Query A (line 524): `from("planning_items")` → returns ALL planning items in window (linked + standalone). **No filter excluding `event_id IS NOT NULL`.**
   - Query B (line 604): `from("events")` → returns ALL non-deleted events in window. **No filter excluding events that already have a linked planning_item.**
   - Returns `{ planningItems: PlanningItem[], events: PlanningEventOverlay[] }` as two parallel arrays (`PlanningBoardData`, `src/lib/planning/types.ts:115-122`).
3. `src/components/planning/planning-board.tsx`:
   - `combinedEntries` (line 407) and `calendarCombinedEntries` (line 455) map **both** arrays into `PlanningViewEntry[]`:
     - every planning item → `{ source: "planning", id: "planning-<itemId>" }` (line 410 / 462)
     - every event → `{ source: "event", id: "event-<eventId>" }` (line 420 / 481)
   - The two lists are concatenated with **no dedup on `event_id`**.
4. `src/components/planning/planning-calendar-view.tsx:78-89` buckets entries by `targetDate` and renders each — planning entries as navy left-border buttons (line 150-171), event entries as mustard left-border links to `/events/<id>` (line 186-195).

### Root cause (one sentence)
For each of the 95 events that have a linked planning_item, the board emits **two** calendar entries — one `source:"event"` (the `events` overlay) and one `source:"planning"` (the linked `planning_items` row, `type_label="Event"`, same `target_date`) — because neither query filters out the linked counterpart and the merge step does no dedup. **33 such pairs are live on the open board right now.** The same double-render affects the **list view** and **30/60/90 bucket board view** (`eventsByBucket` line 338 + `planningByBucket`), not just the calendar.

### Where each appears
- Event entry: `planning-calendar-view.tsx:186-195` (calendar) + `EventOverlayCard` `planning-item-card.tsx:863` (board/list, rendered at `planning-board.tsx:768`).
- Planning entry (the duplicate): `planning-calendar-view.tsx:150-171` (calendar) + `PlanningItemCard` `planning-item-card.tsx:107` (board/list).

---

## 3. "One item per event" — structural meaning (SCOPE TO CONFIRM)

The DB already enforces one planning_item per event (unique index). The duplication is purely a **read/merge** problem, not a schema problem. Three candidate interpretations (see Questions):
- **(A) Hide the redundant event overlay** in planning views when a linked planning_item exists, and render the single planning_item entry (which already carries SOP tasks + status). Standalone planning items (146) and the 26 unlinked events keep rendering as-is. *Lowest risk; no schema/data change.*
- **(B) Hide the linked planning_item** and keep only the event overlay (but then SOP checklist + planning status would need to surface on the event card, which today it does not — `EventOverlayCard` has no task list or status dropdown).
- **(C) Schema/data merge** (collapse the two rows into one). Not required by the data model and would be destructive — out of scope unless explicitly requested.

Standalone planning items (146, `event_id IS NULL`) are a distinct, legitimate concept (series occurrences + ad-hoc tasks) and almost certainly must be **retained** — confirm.

---

## 4. `/planning` — can an EVENT's status be changed there today?

**No — not in the way planning items can.** On the planning board, events render via `EventOverlayCard` (`src/components/planning/planning-item-card.tsx:863-959`), which exposes only:
- `draft` events: "Archive draft" (`archiveDraftEventAction`) + "Continue draft" link to `/events/<id>`.
- `submitted`/`needs_revisions` events (if `canApprove`): `<ApproveEventButton>` → `reviewerDecisionAction` (decision = "approved").
- All others: "Manage" link to `/events/<id>`.

There is **no free-form event status dropdown** on /planning. `grep` for `updateEventStatus`/`setEventStatus`/`markEventComplete` returns nothing — events have no generic status-setter action at all. Event status only moves through the **review workflow** (`submitEventForReviewAction`, `reviewerDecisionAction` in `src/actions/events.ts:1312/1817`, statuses gated: only `submitted`→`approved|needs_revisions|rejected`, etc.) plus lifecycle actions (`archiveDraftEventAction`, `revertToDraftAction`, `deleteEventAction`).

### Current planning-ITEM status-change mechanism (the behaviour event-status must "match")
Defined in `src/components/planning/planning-item-card.tsx`:
- **Statuses** (`STATUS_OPTIONS`, line 43): `planned`, `in_progress`, `blocked`, `done`, `cancelled`.
- **Compact card control** (line 391-442): a pill button → popup `role="listbox"` of the 5 statuses → `handleCompactStatusChange` (line 134) → `updatePlanningItemAction({ itemId, status })` → toast + `onChanged()`.
- **Full card control** (line 541-567): pencil → `<Select>` of the 5 statuses → `saveField("status")` (line 239) → same action.
- Server: `updatePlanningItemAction` (`src/actions/planning.ts:212`) validates with `planningStatusSchema`, permission-checks via `ensureCanManagePlanningItem`, calls `updatePlanningItem`, writes audit log (`planning.item_updated`), `revalidatePath("/planning")`.
- The calendar itself supports **drag-to-move date** for planning entries only (`onMovePlanningItem` → `movePlanningItemDateAction`), not status.

So "matching" = give the event entry an equivalent inline status dropdown that writes through a server action with permission check + audit + revalidate.

---

## 5. Status vocabulary mismatch (complicates "matching")

| `events.status` (CHECK, 8 values) | `planning_items.status` (CHECK, 5 values) |
|---|---|
| `pending_approval` | `planned` |
| `approved_pending_details` | `in_progress` |
| `draft` | `blocked` |
| `submitted` | `done` |
| `needs_revisions` | `cancelled` |
| `approved` | |
| `rejected` | |
| `completed` | |

**Zero overlap.** Live distribution: events → approved 28, completed 45, draft 22, rejected 24, approved_pending_details 2. planning_items → planned 140, done 100, cancelled 1.

Implications for "make event status changes match planning behaviour":
- The 5 planning statuses are **operational** (work progress). The 8 event statuses are a **review/approval lifecycle** with server-side guards (`events_status_check`, `events_required_fields_after_proposal`, and transition gates in `reviewerDecisionAction` that only allow specific moves and trigger emails/audit/SOP side-effects).
- You **cannot** simply reuse the planning dropdown for events — applying `planned`/`in_progress`/`done` to an event would violate `events_status_check` and bypass the approval workflow (emails, reviewer audit, web-copy gating, planning-item creation on approval).
- "Match the behaviour" most plausibly means **match the UX pattern** (inline dropdown on the planning card → server action → toast/audit/revalidate), exposing the **legally allowed event transitions** (a constrained subset, e.g. mark `completed`, or surface approve/reject inline) — NOT importing the planning status set. This must be confirmed.

---

## QUESTIONS FOR HUMAN

1. **"One item per event" — exact intent?** Pick one:
   (a) Keep the single linked planning_item entry on /planning and **hide the duplicate event overlay** when a linked planning_item exists (recommended — read-only fix, no data change, planning_item already carries SOP tasks + status); or
   (b) **Hide the linked planning_item** and keep only the event overlay (requires moving SOP checklist + status controls onto the event card, which don't exist there today); or
   (c) something else (e.g. merge into a single combined card)? This decides almost everything downstream.

2. **Retain standalone planning items?** There are 146 planning items with no event (recurring-series occurrences + ad-hoc tasks). Confirm these remain their own calendar items and are out of scope for the de-dup (we believe yes).

3. **Event status from /planning — which statuses, given the vocab gap?** Event statuses (draft/submitted/approved/rejected/completed…) and planning statuses (planned/in_progress/done…) **do not overlap at all**, and event status moves run a guarded approval workflow (emails, audit, web-copy gating, auto-creation of the planning_item on approval). When you say "make event status changes match the planning item status change behaviour," do you mean:
   (a) match the **UX pattern only** (an inline dropdown on the card → instant save → toast), exposing the **valid event lifecycle transitions** (subset, respecting the approval rules); or
   (b) literally let events take the **planning statuses** (planned/in_progress/blocked/done/cancelled)? Option (b) conflicts with the `events_status_check` constraint and the review workflow, so we need explicit direction.

4. **Which event transitions should be inline-settable from /planning, and for which roles?** Today only Approve (reviewers) and Archive/Continue (drafts) are inline. Should office_workers be able to move event status from /planning, or only reviewers/administrators? (Planning-item edits are gated by `ensureCanManagePlanningItem`; event review is gated to reviewers.)

5. **Scope of de-dup — calendar only, or all /planning views?** The double-render also affects the 30/60/90 **bucket board** and **list view** (`eventsByBucket` + `planningByBucket`), not just the calendar. Confirm the fix should apply across all three (recommended for consistency).
