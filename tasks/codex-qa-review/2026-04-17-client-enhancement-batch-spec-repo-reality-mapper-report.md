# Repo Reality Map: Client Enhancement Batch Spec

## Inspection Inventory

### Inspected
- Project guidance: `CLAUDE.md` says Next.js 16.1, React 19.1, Supabase/RLS, Resend, server actions for mutations, and role helpers in `src/lib/roles.ts` (`CLAUDE.md:7`, `CLAUDE.md:34`, `CLAUDE.md:44`, `CLAUDE.md:95-118`).
- Supabase guidance: project-local `.claude/rules/supabase.md` does not exist; workspace rule exists at `../.claude/rules/supabase.md`, including server-action auth re-verification and audit guidance (`../.claude/rules/supabase.md:33-38`, `../.claude/rules/supabase.md:78-87`).
- Spec: `docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md` through the full six-wave plan.
- Requested action/helper files plus targeted support files: `src/actions/events.ts`, `src/actions/planning.ts`, `src/actions/debriefs.ts`, `src/actions/users.ts`, `src/lib/roles.ts`, `middleware.ts`, `src/lib/auth.ts`, `src/lib/auth/session.ts`, `src/lib/planning/*`, `src/lib/notifications.ts`, `src/lib/audit-log.ts`.
- Migrations: scanned filenames, read the latest five, and read relevant migrations for `planning_tasks`, `events`, `debriefs`, `audit_log`, SOP, and Storage.

### Not inspected (with reason)
- Full repo line-by-line: not inspected because the instruction was to read the named files first and avoid whole-repo review.
- UI components were only touched by targeted grep where needed for exact surface confirmation, not reviewed for behaviour.
- Live Supabase database: not queried; conclusions are migration/code based.

### Limited visibility conclusions
- Current DB state is inferred from migration order, not `pg_policies` / `pg_constraint` introspection.
- SOP taxonomy in production may include UI-created sections not represented in migrations; migration evidence shows the seeded defaults only.
- No implementation, tests, or local app run were performed.

## 1. Server action canonical pattern

Canonical create path in `src/actions/events.ts`: `saveEventDraftAction(_: ActionResult | undefined, formData: FormData): Promise<ActionResult>` (`src/actions/events.ts:591`). It uses the Next form-action convention of an ignored previous state `_` plus `FormData`; other event actions follow the same pattern, e.g. `submitEventForReviewAction(_: ActionResult | undefined, formData: FormData): Promise<ActionResult>` (`src/actions/events.ts:963-966`) and `reviewerDecisionAction(_: ActionResult | undefined, formData: FormData): Promise<ActionResult>` (`src/actions/events.ts:1338-1341`).

Flow for a new draft:
- Auth check: `getCurrentUser()`, redirect to `/login` if absent (`src/actions/events.ts:591-595`).
- Permission check: `canManageEvents(user.role, user.venueId)` (`src/actions/events.ts:596-598`).
- Venue scoping: office workers are forced to their own `venueId` and mismatches are rejected (`src/actions/events.ts:602-615`).
- Validation: reads `FormData`, parses with `eventDraftSchema.safeParse(...)`, returns field errors via `getFieldErrors` (`src/actions/events.ts:617-670`).
- DB mutation: no `eventId` means create; calls `createEventDraft({...})` (`src/actions/events.ts:846-877`). That helper inserts an `events` row with `status: "draft"` (`src/lib/events.ts:420-467`).
- Linked planning/SOP side effect: creates event planning item and SOP checklist via `createEventPlanningItem(...)` (`src/actions/events.ts:878-886`; helper inserts planning item then calls `generateSopChecklist`, `src/lib/events.ts:543-570`).
- Audit: `createEventDraft` records `event.created` (`src/lib/events.ts:524-534`); the action also records `event.draft_saved` (`src/actions/events.ts:942-948`).
- Revalidation/redirect: revalidates event detail and list, then redirects to the new event (`src/actions/events.ts:949-958`).

Current audit helper signature is `recordAuditLogEntry(params: { entity; entityId; action; meta?; actorId? }): Promise<void>`; there is no `operation_status` parameter in this helper (`src/lib/audit-log.ts:7-13`, `src/lib/audit-log.ts:32-41`).

## 2. Audit log current state

Latest migration that changes `audit_log` constraints is `20260416000000_user_deactivation.sql`; a later migration only comments that `audit_log.actor_id` is not touched (`supabase/migrations/20260416000000_user_deactivation.sql:71-113`, `supabase/migrations/20260416210000_manager_responsible_fk.sql:89`).

Allowed `entity` values in that latest CHECK:
`event`, `sop_template`, `planning_task`, `auth`, `customer`, `booking`, `user` (`supabase/migrations/20260416000000_user_deactivation.sql:77-83`).

