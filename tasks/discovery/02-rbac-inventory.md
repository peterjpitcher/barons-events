# 02 — RBAC / Access Control Inventory (READ-ONLY DISCOVERY)

**Scope:** Complete map of the current permission model and every touchpoint, to support a
*later* implementation effort. NOT an implementation plan. Project: BaronsHub
(Supabase ref `shofawaztmdxytukhozo`). Roles today: `administrator`, `office_worker`, `executive`.

**Client intended end-state (verbatim):**
- Remove the executive role.
- Convert existing executives to `office_worker` with no assigned venue.
- Keep only `administrator` and `office_worker`.
- Everyone can view events and planning.
- Only administrators can create events.
- Only administrators can make any changes to events.
- Operations and manage controls should be administrator-edit-only.

---

## 1. Capability functions — `src/lib/roles.ts` (the single source of capability logic)

Every exported function. `UserRole = "administrator" | "office_worker" | "executive"` (`src/lib/types.ts:3-6`).
The file header (lines 3-13) describes the venueId capability switch:
*office_worker + venueId = venue-scoped write; office_worker + no venueId = global read + event proposals, planning writes blocked.*

| Line | Function (signature) | Gates / returns | Current role logic | Touches `executive`? |
|---|---|---|---|---|
| 16 | `isAdministrator(role)` | is-admin convenience | `role === "administrator"` | no |
| 21 | `canProposeEvents(role)` | propose/submit an event | `admin OR office_worker` | no (excludes exec) |
| 36 | `canEditEvent(role, userId, userVenueId, event: EventEditContext)` | edit a specific event | admin always; office_worker if (creator AND draft/needs_revisions) OR (venue-linked AND manager_responsible AND approved/cancelled); deleted events → admin only | no (office_worker only) |
| 79 | `canSubmitDebriefForEvent(role, userId, userVenueId, event)` | submit/edit debrief | admin always; else `canCreateDebriefs` + venue-link + (manager_responsible OR creator-when-no-manager); event must be approved/completed | no |
| 104 | `canViewEvents(role)` | view events | **`return true`** (all roles) | no |
| 109 | `canReviewEvents(role)` | approve/reject/request-changes | `role === "administrator"` | no |
| 114 | `canManageBookings(role, venueId?)` | write bookings | admin; OR office_worker **with** venueId | no |
| 121 | `canManageCustomers(role, venueId?)` | write customers | admin; OR office_worker **with** venueId | no |
| 128 | `canManageArtists(role, venueId?)` | write artists | admin; OR office_worker **with** venueId | no |
| 135 | `canCreateDebriefs(role, venueId?)` | create debriefs | admin; OR office_worker **with** venueId | no |
| 142 | `canEditDebrief(role, isCreator)` | edit a debrief | admin; OR office_worker if isCreator | no |
| 149 | `canViewDebriefs(role)` | view debriefs | **`return true`** | no |
| 154 | `canViewBookings(role)` | view bookings list | `admin OR office_worker` (comment: "not executive") | no (excludes exec) |
| 159 | `canViewCustomers(role)` | view customers list | `admin OR office_worker` | no (excludes exec) |
| 164 | `canViewArtists(role)` | view artists directory | `admin OR office_worker` | no (excludes exec) |
| 169 | `canViewReviews(role)` | view review pipeline (RO) | `admin OR office_worker` | no (excludes exec) |
| 174 | `canCreatePlanningItems(role, venueId?)` | create planning items | `admin OR (office_worker AND venueId)` | no |
| 179 | `canManageOwnPlanningItems(role)` | edit/delete own planning | `admin OR office_worker` | no |
| 184 | `canManageAllPlanning(role)` | manage any planning item | `role === "administrator"` | no |
| 189 | `canViewPlanning(role)` | view planning workspace | **`return true`** | no |
| 194 | `canManageVenues(role)` | manage venues | `role === "administrator"` | no |
| 199 | `canManageUsers(role)` | invite/update users | `role === "administrator"` | no |
| 204 | `canManageSettings(role)` | event types + settings | `role === "administrator"` | no |
| 209 | `canManageLinks(role)` | short links / QR codes | `role === "administrator"` | no |
| 214 | `canViewSopTemplate(role)` | view SOP template config | **`admin OR executive`** | **YES (only fn referencing executive)** |
| 219 | `canEditSopTemplate(role)` | edit SOP template | `role === "administrator"` | no |

