# Charlotte's August Feedback: Design Spec

**Date:** 2026-08-24
**Version:** v2, revised after Peter's answers and the independent developer review (`2026-08-24-charlotte-feedback-design-review.md`)
**Status:** Decisions 1 to 16 confirmed by Peter. Six further decisions taken in this revision are marked as such in the register. Slice 0 is cleared to ship
**Owner:** Peter Pitcher
**Source:** Charlotte Whindle email, 2026-08-24, following a walkthrough with Georgia and Tom

Everything here was checked against the code and the live production database (`shofawaztmdxytukhozo`). Section 10 carries the SQL so any figure can be re-run before deployment.

## Revision log (v1 to v2)

Client and Peter answers folded in, and the review's 35 findings worked through. Nine review findings were verified as correct and are now designed out, four were found to be wrong or overstated, and five things the review did not spot were found and are more consequential than several of its own findings.

**What changed most:**

1. **Event checklists stay off.** Peter answered "not yet" to switching them back on and to any backfill. This removes the largest data-operation risk from the programme and defers three slices.
2. **The venue lock is back in.** v1 recommended no lock. The review is right that this contradicts the permission model, and the live database already encodes the opposite rule. See decision 4.
3. **The RPC signature problem dissolves rather than needing a migration.** The SOP selection is applied after the approval RPC returns, in TypeScript, using a helper that already exists. No argument is added to `pre_approve_event_proposal`, so review finding F18 does not arise.
4. **Two AI actions leak, not one.** The review spotted `generateWebsiteCopyFromFormAction`. `generateTermsAndConditionsAction` has the same shape and the same gate.
5. **The stale-proposal cron has never run.** v1 warned it would auto-reject a manager backlog. It is absent from `vercel.json` and has zero audit rows in its entire history. The real risk is the opposite: nothing will ever clear the queue.
6. **The London date bug is latent, not live.** Zero of 142 events have a London/UTC date divergence, and the earliest London start time is 12:30. Worth fixing, but it has never misdated a checklist.
7. **`due_date_manually_overridden` is never written.** Neither v1 nor the review spotted this. It is the highest-consequence item in the set: the first event date change would silently wipe every hand-set deadline, if hand-set deadlines existed.
8. **A prior template deletion already caused data loss.** Ten SOP templates were deleted on 28 May 2026, orphaning 2,290 task rows. The delete button that did it is still unguarded and sits two clicks from the backfill button.

---

## 1. Read this first: two live defects nobody reported

### Defect A: event checklists have been switched off since 11 June

`src/lib/planning/sop.ts:5-6` declares two constants set to the same date:

```ts
export const EVENT_TODO_NOT_REQUIRED_AFTER_DATE = "2026-06-11";
export const EVENT_TODO_NOT_REQUIRED_BEFORE_DATE = "2026-06-11";
```

and `shouldMarkEventTodosNotRequired` (`src/lib/planning/sop.ts:75-81`) returns

```ts
targetDate < today || targetDate < beforeDate || targetDate > afterDate
```

Because the two bounds are identical this was true for every date except exactly 2026-06-11, and since 12 June the first clause alone has made it true for every date without exception. It was a one-off go-live switch added on 28 May 2026 (commit 6495885) and never removed.

Every event created since then generates 28 SOP tasks with correct deadlines and closes all 28 in the same second.

| Population | Items | SOP tasks | Still open |
|---|---|---|---|
| Future events | 39 | 1,062 | 55 |
| Future non-event planning items | 78 | 1,950 | 1,950 |

**Peter's decision: switch it on for newly created events only, with no backfill** (decisions 17 and 18). The two halves are deliberately separated. Switching on is a code change with zero DML and is reversible in a minute. Restoring checklists on events already in the system would rewrite hundreds of live rows and could not be undone by a code revert, so it is not being done.

Three consequences, designed around in this revision:

- The 39 future events already in the system keep their empty checklists. Only events created after the switch get a live task list. Charlotte should know this, because events she added before the switch will look different from ones she adds after it.
- Each new event will raise about 27 open tasks against named people, so **the section owners must be confirmed before the switch is flipped**. That is slice 9's precondition, not an afterthought.
- There is no feature flag today. "Checklists are off" is an accident that reads like two date constants, so anyone tidying those dates would switch 4,454 tasks back on. The switch is replaced with a named boolean first (decision 22), then flipped.

The propose-then-approve route was always exempt from the kill switch, because `pre_approve_event_proposal` generates in PL/pgSQL. That is why the two `approved_pending_details` events carry 27 live tasks each today, and why Charlotte's SOP picker (her item 5) is worth building on that route regardless.

### Defect B: creating a planning item fails whenever you tick an SOP box

1. The SOP seed built template ids from an MD5 hash (`supabase/migrations/20260408120005_seed_sop_template.sql:12-16`, `select (md5(key)::uuid)`). Postgres accepts these; they carry no RFC 4122 version or variant bits.
2. The project runs zod 4.1.12, whose `.uuid()` enforces both nibbles. `src/actions/planning.ts:80` validates the picker output with `z.array(z.string().uuid())`.
3. **20 of the 28 SOP task templates fail that check.**
4. `zodFieldErrors` (`src/actions/planning.ts:43-52`) keys errors by dotted path, producing `sopNotRequiredTemplateIds.0`, with a varying index.
5. The form renders error text for exactly five keys (`src/components/planning/planning-item-editor.tsx:268, 283, 307, 362`). There is no catch-all, so the key matches nothing.

The toast says "Check the highlighted fields" and nothing is highlighted. **Zero standalone planning items have been created since 22 June 2026.** Event-linked items are still being created, so it is specifically the manual create path that has stopped.

The event form is unaffected because it posts ids as FormData through `normaliseSopNotRequiredTemplateIds`, which uses a deliberately lax pattern. `src/actions/planning.ts` is the only place that puts a strict `.uuid()` in front of these ids. `src/actions/sop.ts` avoids `.uuid()` everywhere for exactly this reason, which is the in-repo precedent for the fix.

Two more invisible-error paths exist on the same screen's "Recurring series" tab: unticking every weekday, and clearing the day-of-month box.

---

## 2. Decision register

Status is one of **Confirmed** (Peter or the client has said yes), **Taken in v2** (a design decision made in this revision on the evidence, reversible on request), or **Deferred**.