Allowed `action` values:
`event.created`, `event.updated`, `event.artists_updated`, `event.submitted`, `event.approved`, `event.needs_revisions`, `event.rejected`, `event.completed`, `event.assignee_changed`, `event.deleted`, `event.status_changed`, `event.website_copy_generated`, `event.debrief_updated`, `event.terms_generated`, `sop_section.created`, `sop_section.updated`, `sop_section.deleted`, `sop_task_template.created`, `sop_task_template.updated`, `sop_task_template.deleted`, `sop_dependency.created`, `sop_dependency.deleted`, `sop_checklist.generated`, `sop_checklist.dates_recalculated`, `sop_backfill_completed`, `planning_task.status_changed`, `planning_task.reassigned`, `auth.login.success`, `auth.login.failure`, `auth.login.service_error`, `auth.lockout`, `auth.logout`, `auth.password_reset.requested`, `auth.password_updated`, `auth.invite.sent`, `auth.invite.accepted`, `auth.invite.resent`, `auth.role.changed`, `auth.session.expired.idle`, `auth.session.expired.absolute`, `customer.erased`, `booking.cancelled`, `user.deactivated`, `user.reactivated`, `user.deleted` (`supabase/migrations/20260416000000_user_deactivation.sql:85-113`).

`logAuditEvent` does not exist in `src/` by grep. Current imports are `recordAuditLogEntry` and `logAuthEvent`. Production `recordAuditLogEntry` imports: `src/lib/events.ts`, `src/actions/venues.ts`, `src/actions/sop.ts`, `src/actions/planning.ts`, `src/actions/users.ts`, `src/actions/opening-hours.ts`, `src/actions/event-types.ts`, `src/actions/artists.ts`, `src/actions/debriefs.ts`, `src/actions/links.ts`, `src/actions/bookings.ts`, `src/actions/events.ts` (`rg` result; examples at `src/actions/events.ts:17`, `src/actions/planning.ts:25`, `src/actions/debriefs.ts:11`). `logAuthEvent` imports: `src/actions/auth.ts`, `src/actions/users.ts`, `src/app/auth/confirm/route.ts` (`src/actions/users.ts:14`).

## 3. RLS pattern (planning_tasks)

Active planning task policies inferred from migrations:

- SELECT: `"planning tasks read by authenticated"` uses `auth.role() = 'authenticated'` (`supabase/migrations/20260225000001_tighten_planning_rls.sql:83-86`).
- INSERT: `"planning tasks write by admin or owner"` with check:
  `public.current_user_role() = 'administrator' OR (public.current_user_role() = 'office_worker' AND created_by = auth.uid())` (`supabase/migrations/20260415180000_rbac_renovation.sql:667-677`).
- UPDATE: `"planning tasks update by admin or owner"` using:
  `public.current_user_role() = 'administrator' OR (public.current_user_role() = 'office_worker' AND created_by = auth.uid())` (`supabase/migrations/20260415180000_rbac_renovation.sql:679-689`).
- UPDATE, additional permissive policy: `"planning_tasks_assignee_update"` using `exists (...)` against `planning_task_assignees.task_id = planning_tasks.id` and `planning_task_assignees.user_id = auth.uid()` (`supabase/migrations/20260408120001_add_planning_task_columns.sql:208-218`).
- DELETE: `"planning tasks delete by admin or owner"` using the same administrator-or-created_by expression (`supabase/migrations/20260415180000_rbac_renovation.sql:691-701`).

Helpers/functions referenced: `public.current_user_role()`, `auth.role()`, `auth.uid()`. Latest `current_user_role()` reads `public.users`, returns `NULL` for deactivated users, then falls back to JWT role/authenticated (`supabase/migrations/20260416000000_user_deactivation.sql:117-146`).

## 4. SOP taxonomy

SOP sections table stores `label`, not `title` (`supabase/migrations/20260408120000_add_sop_tables.sql:24-31`). Seed migration inserts 8 sections (`supabase/migrations/20260408120005_seed_sop_template.sql:22-32`):

`Details of the Event`, `Communication`, `Compliance`, `Systems`, `Purchasing`, `Food Development`, `Operations`, `Training`.

A seeded `Food Development` section exists at sort order 6 (`supabase/migrations/20260408120005_seed_sop_template.sql:29`). Seeded food-section tasks are `Food specs`, `Shopping list`, and `Allergens` (`supabase/migrations/20260408120005_seed_sop_template.sql:166-182`). No existing `Proof-read menus` task was found outside the spec by targeted grep.

## 5. Permissions helpers (src/lib/roles.ts)

Exports and signatures:

`isAdministrator(role: UserRole): boolean` (`src/lib/roles.ts:16`); `canManageEvents(role: UserRole, venueId?: string | null): boolean` (`src/lib/roles.ts:21`); `canViewEvents(role: UserRole): boolean` (`src/lib/roles.ts:28`); `canReviewEvents(role: UserRole): boolean` (`src/lib/roles.ts:33`); `canManageBookings(role: UserRole, venueId?: string | null): boolean` (`src/lib/roles.ts:38`); `canManageCustomers(role: UserRole, venueId?: string | null): boolean` (`src/lib/roles.ts:45`); `canManageArtists(role: UserRole, venueId?: string | null): boolean` (`src/lib/roles.ts:52`); `canCreateDebriefs(role: UserRole, venueId?: string | null): boolean` (`src/lib/roles.ts:59`); `canEditDebrief(role: UserRole, isCreator: boolean): boolean` (`src/lib/roles.ts:66`); `canViewDebriefs(role: UserRole): boolean` (`src/lib/roles.ts:73`); `canCreatePlanningItems(role: UserRole): boolean` (`src/lib/roles.ts:78`); `canManageOwnPlanningItems(role: UserRole): boolean` (`src/lib/roles.ts:83`); `canManageAllPlanning(role: UserRole): boolean` (`src/lib/roles.ts:88`); `canViewPlanning(role: UserRole): boolean` (`src/lib/roles.ts:93`); `canManageVenues(role: UserRole): boolean` (`src/lib/roles.ts:98`); `canManageUsers(role: UserRole): boolean` (`src/lib/roles.ts:103`); `canManageSettings(role: UserRole): boolean` (`src/lib/roles.ts:108`); `canManageLinks(role: UserRole): boolean` (`src/lib/roles.ts:113`); `canViewSopTemplate(role: UserRole): boolean` (`src/lib/roles.ts:118`); `canEditSopTemplate(role: UserRole): boolean` (`src/lib/roles.ts:123`).

Helpers taking `venueId`: `canManageEvents`, `canManageBookings`, `canManageCustomers`, `canManageArtists`, `canCreateDebriefs`. There is no exported `canEditPlanningTask`; planning task actions use bespoke ownership/assignee checks (`src/actions/planning.ts:415-470`).

## 6. events.status transitions

Current status enum/check is `draft`, `submitted`, `needs_revisions`, `approved`, `rejected`, `completed` (`supabase/migrations/20250218000000_initial_mvp.sql:52-53`). Current NOT NULL fields include `event_type`, `start_at`, `end_at`, `venue_space` (`supabase/migrations/20250218000000_initial_mvp.sql:52-56`).

Code paths that set or update event status:
- Initial draft insert: `createEventDraft` inserts `status: "draft"` (`src/lib/events.ts:420-426`).
- Admin auto-approval: `autoApproveEvent` updates `status: "approved"` (`src/actions/events.ts:524-529`).
- Submit for review: `submitEventForReviewAction` updates `status: "submitted"` and `submitted_at`/`assignee_id` (`src/actions/events.ts:1281-1288`).
- Reviewer decision: `reviewerDecisionAction` parses `approved | needs_revisions | rejected` and updates `status: newStatus` (`src/actions/events.ts:1360-1371`, `src/actions/events.ts:1416-1426`).
- Debrief submit: `submitDebriefAction` updates event status to `completed`, first through admin client and then fallback user client (`src/actions/debriefs.ts:131-154`).
- Revert: `revertToDraftAction` updates `status: "draft"` and clears assignee (`src/actions/events.ts:1893-1896`).
- Import migration inserts imported events as `draft` (`supabase/migrations/20260206120000_import_baronspubs_2026_events.sql:132-155`).

DB triggers/RPCs found: `trg_events_updated` only calls `set_updated_at()` (`supabase/migrations/20250218000000_initial_mvp.sql:138-139`). Booking RPCs read/check event status but do not update it (`supabase/migrations/20260414130001_harden_create_booking_rpc.sql:26-40`; `supabase/migrations/20260417000000_sms_campaign.sql:151-160`).

## 7. Storage

No `@supabase/storage-js` import was found in `src/`. Storage is accessed through Supabase client `.storage` in event image upload/removal (`src/actions/events.ts:46`, `src/actions/events.ts:470-481`, `src/actions/events.ts:490-494`).

Existing Supabase Storage bucket references do exist in migrations: `event-images` is inserted into `storage.buckets`, public, 10 MB cap, image MIME allow-list (`supabase/migrations/20260210122000_retire_venue_areas_and_event_image_storage.sql:6-18`). Storage object policies refer to `bucket_id = 'event-images'` (`supabase/migrations/20260210122000_retire_venue_areas_and_event_image_storage.sql:29-72`), later tightened so writes are service-role only (`supabase/migrations/20260210223000_restrict_event_image_storage_writes.sql:5-19`). No `task-attachments` bucket or attachments table exists by targeted grep.

## 8. Existing SLT / executive concept