Note: `EventEditContext` (type, line 26) and `EventDebriefContext` (line 69) carry `venueId/venueIds/managerResponsibleId/createdBy/status/deletedAt`.

**Capability-function observations relevant to the end-state:**
- `canViewEvents`, `canViewDebriefs`, `canViewPlanning` already return `true` for everyone → "everyone can view" already satisfied at the helper level.
- **`canProposeEvents` allows office_worker** → conflicts with "only admins can create events." Used as the create-gate for `/events/new`, `/events/propose`, and the draft/submit actions (see §4a).
- **`canEditEvent` has office_worker write paths** → conflicts with "only admins can change events."
- `canViewSopTemplate` is the **only** capability function literally referencing `executive`.

---

## 2. Every `executive` touchpoint (file:line) — removal map

**Live application code (non-test):**
| File:line | Reference |
|---|---|
| `src/lib/types.ts:6` | `UserRole` union member `"executive"` |
| `src/lib/roles.ts:8` | header comment "executive — read-only observer" |
| `src/lib/roles.ts:153,158,163,168` | comments "(...; not executive)" |
| `src/lib/roles.ts:215` | `canViewSopTemplate` returns `admin OR executive` |
| `src/lib/auth.ts:24` | `normalizeRole()` `case "executive":` (accepts the role) |
| `src/lib/events.ts:160` | review-queue read role check includes `executive` |
| `src/lib/events.ts:202` | `listEventsForUser` un-limited read includes `executive` |
| `src/lib/visibility.ts:39` | `canViewVenueLinkedResource`: admin OR executive → full visibility |
| `src/lib/dashboard.ts:146-147` | "Debriefs needed (not for executives)" `if (user.role !== "executive")` |
| `src/lib/dashboard.ts:818` | comment "for executives/admins" |
| `src/lib/users.ts:149` | `ASSIGNABLE_ROLES` includes `"executive"` |
| `src/lib/users.ts:174,184` | reassignment target query `.neq("role", "executive")` (+ comment) |
| `src/lib/supabase/database.types.ts:2760,2897` | generated enum `user_role` lists legacy `"executive"` (alongside legacy `venue_manager/reviewer/central_planner`) |
| `src/actions/auth.ts:30` | `APP_ROLES = new Set([... "executive"])` |
| `src/actions/users.ts:21,120` | two `z.enum([... "executive"])` (invite + update role schemas) |
| `src/actions/users.ts:361,376,488,584` | reassignment-eligibility excludes `executive` (comment + `.neq` + two guards) |
| `src/app/page.tsx:44` | dashboard copy map `executive: { heading: "Executive Snapshot", ... }` |
| `src/app/page.tsx:238` | `else if (user.role === "executive")` dashboard data branch (`getExecutiveSummaryStats`) |
| `src/app/page.tsx:317` | `{user.role === "executive" && ( ... SummaryStatsCard ... )}` render branch |
| `src/components/shell/app-shell.tsx:37,41,46,48` | NAV_SECTIONS `roles: [..., "executive"]` (Dashboard, Events, Planning, Debriefs) |
| `src/components/shell/app-shell.tsx:74` | `roleDisplayNames.executive = "Executive"` |
| `src/components/shell/app-topbar.tsx:54` | `executive: "Executive"` display label |
| `src/components/users/users-manager.tsx:31` | `executive: "Executive"` role label (role picker UI) |

