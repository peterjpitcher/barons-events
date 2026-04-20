# Review Pack: office-worker-propose-edit-scope-spec

**Generated:** 2026-04-18
**Mode:** A (A=Adversarial / B=Code / C=Spec Compliance)
**Project root:** `/Users/peterpitcher/Cursor/BARONS-BaronsHub`
**Base ref:** `HEAD`
**HEAD:** `b72820e`
**Diff range:** `HEAD`

> This pack is the sole input for reviewers. Do NOT read files outside it unless a specific finding requires verification. If a file not in the pack is needed, mark the finding `Needs verification` and describe what would resolve it.

## Changed Files

_(none detected for this diff range)_

## User Concerns

Spec for splitting canManageEvents into canProposeEvents + canEditEvent; loosening office_worker propose rights (any venue); tightening office_worker edit rights to (event.venue_id == user.venue_id AND event.manager_responsible_id == user.id); loosening SELECT RLS to global for all three roles; tightening UPDATE RLS to require manager_responsible_id match. Review the spec at docs/superpowers/specs/2026-04-18-office-worker-propose-and-edit-scope-design.md for correctness, completeness, codebase fit, RLS safety, regression risk, and whether the proposed capability split handles all call-sites correctly.

## Diff (`HEAD`)

_(no diff output)_

## Changed File Contents

_(no files to include)_
## Related Files (grep hints)

_(no related files found by basename grep)_

## Workspace Conventions (`Cursor/CLAUDE.md`)

```markdown
# CLAUDE.md — Workspace Standards

Shared guidance for Claude Code across all projects. Project-level `CLAUDE.md` files take precedence over this one — always read them first.

## Default Stack

Next.js 15 App Router, React 19, TypeScript (strict), Tailwind CSS, Supabase (PostgreSQL + Auth + RLS), deployed on Vercel.

## Workspace Architecture

21 projects across three brands, plus shared tooling:

| Prefix | Brand | Examples |
|--------|-------|----------|
| `OJ-` | Orange Jelly | AnchorManagementTools, CheersAI2.0, Planner2.0, MusicBingo, CashBingo, QuizNight, The-Anchor.pub, DukesHeadLeatherhead.com, OrangeJelly.co.uk, WhatsAppVideoCreator |
| `GMI-` | GMI | MixerAI2.0 (canonical auth reference), TheCookbook, ThePantry |
| `BARONS-` | Barons | CareerHub, EventHub, BrunchLaunchAtTheStar, StPatricksDay, DigitalExperienceMockUp, WebsiteContent |
| (none) | Shared / test | Test, oj-planner-app |

## Core Principles

**How to think:**
- **Simplicity First** — make every change as simple as possible; minimal code impact
- **No Laziness** — find root causes; no temporary fixes; senior developer standards
- **Minimal Impact** — only touch what's necessary; avoid introducing bugs

**How to act:**
1. **Do ONLY what is asked** — no unsolicited improvements
2. **Ask ONE clarifying question maximum** — if unclear, proceed with safest minimal implementation
3. **Record EVERY assumption** — document in PR/commit messages
4. **One concern per changeset** — if a second concern emerges, park it
5. **Fail safely** — when in doubt, stop and request human approval

### Source of Truth Hierarchy

1. Project-level CLAUDE.md
2. Explicit task instructions
3. Existing code patterns in the project
4. This workspace CLAUDE.md
5. Industry best practices / framework defaults

## Ethics & Safety

AI MUST stop and request explicit approval before:
- Any operation that could DELETE user data or drop DB columns/tables
- Disabling authentication/authorisation or removing encryption
- Logging, sending, or storing PII in new locations
- Changes that could cause >1 minute downtime
- Using GPL/AGPL code in proprietary projects

## Communication

- When the user asks to "remove" or "clean up" something, clarify whether they mean a code change or a database/data cleanup before proceeding
- Ask ONE clarifying question maximum — if still unclear, proceed with the safest interpretation

## Debugging & Bug Fixes

- When fixing bugs, check the ENTIRE application for related issues, not just the reported area — ask: "Are there other places this same pattern exists?"
- When given a bug report: just fix it — don't ask for hand-holding
- Point at logs, errors, failing tests — then resolve them
- Zero context switching required from the user

## Code Changes

- Before suggesting new environment variables or database columns, check existing ones first — use `grep` to find existing env vars and inspect the current schema before proposing additions
- One logical change per commit; one concern per changeset

## Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- One task per subagent for focused execution

### 3. Task Tracking
- Write plan to `tasks/todo.md` with checkable items before starting
- Mark items complete as you go; document results when done

### 4. Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules that prevent the same mistake; review lessons at session start

### 5. Verification Before Done
- Never mark a task complete without proving it works
- Run tests, check logs, demonstrate correctness
- Ask yourself: "Would a staff engineer approve this?"
- For non-trivial changes: pause and ask "is there a more elegant way?"

### 6. Codex Integration Hook
Uses OpenAI Codex CLI to audit, test and simulate — catches what Claude misses.

```
when: "running tests OR auditing OR simulating"
do:
  - run_skill(codex-review, target=current_task)
  - compare_outputs(claude_result, codex_result)
  - flag_discrepancies(threshold=medium)
  - merge_best_solution()
```

The full multi-specialist QA review skill lives in `~/.claude/skills/codex-qa-review/`. Trigger with "QA review", "codex review", "second opinion", or "check my work". Deploys four specialist agents (Bug Hunter, Security Auditor, Performance Analyst, Standards Enforcer) into a single prioritised report.

## Common Commands

```bash
npm run dev       # Start development server
npm run build     # Production build
npm run lint      # ESLint (zero warnings enforced)
npm test          # Run tests (Vitest unless noted otherwise)
npm run typecheck # TypeScript type checking (npx tsc --noEmit)
npx supabase db push   # Apply pending migrations (Supabase projects)
```

## Coding Standards

### TypeScript
- No `any` types unless absolutely justified with a comment
- Explicit return types on all exported functions
- Props interfaces must be named (not inline anonymous objects for complex props)
- Use `Promise<{ success?: boolean; error?: string }>` for server action return types

### Frontend / Styling
- Use design tokens only — no hardcoded hex colours in components
- Always consider responsive breakpoints (`sm:`, `md:`, `lg:`)
- No conflicting or redundant class combinations
- Design tokens should live in `globals.css` via `@theme inline` (Tailwind v4) or `tailwind.config.ts`
- **Never use dynamic Tailwind class construction** (e.g., `bg-${color}-500`) — always use static, complete class names due to Tailwind's purge behaviour

### Date Handling
- Always use the project's `dateUtils` (typically `src/lib/dateUtils.ts`) for display
- Never use raw `new Date()` or `.toISOString()` for user-facing dates
- Default timezone: Europe/London
- Key utilities: `getTodayIsoDate()`, `toLocalIsoDate()`, `formatDateInLondon()`

### Phone Numbers
- Always normalise to E.164 format (`+44...`) using `libphonenumber-js`

## Server Actions Pattern

All mutations use `'use server'` functions (typically in `src/app/actions/` or `src/actions/`):

```typescript
'use server';
export async function doSomething(params): Promise<{ success?: boolean; error?: string }> {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Unauthorized' };
  // ... permission check, business logic, audit log ...
  revalidatePath('/path');
  return { success: true };
}
```

## Database / Supabase

See `.claude/rules/supabase.md` for detailed patterns. Key rules:
- DB columns are `snake_case`; TypeScript types are `camelCase`
- Always wrap DB results with a conversion helper (e.g. `fromDb<T>()`)
- RLS is always on — use service role client only for system/cron operations
- Two client patterns: cookie-based auth client and service-role admin client

### Before Any Database Work
Before making changes to queries, migrations, server actions, or any code that touches the database, query the live schema for all tables involved:
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name IN ('relevant_table') ORDER BY ordinal_position;
```
Also check for views referencing those tables — they will break silently if columns change:
```sql
SELECT table_name FROM information_schema.view_table_usage
WHERE table_name IN ('relevant_table');
```

