# Claude Hand-Off Brief: RBAC Renovation Spec

**Generated:** 2026-04-15
**Review mode:** Spec Compliance (Mode C)
**Overall risk assessment:** Critical — spec is not safe to implement as written

## DO NOT REWRITE

These decisions are sound and should be preserved:
- Using `public.users.role` text column + check constraint (no enum redesign needed)
- central_planner → administrator as a clean 1:1 rename
- executive role unchanged
- Public API and cron routes excluded (they use API key / bearer secret auth)
- Centralising permission logic in roles.ts capability functions
- 5-section navigation layout with declarative role-array filtering
- Events nav section hidden from non-administrators
- Opening Hours moved to Administration

## SPEC REVISION REQUIRED

- [ ] **SPEC-01: Add compatibility-first deployment strategy.** The spec currently says Phase 1 deploys DB migration + types together. Revise to: Phase 0 deploys code that accepts BOTH old and new role strings in `normalizeRole()`, UserRole union, and all 47 consumer files. Phase 1 then runs the DB migration safely. Phase 2 removes old-string support. This prevents the auth lockout on deployment.

- [ ] **SPEC-02: Define office_worker security scope.** The spec merges venue_manager (venue-scoped) and reviewer (global-read) into office_worker without defining the resulting scope. The spec must state: does office_worker get venue-scoped access (via venue_id), global read access, or something else? This is a product decision that affects RLS policy design. Current spec creates a cross-venue data exposure vulnerability.

- [ ] **SPEC-03: Redesign debrief access model.** Current debriefs use upsert (create and edit are the same DB operation). The spec's "create but not edit" for executive is unimplementable. Options: (a) change debriefs to separate INSERT + UPDATE with immutable `created_by` column, (b) restrict debrief create to admin + office_worker only, (c) allow executive to edit their own. Also, "creator" must be defined — event creator or debrief submitter?

- [ ] **SPEC-04: Define reviewer workflow replacement.** The spec removes the reviewer role but does not replace: `default_reviewer_id` on venues, auto-assignment of submitted events to reviewers, the review queue page, reviewer lookup queries in `src/lib/reviewers.ts`. The spec must define: who reviews events now? Is it admin-only? Does `default_reviewer_id` become `default_admin_id`? What about pending approvals at migration time?

- [ ] **SPEC-05: Define venue_id handling for office_worker.** venue_manager has venue_id set; reviewer has NULL venue_id. After merge, office_worker may or may not have venue_id. The spec must state: (a) is venue_id retained on the user record, (b) do venue-scoped queries still use it, (c) what happens to former-reviewer office_workers with NULL venue_id.

- [ ] **SPEC-06: Specify planning permissions fully.** The spec says office_worker can "create planning items" and admin can "manage". Missing: can office_worker edit/delete their OWN planning items and tasks? What RLS changes are needed (currently central_planner-only)? How does the planning board UI show/hide mutation controls per role? Current board shows creation UI unconditionally.

- [ ] **SPEC-07: Move notification logic into scope.** `src/lib/notifications.ts:629` and `:711` hardcode `central_planner` for recipient lookup queries. These will silently fail after rename. This is not a feature change — it's breakage that must be fixed in the migration.

- [ ] **SPEC-08: Update scope estimate.** Change "~23 pages" to "47 non-test src/ files" including components (users-manager, event-form, events-board, planning-board), lib helpers (reviewers, users, notifications, events, customers), and server actions. Only 17 are page routes.

- [ ] **SPEC-09: Replace typecheck safety claim.** typecheck only catches ~10-15 files that use the UserRole type directly. Add mandatory grep verification: `grep -rn "central_planner\|venue_manager\|reviewer" src/ supabase/` as a pre-merge gate alongside typecheck, lint, and build.

- [ ] **SPEC-10: Fix seed.sql sequencing.** Move seed.sql update from Phase 4 to Phase 1 (same PR as the check constraint change). Otherwise `supabase db reset` breaks immediately.

- [ ] **SPEC-11: Remove or qualify reversibility claim.** The migration merges two roles into one — there's no way to deterministically restore which office_worker was formerly a reviewer vs venue_manager. Either add a `previous_role` audit column, or acknowledge this is a one-way migration.

- [ ] **SPEC-12: Acknowledge venue_manager write-access removal.** Current venue_managers can create/edit events, manage bookings, customers, and artists. After migration to office_worker, they lose ALL write access to these areas. If intentional, the spec should say so explicitly. If not, the capability matrix needs revision.

