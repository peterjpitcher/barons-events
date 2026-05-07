# Review Pack: event-creation-spec

**Generated:** 2026-05-07
**Mode:** A (A=Adversarial / B=Code / C=Spec Compliance)
**Project root:** `/Users/peterpitcher/Cursor/BARONS-BaronsHub/.claude/worktrees/eager-borg-52d3f5`
**Base ref:** `HEAD`
**HEAD:** `0731f5e`
**Diff range:** `HEAD`

> This pack is the sole input for reviewers. Do NOT read files outside it unless a specific finding requires verification. If a file not in the pack is needed, mark the finding `Needs verification` and describe what would resolve it.

## Changed Files

```
tasks/2026-05-07-event-creation-reliability-spec.md
```

## User Concerns

This is a SPEC review, not a code review. The spec is at tasks/2026-05-07-event-creation-reliability-spec.md and proposes a 3-phase remediation for event-save reliability bugs. CHALLENGE the spec hard: (1) verify the cited file:line claims actually match the code in src/actions/events.ts (2153 lines) and src/components/events/event-form.tsx (2262 lines); (2) check whether removing the prop-reset useEffect would break edit mode (consumers of defaultValues prop changes); (3) challenge the proposed save_event_draft RPC — is wrapping image upload + multi-table writes + audit in one transaction actually feasible given Supabase storage is outside Postgres?; (4) is the recommended sequencing (Phase A before B) actually safe, or does Phase A's warnings[] addition mask the real bugs in a way that makes Phase B harder; (5) is anything MISSING from the spec — failure modes the spec doesn't address. Be ruthless about unproven assumptions and missing scope. Question the proposed correlation-ID approach. Question whether the spec's open questions Q1-Q5 are the RIGHT questions or if they're missing the point.

## Diff (`HEAD`)

_(no diff output)_

## Changed File Contents

### `tasks/2026-05-07-event-creation-reliability-spec.md`