| # | Decision | Choice | Status |
|---|---|---|---|
| 1 | Ship the planning form fix first, as a hotfix | Yes | Confirmed 2026-08-24 |
| 2 | Start the AI and end-time slices without waiting | Yes | Confirmed 2026-08-24 |
| 3 | Managers may propose events | Yes, propose form only. `/events/new` stays administrator-only | Confirmed 2026-08-24 |
| 4 | Manager venue scope | Manager with a venue: that venue only. Manager without a venue: any venue except the internal one | Confirmed 2026-08-24 |
| 5 | Who completes an approved proposal | Head office (administrator) | Confirmed 2026-08-24 |
| 6 | End time on proposals | Required, prefilled to start plus three hours, full date-and-time control | Confirmed 2026-08-24 |
| 7 | AI generation start point | From the moment a proposal is approved | Confirmed 2026-08-24 |
| 8 | Quiz Night and Live Music templates | **Social media task only.** The website listing is published automatically from BaronsHub, so the manual website task is redundant for these two types. This is a deliberate narrowing of what Charlotte asked for, see the note below | Confirmed 2026-08-25 |
| 9 | Website task lead time | Stays at 8 weeks (T-56) for SEO indexing, on the event types that keep the task | Confirmed 2026-08-24 |
| 28 | Debrief ownership | The venue's manager. If the venue has no manager, Helen Pillinger | Confirmed 2026-08-25 |
| 29 | Debrief on the short templates | Quiz Night and Live Music keep the post-event debrief task | Confirmed 2026-08-25 |
| 30 | Acoustic Music | Uses the same short template as Live Music | Confirmed 2026-08-25 |
| 31 | Telling Charlotte about the dropped website task | Do not raise it separately. Ship it and let it stand | Confirmed 2026-08-25 |
| 10 | Menu changes | Planning items, not events | Confirmed 2026-08-24 |
| 11 | "Past" definition | Ends more than 7 days ago, so there is time to add the debrief | Confirmed 2026-08-24 |
| 12 | Debrief chasing | Keep it. See the note below, this answer needs one confirmation | Confirmed 2026-08-24, reading to confirm |
| 13 | Weekend deadlines | Move Saturday and Sunday back to the preceding Friday | Confirmed 2026-08-24 |
| 14 | Weekend change scope | Prospective only. No existing task row changes | Confirmed 2026-08-24 |
| 15 | Dependencies | Template-level rules are the answer. The missing piece is the prompt when a prerequisite completes | Confirmed 2026-08-24 |
| 16 | SOP picker semantics | Keep "tick what you do not need". Do not invert | Taken in v1, unchallenged |
| 17 | Event checklist kill switch | Switch on, for newly created events only. No existing event changes | Confirmed 2026-08-24 |
| 18 | Historic task backfill | None. The 39 future events already in the system keep their empty checklists | Confirmed 2026-08-24 |
| 19 | SOP selection into approval | Applied after the approval RPC returns, in TypeScript. No RPC argument added | Taken in v2 |
| 20 | Approval keeps generating a checklist | Yes, and the checklist starts at approval, never at proposal. A proposal awaiting a decision carries no tasks | Confirmed 2026-08-24 |
| 20a | Stale-proposal job | Schedule it, with chasers at 7 and 14 days before any auto-reject at 21 days, and never auto-reject an already-approved proposal | Confirmed 2026-08-24 |
| 20b | AI slug suggestion on a published event | Hide it, rather than show a value that will not be saved | Confirmed 2026-08-24 |
| 21 | Slug freeze marker | New `events.first_published_at` column, set by trigger, backfilled for 110 rows | Taken in v2 |
| 22 | Replace the kill switch with a named flag | Yes, while leaving it off | Taken in v2 |
| 23 | Template delete protection | Archive, not hard delete, enforced by a database trigger | Taken in v2 |
| 24 | `EVENT_SAVE_USE_RPC` | Stays off. Documented as blocked on a trigger change | Confirmed in v1 |
| 25 | Public API | Untouched. Additive only | Confirmed in v1 |
| 26 | Auto-completing past events | Out of scope | Confirmed in v1 |
| 27 | The two proposals stuck since 1 June | Cancel them | Confirmed 2026-08-24 |

**Note on decision 4.** Peter answered "any venue". The review is correct that this contradicts the project permission model, where `venue_id` is the capability switch, and the live `propose_event_draft` function already refuses cross-venue proposals from an assigned manager. The design adopted keeps Peter's intent intact in practice: 12 of the 13 manager accounts have no venue, so they can still propose anywhere. Only one account is affected, and that account is assigned to "Meade Hall at The Crown & Cushion", a room inside a larger pub, so a strict lock is narrow. This is flagged for confirmation rather than assumed.

**Note on decision 12.** "Yes" was given to a question phrased as "do you still want chasing for post-event debriefs", where the recommendation was to retire it. Read together with decision 11, whose stated reason is leaving time to add the debrief, this is taken as **keep the debrief chase**. Confirmed in discussion on 2026-08-25, and decision 28 now supplies the owner it needed.

**Note on decision 8.** Charlotte's email asked for two tasks on these templates: "Social Media posts task and website task, with Georgia allocated to them". Only the social media task is being built. The reason is that event details already flow from BaronsHub to the brand website through the public API, so a person manually updating the website is duplicated effort for a recurring quiz or music night. This is a deliberate deviation from the written request. Decision 31 is not to raise it separately with her; if she asks, the answer is that the listing publishes itself.

**Note on decision 28.** The chain resolves as: the event's named manager, then the venue's default manager, then Helen Pillinger. Twelve of the thirteen venues already have a default manager recorded, so the chain works today. Applied to the 29 currently outstanding debriefs it produces Helen 19 and Natalie Thewlis 10, and exactly one cannot be resolved by venue and falls to Helen. Worth noting that the fallback puts roughly two thirds of the existing backlog on Helen.

---

## 3. Response to the developer review

The review raised 35 findings. Each was verified against the repo and the live database rather than accepted or dismissed on reading.

### Accepted, and now designed out

| ID | Finding | Verified | Where it is now handled |
|---|---|---|---|
| F04 | Venue scope contradicts the permission model, and the live service-role RPC does not enforce it | Correct | Decision 4, slice 3 |
| F08 | The 11 call sites need an explicit capability matrix | Correct, and it undercounts the leak | Slice 3, section 4.3 |
| F12 | SOP target dates are not derived from the London calendar date | Correct but **latent, not live** | Slice 6 |
| F13 | "Any editable status except pending_approval" is not an allowlist | Correct | Slice 1, section 4.1 |
| F14 | Slug freezing needs a durable publication marker that does not exist | Correct | Decision 21, slice 1 |
| F17 | The user is told the item was created when the checklist silently failed | Correct | Slice 5 |
| F18 | A defaulted RPC argument cannot be added with `CREATE OR REPLACE` | Correct, and the failure mode is worse than the review says | Dissolved by decision 19 |
| F21 | Event date changes do not move checklist dates, and no slice owned the fix | Correct | Slice 6 |
| F22 | Weekend adjustment scope is unspecified | Correct | Decisions 13 and 14, slice 6 |
| F26 | Delete protection covers too little of the destructive path | Correct, and it has already caused data loss | Decision 23, slice 7 |
| F10 | The stale-approval cron's schedule is unproven | Correct, and it has never run | Slice 3 |
| F02 | Acceptance criteria are missing | Correct | Section 5 |
| F32 | Production evidence is not reproducible | Correct | Section 10 |

### Corrected

| ID | Review said | Actually |
|---|---|---|
| F12 | Early-morning BST events are getting one-day-early deadlines | Zero of 142 events have a London/UTC date divergence. The earliest London start is 12:30. The bug is real but has never fired. Presenting it as live would be wrong |
| F16 | Persisting the exclusion list implies editable state that is undefined | No column should be added at all. When checklists return, the exclusion is a creation-time input that materialises as per-task status. There is no list to edit |
| F28 | The spec's "close to zero coverage" is too broad | Correct, and now replaced with the accurate statement in section 9. The codebase has 105 Vitest files with dense coverage. The real problem is different: several suites pin today's defective behaviour and must be edited deliberately |
| F18 | Use a versioned `pre_approve_event_proposal_v2` | No new argument is needed at all, so neither a version nor a drop-and-recreate is required. The repo's one versioned-name precedent left an orphan that is still wired in today |

### Found here, missed by the review