The role model includes `executive` as read-only observer (`CLAUDE.md:105-110`, `src/lib/roles.ts:4-13`). `canViewSopTemplate` allows administrator or executive, but editing is administrator-only (`src/lib/roles.ts:117-124`).

No `SLT`/`slt` concept was found in `src/`. Existing broadcast-like patterns in notifications are administrator-based:
- `listUsersByRole(role)` returns active users filtered by role and `deactivated_at IS NULL` (`src/lib/notifications.ts:251-265`).
- `sendPostEventDigestEmail` sends debrief digest to all administrators (`src/lib/notifications.ts:622-632`) and footer says administrators receive it (`src/lib/notifications.ts:682-692`).
- `sendWeeklyPipelineSummaryEmail` sends to administrators (`src/lib/notifications.ts:707-713`, `src/lib/notifications.ts:787-790`) and footer says administrator (`src/lib/notifications.ts:784`).

## 9. E.164 normalisation

No central reusable phone normalisation helper was found. The canonical current pattern is inline in booking creation:
- Imports `parsePhoneNumber` and `isValidPhoneNumber` from `libphonenumber-js` (`src/actions/bookings.ts:3-4`).
- Validates GB number then formats E.164: `parsePhoneNumber(data.mobile, "GB").format("E.164")` (`src/actions/bookings.ts:65-70`).
- The normalised value is passed to booking RPC and customer upsert (`src/actions/bookings.ts:71-81`, `src/actions/bookings.ts:98-107`).

Separate caller/pattern: Twilio inbound normalises `From` with `parsePhoneNumberFromString(rawFrom, "GB")` and falls back to raw input if parse fails (`src/app/api/webhooks/twilio-inbound/route.ts:3`, `src/app/api/webhooks/twilio-inbound/route.ts:57-60`). Types document customer and booking mobile as E.164 (`src/lib/types.ts:67-73`, `src/lib/types.ts:87-93`).

## 10. Planning task parent relationship

No current `planning_tasks.parent_task_id`, `cascade_venue_id`, or cascade-definition relationship was found. Schema evidence: `planning_tasks` has `planning_item_id`, `title`, `assignee_id`, `due_date`, `status`, `completed_at`, `sort_order`, `created_by`, timestamps in its original table definition (`supabase/migrations/20260223120000_add_planning_workspace.sql:75-87`). Later SOP extension adds SOP metadata, `is_blocked`, `completed_by`, and multi-assignee/dependency support, but not a parent column (`supabase/migrations/20260408120001_add_planning_task_columns.sql:42-76`).

There is an existing task dependency graph table, not a parent-child cascade column: `planning_task_dependencies(task_id, depends_on_task_id)` with both columns referencing `planning_tasks(id)` and a no-self-reference check (`supabase/migrations/20260408120001_add_planning_task_columns.sql:144-163`). Code exposes this as `dependsOnTaskIds` (`src/lib/planning/types.ts:23-40`, `src/lib/planning/index.ts:501-518`).

## Risk areas for the spec

- Audit naming/shape alignment: workspace/spec use `logAuditEvent` and `operation_status`; repo code uses `recordAuditLogEntry` without `operation_status` (`../.claude/rules/supabase.md:85-95`, `src/lib/audit-log.ts:7-13`).
- Audit CHECK alignment: latest DB constraint allows fewer entities/actions than some current code/spec names, e.g. helper type includes `artist`, `event_type`, `link`, `opening_hours`, `planning`, `venue` (`src/lib/audit-log.ts:7-8`), while latest migration does not (`supabase/migrations/20260416000000_user_deactivation.sql:77-113`).
- Event status/form assumptions: `pending_approval` is not in the current CHECK and `event_type`, `end_at`, `venue_space` are currently NOT NULL (`supabase/migrations/20250218000000_initial_mvp.sql:52-56`).
- SLT email overlaps an existing administrator digest; current debrief action awaits `sendPostEventDigestEmail` and that helper targets administrators (`src/actions/debriefs.ts:195`, `src/lib/notifications.ts:630-632`).
- SOP food section already exists in seed data; `Proof-read menus` does not (`supabase/migrations/20260408120005_seed_sop_template.sql:22-32`, `supabase/migrations/20260408120005_seed_sop_template.sql:166-182`).
- Attachments will be a second Storage model alongside existing public `event-images` bucket and service-role write policies (`supabase/migrations/20260210122000_retire_venue_areas_and_event_image_storage.sql:6-18`, `supabase/migrations/20260210223000_restrict_event_image_storage_writes.sql:5-19`).
- Cascade parent columns would coexist with the existing dependency graph table, not replace it (`supabase/migrations/20260408120001_add_planning_task_columns.sql:144-163`).
- Phone normalisation is duplicated inline rather than centralised (`src/actions/bookings.ts:65-70`, `src/app/api/webhooks/twilio-inbound/route.ts:57-60`).