**Tests referencing `executive` (will need updating/removal):**
`src/actions/__tests__/attachments-edit-rbac.test.ts` (101-102); `events-edit-rbac.test.ts` (246-247,367-368,509-510,591-592,626-627); `events-operation-id.test.ts` (82,102,122,146,166); `pre-event.test.ts` (65-66); `revert-to-draft.test.ts` (72-73); `users-session-revocation.test.ts` (111); `src/lib/__tests__/events-list.test.ts` (39,42,168,186); `inspiration-actions.test.ts` (91,121,144); `visibility.test.ts` (34,38,55,57); `src/lib/auth/__tests__/debrief-role-helper.test.ts` (46-47); `invite.test.ts` (300,305); `rbac.test.ts` (265,423,431,689,691,755,761,785-786,852,859,866,873,880,888,896-897,904,913-914,923-924,933-934,943-944,952,958,964,971,980,986); `supabase/migrations/__tests__/office_worker_event_scope.test.ts` (many: uses `SUPABASE_EXECUTIVE_JWT` for read-deny assertions on payments etc.).

**SQL / migrations referencing `executive` (historical + live policies):**
| File:line | Note |
|---|---|
| `supabase/seed.sql:80,113,115` | seeds an `executive@barons.example` user with `role='executive'` |
| `supabase/migrations/20250218000000_initial_mvp.sql:37` | original CHECK had legacy `'executive'` (with venue_manager/reviewer/central_planner) |
| `20260225000003_schema_integrity.sql:77` | `current_user_role() = 'executive'` |
| `20260408120000_add_sop_tables.sql:42-45,92-95,143-146` | SOP read policies `in ('central_planner','executive')` (later superseded) |
| `20260410120003_venue_manager_event_visibility.sql:14-15` | event visibility includes `executive` |
| `20260415180000_rbac_renovation.sql:4-5,87,158,740-744,767-771,794-798` | the 4-role→3-role migration; CHECK constraint `IN ('administrator','office_worker','executive')`; SOP policies recreated as `IN ('administrator','executive')` |
| `20260417310000_add_attachments.sql:6,56` | attachments SELECT short-circuits `in ('administrator','executive')` |
| `20260420170000_office_worker_event_scope.sql:14,121` | `IN ('administrator','executive','office_worker')` |
| `20260420180000_fix_public_api_events_access.sql:37` | comment only |
| `20260504203000_scope_office_worker_visibility.sql:31,67,204` | visibility fns short-circuit `IN ('administrator','executive')` |
| `20260507140500_fix_join_table_rls_recursion.sql:18,32` | join-table read `in ('administrator','executive')` |
| `20260525160000_rbac_hardening.sql:255` | comment "executives may not" |

> NOTE: `database.types.ts` (generated) still lists the *legacy 4-role enum*
> (`venue_manager/reviewer/central_planner/executive`) for a DB enum named `user_role`.
> The live `public.users.role` column is **text + CHECK**, not this enum (see §6/§7).
> The legacy enum type may be unused/orphaned — flagged as a question.

---

## 3. Live DB role helper functions (security definer; drive RLS)

From `pg_proc` (live DB):
- `current_user_role()` → `users.role` for `auth.uid()` (deactivated → null).
- `current_user_venue_id()` → `users.venue_id` for `auth.uid()`.
- `event_visible_to_current_user(event_id, primary_venue_id)`: **`administrator` OR `executive` ⇒ true**; `office_worker` with NULL venue ⇒ true; office_worker with venue ⇒ primary or linked-venue match; other ⇒ false.
- `planning_item_visible_to_current_user(item_id, primary_venue_id)`: same shape as above (admin/exec ⇒ true; office_worker NULL venue ⇒ true; else venue match).
- `planning_item_writable_to_current_user(item_id, primary_venue_id)`: **`administrator` ⇒ true**; office_worker **with** venue ⇒ venue match; else false (exec ⇒ false).

**Implication for the conversion:** Converting `executive` → `office_worker` with `venue_id = NULL`
**preserves global read** in `event_visible_*` / `planning_item_visible_*` (office_worker + NULL venue already returns true) and **already denies writes** in `planning_item_writable_*`. The `IN ('administrator','executive')` short-circuits become redundant once no executives exist, but must still be removed from the helper bodies for the role to be fully retired.