1. **`due_date_manually_overridden` has never been written to on any of 9,726 rows.** `src/lib/planning/index.ts:1038` writes `due_date` without ever setting the flag. Any recalculation feature that promises to respect hand-set deadlines is promising something that cannot happen. This must be fixed in the same change as recalculation, or the first date move wipes every hand-set deadline.
2. **A second AI action leaks.** `generateTermsAndConditionsAction` (`src/actions/events.ts:3074`) has the same shape and the same `canProposeEvents` gate as the one the review found. Both call an LLM. Both must move to an administrator-only capability.
3. **Ten SOP templates were deleted on 28 May 2026**, orphaning 2,290 task rows (23.5% of all tasks). The link is `ON DELETE SET NULL`, so nothing errored and nothing can be reconstructed. The button that did it is still unguarded.
4. **The stale-approval cron has never executed.** Zero `event.pre_expired` audit rows in the entire history, against 629 rows for the sweep that is scheduled. Its expiry clock is also wrong: `max(start_at, updated_at)` means a proposal for a future date can never expire.
5. **`propose_event_draft` is EXECUTE-granted to `authenticated`.** A signed-in manager can call it directly from the browser, bypassing the server action. It is protected today only by its own internal checks and by the events trigger.

### Not adopted

F15 (AI cost ceilings), F30 (performance budgets) and F31 (a monitoring platform) are reasonable engineering asks but are out of proportion to a 17-user internal tool with 142 events. Structured logging is added where it is cheap. F29 (accessibility) is adopted in substance: every error surface in this programme carries an icon or label plus text, focus moves to the error summary, and nothing is signalled by colour alone.

---

## 4. The work, item by item

### 4.1 AI description blocked on approved proposals (Charlotte item 4)

Two hard-coded status allowlists, both `["approved", "completed"]`: the client gate at `src/components/events/event-form.tsx:621-623` and the server gate at `src/actions/events.ts:2916-2917`. Approving a proposal moves an event to `approved_pending_details`, so the button is disabled with the message "Approve the event to enable AI generation" shown to the administrator who has just approved it.

**Contract.** One shared policy module, `src/lib/events/ai-copy-policy.ts`, mirroring the existing `src/lib/events/image-policy.ts` pattern. All nine statuses ruled on explicitly:

| Status | Generate? | Why |
|---|---|---|
| `pending_approval` | No | Not yet approved, and the form is not usable here |
| `approved_pending_details` | **Yes** | This is the client requirement |
| `draft` | **Yes** | Where an administrator completes details after approval |
| `submitted` | **Yes** | Reviewer regenerates before approving |
| `needs_revisions` | **Yes** | The revision loop is when copy gets fixed |
| `approved` | Yes | Unchanged |
| `rejected` | No | Terminal, never publishes |
| `cancelled` | No | Terminal, and generation would churn a dead event's slug |
| `completed` | Yes | Unchanged. Archive and SEO edits are legitimate |

Client and server both consume the module. `generateWebsiteCopyFromFormAction` stays ungated on status: it is the create-mode path, holds no event row and persists nothing.

**Three mandatory companions.**

1. **Overwrite guard.** `autoApproveEvent` (`src/actions/events.ts:748-781`) regenerates unconditionally on publish. Copy the `alreadyHasCopy` guard that `reviewerDecisionAction` already has at line 2065. Without it, opening the button at draft means: generate, hand-polish, publish, edits silently destroyed.
2. **Slug freeze.** Widening from two statuses to six multiplies how often generation runs, and generation writes `seo_slug`. Add `events.first_published_at timestamptz`, set by a `BEFORE INSERT OR UPDATE OF status` trigger when status first becomes approved or completed, never cleared. Freeze rule, one clause: if `first_published_at` is not null, omit `seo_slug` from the update payload entirely. Backfill 110 rows in the same migration (108 published plus 2 cancelled events still holding slugs). The 29 published rows with no slug are left alone deliberately: their URLs already carry the id, and giving them a bare slug would change what the brand site sees.
3. **Remove the bypass.** The screen-reader-only proxy submit button at `src/components/events/event-form.tsx:1944` sits outside the disabling fieldset and carries no `disabled`. Nothing consumes it. Delete it and the dead context entries.

No migration for the gate itself. No public API change: `PublicEvent.slug`, `seoSlug` and `bookingUrl` are unchanged for every existing row, and `first_published_at` is not exposed.

### 4.2 End time on the proposal form (Charlotte item 3)

`events.end_at` already exists as a nullable `timestamptz`, and the full event form already collects it as required with a three-hour auto-fill. Only the quick propose form omits it, in two places: the four-key zod schema at `src/actions/pre-event.ts:32-40`, and both proposal database functions, which hard-code `end_at` to literal `null`.

**Contract.**

1. One migration, two `CREATE OR REPLACE` statements, reading `nullif(p_payload->>'end_at','')::timestamptz`. Update both functions even though only one runs, so flipping the feature flag later cannot silently regress. `propose_event_draft` has **three** payloads to touch: the events INSERT, `event_creation_batches.batch_payload`, and the `event_versions` payload.
2. Add `endAt` to the proposal schema as required, with a refine mirroring the constraint **exactly**: `end_at > start_at`, strictly greater. Both error paths surface raw Postgres text to the user, so a `>=` refine would show a constraint violation string.
3. Add the datetime-local field with the +3h auto-fill, and feed the real end into the venue clash check, currently hardcoded `endAt: null` at `src/components/events/propose-event-form.tsx:108`.
4. Show the range in the pending list and the proposal email, with a **null-safe formatter**. `formatEventWindow` does `new Date(null)`, which is the 1970 epoch rather than an invalid date, so reusing it would email a plausible but wrong time for the two existing null rows.
5. Fix the unguarded DST throw at `src/actions/pre-event.ts:115` while in the file. It is already a live latent server-action exception on the start time alone.

Public API needs no change and should get none: it only serves approved and completed events, and a validated CHECK constraint already guarantees those have an end time (approved 65/65, completed 43/43).

### 4.3 Managers proposing events (Charlotte item 2)

One function gates everything: `src/lib/roles.ts:16-18`. The database was already built for this. Both proposal functions accept `manager`, and the production path calls `create_multi_venue_event_proposals` with the service-role key, which bypasses RLS and satisfies the write trigger. **No migration is required for the capability itself.**

**Contract: split into four capabilities.**

- `canProposeEvents(role)`: administrator or any manager. Gates `/events/propose` and `proposeEventAction`.
- `canCreateEventsDirectly(role)`: administrator only. Gates `/events/new` and the two create branches in `src/actions/events.ts`.
- `canUseEventAiTools(role)`: administrator only. Gates both LLM actions with no event context.
- `proposableVenueIds(role, userVenueId, venues)` and `canProposeForVenues(...)`: one source of truth for the venue rule, used by both the page and the server action.

Venue rules, exactly: administrator gets every venue including the internal one; a manager **with** a venue gets exactly that venue; a manager **without** a venue gets every venue except `is_internal = true`.

**The 11 call sites.**

| File:line | Becomes |
|---|---|
| `src/app/more/page.tsx:65` | `canProposeEvents` (widened) |
| `src/app/events/propose/page.tsx:19` | `canProposeEvents`, plus filter venues through `proposableVenueIds` and pass `defaultVenueId={user.venueId}`. Role-gate the "use the full event form" link, which points at an administrator-only route |
| `src/app/events/new/page.tsx:39` | `canCreateEventsDirectly` |
| `src/components/shell/app-shell.tsx:117` | `canProposeEvents` (widened). All three targets are `/events/propose` |
| `src/components/dashboard/context-cards/upcoming-events-card.tsx:48` | Split: administrators keep "New event"; managers get "Propose an event" |
| `src/components/events/events-board.tsx:232` | Split into `canCreate` (administrator only, driving the New event button, the mobile FAB and the matrix Add) and `canPropose` (driving only the Propose button). Delete the dead `createScopeVenueId` at :231 and its consumers |
| `src/actions/events.ts:852` | `canCreateEventsDirectly` |
| `src/actions/events.ts:1392` | `canCreateEventsDirectly` |
| `src/actions/events.ts:2957` | `canUseEventAiTools` |
| `src/actions/events.ts:3074` | `canUseEventAiTools` |
| `src/actions/pre-event.ts:93` | `canProposeEvents` plus the new venue check |