```
# Event Creation Reliability — Discovery & Spec

**Status:** Discovery complete; spec for client review
**Date:** 2026-05-07
**Author:** Claude (under Peter Pitcher's direction)
**Branch:** `claude/eager-borg-52d3f5`
**Complexity score:** 4 (L) — multi-layer change; will be split into at least 3 PRs

---

## 1. Problem statement

Users across the platform are reporting that:

- **A.** Saving a new or edited event sometimes "doesn't take" — they click Save and nothing visibly changes, OR they see a success toast but the data they entered is missing the next time they open the event.
- **B.** They lose work — text they typed disappears, multi-venue selections drop venues, attached artists vanish, or the form rolls back to old values.

This is not a one-off; it's enough volume that "creating an event" is no longer trusted by the team. The flow has had eight separate fixes in the last 30 days (`b44ee1b`, `5a84fbf`, `7970ddf`, `6d3d909`, `5f845de`, `5674728`, `750303a`, `654d466`) and another bug class is still leaking through. The code is not structurally reliable; we need to fix the underlying patterns rather than ship a ninth point fix.

## 2. What "Save" actually does today

### 2.1 Entry points

| Path | Component | Action(s) used |
|---|---|---|
| `/events/new` | `EventForm` (mode=`create`) | `saveEventDraftAction` → `submitEventForReviewAction` |
| `/events/propose` | `EventForm` (mode=`create`) + propose-form helper | `proposeEventAction` (RPC) |
| `/events/[eventId]` | `EventForm` (mode=`edit`) | `saveEventDraftAction` → `submitEventForReviewAction` |
| `/events/[eventId]/edit` (status routing) | Same form | Same actions |

There are **no** API endpoints involved in create/save (the public `/api/v1/events` is read-only).

### 2.2 What `saveEventDraftAction` does (today)

It performs ~10 sequential operations against multiple tables and an RPC, with **no surrounding transaction**:

1. Auth check (`getCurrentUser`).
2. Permission check (`canEditEvent` / `canProposeEvents`).
3. Zod parse (`eventDraftSchema`).
4. `INSERT` or `UPDATE` `events`.
5. `syncEventArtists` — wraps `event_artists` insert/delete.
6. `syncEventVenueAttachments` — calls `set_event_venues` RPC for multi-venue.
7. `uploadEventImage` — Supabase Storage write.
8. `appendEventVersion` — snapshot row in `event_versions`.
9. `recordAuditLogEntry` — `audit_log` insert.
10. `revalidatePath` — clear Next.js cache.

Each step is awaited. **Most have their own try/catch that swallows the error and logs to console.** A failure in steps 5–9 leaves the parent `events` row written but linked data missing — and the action still returns `{ success: true }`.

### 2.3 What the form does on submit

- `useActionState(saveEventDraftAction)` binds state.
- Two submit buttons share one `<form>` and use `data-intent` plus `formAction=` to switch between draft and submit.
- A `useEffect` watches `draftState.message` and shows a toast — **only if `fieldErrors` is falsy**. If the server returns `{ success: false, fieldErrors: {...} }`, no top-level toast appears.
- Another `useEffect` (line 396 of `event-form.tsx`) **resets every form state value to `defaultValues` on prop change**. If any parent re-render hands a new `defaultValues` object reference (RSC navigation, revalidatePath callback, parent state change), the user's unsaved input is silently overwritten.
- After a successful save, **the form's `isDirty`-equivalent flags are never cleared**, so the unload-warning ("you have unsaved changes") still fires and users assume their save failed and re-click Save.
- There is no `isPending` / disabled state on the submit buttons. Rapid clicks fire multiple actions.

## 3. Failure modes found (cited with file:line)

> Every line below is a place where today's code can leave the user with the symptoms in §1.

### 3.1 CRITICAL — silent partial-write failures

| # | File:Line | What happens | Why the user loses data |
|---|---|---|---|
| C1 | [`src/actions/events.ts:35-46`](src/actions/events.ts:35) | `syncEventVenueAttachments` calls `set_event_venues` RPC and only `console.error`s on failure. Returns `void`. | Multi-venue selections silently drop. User sees one venue saved, the others gone. |
| C2 | `src/actions/events.ts` (~835-845, draft) and (~1070-1078, submit) | Artist sync errors caught, set a local `artistSyncWarning` flag, return success anyway. Warning never propagates to UI. | User saves with 4 artists, 0–3 are persisted, no error shown. |
| C3 | `src/actions/events.ts` (~880-888) | `appendEventVersion` wrapped in try/catch that swallows. Sets `versionWarning`, never surfaces it. | Version-history row missing; future audits/rollbacks can't reconstruct what changed. |
| C4 | `src/actions/events.ts:856`, `:1084`, `:1142-1143` | `recordAuditLogEntry({...}).catch(() => {})` — explicit silent swallow on three audit paths. | Mutation is committed but unaudited. CI guard at `__tests__/audit-coverage.test.ts` doesn't catch swallowed runtime failures. |
| C5 | `src/actions/events.ts:~924, :1267` | `await syncEventVenueAttachments(...)` is **not** wrapped. Any exception thrown by the helper (e.g. RLS denial bubbling out of the admin client) crashes the entire action AFTER the `events` row is already committed. | Event row exists; venue join rows don't; client gets a generic "could not save" and the dirty form, so user re-submits → duplicates. |
| C6 | [`supabase/migrations/20260417200000_add_multi_venue_event_drafts_rpc.sql`](supabase/migrations/20260417200000_add_multi_venue_event_drafts_rpc.sql) | `create_multi_venue_event_drafts` uses `FOREACH … LOOP` per venue with no `SAVEPOINT`. | If venue 3 of 5 fails (e.g. RLS, FK), Postgres rolls back the whole RPC — and `event_creation_batches.result` is never populated. The client retries with a new key and creates duplicates, OR retries with the same key and gets ambiguous "already processed" with no result payload. |
| C7 | `src/components/events/event-form.tsx:396-440` | `useEffect([mode, defaultValues?.id, ...])` resets every controlled state to `defaultValues` whenever `defaultValues` reference changes. | Any background revalidation that re-renders the parent reseeds the form, wiping user-entered text mid-edit. |

### 3.2 HIGH — broken UX feedback loop

| # | File:Line | What happens | User-visible effect |
|---|---|---|---|
| H1 | `event-form.tsx:~348-365` | Error toast suppressed when `fieldErrors` truthy: `} else if (!draftState.fieldErrors)`. Empty object `{}` is also truthy. | On any validation failure (whether or not fields are flagged), no top-of-page toast appears. On a long form, the inline error is offscreen. |
| H2 | `event-form.tsx` (no reset path) | After `success: true`, `isDirty`/dirty trackers are never cleared. | Unsaved-changes warning persists; users re-Save and wonder why "it isn't saving". |
| H3 | `event-form.tsx:563-570` `handleSubmit` | Only sets intent. No `isPending` guard, no button disable. | Double-submit on slow networks → duplicate events / partial overwrites. |
| H4 | `events.ts:~1027-1244` (catch block in submit) | Generic `return { success: false, message: "Could not submit right now. Please try again." }`. Real error logged server-side only. | Users don't know what failed; support has no correlation ID. |
| H5 | `events.ts:1242-1244` | Inside the catch, `revalidatePath(...)` and `redirect(...)` are called BEFORE the return. `redirect` throws — the return is unreachable. Cache is cleared before we know the write committed. | Stale cache served; user lands on the event page and sees the pre-error state, not their input. |

### 3.3 MEDIUM — validation, idempotency, RLS asymmetry

| # | File:Line | Issue |
|---|---|---|
| M1 | [`supabase/migrations/20260505190000_allow_office_worker_full_form_submit.sql`](supabase/migrations/20260505190000_allow_office_worker_full_form_submit.sql) | RLS asymmetry — `WITH CHECK` allows office_worker to write `manager_responsible_id` and submit, but `USING` (SELECT) of submitted events is still admin-only. After submit, the form's reload may 404, surfacing as "save lost". Needs verification. |
| M2 | `event-form.tsx` propose-form path (`5a84fbf` fix) | Idempotency key generated client-side. If a client retries after a generic error with a freshly mounted component, the key may differ → duplicate proposals. Fix `5a84fbf` made it stable per-mount; still vulnerable across navigations. |
| M3 | `events.ts` everywhere | `as any` casts on supabase client (`(db as any).rpc(...)`) defeat type checking on RPC names/args. |
| M4 | `events.ts:~860-867` | Image upload error is returned as `{ success: false }` but the events row is already committed. User sees error, dirty form, no awareness that the text saved. |
| M5 | `event-form.tsx:370`, `:414` | `(defaultValues as any)?.manager_responsible_id` — type bypass. If shape drifts, no compile error and silent UI bugs result. |

### 3.4 LOW — cosmetic / cleanup

L1. `console.error("syncEventVenueAttachments RPC failed:", error)` — no correlation ID; can't tie to a user complaint.
L2. Fix `654d466` ("sanitise error messages") removed details from messages without adding a request-id mechanism for support.
L3. No metric/log on "events that succeeded with warnings" — invisible failure rate.

## 4. Root causes (the patterns to break)

1. **No transaction boundary** around the multi-write save. The action is an arbitrary chain of independently-failing operations.
2. **Pervasive error swallowing** — `try/catch (err) { console.error; return { success: true } }` and `.catch(() => {})` are normalised in this file.
3. **Form state reset effect on prop change** — clobbers user input on background revalidation.
4. **No partial-success contract** — the `ActionResult` shape `{ success, message, fieldErrors }` cannot express "core saved, side-effect failed". Engineers default to "log and pretend".
5. **No double-submit lock** — the form trusts the user not to click twice.
6. **No correlation ID** — when a user complains "save didn't work", support can't find the trace.

## 5. Proposed remediation

> Three sequenced PRs. Each is independently deployable. Every PR is gated by tests written first (TDD).

### Phase A — Stop the bleeding (UX guardrails)

**Goal:** Even with the underlying server-side bugs, no user loses work or thinks a failure was a success.

1. **Disable submit buttons while pending.** Add `isPending` from `useActionState` to both Save and Submit buttons (`disabled={isPending}` + spinner). Eliminates double-submit.
2. **Fix the toast condition.** Change `else if (!draftState.fieldErrors)` → `else { toast.error(message) }`. Always surface a top-level toast on failure. Use icon + text (no colour-only) for the error variant.
3. **Clear `isDirty` after successful save.** Reset the unload-warning sentinels when the action returns `success: true`.
4. **Remove the prop-reset `useEffect` in edit mode** (or gate it on a stable key the user explicitly triggers, e.g. "Discard changes"). On `mode === "edit"` the form should mount with `defaultValues` and never re-seed mid-session.
5. **Show what saved and what didn't.** Augment `ActionResult` with `warnings: string[]` and render any non-empty warnings as a non-fatal banner. Replace every `console.error` swallow in the action chain with a `warnings.push(...)` call.
6. **Surface a correlation ID** on every error toast: `Save failed (ref: a1b2c3). Try again or contact support with this code.` Generate a UUID per action invocation, log it with the error, return it in `message`.

**Acceptance for Phase A:** A failing artist sync, a failing venue sync, a failing image upload, and a failing version write all produce a clear user-visible warning AND the user's text is preserved in the form. Double-clicking Save creates exactly one event. Validation failures always produce a toast.

### Phase B — Atomicity and error propagation

**Goal:** Either the whole save commits, or none of it does, and the client knows precisely which.

1. **Wrap the multi-write save in a single Postgres transaction via an RPC.**
   - New SECURITY DEFINER RPC `save_event_draft(payload jsonb, user_id uuid)` that does: insert/update `events`, `event_artists`, `event_venues` join, `event_versions`, `audit_log` — all in one transaction, using `SAVEPOINT` per artist/venue so a single bad row in a list raises a structured error rather than rolling back the parent.
   - Returns `{ event_id uuid, warnings text[] }` so the action can still report partial side-effect failures (e.g. notification dispatch) explicitly.
   - Image upload stays outside the transaction (S3-style storage can't join a Postgres tx) but happens AFTER the RPC succeeds, with a documented "image-not-attached" warning + retry path.
2. **Replace `syncEventVenueAttachments` and `appendEventVersion` direct calls** with the RPC return.
3. **Remove every `.catch(() => {})`** from `events.ts`. If an audit insert fails, the action fails. If notification dispatch fails, that's a documented partial-success warning.
4. **Add a `SAVEPOINT` per venue** in `create_multi_venue_event_drafts` so we can return `{ created: [...], failed: [{ venue_id, reason }] }` instead of all-or-nothing.
5. **Stop calling `revalidatePath` and `redirect` in catch blocks.** Cache invalidation only happens after a confirmed success.
6. **Type the RPC calls.** Generate Supabase types (`supabase gen types`), drop the `as any` casts.

**Acceptance for Phase B:** Killing the database connection mid-save leaves no orphaned rows. A multi-venue create where 1 of 5 venues violates RLS returns a clear error naming that venue and creates 0 events. Audit log failures are loud, not silent.

### Phase C — Observability and prevention

**Goal:** We catch the next regression before users do.

1. **Structured logging** on every event action — `{ correlation_id, user_id, action, duration_ms, outcome, warning_count }`. Pipe to the existing log surface (no new infra needed).
2. **Test suite for the failure modes** — Vitest tests that mock Supabase to inject:
   - RPC error → assert action returns `{ success: false }` and form preserves input.
   - Audit insert failure → assert action returns `{ success: false }`.
   - Partial multi-venue → assert structured `failed[]` returned.
   - Double-submit → assert only one row created.
   - Image upload failure after event write → assert warning + correlation ID.
3. **E2E test** (Playwright) — golden path: create draft, edit, submit. Edge case: submit with network throttled mid-flight, assert no data loss.
4. **CI guard extension** — extend `audit-coverage.test.ts` to also verify "no `.catch(() => {})` patterns in `src/actions/events.ts`".
5. **Migration check** — verify Supabase advisors don't flag the new RPC.

## 6. Acceptance criteria (what "fixed" means)

A user is considered to have a reliable save when ALL of the following hold:

- [ ] Clicking Save once produces exactly one server action invocation. Double-clicks are no-ops.
- [ ] On success, the toast is visible AND the unsaved-changes warning is cleared AND the user is redirected (single, deterministic path).
- [ ] On failure, the toast is visible AND the form retains every input the user typed AND the toast contains a correlation ID.
- [ ] Multi-venue saves are atomic: either all venues are created or none are, with a list of which venues failed and why.
- [ ] Artist links, venue links, image uploads, version snapshots, and audit log writes can each fail and produce a *visible* warning — none of them is silent.
- [ ] Any background re-render of the parent does not reset the form.
- [ ] RLS asymmetry between draft-write and submitted-read is resolved (M1) so that post-submit reload doesn't 404.
- [ ] All event-flow Vitest tests pass; new failure-mode tests pass; Playwright golden + edge path passes.
- [ ] Definition of Done from `.claude/rules/definition-of-done.md` passes (lint, typecheck, build, tests, audit, RLS verified).

## 7. Test strategy (TDD)

Tests are written **before** each fix:

- Vitest: each numbered finding (C1–C7, H1–H5, M1–M5) gets at least one failing test that proves the bug, then the fix turns it green.
- Playwright (existing config): two scenarios — "create + submit happy path" and "create with simulated venue-RPC failure".
- All Supabase clients mocked. Mock strategy already established in `src/components/events/__tests__/event-form.create.test.tsx`.

## 8. Open questions for review

> I need answers on these before starting Phase B work; Phase A can proceed regardless.

1. **Q1.** When an image upload fails after the event row is written, what should happen?
   (a) Roll back the event entirely (delete the row) and require re-submit.
   (b) Keep the event saved, surface a "Image not attached, click here to retry" warning. ← my recommended default.
2. **Q2.** When a multi-venue save fails on 1 of 5 venues, do we:
   (a) Fail the whole batch — user re-picks. ← simplest, matches current rollback behaviour.
   (b) Save the 4 that succeeded, return the 1 failed one for retry.
3. **Q3.** Is it acceptable for office_workers to **see** their own submitted events in the form (M1 RLS asymmetry)? My read of the project CLAUDE.md is yes, but it's a policy decision.
4. **Q4.** Correlation IDs in error messages — OK to expose to end users, or do you want them logged-only and shown only to admins?
5. **Q5.** Are there any active sessions / data already in flight that we should drain before deploying Phase B (transactional save)? If so, we'll add a maintenance banner.

## 9. Out of scope (parking lot)

- Pre-event proposal status transitions (`pending_approval` → `approved_pending_details`) — that flow has its own RPC `pre_approve_event_proposal` which the recent fixes already hardened. Audit pass to confirm, but not in this remediation.
- SOP checklist generation — out of save path; runs as side-effect.
- Notification email dispatch — already non-blocking by design.
- Public `/api/v1/events` — read-only, unrelated.
- Event delete / hard-delete — separate flow.

[truncated at line 200 — original has 215 lines]
```