### Migrations
- Always verify migrations don't conflict with existing timestamps
- Test the connection string works before pushing
- PostgreSQL views freeze their column lists — if underlying tables change, views must be recreated
- Never run destructive migrations (DROP COLUMN/TABLE) without explicit approval

## Git Conventions

See `.claude/rules/pr-and-git-standards.md` for full PR templates, branch naming, and reviewer checklists. Key rules:
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`
- Never force-push to `main`
- One logical change per commit
- Meaningful commit messages explaining "why" not just "what"

## Rules Reference

Core rules (always loaded from `.claude/rules/`):

| File | Read when… |
|------|-----------|
| `ui-patterns.md` | Building or modifying UI components, forms, buttons, navigation, or accessibility |
| `testing.md` | Adding, modifying, or debugging tests; setting up test infrastructure |
| `definition-of-ready.md` | Starting any new feature — check requirements are clear before coding |
| `definition-of-done.md` | Finishing any feature — verify all quality gates pass |
| `complexity-and-incremental-dev.md` | Scoping a task that touches 4+ files or involves schema changes |
| `pr-and-git-standards.md` | Creating branches, writing commit messages, or opening PRs |
| `verification-pipeline.md` | Before pushing — run the full lint → typecheck → test → build pipeline |
| `supabase.md` | Any database query, migration, RLS policy, or client usage |

Domain rules (auto-injected from `.claude/docs/` when you edit relevant files):

| File | Domain |
|------|--------|
| `auth-standard.md` | Auth, sessions, middleware, RBAC, CSRF, password reset, invites |
| `background-jobs.md` | Async job queues, Vercel Cron, retry logic |
| `api-key-auth.md` | External API key generation, validation, rotation |
| `file-export.md` | PDF, DOCX, CSV generation and download |
| `rate-limiting.md` | Upstash rate limiting, 429 responses |
| `qr-codes.md` | QR code generation (client + server) |
| `toast-notifications.md` | Sonner toast patterns |
| `email-notifications.md` | Resend email, templates, audit logging |
| `ai-llm.md` | LLM client, prompts, token tracking, vision |
| `payment-processing.md` | Stripe/PayPal two-phase payment flows |
| `data-tables.md` | TanStack React Table v8 patterns |

## Quality Gates

A feature is only complete when it passes the full Definition of Done checklist (`.claude/rules/definition-of-done.md`). At minimum: builds, lints, type-checks, tests pass, no hardcoded secrets, auth checks in place, code commented where complex.
```

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

## Rule: `/Users/peterpitcher/Cursor/.claude/rules/definition-of-done.md`

```markdown
# Definition of Done (DoD)

A feature is ONLY complete when ALL applicable items pass. This extends the Quality Gates in the root CLAUDE.md.

## Code Quality

- [ ] Builds successfully — `npm run build` with zero errors
- [ ] Linting passes — `npm run lint` with zero warnings
- [ ] Type checks pass — `npx tsc --noEmit` clean (or project equivalent)
- [ ] No `any` types unless justified with a comment
- [ ] No hardcoded secrets or API keys
- [ ] No hardcoded hex colours — use design tokens
- [ ] Server action return types explicitly typed

## Testing

- [ ] All existing tests pass
- [ ] New tests written for business logic (happy path + at least 1 error case)
- [ ] Coverage meets project minimum (default: 80% on business logic)
- [ ] External services mocked — never hit real APIs in tests
- [ ] If no test suite exists yet, note this in the PR as tech debt

## Security

- [ ] Auth checks in place — server actions re-verify server-side
- [ ] Permission checks present — RBAC enforced on both UI and server
- [ ] Input validation complete — all user inputs sanitised (Zod or equivalent)
- [ ] No new PII logging, sending, or storing without approval
- [ ] RLS verified (Supabase projects) — queries respect row-level security

## Accessibility

- [ ] Interactive elements have visible focus styles
- [ ] Colour is not the sole indicator of state
- [ ] Modal dialogs trap focus and close on Escape
- [ ] Tables have proper `<thead>`, `<th scope>` markup
- [ ] Images have meaningful `alt` text
- [ ] Keyboard navigation works for all interactive elements

## Documentation

- [ ] Complex logic commented — future developers can understand "why"
- [ ] README updated if new setup, config, or env vars are needed
- [ ] Environment variables documented in `.env.example`
- [ ] Breaking changes noted in PR description

## Deployment

- [ ] Database migrations tested locally before pushing
- [ ] Rollback plan documented for schema changes
- [ ] No console.log or debug statements left in production code
- [ ] Verification pipeline passes (see `verification-pipeline.md`)
```

---

_End of pack._

---

# SUPPLEMENTAL: The spec under review

The file below is the spec being challenged. It is untracked in git but is the primary artefact for review.

## File: docs/superpowers/specs/2026-04-18-office-worker-propose-and-edit-scope-design.md

```markdown
# Office Worker — Propose Rights & Per-Event Edit Scope

**Date:** 2026-04-18
**Status:** Draft — awaiting approval
**Scope:** Split the single `canManageEvents` capability into `canProposeEvents` + `canEditEvent`, loosen office_worker propose rights (any venue), and tighten office_worker edit rights (own venue AND listed as `manager_responsible_id`). Includes RLS, server-action, UI, and test updates.

## Problem

Today an office_worker **without a `venue_id`** cannot propose events at all: the `/events/propose` page and the `submitEventAction` path both gate on `canManageEvents(role, venueId)`, which returns `false` for `office_worker` + `null` venue. The user reports this as a regression from the intent that *any* office_worker should be able to raise a proposal for *any* venue, letting an administrator triage and approve.

At the same time, an office_worker **with a `venue_id`** can currently edit every event at that venue, regardless of whether they are the named `manager_responsible_id`. Business rule: they should only be able to edit events they are personally responsible for (manager_responsible_id) at their own venue.

Visibility is separately under-scoped: an office_worker with a `venue_id` can only see events at their own venue (plus ones they created/were assigned). The business rule is that all office_workers should be able to see all events for planning awareness.

## Current State (verified)

| Layer | File | Current rule |
|------|------|---------|
| Role helpers | [src/lib/roles.ts:21](src/lib/roles.ts:21) | `canManageEvents(role, venueId)` — admin always; office_worker requires `venueId` |
| Propose page | [src/app/events/propose/page.tsx:18](src/app/events/propose/page.tsx:18) | Gated on `canManageEvents(user.role, user.venueId)` — redirects office_worker without venueId to `/unauthorized` |
| Propose action | [src/actions/pre-event.ts:37](src/actions/pre-event.ts:37) | Only checks `if (!user)` — no capability check at all |
| Full event form page | [src/app/events/new/page.tsx:37](src/app/events/new/page.tsx:37) | `canManageEvents(user.role, user.venueId)` |
| Edit/update actions | [src/actions/events.ts](src/actions/events.ts) lines 614, 1027, 1635, 1731, 1856, 2022 | `canManageEvents(user.role, user.venueId)` — venue-scoped but not manager-responsible-scoped |
| SELECT RLS | [supabase/migrations/20260415180000_rbac_renovation.sql:144](supabase/migrations/20260415180000_rbac_renovation.sql:144) | Office_worker WITH venue_id restricted to their venue + created/assigned rows |
| UPDATE RLS | [supabase/migrations/20260415180000_rbac_renovation.sql:182](supabase/migrations/20260415180000_rbac_renovation.sql:182) | Office_worker with venue_id can update any event where `events.venue_id = user.venue_id` |

Data model is already in place — no schema changes needed. `events.manager_responsible_id UUID` (FK to users) was added in [supabase/migrations/20260416210000_manager_responsible_fk.sql](supabase/migrations/20260416210000_manager_responsible_fk.sql).

## Proposed Rules

| Capability | Administrator | Office_worker (no venueId) | Office_worker (venueId set) | Executive |
|------------|---------------|----------------------------|-----------------------------|-----------|
| View events | All | All | All (**change**) | All |
| Propose event | Yes | Yes (**change**) | Yes | No |
| Submit full event | Yes | Yes (**change**) | Yes | No |
| Edit existing event | Any | Only own drafts they created | Only where `event.venue_id = user.venue_id` **AND** `event.manager_responsible_id = user.id` (**change**) | No |
| Cancel / delete event | Any | Only own drafts | Same edit rule | No |
| Review / approve | Yes | No | No | No |

Edit also continues to allow the creator to edit their own `draft` / `needs_revisions` events — preserves the existing self-service flow for the proposer before admin approval.

## Capability Helper Changes — `src/lib/roles.ts`

Replace `canManageEvents` with two functions. Keep the old name as a deprecated re-export temporarily to keep the change reviewable; remove in a follow-up PR after all call-sites migrate (all within this repo, so we can do it in one PR — prefer that).

```typescript
/** Can propose or submit an event (any venue; admin triages). */
export function canProposeEvents(role: UserRole): boolean {
  return role === "administrator" || role === "office_worker";
}