**Where the venue rule is enforced.** The server action is authoritative, because the live path runs under the service-role key and bypasses everything else. Add the check after the zod parse and the capability check, before either RPC branch, selecting `id, is_internal` so the internal rule can be applied. Add the same rule to both database functions as defence in depth, but do not describe the RPC check as an authorisation gate: `create_multi_venue_event_proposals` trusts `p_payload->>'created_by'`, which is only safe because the server action sets it from the session.

**UX for a locked manager:** render the single venue as a read-only line with the hidden input, not a one-option dropdown. The constraint should be readable, not inferred from a greyed control.

**Two operational items.**

- **`EVENT_SAVE_USE_RPC` must stay off, and this is now proven rather than inferred.** A read-only simulation of a manager JWT confirms `auth.role()` returns `authenticated` while `current_user_role()` returns `manager`, so the `events_require_admin_or_service_write` trigger raises, and the RPC's `exception when others` handler surfaces "Only administrators can create or edit events" straight to the user.
- **The stale-approval reaper has never run.** Zero `event.pre_expired` audit rows ever. It is absent from `vercel.json`, and `docs/Runbooks/CronMonitoring.md:12` wrongly lists it as monitored. Its clock is also wrong: `max(start_at, updated_at)` means a future-dated proposal can never expire, and it auto-rejects `approved_pending_details` rows, destroying an approval an administrator already gave. Before 13 managers start proposing into a queue cleared by 4 administrators, it needs: a schedule, chasers at 7 and 14 days before any auto-reject at 21 days, no auto-reject of already-approved work, an email to the proposer on rejection, the guarded UPDATE moved before the approvals insert, a 50-row cap, and a dry-run mode.

### 4.4 The planning form validation bug (Charlotte item 6)

1. `src/actions/planning.ts:80` and `:432`: replace `z.array(z.string().uuid())` with the lax pattern already exported from `src/lib/planning/sop.ts:26`. `normaliseSopNotRequiredTemplateIds` downstream already filters anything that does not match a real template row, so nothing is weakened.
2. Add a catch-all error region rendering any `fieldErrors` key with no matching input. **Match on a key prefix, never the literal `sopNotRequiredTemplateIds.0`**, because the array index varies with which boxes are ticked. Same on the edit shell.
3. Add the three missing field errors: the Owner select (which also lacks `aria-invalid`, unlike every sibling), the weekday fieldset, and the day-of-month input. The interval input already shows the correct pattern.
4. Guard `Number(monthday)` at line 209, which turns an empty box into 0.
5. Accessibility: focus moves to the error summary on failure, each message links to its field, typed values are preserved, and nothing is signalled by colour alone.

**Do not re-key the template ids.** 7,430 task rows reference them, plus 11 dependency rules of which 8 are hand-entered configuration not reproducible from the seed.

**Test with an id that actually fails**, for example Staffing `c0905fb6-d04d-4c4a-0fec-3dc142ac7e49`. A `gen_random_uuid()` fixture passes under the old schema and proves nothing.

### 4.5 The SOP picker on event creation (Charlotte item 5)

It is not a "choose your tasks" dropdown. It is an exclude list headed "SOP items marked N/A", every box starts unticked, and ticking one means the job does not apply. Today it appears on `/planning/new` and on `/events/new` in create mode only, buried in a 320px right rail that drops to the bottom of a very long form below 1280px. It is completely absent from `/events/propose`, which is the route the nav pushes people towards and the route managers will now use.

**Contract, given checklists stay off.**

- Add the picker to `/events/propose`. It is meaningful there because `pre_approve_event_proposal` generates in PL/pgSQL and is exempt from the kill switch. The two existing `approved_pending_details` events carry 27 live open tasks each, which is the proof.
- Persist the selection on the **event** row at propose time (a nullable `uuid[]`), so the administrator can see and adjust it at approval.
- Apply it **after** `pre_approve_event_proposal` returns, in `preApproveEventAction`, by calling the existing `markSopTemplateTasksNotRequired` helper with the planning item id from the RPC response. This is decision 19 and it is why review finding F18 does not arise: no argument is added to the RPC, no signature changes, no overload ambiguity.
- Reposition the rail on `/events/new` so it cannot be missed at laptop widths.
- Keep "tick what you do not need". Inverting means renaming the same field at five sites in `events.ts`, two in `planning.ts`, the picker, the form state and a database column, with no tests to catch a missed one.

**Deliberately not done:** switching `pre_approve_event_proposal` from the v1 to the v2 generator. It is a real improvement (v2 resolves assignee sentinels, does per-venue fan-out and skips deactivated users) but it changes what a live route produces, and it belongs with the checklist decision rather than ahead of it.

### 4.6 Dependencies (Charlotte item 7)

Roughly 80% built and running, including Charlotte's exact example. Production holds 11 template dependency rules, including Food specs blocking Allergens, Shopping list and Communication with kitchen on menu, plus Setup Event blocking 8 tasks. Those copy into 1,358 per-task edges, 256 open tasks are correctly blocked, and the blocked state is accurate in both directions. Blocked tasks show a disabled checkbox and the text "Waiting on: Food specs", which is already colourblind-safe.

**No Barons user has ever created a dependency.** The 3 Food specs rules are seed data; the 8 Setup Event rules were created by my own administrator account on 28 May 2026. Showing Charlotte the screen is a new demo, not a reminder.

**What is missing, and is the work.**

1. **Nothing tells anyone when a task becomes unblocked.** Zero occurrences of "blocked", "dependency", "prerequisite" or "unblock" across the whole notifications layer. This is the "prompt the training task" half of the request. `updateBlockedStatus` already computes the newly-unblocked set internally and discards it; returning it is a purely additive change with an existing 11-test suite to regress against. Batch per recipient and exclude the two cron sweep call sites, or completing Setup Event fans out to 8 emails at once.
2. **No cycle guard at template level.** The per-task editor has a depth-first check; the template editor has only a self-reference check. Port the existing walk. One bad entry would deadlock those tasks on every future checklist.
3. **The picker ignores dependencies.** You can mark Food specs not required while leaving its three dependents required, with no warning. **The trigger is a tick, not an untick**: warn when a prerequisite is ticked as not required while a dependent is left required. The data is already in the component.

This work is **not** blocked by the checklist decision, because 2,732 open tasks on non-event planning items are live and carry dependencies today.

Per-task dependency editing on SOP tasks stays out of scope: decision 15 confirms template-level rules are the answer.

### 4.7 Deadlines and due dates (Charlotte's question)

**The answer for the client.** Deadlines are not set task by task by a person. Every task in the master checklist carries a fixed "days before" number, and the system counts back that many calendar days from the event date or the campaign go-live date. The debrief is the only task that runs forwards: one day after.