---

## 4. Where create / edit / operations / manage are gated TODAY

### 4a. CREATE event
| Layer | Location | Gate |
|---|---|---|
| Page (proposal) | `src/app/events/propose/page.tsx:18` | `canProposeEvents(role)` → redirect /unauthorized |
| Page (new/full) | `src/app/events/new/page.tsx:38` | `canProposeEvents(role)` |
| Server action (draft) | `src/actions/events.ts:788` `saveEventDraftAction` | `canProposeEvents` then `canEditEvent` |
| Server action (submit) | `src/actions/events.ts:1327` `submitEventForReviewAction` | `canProposeEvents` then `canEditEvent` |
| Server action (pre-event copy) | `src/actions/events.ts:2044,2161` | `canProposeEvents` |
| Server action (pre-event) | `src/actions/pre-event.ts:88` | `canProposeEvents` |
| RLS INSERT | `events` policy "office workers insert scoped events" | admin OR (office_worker AND created_by=uid AND venue match) |
| Nav entry | `app-shell.tsx:115,220,239,243`; `mobile-nav.tsx:127-129` | `canProposeEvents` (admin OR office_worker) shows "Propose an event" |
| Dashboard CTA | `components/dashboard/context-cards/upcoming-events-card.tsx:45` | Link to `/events/new` (no inline gate; page gates) |

→ **Conflict:** office_worker can currently create. End-state = admin-only.

### 4b. EDIT / CHANGE event
| Layer | Location | Gate |
|---|---|---|
| Page (detail) | `src/app/events/[eventId]/page.tsx:89,90,122` | `canEditEventFromRow` → canEdit/canDelete/canUploadAttachments |
| Helper | `src/lib/events/edit-context.ts:53-57` | wraps `canEditEvent` |
| Server actions (edit) | `events.ts:800,1339,2157,2302(delete),2378(archive),2554(booking settings)` | `canEditEvent` |
| Attachments | `src/lib/attachment-access.ts:97,125` | `canEditEvent` |
| RLS UPDATE | `events` policy "managers update editable events" | admin OR office_worker creator(draft/needs_revisions) OR office_worker manager_responsible(approved/cancelled) |
| RLS ALL | `events` policy "admins manage events" | `current_user_role()='administrator'` |

→ **Conflict:** office_worker has edit paths. End-state = admin-only.

### 4c. STATUS changes (event)
| Action | Location | Gate today |
|---|---|---|
| Submit for review (draft→submitted) | `events.ts:1312 submitEventForReviewAction` | `canProposeEvents`+`canEditEvent` (office_worker reachable) |
| Reviewer decision (approve/reject/needs_revisions) | `events.ts:1817 reviewerDecisionAction` | `canReviewEvents` = **admin only** |
| Revert to draft (approved→draft) | `events.ts:2431 revertToDraftAction` | inline: **admin only** (`canReviewEvents` gate; tests assert office_worker/executive rejected) |
| Revert-to-draft UI gate | `app/events/[eventId]/page.tsx:91 canRevertToDraft` | admin-derived |

### 4d. PLANNING status (distinct from event status)
| Action | Location | Gate |
|---|---|---|
| Update planning item (incl. `status`) | `actions/planning.ts:212 updatePlanningItemAction` | RLS `planning_item_writable_to_current_user` (admin OR office_worker+venue) |
| Toggle planning task status | `actions/planning.ts:985 togglePlanningTaskStatusAction` | RLS planning_tasks write scoped |
| Planning item card status control | `components/planning/planning-item-card.tsx:146,246` | client UI; server/RLS enforce |
| Create planning item | `planning.ts:58,1143,1218`; `app/planning/new/page.tsx:23`; `planning-board.tsx:585,799-813` | `canCreatePlanningItems` (admin OR office_worker+venue) |
| Manage all planning | `planning.ts:585,601`; `planning-board.tsx:825` | `canManageAllPlanning` = admin only |