/** Context an edit check needs about the event being edited. */
export type EventEditContext = {
  venueId: string | null;
  managerResponsibleId: string | null;
  createdBy: string | null;
  status: string | null;
};

/** Can edit a specific event. */
export function canEditEvent(
  role: UserRole,
  userId: string,
  userVenueId: string | null,
  event: EventEditContext,
): boolean {
  if (role === "administrator") return true;
  // Creator can always edit own draft / needs_revisions (pre-approval self-service)
  if (
    event.createdBy === userId &&
    (event.status === "draft" || event.status === "needs_revisions")
  ) {
    return true;
  }
  if (role !== "office_worker") return false;
  if (!userVenueId) return false;
  if (event.venueId !== userVenueId) return false;
  if (event.managerResponsibleId !== userId) return false;
  return true;
}
```

`canViewEvents` stays `true` for every role.

## Server-Action Changes — `src/actions/events.ts` & `src/actions/pre-event.ts`

### 1. `proposeEventAction` ([src/actions/pre-event.ts:37](src/actions/pre-event.ts:37))

Add an explicit capability check (fills the gap where only `!user` was checked today):

```typescript
if (!canProposeEvents(user.role)) {
  return { success: false, message: "You don't have permission to propose events." };
}
```

No venue filtering — the form already lets office_workers pick any venue (we'll expose the full list in the UI, see below).

### 2. `submitEventAction` and related full-form/update actions ([src/actions/events.ts](src/actions/events.ts))

Today these call `canManageEvents(user.role, user.venueId)`. They need to diverge by code path:

- **Create path** (`eventId` empty): `canProposeEvents(user.role)`.
- **Update path** (`eventId` present): load the target event (`venue_id`, `manager_responsible_id`, `created_by`, `status`) and call `canEditEvent(user.role, user.id, user.venueId, eventCtx)`. If false, return `"You don't have permission to edit this event."`.

Affected function entry points:

| Line | Function | Today | After |
|------|----------|-------|-------|
| 614  | `submitFullEventAction` (guess — confirm on implementation) | `canManageEvents` | Create path → `canProposeEvents`; update path → `canEditEvent` (load event) |
| 1027 | Same pattern | ditto | ditto |
| 1635 | `generateWebsiteCopyFromFormAction` | `canManageEvents` | `canProposeEvents` (copy gen needs no event context yet) |
| 1731 | Event update | `canManageEvents` | `canEditEvent` |
| 1856 | Event cancel/archive | `canManageEvents` | `canEditEvent` |
| 2022 | Image / metadata update | `canManageEvents` | `canEditEvent` |

Each update path adds one extra query to fetch the event before the guard. That query must use the service-role client (`createSupabaseAdminClient`) to avoid RLS masking the row before the capability check runs. Return `"Not found."` if the event is missing.

### 3. Also audit `cancelEventAction`, `deleteEventAction`, `restoreEventAction`, artist-link mutations, image uploads

Grep pattern: `canManageEvents(user.role, user.venueId)` in `src/actions/`. Every update/delete mutation must move to `canEditEvent`. A follow-up listing of each concrete symbol will be produced in the implementation PR.

## Page Gating Changes

- [src/app/events/propose/page.tsx:18](src/app/events/propose/page.tsx:18) — switch to `canProposeEvents(user.role)`.
- [src/app/events/propose/page.tsx:29](src/app/events/propose/page.tsx:29) — remove the `restrictedVenues` filter so the picker shows **all venues** regardless of `user.venueId` (the user confirmed office_workers can propose for any venue).
- [src/app/events/new/page.tsx:37](src/app/events/new/page.tsx:37) — switch to `canProposeEvents(user.role)`.
- `src/app/events/[eventId]/edit/page.tsx` (and any equivalent) — load event, gate on `canEditEvent(...)`; `/unauthorized` redirect on fail.
- `src/app/events/[eventId]/page.tsx` — keep readable for all; conditionally render Edit/Cancel/Delete buttons only when `canEditEvent` passes for the signed-in user.

## UI Gating Changes

- Event list rows and detail header: hide edit/cancel/delete actions unless `canEditEvent` passes. Server components already have the event and the user — add a helper `canEditThisEvent(user, event)` co-located with the component.
- Nav: no change (the "Propose an event" child is already visible to office_workers after commit `861b92f`).

## RLS Changes — new migration

File: `supabase/migrations/20260418170000_office_worker_event_scope.sql`

### Loosen SELECT for office_worker-with-venue_id to match office_worker-no-venue (global read):

```sql
DROP POLICY IF EXISTS "events_select_policy" ON public.events;
CREATE POLICY "events_select_policy"
  ON public.events
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      public.current_user_role() IN ('administrator', 'executive', 'office_worker')
    )
  );
```

Rationale: all three application roles now have global read; RLS becomes a simple role check plus `deleted_at IS NULL`.

### Tighten UPDATE to require manager_responsible_id for office_worker:

```sql
DROP POLICY IF EXISTS "managers update editable events" ON public.events;
CREATE POLICY "managers update editable events"
  ON public.events
  FOR UPDATE
  USING (
    public.current_user_role() = 'administrator'
    -- Creator self-service on their own pre-approval draft
    OR (
      auth.uid() = created_by
      AND status IN ('draft', 'needs_revisions')
    )
    -- Office_worker: must be at their venue AND be the manager responsible
    OR (
      public.current_user_role() = 'office_worker'
      AND (SELECT venue_id FROM public.users WHERE id = auth.uid()) IS NOT NULL
      AND venue_id = (SELECT venue_id FROM public.users WHERE id = auth.uid())
      AND manager_responsible_id = auth.uid()
    )
  )
  WITH CHECK (
    public.current_user_role() = 'administrator'
    OR (auth.uid() = created_by AND status IN ('draft', 'needs_revisions'))
    OR (
      public.current_user_role() = 'office_worker'
      AND (SELECT venue_id FROM public.users WHERE id = auth.uid()) IS NOT NULL
      AND venue_id = (SELECT venue_id FROM public.users WHERE id = auth.uid())
      AND manager_responsible_id = auth.uid()
    )
  );
```

### Secondary-table policies to revisit in the same migration

Any policy that references `events` for authz (planning items, debriefs, artist_events, event_versions, approvals) must be checked to ensure they don't transitively grant office_workers edit access to events they aren't manager_responsible for. Script:

```sql
SELECT schemaname, tablename, policyname
FROM pg_policies
WHERE definition ILIKE '%events%'
  AND policyname NOT LIKE '%admin%';