- [ ] **SPEC-13: Add admin-client bypass audit to scope.** Planning loader, bookings, customers, and all-bookings lib files use service-role client (bypass RLS). These are not covered by "update all server actions" — they're in src/lib/. Must be audited and updated.

- [ ] **SPEC-14: Add session invalidation step.** After DB migration, force session invalidation so users get fresh tokens with new role strings. This prevents JWT/DB split-brain in the `current_user_role()` SQL fallback path.

- [ ] **SPEC-15: Add pending work migration step.** Events in "submitted" status with reviewer assignments need to be reassigned to an administrator. Venue manager draft events need owner clarity.

## ASSUMPTIONS TO RESOLVE

- [ ] **A-01: office_worker read scope** — Should former venue_managers see only their venue's data, or all venues? → Ask Peter. If venue-scoped: keep venue_id semantics. If global: explicitly design new RLS. This is the single most important product decision.

- [ ] **A-02: Executive debrief participation** — Can executives create debriefs? The spec says yes but also says executive is "read-only observer". → Ask Peter. If no: simplify to admin + office_worker create. If yes: need schema changes to separate create from edit.

- [ ] **A-03: Planning item self-management** — Can office_worker edit/delete their own planning items, or only create new ones? → Ask Peter. If yes: need owner-based capability and RLS. If no: office_worker creates items that only admin can modify (unusual UX).

- [ ] **A-04: Venue_manager write-access removal confirmation** — Is it intentional that former venue_managers lose ALL event/booking/customer write access? → Ask Peter. This is a significant operational change.

## REPO CONVENTIONS TO PRESERVE

- Role is stored in `public.users.role` (text column, not app_metadata)
- `getCurrentUser()` is the single auth entry point — never bypass it
- Capability functions in `src/lib/roles.ts` — use these, not inline role checks
- Navigation filtering via `item.roles.includes(user.role)` in app-shell
- Admin client usage pattern: service-role for system operations, anon-key for user-scoped
- Server actions pattern: getUser → permission check → business logic → audit log → revalidate
- Conventional commits, one concern per PR

## RE-REVIEW REQUIRED AFTER FIXES

- [ ] CR-002: Re-review RLS policies after office_worker scope decision
- [ ] CR-003: Re-review debrief schema after create/edit separation design
- [ ] SD-001: Re-review reviewer workflow after replacement is designed
- [ ] AI-001: Re-review admin-client paths after bypass audit
- [ ] SEC-004: Re-review session handling after invalidation strategy defined

## REVISION PROMPT

You are revising the RBAC renovation spec based on an adversarial review that found 3 critical risks, 5 high-severity spec defects, and several implementation gaps.

Before making ANY code changes, apply these spec revisions in order:

1. **Get product decisions** from the user on:
   - office_worker read scope: venue-scoped or global? (A-01)
   - Executive debrief access: create or read-only? (A-02)
   - Planning self-management: office_worker edit own items? (A-03)
   - Venue_manager write removal: intentional? (A-04)

2. **Revise the spec** to address SPEC-01 through SPEC-15:
   - Add compatibility-first deployment (SPEC-01)
   - Define office_worker scope based on A-01 answer (SPEC-02)
   - Redesign debrief model based on A-02 answer (SPEC-03)
   - Define reviewer workflow replacement (SPEC-04)
   - Define venue_id handling (SPEC-05)
   - Specify planning permissions fully (SPEC-06)
   - Move notifications into scope (SPEC-07)
   - Update scope to 47 files (SPEC-08)
   - Add grep verification (SPEC-09)
   - Fix seed sequencing (SPEC-10)
   - Fix reversibility claim (SPEC-11)
   - Acknowledge VM write removal (SPEC-12)
   - Add admin-client audit (SPEC-13)
   - Add session invalidation (SPEC-14)
   - Add pending work migration (SPEC-15)

3. **Preserve these decisions** — do not change:
   - text column approach, admin mapping, executive unchanged
   - Public API / cron exclusion
   - Capability function architecture
   - 5-section nav layout

4. **After revisions, request re-review** of:
   - RLS policy design for new office_worker scope
   - Debrief schema changes
   - Reviewer workflow replacement
   - Admin-client bypass paths

After applying changes, confirm:
- [ ] All 15 spec revisions applied
- [ ] All 4 product decisions resolved
- [ ] No sound decisions were overwritten
- [ ] Phase boundaries redesigned around compatibility-first deployment
- [ ] Scope reflects full 47-file surface