| Days before | Tasks |
|---|---|
| 63 (9 weeks) | Setup Event |
| 56 (8 weeks) | Website, Ticketing |
| 42 (6 weeks) | Printed Material Design, Licence, H&S additional risks, Liability certificates |
| 28 (4 weeks) | Social media, Food safety info, three Zonal till tasks, Food specs, Training brief |
| 14 (2 weeks) | Crockery, Glassware, Props and decorations, Shopping list, Allergens, Proof-read menus, Staffing |
| 7 | Allocation chart, Communication with kitchen on menu, Order bar stock |
| 5 | Drinks specs |
| 3 | Set up for the event, Allocated area prep |
| +1 after | Submit post-event debrief |

Verified against all 9,665 SOP task rows with zero arithmetic drift. "Overdue" means due before today. There is exactly one email that lists tasks: the Tuesday update, capped at 10, due within 14 days, oldest first, and it never uses the word "overdue".

**The changes.**

- **Weekend nudge, prospective only** (decisions 13 and 14). Two Postgres helpers, because the two directions differ: pre-event tasks move **back** (Saturday minus 1, Sunday minus 2, both landing on Friday); the post-event debrief moves **forward** (Saturday plus 2, Sunday plus 1, both landing on Monday). Pulling the debrief back would set it due before the event happened. Four insertion points only: `generate_sop_checklist_v2`, `generate_sop_checklist` v1, `ensure_debrief_sop_task`, and `recalculate_sop_dates`.

  No existing row can change, and this is guaranteed three ways: the migration contains zero DML against `planning_tasks`; both generators are idempotent and early-return on an existing checklist; and `recalculate_sop_dates` gates the nudge on the planning item's `created_at` being at or after the deploy timestamp, so no checklist that exists today can ever acquire a nudged date.

- **Event date changes must move the deadlines.** A new `syncEventPlanningDate(eventId, newStartAt, actorId)` owns the whole behaviour, called from five places: the two `updateEventDraft` paths, the RPC branch, reschedule, and `updatePlanningItemAction`. It updates the planning item target date, calls the extended `recalculate_sop_dates`, and audits with the old and new dates. It is wrapped in try/catch at every call site: a planning resync must never block an event save.

  Dispositions, stated explicitly: completed tasks never move, because their due date is now a record of the deadline they were finished against. Manually overridden dates never move. The post-event debrief moves forwards via a new branch, closing the null-offset gap that excludes it today. Tasks the **system** closed because the event had passed are reopened when an event moves from the past into the future; tasks a **person** marked not required stay closed, because a date change does not overrule a human decision. The two are distinguishable in the data: 4,623 not-required rows have a null `completed_by` (system) against 1,978 with an actor.

- **`due_date_manually_overridden` must start being written**, at `src/lib/planning/index.ts:1038`, in the same change. Today it is false on all 9,726 rows, so the promise to respect hand-set deadlines is currently unkeepable, and the first date move would silently overwrite them.

- **London dates.** One helper in `src/lib/datetime.ts`, one SQL expression `(<ts> AT TIME ZONE 'Europe/London')::date`. Three call sites derive a planning target date from an event and all three must adopt it: `src/lib/events.ts:644`, `pre_approve_event_proposal`, and `create_multi_venue_event_drafts`. `.slice(0, 10)` on any value that came from Postgres as a timestamptz is banned; it stays legitimate only on a `datetime-local` form value. **State this as latent, not live:** zero of 142 events currently diverge, and the earliest London start time is 12:30. About ten display-only occurrences of the same mistake elsewhere are listed as a separate annex rather than folded in, including the one genuine live symptom at `src/components/planning/planning-task-list.tsx:131`, where a UTC date makes a task read as overdue in one place and not another between midnight and 1am.

- **Tuesday email:** add a lower bound to the task list and mark late items as overdue.

### 4.8 Past events disappearing (Charlotte item 1)

There is no single definition of "past" anywhere in the codebase. `/events` loads every non-deleted event with no date filter, currently 142 rows of which 103 are past. The desktop list and mobile agenda already hide past events by default; the month calendar and 7-day grid do not, though each applies its own window, so the default month view shows 12 events of which 7 are past and the grid shows none.

**One correction that matters.** "Tasks that can be actioned" is mostly not a past-events problem:

| Open overdue tasks | Count |
|---|---|
| Total | 502 |
| On something that has already happened | 25 |
| On things that have not happened yet | 477 |

Hiding past events removes about 5% of the red. The rest is genuine work on future events and campaigns whose deadline has passed, which is a real backlog rather than clutter.

**Contract, given decisions 11 and 12.**

1. Rolling lower bound of "ends more than 7 days ago" on `listEventsForUser`, applied identically to the month calendar and the 7-day grid so all three views agree.
2. A "show past" escape hatch as a server round trip or `?past=1`, so nothing becomes unfindable.
3. **Debriefs are explicitly exempt** (decision 12). Do not apply a blanket event date bound to the task queries. Define separate policies for pre-event SOP tasks, post-event debrief tasks and standalone planning tasks, keyed on the task phase or template key. `classifyTodoUrgency` already has a distinct debrief branch, so two definitions of overdue are already live and both must be respected.
4. **Fix the debrief visibility gap while here.** 11 of the 28 outstanding debriefs have both `manager_responsible_id` and `created_by` null, and the queries scope on those two fields, so they appear on nobody's dashboard. Keeping the chase means making it reach someone. Both queries are also capped at 10 and are administrator-only on the dashboard.
5. Planning board: start the "Past / Overdue" column collapsed, and tighten the today-minus-365-days window. The column is already conditional on there being past items, so it does not need removing.
6. **The dashboard needs its own query.** `src/app/page.tsx:199` feeds the same event array into `getDashboardOperationsSnapshot`, and booking pulse counts bookings by creation date across all events, not by event date. Narrowing the shared query would silently reduce "confirmed bookings this week", "tickets this week" and "net sales this month" with no error logged.

**Do not auto-complete past events** (decision 26). `getDebriefsDue` and `fetchDebriefTodos` both key on `status = 'approved'`, so flipping 28 past events to completed would make every outstanding debrief vanish silently. Also note that "Upcoming events" and "Event readiness" filter on `start_at`, not end time, so an event running right now already disappears from both cards.

### 4.9 New SOP templates (Charlotte's SOP request)

There is exactly one SOP template in the system: 8 sections, 28 tasks, applied identically to every event and every planning item. `sop_sections` and `sop_task_templates` carry no event-type, venue, series or template-set column, and the live generator's only filter is on `phase`. **An administrator cannot do this in the UI today**, and adding a "Quiz Nights" section would add those tasks to every event, every menu change and every campaign.

**What decisions 8, 9, 10, 17 and 18 mean together.**

- All four templates are deliverable, in two waves. Food Menu Change and Drinks Menu Change are planning items (decision 10) and can land as soon as the task lists arrive. Quiz Night and Live Music are events and become visible once slice 9 flips the switch (decision 17).
- **Quiz Night and Live Music need no new content.** The Communication section already contains a Social media task (T-28) and a Website task (T-56), and Georgia Cairns is already that section's sole default assignee. Decision 9 keeps the website task at 8 weeks. Those two templates are a re-scope of existing rows.
- Neither applies retrospectively. The 29 future Quiz Night and Live Music events already in the system keep whatever checklist they have.

**Approach.** Ship the application-level default map first: a map from event type or planning type to the template ids that do not apply, pre-ticking the picker. No migration, one change, and it proves the value before committing to schema. Move to proper template sets in `sop_sections` afterwards, keyed on a stable identifier rather than the free-text label, with a mandatory default fallback.