```

Each hit is reviewed in the PR; no blanket change — existing debrief policy (manager_responsible_id or creator) already fits.

## Tests

| File | Change |
|------|--------|
| [src/lib/auth/__tests__/rbac.test.ts:697](src/lib/auth/__tests__/rbac.test.ts:697) | Remove `canManageEvents` block; add describe block for `canProposeEvents` (admin + office_worker both allowed, executive not; venueId irrelevant) |
| Same file, new block | `canEditEvent`: 8 cases — admin passes, executive fails, office_worker requires venueId match + manager_responsible_id match, creator passes on draft/needs_revisions only, and fails on published |
| `src/actions/__tests__/pre-event.test.ts` (new) | Office_worker with no venueId can propose; executive cannot; proposal persists via mocked RPC |
| `src/actions/__tests__/events-edit-rbac.test.ts` (new) | Office_worker without manager_responsible_id on target event gets `"You don't have permission…"`; with it, update succeeds |
| Migration integration test | After applying the new migration, a role-simulated query confirms SELECT succeeds for office_worker on another venue's event, and UPDATE fails unless `manager_responsible_id = auth.uid()` |

Coverage target per `.claude/rules/testing.md`: 90% on `src/lib/roles.ts`, 80% on touched server actions.

## Migration & Rollback

- One new SQL migration (`20260418170000_office_worker_event_scope.sql`) — idempotent `DROP POLICY IF EXISTS … CREATE POLICY …`.
- Rollback: re-apply the prior policy body from [supabase/migrations/20260415180000_rbac_renovation.sql](supabase/migrations/20260415180000_rbac_renovation.sql) in a reverse migration. No data is mutated.
- Code changes ship together with the migration in a single PR (RLS tightens UPDATE while the app also tightens its check — both in lockstep prevents a window where the app allows an action the DB rejects or vice versa).

## Complexity Score: 4 (L)

- Files touched: ~15 (roles, 6 action call-sites, 3 pages, tests, migration, 2–3 UI components)
- Schema changes: none (existing `manager_responsible_id` column reused)
- External integrations: 0
- Breaking changes: internal only — `canManageEvents` helper replaced; no public API surface

Breaking down further is possible but introduces coordination risk (RLS and app guard must move together). Keep as one PR, but land with phased commits:
1. New helpers + tests
2. Page gating
3. Server-action gating
4. RLS migration
5. UI button hiding + final typecheck/lint/build

## Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| Office_worker tries to edit an event where they're not manager_responsible and hits a confusing "permission denied" after opening the edit page | Medium | Page-level `canEditEvent` check redirects to `/unauthorized` *before* the edit form renders; UI buttons hidden in list/detail views |
| Existing office_workers with venue_id lose edit ability on events they were previously editing (because they aren't manager_responsible_id) | High-likelihood behavioural change — but this is the intended business rule | Communicate to stakeholders pre-deploy; run SQL audit (below) to quantify impact |
| RLS UPDATE tightens before app code deploys, causing silent failures | Low | Ship in one atomic PR/migration with code; verify locally before push |
| Existing code paths relying on the removed `canManageEvents` continue to compile via the temporary re-export but silently keep old behaviour | Medium | Remove `canManageEvents` in the same PR — no temporary alias |

### Pre-deploy audit query

```sql
SELECT COUNT(*) AS editable_today,
       COUNT(*) FILTER (WHERE manager_responsible_id = u.id) AS still_editable,
       COUNT(*) FILTER (WHERE manager_responsible_id IS NULL) AS no_manager
FROM events e
JOIN users u ON u.venue_id = e.venue_id
WHERE u.role = 'office_worker'
  AND e.deleted_at IS NULL
  AND e.status NOT IN ('draft', 'needs_revisions');
```

If `no_manager` is high, stakeholders should backfill `manager_responsible_id` (or use `venues.default_manager_responsible_id` as the backfill source) before deploy — otherwise office_workers lose edit rights on events with no manager set.

## Assumptions (recorded per workspace CLAUDE.md §Core Principles)

1. "Listed as manager responsible" = `events.manager_responsible_id = user.id`, not `venues.default_manager_responsible_id`. Venue default is the source for auto-fill, but the per-event value is authoritative for access control.
2. "Own venue" = `users.venue_id`, not membership in any multi-venue grouping (no such grouping exists in the schema today).
3. Executives remain read-only — unchanged.
4. When an office_worker has created a proposal but is not yet `manager_responsible_id` (pre-approval), they retain edit rights through the creator-draft clause until approval flips the status off `draft`/`needs_revisions`.
5. No change to "review/approve" rights — still admin-only.

## Open Questions

1. Should the propose form *default-select* the office_worker's own `venueId` (if set) for convenience, while still allowing them to pick any venue? Recommend **yes** — reduces clicks for the common case.
2. Should office_workers be able to *request assignment* as manager_responsible_id on an event to gain edit rights, or is that always admin-driven? Assume admin-driven for now (no new UI).
3. If an office_worker is removed as manager_responsible_id mid-workflow (e.g., admin reassigns), do we notify them? Out of scope — handle via the existing notifications pathway in a follow-up.

## Definition of Done

- [ ] `canProposeEvents` and `canEditEvent` implemented with tests (90% coverage on `src/lib/roles.ts`)
- [ ] All `canManageEvents` call-sites migrated; helper removed
- [ ] `/events/propose` accessible to all office_workers; venue picker shows every venue
- [ ] Event detail/list edit controls hidden when `canEditEvent` returns false
- [ ] RLS migration applied locally and on staging; pre-deploy audit query run and reviewed
- [ ] `npm run lint && npx tsc --noEmit && npm test && npm run build` all pass
- [ ] PR description includes audit-query result and "Breaking change" callout listing user-visible behaviour changes
```

---

# SUPPLEMENTAL: Current state of key files referenced by the spec

## File: src/lib/roles.ts (current)

```typescript
import type { UserRole } from "./types";

/**
 * Role capability model — FINAL (3-role)
 *
 * administrator — full platform access
 * office_worker — venue-scoped write (if venueId set) or global read-only (if no venueId)
 * executive     — read-only observer
 *
 * Functions accepting venueId use it as a capability switch:
 * office_worker + venueId = venue-scoped write access
 * office_worker + no venueId = read-only access
 */

/** Convenience: check if user is an administrator */
export function isAdministrator(role: UserRole): boolean {
  return role === "administrator";
}

/** Can create or edit events (admin always; office_worker only with venueId) */
export function canManageEvents(role: UserRole, venueId?: string | null): boolean {
  if (role === "administrator") return true;
  if (role === "office_worker" && venueId) return true;
  return false;
}

/** Can view events (all roles) */
export function canViewEvents(role: UserRole): boolean {
  return true;
}

/** Can make review/approval decisions on events */
export function canReviewEvents(role: UserRole): boolean {
  return role === "administrator";
}

/** Can manage bookings (admin always; office_worker only with venueId) */
export function canManageBookings(role: UserRole, venueId?: string | null): boolean {
  if (role === "administrator") return true;
  if (role === "office_worker" && venueId) return true;
  return false;
}

/** Can manage customers (admin always; office_worker only with venueId) */
export function canManageCustomers(role: UserRole, venueId?: string | null): boolean {
  if (role === "administrator") return true;
  if (role === "office_worker" && venueId) return true;
  return false;
}

/** Can manage artists (admin always; office_worker only with venueId) */
export function canManageArtists(role: UserRole, venueId?: string | null): boolean {
  if (role === "administrator") return true;
  if (role === "office_worker" && venueId) return true;
  return false;
}

/** Can create debriefs (admin always; office_worker only with venueId) */
export function canCreateDebriefs(role: UserRole, venueId?: string | null): boolean {
  if (role === "administrator") return true;
  if (role === "office_worker" && venueId) return true;
  return false;
}

/** Can edit a debrief. Admin always; office_worker only if they are the submitted_by user. */
export function canEditDebrief(role: UserRole, isCreator: boolean): boolean {
  if (role === "administrator") return true;
  if (role === "office_worker" && isCreator) return true;
  return false;
}

/** Can view/read debriefs (all roles) */
export function canViewDebriefs(role: UserRole): boolean {
  return true;
}

/** Can create new planning items */
export function canCreatePlanningItems(role: UserRole): boolean {
  return role === "administrator" || role === "office_worker";
}

/** Can edit/delete own planning items (admin can manage any) */
export function canManageOwnPlanningItems(role: UserRole): boolean {
  return role === "administrator" || role === "office_worker";
}

/** Can manage all planning items regardless of owner */
export function canManageAllPlanning(role: UserRole): boolean {
  return role === "administrator";
}

/** Can view the planning workspace */
export function canViewPlanning(role: UserRole): boolean {
  return true;
}

/** Can manage venues */
export function canManageVenues(role: UserRole): boolean {
  return role === "administrator";
}

/** Can manage users (invite, update roles) */
export function canManageUsers(role: UserRole): boolean {
  return role === "administrator";
}

/** Can manage event types and system settings */
export function canManageSettings(role: UserRole): boolean {
  return role === "administrator";
}

/** Can create, edit, or delete short links and manage QR codes */
export function canManageLinks(role: UserRole): boolean {
  return role === "administrator";
}

/** Can view the SOP template configuration */
export function canViewSopTemplate(role: UserRole): boolean {
  return role === "administrator" || role === "executive";
}

/** Can create, edit, or delete SOP template sections and tasks */
export function canEditSopTemplate(role: UserRole): boolean {
  return role === "administrator";
}
```