## Related Files (grep hints)

_(no related files found by basename grep)_

## Project Conventions (`CLAUDE.md`)

```markdown
# CLAUDE.md — BaronsHub

This file provides project-specific guidance. See the workspace-level `CLAUDE.md` one directory up for shared conventions.

## Quick Profile

- **Framework**: Next.js 16.1, React 19.1
- **Test runner**: Vitest
- **Database**: Supabase (PostgreSQL + RLS)
- **Key integrations**: QR code generation, Email (Resend), public event API, event management
- **Size**: ~148 files in src/

## Commands

```bash
npm run dev              # Start development server
npm run build            # Production build
npm run start            # Start production server
npm run lint             # ESLint check
npm run test             # Vitest run (single pass)
npm run test:watch       # Vitest watch mode
npm run typecheck        # TypeScript check (tsc --noEmit)
npm run supabase:migrate # Apply pending migrations
npm run supabase:reset   # Reset database (linked, requires confirmation)
```

## Architecture

**Route Structure**: App Router with event management focus. Key sections:
- `/events` — Event browsing, listing (public and authenticated)
- `/admin` — Event creation, management, setup
- `/api/v1/events` — Public event API with rate limiting and auth

**Auth**: Supabase Auth with JWT + HTTP-only cookies. User context available in server and client components. Permission checks via `src/lib/` helpers.

**Database**: Supabase PostgreSQL with RLS. `src/lib/` contains data access helpers. `supabase/seed.sql` provides test data setup.

**Key Integrations**:
- **QR Codes**: `qrcode` library for event ticket generation
- **Email**: Resend for event notifications and confirmations
- **Public API**: `src/lib/public-api/` — rate-limited REST API for events
- **Notifications**: `src/lib/notifications.ts` — event alerts and reminders

**Data Flow**: Server actions for mutations (create/update/delete events). Server components for data fetching. All API responses validated with Zod. RLS enforces permission at database level.

## Key Files

| Path | Purpose |
|------|---------|
| `src/types/` | TypeScript definitions (event models, API) |
| `src/lib/public-api/` | Rate-limited public REST API endpoints |
| `src/lib/public-api/rate-limit.ts` | API rate limiting (per IP/API key) |
| `src/lib/public-api/auth.ts` | API key validation |
| `src/lib/validation.ts` | Zod schemas for events, bookings, etc. |
| `src/lib/datetime.ts` | Date/time utilities for event scheduling |
| `src/lib/artists.ts` | Artist/performer data helpers |
| `src/lib/reviewers.ts` | Event reviewer/moderator logic |
| `src/lib/notifications.ts` | Email and notification dispatch |
| `src/app/api/v1/events` | Public event REST API |
| `src/actions/` | Server actions for mutations |
| `supabase/migrations/` | Database schema migrations |
| `supabase/seed.sql` | Database seed for testing |
| `vitest.config.ts` | Vitest configuration |

## Environment Variables

| Var | Purpose |
|-----|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (public) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key (server-only) |
| `RESEND_API_KEY` | Resend email service key |
| `BARONSHUB_WEBSITE_API_KEY` | BaronsHub website integration API key |

## Project-Specific Rules / Gotchas

### Public API
- Endpoints in `src/lib/public-api/events.ts` require rate limiting
- `src/lib/public-api/auth.ts` validates API keys (Bearer token or query param)
- All responses return `{ success: boolean; data?: T; error?: string }`
- Minimum 80% test coverage on API logic (see `src/lib/public-api/__tests__/`)

### Rate Limiting
- Per-IP limiting for anonymous requests
- Per-API-key limiting for authenticated requests
- Limits configurable in `src/lib/public-api/rate-limit.ts`
- Return 429 (Too Many Requests) when exceeded

### Event Model
- Events have status: `draft` → `published` → `completed`
- Optional artists/performers with bios
- Date/time handling via `src/lib/datetime.ts` (respects timezone)
- QR codes generated on demand (not pre-stored)

### Permissions
- Event creators can edit own events
- Administrators can moderate all events; office_workers can manage events at their venue
- Check permissions in both UI and server actions (defense in depth)
- RLS enforces at database level

### Auth Standard Deviation: Custom Role Model

**Deviation from workspace standard (auth-standard.md §7):** The workspace standard mandates three generic roles (`admin`, `editor`, `viewer`). This project uses three domain-specific roles approved for this application:

| Application Role | Maps to Standard Tier | Capabilities |
|---|---|---|
| `administrator` | `admin` | Full platform access, user management, all event operations |
| `office_worker` | `editor` | Venue-scoped write access (if venue_id set) or global read-only (if no venue_id); planning CRUD on own items; debrief create/edit (own) |
| `executive` | `viewer` | Read-only access to all events, planning, and reporting |

**Why:** Event management requires venue-scoped write access for some staff and global read-only for others, expressed through a single role with venue_id as the capability switch.

**Implementation notes:**
- Roles stored in `public.users.role` column (not Supabase `app_metadata`)
- Role helpers in `src/lib/roles.ts` use explicit capability functions with optional `venueId` parameter
- Permission checks use `role === "administrator"` for admin operations
- `venue_id` on the user record acts as a capability switch for office_worker
- All capability functions are in `src/lib/roles.ts`

### Email & Notifications
- `src/lib/notifications.ts` handles async dispatch
- Never await email sends in critical paths — queue for background jobs
- Use Resend templates for transactional emails

### Testing with Vitest
- Test API endpoints in `src/lib/public-api/__tests__/`
- Mock Resend and Supabase in tests
- Use `vitest.config.ts` for test setup (environment, ports, etc.)
- Run tests before pushing: `npm run test`

### QR Code Generation
- Use `qrcode` library (not `qrcode.react`)
- Generate QR codes server-side for ticket URLs
- Embed event ID and user ID in URL
- Cache generated QR images (optional, not required)

### Supabase Data Access
- Use service-role client only for system operations (migrations, seeding)
- Client operations use anon-key (respects RLS)
- Always wrap DB results with conversion helper (snake_case → camelCase)

### Database Seeding
- `supabase/seed.sql` creates test events and users
- Run seeding after `supabase db reset`
- Keep seed data minimal (fast test setup)

### Artist Logic
- `src/lib/artists.ts` — fetch artist info, bios, links
- `src/lib/reviewers.ts` — fetch reviewer assignments, approval status
- Always verify permissions via `src/lib/roles.ts` capability functions before allowing edits

### Datetime Handling
- Use `src/lib/datetime.ts` for all user-facing dates
- Store all times in UTC in database
- Convert to user's timezone on display
- See workspace CLAUDE.md for timezone conventions
```

---

_End of pack._