### 4e. OPERATIONS controls (nav section "Operations")
`app-shell.tsx:51-58`:
| Item | roles (nav visibility) | Write gate (server) |
|---|---|---|
| Bookings `/bookings` | admin, office_worker | `canManageBookings(role, venueId)` — `actions/bookings.ts:495`; page `events/[eventId]/bookings/page.tsx:66` |
| Customers `/customers` | admin, office_worker | `canManageCustomers(role, venueId)` |
| Artists `/artists` | admin, office_worker | `canManageArtists(role, venueId)` — `actions/artists.ts:60,121,179`; pages `artists/page.tsx:24`, `artists/[artistId]/page.tsx:22` |
| Links & QR `/links` | admin only | `canManageLinks` — `actions/links.ts:54`; page `links/page.tsx:14` |

→ **Conflict:** Bookings/Customers/Artists are office_worker-writable today; end-state = admin-edit-only.

### 4f. MANAGE controls (nav section "Manage")
`app-shell.tsx:60-67` — Venues/Opening Hours/Users/Settings all `roles: ["administrator"]`.
Server: `canManageVenues/Users/Settings` (admin only), `users.ts` guards via `isAdministrator` (`actions/users.ts:366,387,463,514,553`), `requireAdmin()` (`src/lib/auth.ts:118`). RLS: all `venue_*`, `users`, `event_types`, `business_settings`, `slt_members` policies are admin-only.
→ Already admin-edit-only (matches end-state). Read access for office_worker is limited (e.g. customers SELECT has venue-worker policy).

### 4g. VIEW (read) gating
- Events/Planning/Debriefs nav visible to all three roles (`app-shell.tsx:37-48`).
- `canViewEvents/Planning/Debriefs` return `true`.
- `listEventsForUser` (`events.ts:201-202`): roles outside {admin, office_worker, executive} are limited to 10 — i.e. all three current roles get full reads; the limit is a fallback for unknown roles.
- Read scope enforced by RLS `events_select_policy` + `events_select_office_worker` via `event_visible_to_current_user`.

---

## 5. Middleware — `middleware.ts`

- **No role logic.** Middleware does: public-path allowlist (`PUBLIC_PATH_PREFIXES`: `/login`, `/unauthorized`, `/deactivated`, etc.; lines 14-35), root `/` redirects to `https://baronspubs.com` (115-120), short-link public passthrough (140), security headers/CSP, and **authentication** only — `supabase.auth.getUser()` (215), session-store validation, fail-closed redirects to `/login` on missing/expired/mismatched session.
- `/api/*` excluded from middleware via matcher (comment line 629).
- **Authorization by role happens in pages/actions/RLS, not middleware.** Role gate to `/unauthorized` is done per-page (e.g. `requireAdmin()` in `src/lib/auth.ts:118`, and `canPropose...` redirects). `rbac.test.ts:423` asserts executive → `/unauthorized` for an admin-gated route.

---

## 6. RLS policies referencing role / executive / venue (by table)

Source: live `pg_policies`. `current_user_role()` / `current_user_venue_id()` per §3.
**Policies that literally name `executive`** (must change when retiring the role):
- `event_venues` — `event_venues_read` (SELECT): `IN ('administrator','executive')` OR office_worker venue match.
- `planning_item_venues` — `planning_item_venues_read` (SELECT): same shape.
- `planning_series` — `planning series read scoped` (SELECT): `IN ('administrator','executive')` OR office_worker venue.
- `sop_sections` — `sop sections readable by admins and executives` (SELECT): `IN ('administrator','executive')`.
- `sop_task_templates` — `sop task templates readable by admins and executives` (SELECT): `IN ('administrator','executive')`.
- `sop_task_dependencies` — `sop task dependencies readable by admins and executives` (SELECT): `IN ('administrator','executive')`.
- Plus the helper functions `event_visible_to_current_user` / `planning_item_visible_to_current_user` (SECURITY DEFINER) short-circuit on `executive` (§3).