## File: src/app/events/propose/page.tsx (current)

```typescript
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { canManageEvents } from "@/lib/roles";
import { listVenues } from "@/lib/venues";
import { ProposeEventForm } from "@/components/events/propose-event-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { VenueOption } from "@/components/venues/venue-multi-select";

export const metadata = {
  title: "Propose an event · BaronsHub",
  description: "Submit a quick event proposal for admin approval before filling in the full details."
};

export default async function ProposeEventPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canManageEvents(user.role, user.venueId)) redirect("/unauthorized");

  const venueRows = await listVenues();
  const venues: VenueOption[] = venueRows.map((v) => ({
    id: v.id,
    name: v.name,
     
    category: (((v as any).category ?? "pub") === "cafe" ? "cafe" : "pub") as "pub" | "cafe"
  }));

  // Office workers with a specific venue: pre-restrict to that venue only.
  const restrictedVenues =
    user.role === "office_worker" && user.venueId
      ? venues.filter((v) => v.id === user.venueId)
      : venues;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Propose an event</CardTitle>
          <CardDescription>
            Give just a title, date and short description. An administrator will review and — once approved —
            you can fill in the remaining details.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProposeEventForm venues={restrictedVenues} />
          <p className="mt-4 text-xs text-subtle">
            Need to submit a fully-detailed event straight away? <Link className="underline" href="/events/new">Use the full event form.</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
```

## File: src/actions/pre-event.ts (current)

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { randomUUID } from "crypto";
import { getCurrentUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordAuditLogEntry } from "@/lib/audit-log";
import type { ActionResult } from "@/lib/types";

/**
 * Wave 3 — pre-event approval server actions.
 *
 * proposeEventAction: venue manager (or administrator) submits a
 * bare-bones proposal for multiple venues. Calls
 * create_multi_venue_event_proposals RPC. No event_type / venue_space /
 * end_at required; no SOP generated until approval.
 *
 * preApproveEventAction: administrator only. Calls
 * pre_approve_event_proposal RPC (transitional status, planning item
 * creation + SOP generation).
 *
 * preRejectEventAction: administrator only. Records rejection with
 * reason in approvals and transitions status to 'rejected'.
 */

const proposalSchema = z.object({
  title: z.string().min(1, "Add a title").max(200),
  startAt: z.string().min(1, "Pick a start date & time"),
  notes: z.string().min(1, "Add a short description").max(2000),
  venueIds: z
    .array(z.string().uuid())
    .min(1, "Pick at least one venue")
    .max(20, "Too many venues selected")
});

export async function proposeEventAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, message: "You must be signed in." };

  const venueIds = formData.getAll("venueIds").filter((v): v is string => typeof v === "string" && v.length > 0);
  const parsed = proposalSchema.safeParse({
    title: formData.get("title"),
    startAt: formData.get("startAt"),
    notes: formData.get("notes"),
    venueIds
  });

  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? "Check the highlighted fields."
    };
  }

  const idempotencyKey = (formData.get("idempotencyKey") as string) || randomUUID();
  const db = createSupabaseAdminClient();
   
  const { data, error } = await (db as any).rpc("create_multi_venue_event_proposals", {
    p_payload: {
      created_by: user.id,
      venue_ids: parsed.data.venueIds,
      title: parsed.data.title,
      start_at: parsed.data.startAt,
      notes: parsed.data.notes
    },
    p_idempotency_key: idempotencyKey
  });

  if (error) {
    console.error("proposeEventAction RPC failed:", error);
    return { success: false, message: error.message ?? "Could not submit the proposal." };
  }

  revalidatePath("/events");
  const venueCount = parsed.data.venueIds.length;
  return {
    success: true,
    message:
      venueCount === 1
        ? "Proposal submitted."
        : `Proposal submitted for ${venueCount} venues.`,
    // Expose batch data for UI use if needed. We omit it from the type for
    // simplicity — the toast + redirect is the primary success signal.
    ...(data ? { meta: data } : {})
  } as ActionResult;
}

const approveSchema = z.object({
  eventId: z.string().uuid()
});

export async function preApproveEventAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, message: "You must be signed in." };
  if (user.role !== "administrator") {
    return { success: false, message: "Only administrators can approve proposals." };
  }

  const parsed = approveSchema.safeParse({ eventId: formData.get("eventId") });
  if (!parsed.success) {
    return { success: false, message: "Missing event reference." };
  }

  const db = createSupabaseAdminClient();
   
  const { error } = await (db as any).rpc("pre_approve_event_proposal", {
    p_event_id: parsed.data.eventId,
    p_admin_id: user.id
  });

  if (error) {
    console.error("preApproveEventAction RPC failed:", error);
    return { success: false, message: error.message ?? "Could not approve the proposal." };
  }

  revalidatePath("/events");
  revalidatePath(`/events/${parsed.data.eventId}`);
  return { success: true, message: "Proposal approved. The creator can now complete the details." };
}

const rejectSchema = z.object({
  eventId: z.string().uuid(),
  reason: z.string().min(1, "Give a reason").max(1000)
});

export async function preRejectEventAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, message: "You must be signed in." };
  if (user.role !== "administrator") {
    return { success: false, message: "Only administrators can reject proposals." };
  }

  const parsed = rejectSchema.safeParse({
    eventId: formData.get("eventId"),
    reason: formData.get("reason")
  });
  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Check the rejection reason." };
  }

  const db = createSupabaseAdminClient();

  // Insert the approvals row with the decision + reason, then transition status.
   
  await (db as any).from("approvals").insert({
    event_id: parsed.data.eventId,
    reviewer_id: user.id,
    decision: "rejected",
    feedback_text: parsed.data.reason
  });

   
  const { error: statusError } = await (db as any)
    .from("events")
    .update({ status: "rejected" })
    .eq("id", parsed.data.eventId)
    .eq("status", "pending_approval");

  if (statusError) {
    console.error("preRejectEventAction status update failed:", statusError);
    return { success: false, message: "Could not reject the proposal." };
  }

  await recordAuditLogEntry({
    entity: "event",
    entityId: parsed.data.eventId,
    action: "event.pre_rejected",
    actorId: user.id,
    meta: { reason: parsed.data.reason }
  });

  revalidatePath("/events");
  revalidatePath(`/events/${parsed.data.eventId}`);
  return { success: true, message: "Proposal rejected." };
}
```

## File: src/app/events/new/page.tsx (current)

```typescript
import { redirect } from "next/navigation";
import { EventForm } from "@/components/events/event-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";
import { canManageEvents } from "@/lib/roles";
import { listVenues } from "@/lib/venues";
import { listEventTypes } from "@/lib/event-types";
import { listArtists } from "@/lib/artists";
import { listAssignableUsers } from "@/lib/users";

type SearchParams = Record<string, string | string[] | undefined>;

type PageProps = {
  searchParams?: Promise<SearchParams>;
};

function parseDateParam(value?: string | string[]): string | undefined {
  if (!value) return undefined;
  const stringValue = Array.isArray(value) ? value[0] : value;
  if (!stringValue) return undefined;
  const parsed = new Date(stringValue);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

function parseStringParam(value?: string | string[]): string | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] ?? undefined : value;
}