**Prerequisite, and it is not optional.** `deleteSopSectionAction` and `deleteSopTaskTemplateAction` have no guard and no usage count. The link is `ON DELETE SET NULL`, so deleting silently nulls the template reference on live tasks. **This has already happened**: ten templates were deleted on 28 May 2026 between 08:50 and 08:52, orphaning 2,290 task rows across 229 planning items, and it cannot be reconstructed. It also defeats the generator's idempotency guard, and the "backfill SOP checklists" button sits directly beneath the editor in the same panel, so delete-then-backfill is two clicks and would duplicate checklists across up to 290 items.

Decision 23: archive instead of hard delete, with `archived_at` on both tables, the generator cursor filtered on it, a `BEFORE DELETE` trigger refusing any delete of a referenced template (which aborts a section cascade too), impact counts shown in the confirmation dialog, and the backfill button made two-step with a dry run. Hard delete stays available only at zero references, which today is 0 of 28 templates and 0 of 8 sections.

**Still blocked:** the Food and Drinks Menu Change task lists. The SOP document was not attached and is not on this machine. Section 8 lists exactly what is needed.

### 4.10 Silent checklist failures (review F17)

`createPlanningItemAction` catches checklist generation errors, logs them, and still returns "Planning item created." The same pattern exists on the event create path. The item and its venue links commit before the checklist fails.

**Contract: do not make it atomic, make it loud and repair it.** The planning item is the user's typed work; the checklist is derived. Failing the save to protect a derived artefact loses real data, and true atomicity is unavailable without a rewrite, since the item insert and the SECURITY DEFINER generator are separate commits and the event path is five writes deep.

- `generateSopChecklist` returns a typed result instead of throwing, with a stage discriminator, so no caller can discard the failure with a bare try/catch.
- A `pending_sop_generation` queue table, mirroring the proven `pending_cascade_backfill` shape, with attempt counts, backoff and a dead-letter flag.
- All six call sites queue a repair row and surface a user-visible warning. Wording is plain: "Planning item created. Its task checklist could not be generated yet, it will be added automatically within the hour."
- An hourly `reconcile-sop-checklists` cron drains the queue and runs a safety-net sweep for items with no tasks at all, so a failed queue insert is not itself a silent failure.
- Item pages show an icon-plus-text banner while a repair is pending, and a different one after five failed attempts pointing at the Settings repair tool.

---

## 5. Acceptance criteria

Written as Given/When/Then so QA does not have to read code. One block per slice.

**Slice 0, planning form.**
- Given an administrator on `/planning/new` who ticks "Staffing" in the N/A panel and completes title, type and target date, When they press Add planning item, Then the item is created and the SOP task for Staffing is marked not required.
- Given any validation failure whose error key has no matching input, When the form is rejected, Then a visible summary appears near the submit button naming the problem in plain English, focus moves to it, and it is announced to a screen reader.
- Given the Recurring series tab with every weekday unticked, When submitted, Then a message appears under the weekday buttons and the form is not silently rejected.
- Given the Monthly recurrence with the day-of-month box cleared, When submitted, Then a message appears under that input.

**Slice 1, AI description.**
- Given an event at `approved_pending_details`, When an administrator opens it, Then the Generate with AI button is enabled and generation succeeds.
- Given an event at `rejected` or `cancelled`, When the server action is called directly, Then it refuses.
- Given an administrator who generates copy, edits it by hand, then publishes, Then their edits survive.
- Given a published event, When copy is regenerated, Then `seo_slug` is unchanged in the database and the suggested slug is not shown on screen.
- Given the backfill migration, Then exactly 110 rows receive a `first_published_at`.

**Slice 2, end time.**
- Given the propose form, When a start time is chosen, Then the end prefills to start plus three hours; and When submitted with no end time, Then validation fails with a field-level message.
- Given an end time equal to the start, When submitted, Then a friendly field error appears and no Postgres constraint text reaches the user.
- Given an event finishing after midnight, When proposed, Then the stored end is the following day.
- Given the two existing proposals with no end time, When the pending list and the proposal email render, Then they show "TBC" and never a 1970 date.

**Slice 3, manager proposals.**
- Given a manager with no venue, When they open `/events/propose`, Then the form renders with all venues except the internal one; and When they open `/events/new`, Then they are redirected to `/unauthorized`.
- Given a manager assigned to a venue, When they open the propose form, Then their venue is shown as a read-only line; and When they POST a different venue id directly to the server action, Then it is refused before any RPC call.
- Given a manager, When they invoke `generateWebsiteCopyFromFormAction` or `generateTermsAndConditionsAction` directly, Then both refuse.
- Given a manager proposal, When it is submitted, Then the central events leads receive the existing email and the pending queue count increases.

**Slice 5, checklist failure handling.**
- Given checklist generation fails, When the item saves, Then the user is told the checklist is still generating, a repair row is queued, and the item page shows an icon-plus-text banner.
- Given a queued repair, When the hourly job runs, Then the checklist is created using the stored not-required selection and the banner clears.
- Given five consecutive failures, Then the row is dead-lettered and the Settings panel shows the outstanding count.

**Slice 6, dates.**
- Given a new checklist whose computed due date falls on a Saturday or Sunday, Then the stored date is the preceding Friday; and Given the debrief falls on a weekend, Then it moves forward to the Monday.
- Given every task row that exists on the day of deployment, When the migration runs, Then not one due date changes.
- Given an event moved to a new date, Then open non-overridden pre-event tasks and the debrief move by the same offset, completed tasks do not move, and hand-set dates do not move.
- Given an event moved from the past into the future, Then tasks the system closed are reopened and tasks a person closed stay closed.
- Given a task whose due date a user sets by hand, Then `due_date_manually_overridden` becomes true and a later date move leaves it alone.

**Slice 7, template safety.**
- Given a task template referenced by any task, When an administrator presses delete, Then the action refuses, the button reads Archive, and the dialog states how many tasks and planning items are affected.
- Given an archived template, When a new checklist is generated, Then it is not included, and tasks already created from it are unchanged.
- Given a direct SQL delete of a referenced template, Then the database trigger aborts it.
- Given the backfill button, When pressed once, Then it shows what it would create and writes nothing.

**Slice 8, past events and debriefs.**
- Given an event that ended 8 days ago, Then it is absent from all three events views; and Given one that ended 6 days ago, Then it is present in all three.
- Given the "show past" control, Then past events are retrievable in one click.
- Given an outstanding debrief on an event that ended 30 days ago, Then it still appears on the to-do list, including for the 11 events with no named owner.
- Given the events list is narrowed, Then the dashboard booking pulse figures are unchanged.

---

## 6. Delivery plan

Slices are ordered by value per unit of risk. "Independently deployable" is claimed only where it is true.