**Role-referencing policies by table (administrator / office_worker / venue logic):**
| Table | Policies (cmd) | Role logic summary |
|---|---|---|
| `approvals` | admins manage (ALL), admins record decisions (INSERT), approvals visible with event (SELECT) | admin write; SELECT via event visibility |
| `artists` | readable by admins+office_workers (SELECT); writable by admins+venue workers (ALL) | SELECT admin/office_worker; write admin OR office_worker+venue |
| `attachments` | insert/read/update_admin/delete_admin | admin manage; office_worker write tied to event edit rights + venue |
| `audit_log` | actor insert; admin view | admin SELECT |
| `business_settings` | write_admin (UPDATE) | admin |
| `customers` | select_admin; select_venue_worker | admin; office_worker via venue+booking join |
| `debriefs` | admins manage (ALL); visible with event (SELECT); office_worker insert/update_own | admin; office_worker create/edit own where manager/creator |
| `event_artists` | visible with event (SELECT); insert/update/delete by event editors | admin OR office_worker matching event-edit rules |
| `event_bookings` | admin_read/admin_update; venue_worker_read/venue_worker_update | admin; office_worker+venue match |
| `event_creation_batches` | own (ALL) | admin OR created_by |
| `event_types` | managed by admins (ALL) | admin |
| `event_venues` | `event_venues_read` (SELECT) | **admin/executive** OR office_worker venue |
| `event_versions` | follow event access (SELECT); insert by event editors | admin OR creator OR assignee |
| `events` | admins manage (ALL); select_office_worker; select_policy; managers update editable; office workers insert scoped | see §4a/§4b |
| `payment_refunds` / `payment_transactions` | Staff can view (SELECT) | `IN ('administrator','office_worker')` (exec excluded) |
| `pending_cascade_backfill` | admin (ALL) | admin |
| `planning_inspiration_*` | authenticated read/insert; service manage | authenticated |
| `planning_item_venues` | `planning_item_venues_read` (SELECT) | **admin/executive** OR office_worker venue |
| `planning_items` | read/write/update/delete scoped | via writable/visible helper fns |
| `planning_series` | read scoped (**admin/executive** OR office_worker venue); office_worker insert/update scoped; admin write/update/delete | mixed |
| `planning_series_task_templates` | authenticated access; admin write/update/delete; authenticated read | mixed |
| `planning_task_assignees` | read by authenticated (via item visibility); insert/update/delete by admin | admin write |
| `planning_task_dependencies` | read by authenticated (item visibility); insert/update/delete by admin | admin write |
| `planning_tasks` | read/write/update/delete scoped (via planning_items writable) | admin OR office_worker venue |
| `short_links` | Admins can manage (ALL) | admin |
| `slt_members` | read_admin/write_admin | admin |
| `sop_sections` / `sop_task_templates` / `sop_task_dependencies` | readable by admins+**executives** (SELECT); insert/update/delete by admins | **admin/executive** read; admin write |
| `users` | admins manage (ALL) | admin |
| `venues` / `venue_opening_hours` / `venue_opening_overrides` / `venue_opening_override_venues` / `venue_service_types` / `venue_services` | admins manage (ALL) | admin |
| `venue_default_reviewers` | service manage | service_role |

(Service-role-only tables omitted: `ai_content`, `ai_publish_queue`, `cron_alert_logs`, `feedback_templates`, `goals`, `notifications`, `weekly_digest_logs`.)

---

## 7. Current executive user count (live DB)

`SELECT role, count(*), count(venue_id) FROM public.users GROUP BY role`:

| role | user_count | with venue_id |
|---|---|---|
| administrator | 5 | 0 |
| **executive** | **1** | **0** |
| office_worker | 13 | 1 |