export default async function NewEventPage({ searchParams }: PageProps) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  if (!canManageEvents(user.role, user.venueId)) {
    redirect("/unauthorized");
  }

  const searchParamsPromise =
    searchParams?.then((params) => params as SearchParams).catch(() => ({} as SearchParams)) ??
    Promise.resolve({} as SearchParams);

  const [resolvedSearchParams, venues, eventTypes, artists, assignableUsers] = await Promise.all([
    searchParamsPromise,
    listVenues(),
    listEventTypes(),
    listArtists(),
    listAssignableUsers()
  ]);
  const availableVenues = user.role === "office_worker" ? venues.filter((venue) => venue.id === user.venueId) : venues;
  const initialStartAt = parseDateParam(resolvedSearchParams.startAt);
  const initialEndAt =
    parseDateParam(resolvedSearchParams.endAt) ??
    (initialStartAt ? new Date(new Date(initialStartAt).getTime() + 3 * 60 * 60 * 1000).toISOString() : undefined);
  const requestedVenueId = parseStringParam(resolvedSearchParams.venueId);
  const initialVenueId = availableVenues.some((venue) => venue.id === requestedVenueId) ? requestedVenueId : undefined;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Create a new event draft</CardTitle>
          <CardDescription>
            Share the essentials so reviewers can respond quickly—keep the language simple and cover timings, space, and any promos.
          </CardDescription>
        </CardHeader>
      </Card>
      <EventForm
        mode="create"
        venues={availableVenues}
        artists={artists}
        eventTypes={eventTypes.map((type) => type.label)}
        role={user.role}
        userVenueId={user.venueId}
        initialStartAt={initialStartAt}
        initialEndAt={initialEndAt}
        initialVenueId={initialVenueId}
        users={assignableUsers.map((u) => ({ id: u.id, name: u.name }))}
      />
    </div>
  );
}
```

## File: supabase/migrations/20260415180000_rbac_renovation.sql — events RLS section only

```sql
-- ─── 5.3: public.events ─────────────────────────────────────────────────────

-- "events_select_policy" (from 20260410120003) — the ACTIVE select policy
DROP POLICY IF EXISTS "events_select_policy" ON public.events;
CREATE POLICY "events_select_policy"
  ON public.events
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      -- Administrators see all events
      public.current_user_role() = 'administrator'
      -- office_worker WITHOUT venue_id (former reviewer): global read
      OR (
        public.current_user_role() = 'office_worker'
        AND (SELECT venue_id FROM public.users WHERE id = auth.uid()) IS NULL
      )
      -- Executives see all events
      OR public.current_user_role() = 'executive'
      -- office_worker WITH venue_id (former venue_manager): own venue + own created/assigned
      OR (
        public.current_user_role() = 'office_worker'
        AND (SELECT venue_id FROM public.users WHERE id = auth.uid()) IS NOT NULL
        AND (
          created_by = auth.uid()
          OR assignee_id = auth.uid()
          OR venue_id = (SELECT venue_id FROM public.users WHERE id = auth.uid())
        )
      )
    )
  );

-- "planners manage events" → "admins manage events"
DROP POLICY IF EXISTS "planners manage events" ON public.events;
CREATE POLICY "admins manage events"
  ON public.events
  FOR ALL
  USING (public.current_user_role() = 'administrator')
  WITH CHECK (public.current_user_role() = 'administrator');

-- "managers update editable events" (from 20260414160002) — venue-scoped update
DROP POLICY IF EXISTS "managers update editable events" ON public.events;
CREATE POLICY "managers update editable events"
  ON public.events
  FOR UPDATE
  USING (
    -- Administrators can update any event
    public.current_user_role() = 'administrator'
    -- Creators can update their own draft/needs_revisions events
    OR (auth.uid() = created_by AND status IN ('draft', 'needs_revisions'))
    -- office_worker WITH venue_id can update events at their assigned venue
    OR (
      public.current_user_role() = 'office_worker'
      AND (SELECT venue_id FROM public.users WHERE id = auth.uid()) IS NOT NULL
      AND venue_id = (SELECT venue_id FROM public.users WHERE id = auth.uid())
    )
  )
  WITH CHECK (
    public.current_user_role() = 'administrator'
    OR auth.uid() = created_by
    OR (
      public.current_user_role() = 'office_worker'
      AND (SELECT venue_id FROM public.users WHERE id = auth.uid()) IS NOT NULL
      AND venue_id = (SELECT venue_id FROM public.users WHERE id = auth.uid())
    )
  );

-- ─── 5.4: public.event_versions ──────────────────────────────────────────────

-- "versions follow event access" (from 20250315090000)
DROP POLICY IF EXISTS "versions follow event access" ON public.event_versions;
```

## File: supabase/migrations/20260416210000_manager_responsible_fk.sql

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- Convert manager_responsible from text to user FK
-- ═══════════════════════════════════════════════════════════════════════════
-- Both columns are currently unpopulated (verified: 89 events, 12 venues,
-- all null/empty). No data migration needed.

-- ── 1. Events: drop text, add FK ──────────────────────────────────────────

ALTER TABLE public.events DROP COLUMN IF EXISTS manager_responsible;
ALTER TABLE public.events ADD COLUMN manager_responsible_id uuid REFERENCES public.users(id) ON DELETE SET NULL;

-- ── 2. Venues: drop text, add FK ──────────────────────────────────────────

ALTER TABLE public.venues DROP COLUMN IF EXISTS default_manager_responsible;
ALTER TABLE public.venues ADD COLUMN default_manager_responsible_id uuid REFERENCES public.users(id) ON DELETE SET NULL;

-- ── 3. Update debrief RLS policies to include manager_responsible_id ──────
-- The debriefs_office_worker_insert policy currently only allows insert for
-- events the user created. Update it to also allow the manager_responsible_id.

DROP POLICY IF EXISTS debriefs_office_worker_insert ON public.debriefs;
CREATE POLICY debriefs_office_worker_insert ON public.debriefs
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT role FROM public.users WHERE id = auth.uid()) = 'office_worker'
    AND submitted_by = auth.uid()
    AND event_id IN (
      SELECT id FROM public.events
      WHERE manager_responsible_id = auth.uid()
         OR (manager_responsible_id IS NULL AND created_by = auth.uid())
    )
  );

-- The debriefs_office_worker_update_own policy stays as-is (submitted_by check
-- is sufficient for updates since the user who inserted is the same user).

-- ── 4. Update reassign_user_content RPC ───────────────────────────────────
-- Add two new UPDATE lines for the new FK columns.

CREATE OR REPLACE FUNCTION public.reassign_user_content(
  p_from_id uuid,
  p_to_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Lock source user row to prevent concurrent operations
  PERFORM 1 FROM public.users WHERE id = p_from_id FOR UPDATE;

  -- ═══ OWNERSHIP COLUMNS (reassign to new user) ═══

  UPDATE events SET created_by = p_to_id WHERE created_by = p_from_id;
  UPDATE events SET assignee_id = p_to_id WHERE assignee_id = p_from_id;
  UPDATE events SET manager_responsible_id = p_to_id WHERE manager_responsible_id = p_from_id;
  UPDATE planning_series SET owner_id = p_to_id WHERE owner_id = p_from_id;
  UPDATE planning_series SET created_by = p_to_id WHERE created_by = p_from_id;
  UPDATE planning_items SET owner_id = p_to_id WHERE owner_id = p_from_id;
  UPDATE planning_items SET created_by = p_to_id WHERE created_by = p_from_id;
  UPDATE planning_tasks SET assignee_id = p_to_id WHERE assignee_id = p_from_id;
  UPDATE planning_tasks SET created_by = p_to_id WHERE created_by = p_from_id;
  UPDATE planning_task_assignees SET user_id = p_to_id WHERE user_id = p_from_id;
  UPDATE planning_series_task_templates SET default_assignee_id = p_to_id
    WHERE default_assignee_id = p_from_id;
  UPDATE artists SET created_by = p_to_id WHERE created_by = p_from_id;
  UPDATE event_artists SET created_by = p_to_id WHERE created_by = p_from_id;
  UPDATE short_links SET created_by = p_to_id WHERE created_by = p_from_id;
  UPDATE venues SET default_approver_id = p_to_id WHERE default_approver_id = p_from_id;
  UPDATE venues SET default_manager_responsible_id = p_to_id WHERE default_manager_responsible_id = p_from_id;

  -- SOP array columns (uuid[] — replace element in arrays)
  UPDATE sop_sections
    SET default_assignee_ids = array_replace(default_assignee_ids, p_from_id, p_to_id)
    WHERE p_from_id = ANY(default_assignee_ids);
  UPDATE sop_task_templates
    SET default_assignee_ids = array_replace(default_assignee_ids, p_from_id, p_to_id)
    WHERE p_from_id = ANY(default_assignee_ids);

  -- ═══ PROVENANCE COLUMNS (SET NULL — preserve historical accuracy) ═══

  UPDATE events SET deleted_by = NULL WHERE deleted_by = p_from_id;
  UPDATE event_versions SET submitted_by = NULL WHERE submitted_by = p_from_id;
  UPDATE approvals SET reviewer_id = NULL WHERE reviewer_id = p_from_id;
  UPDATE debriefs SET submitted_by = NULL WHERE submitted_by = p_from_id;
  UPDATE planning_tasks SET completed_by = NULL WHERE completed_by = p_from_id;
  UPDATE venue_opening_overrides SET created_by = NULL WHERE created_by = p_from_id;

  -- audit_log.actor_id is NOT touched — FK dropped, column is soft reference
END;
$$;

NOTIFY pgrst, 'reload schema';
```