| Slice | Content | Size | Order constraint |
|---|---|---|---|
| **0** | Planning form fix, catch-all error region, three missing field errors, two series dead ends, accessible error summary | S | None. Ship now |
| **1** | AI status allowlist, overwrite guard, `first_published_at` and slug freeze, proxy button removal | S/M | Allowlist and slug freeze must ship together, or the widened gate becomes a slug-churn machine |
| **2** | End time on the propose form, two-function migration, DST guard, null-safe email formatter | S | Migration deploys before the code that depends on it |
| **3** | Capability split, venue rule, 11 call sites, stale-approval cron fix and schedule, test inversion | M | Cron fix ships with it, not after |
| **4** | Dependency prompt when a prerequisite completes, template-level cycle guard, picker warning on ticking a prerequisite | M | None. Not blocked by the checklist decision |
| **5** | Checklist failure handling: typed result, repair queue, hourly reconciler, visible warnings | M | None |
| **6** | Weekend nudge, event date recalculation, `due_date_manually_overridden` write, London date helper | M/L | The override write must land before or with recalculation |
| **7** | Template archive and delete protection, backfill dry run, then the event-type default map | M, then M | Archive protection ships before any template work |
| **8** | Past events window, debrief visibility fix, dashboard query separation, Tuesday email overdue labels, planning board collapse | M | After decision 12 is confirmed |
| **9** | Replace the kill switch with a named flag, then switch checklists on for newly created events only | S | Needs the section owners confirmed first, or 27 tasks per event land on the wrong people |
| **10** | Event-type default map, then the four SOP templates | M | Slice 9, plus the menu-change task lists from the client |
| **Deferred** | Historic task backfill, per-event-type template sets in schema | L | Decision 18, not planned |

Slices 0, 1 and 2 are cleared to start. Slice 3 needs the venue-scope confirmation. Slice 8 needs the debrief confirmation.

---

## 7. Data changes requiring approval

1. **`events.first_published_at`** (slice 1): additive nullable column plus a backfill of 110 rows. No destructive operation. Needs a recorded before-state.
2. **`sop_sections.archived_at` and `sop_task_templates.archived_at`** (slice 7): additive nullable columns. No data rewritten.
3. **`pending_sop_generation` table** (slice 5): new table, service-role only.
4. **`events.sop_not_required_template_ids`** (slice 5 picker work): additive nullable array.

Everything else is code-only. Explicitly **no** migration in this programme moves an existing `planning_tasks.due_date`, reopens a task, or changes any event status.

---

## 8. Inputs required from the client

Five inputs are needed. Three of them block work; two are confirmations that prevent a bad outcome.

### A. The menu change task lists (blocks slice 10)

The SOP document did not arrive. For **each** of Food Menu Change and Drinks Menu Change:

1. Every task, in the order they happen.
2. Who owns each one, by name.
3. How many days before the launch date each one is due.
4. Which tasks cannot start until another one is finished, stated as pairs, for example "Training cannot start until Food specs is done".
5. Whether the checklist is the same for every venue, or differs by venue type.
6. Whether anything happens after the launch date, and how many days after.

A good pattern already exists to copy: Food specs, then Shopping list, Allergens and Proof-read menus.

### B. Confirm the section owners (blocks slice 9)

When the switch is flipped, every new event raises about 27 tasks against these people. These are the current owners, and whoever is listed against a section receives every task in it:

| Section | Tasks | Currently goes to |
|---|---|---|
| Details of the Event | 1 | Helen Pillinger |
| Communication | 4 | Georgia Cairns |
| Compliance | 4 | Brock Evans, Harry Smith |
| Systems | 3 | Joe Edwards |
| Purchasing | 3 | Heidi Athroll |
| Food Development | 4 | Vera Neale |
| Operations | 7 | Chris Porter, Daniel Daniss, Neil Perks |
| Training | 2 | Mollie Harris, Tom Ruffell |

The switch must not be flipped until this list is confirmed or corrected.

### C. Quiz Night and Live Music scope: ANSWERED 2026-08-25

Settled by decisions 8, 29 and 30. The template is the social media task plus the post-event debrief, and Acoustic Music uses the same one. No further client input needed.

### D. Debrief ownership: ANSWERED 2026-08-25

Decision 28. Owned by the venue's manager, falling back to Helen Pillinger where a venue has no manager. No further client input needed.

### E. Venue assignments for managers: DEFERRED by Peter, 2026-08-25

To be defined once the wider team is using the tool regularly. Natalie Thewlis is the only venue manager onboarded so far.

Consequence to carry into slice 3: 12 of 13 manager accounts have no venue, so the venue rule in decision 4 binds exactly one person today, and that person is Natalie. Her record points at "Meade Hall at The Crown & Cushion", which is a room inside the pub rather than the pub itself, so as things stand she could propose for the Meade Hall only. Correcting that is a one-row change whenever the assignments are defined.

### Not an input, but Charlotte should be told

- Events she has already added keep their empty checklists. Only events created after the switch get a live task list, so her September events will behave differently depending on when they were created.
- The two proposals stuck since 1 June are being cancelled (decision 27).

---

## 9. Test position

The codebase has 105 Vitest files and coverage is dense, not sparse. The problem is different from what v1 said: several suites **pin today's defective behaviour** and must be edited deliberately, not supplemented.

**Well covered:** roles and RBAC (`rbac.test.ts`, 925 lines), proposals (`pre-event.test.ts`, 341 lines, 12 cases), the weekly email (`weekly-digest.test.ts`, 1,170 lines), SOP dependency unblocking (11 cases), SOP generation plumbing, event listing, planning pure functions, cron auth.

**Real gaps:** the propose form UI (2 cases, neither about required fields), end time (nothing anywhere), weekend deadlines (no logic yet), the unblock prompt (11 tests on the flag, zero on notifying anyone), the kill switch itself (4 tests pin dates that can no longer occur), the stale-approval reaper (no test file), planning server actions (no coverage at all), and the dashboard (2 cases, both about join shape).

**Tests that must be edited, intentionally.** Flag these in the PR description so nobody "fixes" them by reverting the feature: `rbac.test.ts:779-780` (manager can now propose), `pre-event.test.ts:69, 189, 205` (three manager-rejection cases become acceptance cases), and `sop-generate.test.ts:137-152` (four cases should assert a named flag rather than the June dates).

**Layers to add:** real Supabase RLS and RPC tests for the venue rule (unit mocks cannot prove service-role authorisation), a clean `supabase db reset` plus an upgrade-path migration test, and an `it.each` over all nine statuses for the AI policy module.

---

## 10. Evidence appendix

Read-only, against project `shofawaztmdxytukhozo`. Values are as at 2026-08-24. Re-run before any deployment. Figures marked (moves) are time-relative.