→ **1 executive user, no venue.** Converting it to `office_worker` (venue_id NULL) yields a global-read,
no-write office_worker — read access preserved by the visibility helpers (§3). Of 13 office_workers, only 1
has a venue assigned (i.e. 12 are already global-read/no-write).

DB role column: `public.users.role` is **text with CHECK** (`20260415180000_rbac_renovation.sql:87` set it to
`IN ('administrator','office_worker','executive')`). The generated `database.types.ts` enum `user_role`
listing the older 4 roles appears to be a separate/legacy enum type — see question Q5.

---

## 8. Cross-effort interaction conflicts (flag only — do NOT resolve here)

These affect the **functional** work that happens *before* the RBAC change:

1. **Propose vs create vs status-change for office_workers.** Today `canProposeEvents` = admin OR
   office_worker, and the "Propose an event" CTA + `/events/new` + `/events/propose` + draft/submit actions
   are all reachable by office_workers; RLS also lets office_workers INSERT scoped events. The end-state says
   "only administrators can create events" *and* "only administrators can make any changes." But the existing
   proposal flow (and project CLAUDE.md "Event creators can edit own events") assumes office_workers create
   drafts → submit for review → admin triages. **Unresolved:** does "create" include office_worker proposals,
   or only admin publishing? If office_workers keep proposing, `canProposeEvents`, the INSERT RLS, and the
   draft→submitted transition must be carved out as exceptions to "admins-only create/change."

2. **Event status updateable from /planning vs admin-only changes.** Two distinct "status" surfaces exist:
   - *Planning item / planning task status* (`updatePlanningItemAction`, `togglePlanningTaskStatusAction`):
     currently office_worker-writable (venue-scoped) via `planning_item_writable_to_current_user` — NOT admin-only.
   - *Event status* (submit/approve/revert): submit reachable by office_worker; approve/reject/revert already
     admin-only (`canReviewEvents`).
   The functional requirement "event status must be updateable from /planning" may mean office_workers need to
   move planning items (planning status) and/or trigger event submissions — which conflicts with
   "only administrators can make any changes to events." **Unresolved:** which status (planning-item vs event)
   must office_workers change from /planning, and is event-status-from-planning admin-only?

---

## QUESTIONS FOR HUMAN (cross-effort permission conflicts)

1. **Does "only administrators can create events" eliminate office_worker proposals entirely?**
   Today office_workers can propose/submit events (`canProposeEvents`, `/events/propose`, `/events/new`,
   `saveEventDraftAction`, `submitEventForReviewAction`, and RLS `events insert scoped`). If proposals stay,
   they are an explicit exception to "admins-only create" — confirm keep vs remove. If removed, the entire
   proposal UI/flow and INSERT RLS go admin-only.

2. **Can office_workers change event *status* at all (e.g. submit-for-review)?**
   Approve/reject/revert are already admin-only. But draft→submitted is currently office_worker-reachable.
   Under "only administrators can make any changes to events," should office_workers lose the submit
   transition too (making the whole lifecycle admin-driven)?

3. **"Event status must be updateable from /planning" — which status, and by whom?**
   /planning today edits *planning-item/task* status (office_worker venue-scoped), not event status directly.
   Does this requirement refer to planning-item status (keep office_worker-writable) or to *event* status
   (which would conflict with admin-only event changes)? If event status, is that admin-only from /planning?

4. **"Operations/manage administrator-edit-only" — does this revoke office_worker write on Bookings,
   Customers, Artists?** Today office_workers (with a venue) can write these (`canManageBookings/Customers/Artists`
   + venue-scoped RLS). End-state implies admin-edit-only. Confirm office_workers become read-only on
   Operations (Manage is already admin-only). Note 12/13 office_workers have no venue (already read-only there).

5. **Legacy `user_role` enum in `database.types.ts` (venue_manager/reviewer/central_planner/executive).**
   The live `users.role` is text+CHECK, not this enum. Is the `user_role` Postgres enum type orphaned/unused,
   or is it referenced elsewhere? (Affects whether the executive removal also needs an enum migration.)