## File: src/actions/events.ts — excerpt around line 1020 (submitEventAction)

```typescript
    console.error("[events] Draft save failed:", detail, error);
    return { success: false, message: "Could not save the draft. Please try again." };
  }
  if (redirectUrl) {
    redirect(redirectUrl);
  }
  return { success: true, message: "Draft saved." };
}

export async function submitEventForReviewAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (!canManageEvents(user.role, user.venueId)) {
    return { success: false, message: "You don't have permission to submit events." };
  }
  if (user.role === "office_worker" && !user.venueId) {
    return { success: false, message: "Your account is not linked to a venue." };
  }

  const eventId = formData.get("eventId");
  const assigneeField = formData.get("assigneeId") ?? formData.get("assignedReviewerId") ?? undefined;
  const assigneeOverride = typeof assigneeField === "string" ? assigneeField : undefined;
  const eventImageEntry = formData.get("eventImage");
  const eventImageFile = eventImageEntry instanceof File && eventImageEntry.size > 0 ? eventImageEntry : null;
  const requestedArtistIds = normaliseArtistIdList(formData.get("artistIds"));
  const requestedArtistNames = normaliseArtistNameList(formData.get("artistNames"));

  const rawEventId = typeof eventId === "string" ? eventId.trim() : "";
  let targetEventId: string | null = null;

  try {
    if (rawEventId) {
      const parsedId = z.string().uuid().safeParse(rawEventId);
      if (!parsedId.success) {
        return { success: false, message: "Missing event reference." };
      }
      targetEventId = parsedId.data;
    } else {
      const rawVenueIds = formData
        .getAll("venueIds")
        .filter((v): v is string => typeof v === "string" && v.length > 0);
      const fallbackVenueIdValue = formData.get("venueId");
      const fallbackVenueId = typeof fallbackVenueIdValue === "string" ? fallbackVenueIdValue : "";
      const requestedVenueIds =
        rawVenueIds.length > 0 ? rawVenueIds : fallbackVenueId ? [fallbackVenueId] : [];
      const venueIds = user.role === "office_worker"
        ? (user.venueId ? [user.venueId] : [])
        : requestedVenueIds;
      const venueId = venueIds[0] ?? "";
      const requestedVenueId = venueId;

      if (
        user.role === "office_worker" &&
        requestedVenueIds.length > 0 &&
        requestedVenueIds.some((id) => id !== user.venueId)
      ) {
        return {
          success: false,
          message: "Venue managers can only submit events for their linked venue.",
          fieldErrors: { venueId: "Venue mismatch" }
        };
      }

      const titleValue = formData.get("title");
      const title = typeof titleValue === "string" ? titleValue : "";
      const eventTypeValue = formData.get("eventType");
      const eventType = typeof eventTypeValue === "string" ? eventTypeValue : "";
      const startAtValue = formData.get("startAt");
      const startAt = typeof startAtValue === "string" ? startAtValue : "";
      const endAtValue = formData.get("endAt");
      const endAt = typeof endAtValue === "string" ? endAtValue : "";

      const parsed = eventFormSchema
        .omit({ eventId: true })
        .safeParse({
          venueId,
          title,
          eventType,
          startAt,
          endAt,
          venueSpace: normaliseVenueSpacesField(formData.get("venueSpace")),
          expectedHeadcount: formData.get("expectedHeadcount") ?? undefined,
          wetPromo: formData.get("wetPromo") ?? undefined,
          foodPromo: formData.get("foodPromo") ?? undefined,
          bookingType: formData.get("bookingType") ?? undefined,
          ticketPrice: formData.get("ticketPrice") ?? undefined,
          checkInCutoffMinutes: formData.get("checkInCutoffMinutes") ?? undefined,
          agePolicy: formData.get("agePolicy") ?? undefined,
          accessibilityNotes: formData.get("accessibilityNotes") ?? undefined,
          cancellationWindowHours: formData.get("cancellationWindowHours") ?? undefined,
          termsAndConditions: formData.get("termsAndConditions") ?? undefined,
          artistNames: formData.get("artistNames") ?? undefined,
          goalFocus: formData.getAll("goalFocus").length
            ? formData.getAll("goalFocus").join(",")
            : formData.get("goalFocus") ?? undefined,
          costTotal: formData.get("costTotal") ?? undefined,
          costDetails: formData.get("costDetails") ?? undefined,
          notes: formData.get("notes") ?? undefined,
          managerResponsibleId: formData.get("managerResponsibleId") ?? undefined,
          publicTitle: formData.get("publicTitle") ?? undefined,
          publicTeaser: formData.get("publicTeaser") ?? undefined,
          publicDescription: formData.get("publicDescription") ?? undefined,
          publicHighlights: formData.get("publicHighlights") ?? undefined,
          bookingUrl: formData.get("bookingUrl") ?? undefined,
          seoTitle: formData.get("seoTitle") ?? undefined,
          seoDescription: formData.get("seoDescription") ?? undefined,
```

## File: src/actions/events.ts — excerpt around line 600 (approval action)

```typescript
    versionPayload["websiteCopyGenerated"] = true;
    Object.assign(versionPayload, websiteCopyPayload);
  }

  await appendEventVersion(params.eventId, params.actorId, versionPayload);

  return { warnings };
}

export async function saveEventDraftAction(_: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (!canManageEvents(user.role, user.venueId)) {
    return { success: false, message: "You don't have permission to save events." };
  }

  const rawEventId = formData.get("eventId");
  const eventId = typeof rawEventId === "string" ? rawEventId.trim() || undefined : undefined;

  // Multi-venue: read the full list of picked venue IDs. Fall back to the
  // legacy single `venueId` field so existing callers keep working.
  const rawVenueIds = formData
    .getAll("venueIds")
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  const fallbackVenueIdValue = formData.get("venueId");
  const fallbackVenueId = typeof fallbackVenueIdValue === "string" ? fallbackVenueIdValue : "";
  const requestedVenueIds =
    rawVenueIds.length > 0 ? rawVenueIds : fallbackVenueId ? [fallbackVenueId] : [];

  // Office workers are pinned to their linked venue regardless of UI state.
  const venueIds = user.role === "office_worker"
    ? (user.venueId ? [user.venueId] : [])
    : requestedVenueIds;
  const venueId = venueIds[0] ?? "";

  if (user.role === "office_worker" && !user.venueId) {
    return { success: false, message: "Your account is not linked to a venue." };
  }

  if (
    user.role === "office_worker" &&
    requestedVenueIds.length > 0 &&
    requestedVenueIds.some((id) => id !== user.venueId)
  ) {
    return {
      success: false,
      message: "Venue managers can only save events for their linked venue.",
      fieldErrors: { venueId: "Venue mismatch" }
    };
  }
  const titleValue = formData.get("title");
  const title = typeof titleValue === "string" ? titleValue : "";
  const eventTypeValue = formData.get("eventType");
  const eventType = typeof eventTypeValue === "string" ? eventTypeValue : "";
  const startAtValue = formData.get("startAt");
  const startAt = typeof startAtValue === "string" ? startAtValue : "";
  const endAtValue = formData.get("endAt");
  const endAt = typeof endAtValue === "string" ? endAtValue : "";
  const eventImageEntry = formData.get("eventImage");
```