```sql
-- E1. Events by status, and how many are soft-deleted.
-- approved 65 | completed 45 (43 live) | rejected 23 | draft 10 (7 live)
-- | approved_pending_details 2 | cancelled 2
SELECT status, count(*) AS n, count(*) FILTER (WHERE deleted_at IS NULL) AS live
FROM public.events GROUP BY status ORDER BY n DESC;

-- E2. Live / past / future events. -> 142 live, 103 past, 39 future (moves)
SELECT count(*) FILTER (WHERE deleted_at IS NULL)                       AS events_live,
       count(*) FILTER (WHERE deleted_at IS NULL AND start_at <  now()) AS past_events,
       count(*) FILTER (WHERE deleted_at IS NULL AND start_at >= now()) AS future_events
FROM public.events;

-- E3. Users by role and venue assignment.
-- manager 13 (1 with venue, 12 without, 0 deactivated); administrator 4 (0 with venue)
SELECT role, count(*) AS n,
       count(*) FILTER (WHERE venue_id IS NOT NULL)       AS with_venue,
       count(*) FILTER (WHERE venue_id IS NULL)           AS without_venue,
       count(*) FILTER (WHERE deactivated_at IS NOT NULL) AS deactivated
FROM public.users GROUP BY role ORDER BY n DESC;

-- E4. Who actually creates events. -> administrator 126, manager 0
SELECT u.role, count(*) AS events_created
FROM public.events e JOIN public.users u ON u.id = e.created_by
GROUP BY u.role ORDER BY events_created DESC;

-- E5. Proposal lifecycle audit trail.
-- event.pre_approved 4 | event.proposed 2 | event.pre_rejected 1 | event.pre_expired 0
SELECT action, count(*) AS n, min(created_at) AS first_seen, max(created_at) AS last_seen
FROM public.audit_log
WHERE action IN ('event.proposed','event.pre_approved','event.pre_rejected','event.pre_expired')
GROUP BY action ORDER BY n DESC;

-- E6. PROOF the stale-approval reaper has never run. -> 0
SELECT count(*) AS pre_expired_events FROM public.audit_log WHERE action = 'event.pre_expired';

-- E7. PROOF the scheduled SOP sweep IS running. -> 629, last 2026-08-22 07:45
SELECT count(*) AS n, max(created_at) AS last_seen
FROM public.audit_log WHERE action = 'planning_task.auto_not_required';

-- E8. The proposals the reaper would wrongly skip: future-dated, long untouched.
-- -> approved_pending_details, 2 rows, earliest start 2026-09-05, last touched 2026-06-01
SELECT status, count(*) AS n, min(start_at) AS earliest_start, max(updated_at) AS last_touched
FROM public.events
WHERE status IN ('pending_approval','approved_pending_details') AND deleted_at IS NULL
GROUP BY status;

-- E9. SOP template ids that fail zod 4's uuid pattern. -> total 28, fail 20
SELECT count(*) AS total,
       count(*) FILTER (WHERE id::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') AS fail_zod4
FROM public.sop_task_templates;

-- E10. SOP structure. -> sections 8, templates 28, dependency rules 11
SELECT (SELECT count(*) FROM public.sop_sections)          AS sop_sections,
       (SELECT count(*) FROM public.sop_task_templates)    AS sop_templates,
       (SELECT count(*) FROM public.sop_task_dependencies) AS sop_dependencies;

-- E11. Planning task totals, overdue and weekend counts.
-- total 9726 | open 2810 | not_required 6601 | done 315
-- open_overdue 502 | open_weekend_due 600 | from_sop_template 7430
SELECT count(*) AS total,
       count(*) FILTER (WHERE status='open')         AS open_tasks,
       count(*) FILTER (WHERE status='not_required') AS not_required_tasks,
       count(*) FILTER (WHERE status='done')         AS done_tasks,
       count(*) FILTER (WHERE status='open' AND due_date < current_date) AS open_overdue,
       count(*) FILTER (WHERE status='open' AND extract(isodow from due_date) IN (6,7)) AS open_weekend_due,
       count(*) FILTER (WHERE sop_template_task_id IS NOT NULL)          AS from_sop_template
FROM public.planning_tasks;

-- E12. Overdue split: past subjects vs things that have not happened yet.
-- -> 502 total | 25 on past subjects | 477 not yet happened (moves)
SELECT count(*) AS open_overdue_total,
       count(*) FILTER (WHERE pi.event_id IS NOT NULL AND e.start_at <  now()) AS overdue_on_past_events,
       count(*) FILTER (WHERE NOT (pi.event_id IS NOT NULL AND e.start_at < now())) AS overdue_not_yet_happened
FROM public.planning_tasks pt
JOIN public.planning_items pi ON pi.id = pt.planning_item_id
LEFT JOIN public.events e     ON e.id  = pi.event_id
WHERE pt.status='open' AND pt.due_date < current_date;

-- E13. The kill switch, measured. Events vs non-events.
-- open_future_event 55 | open_non_event 2732 | not_required_event 4454
SELECT count(*) FILTER (WHERE pi.event_id IS NOT NULL AND e.start_at >= now() AND pt.status='open') AS open_future_event_tasks,
       count(*) FILTER (WHERE pi.event_id IS NULL     AND pt.status='open')         AS open_non_event_tasks,
       count(*) FILTER (WHERE pi.event_id IS NOT NULL AND pt.status='not_required') AS not_required_event_tasks
FROM public.planning_tasks pt
JOIN public.planning_items pi ON pi.id = pt.planning_item_id
LEFT JOIN public.events e     ON e.id  = pi.event_id;

-- E14. The dead manual-create path. -> standalone_last_60d 0, event_linked_last_60d 30
SELECT count(*) FILTER (WHERE event_id IS NULL)     AS items_standalone,
       count(*) FILTER (WHERE event_id IS NOT NULL) AS items_event_linked,
       count(*) FILTER (WHERE event_id IS NULL     AND created_at >= now() - interval '60 days') AS standalone_created_last_60d,
       count(*) FILTER (WHERE event_id IS NOT NULL AND created_at >= now() - interval '60 days') AS event_linked_created_last_60d
FROM public.planning_items;

-- E15. The 28 May template deletion and its orphans. -> 10 deletions, 2290 orphaned tasks
SELECT (SELECT count(*) FROM public.audit_log WHERE action='sop_task_template.deleted') AS templates_deleted,
       (SELECT count(*) FROM public.planning_tasks WHERE sop_template_task_id IS NULL)  AS tasks_without_template;

-- E16. Not-required attribution: system versus a person.
-- -> completed_by null 4623 (system), non-null 1978 (human)
SELECT count(*) FILTER (WHERE completed_by IS NULL)     AS system_marked,
       count(*) FILTER (WHERE completed_by IS NOT NULL) AS human_marked
FROM public.planning_tasks WHERE status='not_required';

-- E17. Hand-set deadlines. -> 0, which is why the override flag is unkeepable today
SELECT count(*) AS manually_overridden FROM public.planning_tasks WHERE due_date_manually_overridden;

-- E18. Debriefs, and the ones nobody can see.
-- -> submitted 0 | outstanding 28 | invisible to everyone 11
SELECT (SELECT count(*) FROM public.debriefs) AS debriefs_submitted,
       count(*) AS outstanding,
       count(*) FILTER (WHERE e.manager_responsible_id IS NULL AND e.created_by IS NULL) AS invisible_to_everyone
FROM public.events e LEFT JOIN public.debriefs d ON d.event_id = e.id
WHERE e.deleted_at IS NULL AND e.status='approved' AND e.end_at < now() AND d.id IS NULL;

-- E19. End-time integrity on public-API-visible statuses.
-- -> approved 65/65 and completed 43/43 have a non-null end_at
SELECT status, count(*) AS total, count(*) FILTER (WHERE end_at IS NOT NULL) AS with_end_at
FROM public.events WHERE status IN ('approved','completed') AND deleted_at IS NULL
GROUP BY status;

-- E20. Open tasks on the two approved-pending-details events, proving the
-- propose route is exempt from the kill switch. -> 54, i.e. 27 per event
SELECT count(*) AS open_tasks_on_apd_events
FROM public.planning_tasks pt
JOIN public.planning_items pi ON pi.id = pt.planning_item_id
JOIN public.events e          ON e.id  = pi.event_id
WHERE e.status = 'approved_pending_details' AND pt.status = 'open';
```

---

## 11. Out of scope

- Switching event checklists back on, and any historic task backfill (decisions 17 and 18).
- Auto-completing past events.
- Managers editing or completing events after approval (decision 5).
- Any change to `src/lib/public-api` or `/api/v1`.
- True working-day arithmetic. The weekend nudge is the agreed substitute; bank holidays are knowingly ignored.
- Enabling `EVENT_SAVE_USE_RPC`, which is additionally blocked on a trigger change.
- Recurring series, which have never run against real data.
- Reconnecting the 2,290 tasks orphaned on 28 May 2026. Left as they are, consistent with decision 18.
- Two orphaned booking function overloads left by an earlier migration, logged as separate tech debt.