## File: src/actions/events.ts — excerpt around line 1720–1880 (update/cancel paths)

```typescript
}

export async function generateTermsAndConditionsAction(
  _: TermsActionResult | undefined,
  formData: FormData
): Promise<TermsActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  if (!canManageEvents(user.role, user.venueId)) {
    return { success: false, message: "Only administrators or venue managers can generate terms." };
  }

  const bookingType = normaliseOptionalBookingTypeField(formData.get("bookingType"));
  const ticketPrice = normaliseOptionalNumberField(formData.get("ticketPrice"));
  const checkInCutoffMinutes = normaliseOptionalIntegerField(formData.get("checkInCutoffMinutes"));
  const cancellationWindowHours = normaliseOptionalIntegerField(formData.get("cancellationWindowHours"));
  const agePolicy = normaliseOptionalTextField(formData.get("agePolicy"));
  const accessibilityNotes = normaliseOptionalTextField(formData.get("accessibilityNotes"));
  const extraNotes = normaliseOptionalTextField(formData.get("extraNotes"));
  const allowsWalkInsValue = formData.get("allowsWalkIns");
  const refundAllowedValue = formData.get("refundAllowed");
  const rescheduleAllowedValue = formData.get("rescheduleAllowed");

  const toNullableBoolean = (value: FormDataEntryValue | null): boolean | null => {
    if (value === "yes") return true;
    if (value === "no") return false;
    return null;
  };

  try {
    const terms = await generateTermsAndConditions({
      bookingType,
      ticketPrice,
      checkInCutoffMinutes,
      cancellationWindowHours,
      agePolicy,
      accessibilityNotes,
      allowsWalkIns: toNullableBoolean(allowsWalkInsValue),
      refundAllowed: toNullableBoolean(refundAllowedValue),
      rescheduleAllowed: toNullableBoolean(rescheduleAllowedValue),
      extraNotes
    });

    if (!terms) {
      return { success: false, message: "Could not generate terms right now." };
    }

    const parsedEventId = z.string().uuid().safeParse(formData.get("eventId"));
    if (parsedEventId.success) {
      await recordAuditLogEntry({
        entity: "event",
        entityId: parsedEventId.data,
        action: "event.terms_generated",
        actorId: user.id,
        meta: { changes: ["Terms and conditions"] }
      });
    }

    return {
      success: true,
      message: "Terms generated.",
      terms
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    console.error("generateTermsAndConditionsAction failed:", detail, error);
    return { success: false, message: "Could not generate terms right now. Please try again." };
  }
}

export async function updateAssigneeAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user || user.role !== "administrator") {
    return { success: false, message: "Only administrators can update assignees." };
  }

  const eventId = formData.get("eventId");
  const assigneeField = formData.get("assigneeId") ?? formData.get("reviewerId") ?? null;

  const parsedEvent = z.string().uuid().safeParse(eventId);
  const parsedAssignee = assigneeField ? z.string().uuid().safeParse(assigneeField) : { success: true, data: null };

  if (!parsedEvent.success || !parsedAssignee.success) {
    return { success: false, message: "Provide a valid user." };
  }

  try {
    const supabase = await createSupabaseActionClient();
    const { data: eventRow, error: eventFetchError } = await supabase
      .from("events")
      .select("assignee_id")
      .eq("id", parsedEvent.data)
      .single();

    if (eventFetchError) {
      throw eventFetchError;
    }

    const previousAssigneeId = eventRow?.assignee_id ?? null;
    const nextAssigneeId = parsedAssignee.data;

    if (previousAssigneeId === nextAssigneeId) {
      return { success: true, message: "Assignee unchanged." };
    }

    await updateEventAssignee(parsedEvent.data, nextAssigneeId);
    await sendAssigneeReassignmentEmail(parsedEvent.data, nextAssigneeId, previousAssigneeId);
    await recordAuditLogEntry({
      entity: "event",
      entityId: parsedEvent.data,
      action: "event.assignee_changed",
      actorId: user.id,
      meta: {
        assigneeId: nextAssigneeId,
        previousAssigneeId,
        changes: ["Assignee"]
      }
    });
    revalidatePath(`/events/${parsedEvent.data}`);
    revalidatePath("/reviews");
    return { success: true, message: "Assignee updated." };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    console.error("updateAssigneeAction failed:", detail, error);
    return { success: false, message: "Could not update assignee. Please try again." };
  }
}

export async function deleteEventAction(_: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (!canManageEvents(user.role, user.venueId)) {
    return { success: false, message: "You don't have permission to delete events." };
  }

  const eventId = formData.get("eventId");
  const parsedEvent = z.string().uuid().safeParse(eventId);

  if (!parsedEvent.success) {
    return { success: false, message: "Invalid event reference." };
  }

  const supabase = await createSupabaseActionClient();

  let redirectUrl: string | null = null;
  try {
    const { data: event, error: fetchError } = await supabase
      .from("events")
      .select("id, created_by, status, event_image_path")
      .eq("id", parsedEvent.data)
      .single();

    if (fetchError || !event) {
      return { success: false, message: "Event not found." };
    }

```

## File: src/actions/events.ts — excerpt around line 2000–2060 (image/metadata)

```typescript
const bookingSettingsSchema = z.object({
  eventId: z.string().uuid("Invalid event ID"),
  bookingEnabled: z.boolean(),
  totalCapacity: z.number().int().positive().nullable(),
  maxTicketsPerBooking: z.number().int().min(1).max(50),
  smsPromoEnabled: z.boolean().optional(),
});

export type UpdateBookingSettingsInput = z.infer<typeof bookingSettingsSchema>;
export type UpdateBookingSettingsResult = ActionResult & { seoSlug?: string | null };

/**
 * Save booking settings (booking_enabled, total_capacity, max_tickets_per_booking).
 * Auto-generates seo_slug when booking is first enabled and no slug exists yet.
 * Only administrator and office_worker (for their own venue's events) may call this.
 */
export async function updateBookingSettingsAction(
  input: UpdateBookingSettingsInput,
): Promise<UpdateBookingSettingsResult> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  if (!canManageEvents(user.role, user.venueId)) {
    return { success: false, message: "You don't have permission to update booking settings." };
  }

  const parsed = bookingSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: "Invalid booking settings." };
  }

  const { eventId, bookingEnabled, totalCapacity, maxTicketsPerBooking, smsPromoEnabled } = parsed.data;

  const supabase = createSupabaseAdminClient();

  // Fetch the current event to check permissions and existing slug
  const { data: event, error: fetchError } = await supabase
    .from("events")
    .select("id, title, start_at, venue_id, seo_slug")
    .eq("id", eventId)
    .maybeSingle();

  if (fetchError || !event) {
    return { success: false, message: "Event not found." };
  }

  // Venue managers can only modify events at their own venue
  if (user.role === "office_worker" && event.venue_id !== user.venueId) {
    return { success: false, message: "You can only manage booking settings for your own venue's events." };
  }

  // Auto-generate slug when enabling bookings for the first time
  let seoSlug: string | null = event.seo_slug ?? null;
  if (bookingEnabled && !seoSlug) {
    try {
      seoSlug = await generateUniqueEventSlug(event.title, new Date(event.start_at));
    } catch (err) {
      console.error("Failed to generate event slug:", err);
      return { success: false, message: "Could not generate booking page URL. Please try again." };
    }
  }
```
