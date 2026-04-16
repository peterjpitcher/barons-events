**Current System**

The current `session-setup` system is not Graphify-aware. It is a SessionStart verdict hook plus a skill that instructs Claude to launch up to five analysis agents and write one flat cache file.

1. Session start is wired globally in [settings.json](/Users/peterpitcher/.claude/settings.json:8): it runs `gsd-check-update.js`, then [session-setup.js](/Users/peterpitcher/.claude/settings.json:17).
2. The hook detects a project from `package.json`, `pyproject.toml`, etc. in [session-setup.js](/Users/peterpitcher/.claude/hooks/session-setup.js:13), reads `.claude/session-context.md` in [session-setup.js](/Users/peterpitcher/.claude/hooks/session-setup.js:33), counts commits since the cached hash in [session-setup.js](/Users/peterpitcher/.claude/hooks/session-setup.js:50), and detects Supabase by checking for a `supabase` directory in [session-setup.js](/Users/peterpitcher/.claude/hooks/session-setup.js:59).
3. Staleness detection is narrow: it always marks `git_state` stale, then checks only top-level migration/type/lesson files in [session-setup.js](/Users/peterpitcher/.claude/hooks/session-setup.js:76). It does not check route/component/action structure at all, and its type check is not recursive.
4. Verdict logic only forces `FULL_REFRESH` when the snapshot is missing or older than 24 hours; `COMMITS_SINCE` is reported but not used to choose the tier in [session-setup.js](/Users/peterpitcher/.claude/hooks/session-setup.js:101).
5. The skill’s current contract is flat cache generation at `.claude/session-context.md`, described in [SKILL.md](/Users/peterpitcher/.claude/skills/session-setup/SKILL.md:10). `CACHE_ONLY`, `PARTIAL_REFRESH`, and `FULL_REFRESH` are defined in [SKILL.md](/Users/peterpitcher/.claude/skills/session-setup/SKILL.md:63), [SKILL.md](/Users/peterpitcher/.claude/skills/session-setup/SKILL.md:71), and [SKILL.md](/Users/peterpitcher/.claude/skills/session-setup/SKILL.md:83).
6. The five current agents are database schema, type definitions, file structure, git state, and lessons/TODOs in [SKILL.md](/Users/peterpitcher/.claude/skills/session-setup/SKILL.md:102). The exact snapshot format is fixed in [SKILL.md](/Users/peterpitcher/.claude/skills/session-setup/SKILL.md:228).
7. The current cache exists and is ignored: [.claude/session-context.md](/Users/peterpitcher/Cursor/BARONS-BaronsHub/.claude/session-context.md:1) and [.gitignore](/Users/peterpitcher/Cursor/BARONS-BaronsHub/.gitignore:26). It says the repo has 29 tables and a flat file/type/git/lessons summary in [.claude/session-context.md](/Users/peterpitcher/Cursor/BARONS-BaronsHub/.claude/session-context.md:7).

**Scanner Reality**

The proposed scanners need to handle more than the spec’s simple grep rules.

1. App routes are nested and mixed: there are 27 `page.tsx` files and 15 `route.ts` files, including `/api/v1/*`, `/api/cron/*`, `/[code]`, `/l/[slug]`, `/events/[eventId]/bookings`, and `/venues/[venueId]/opening-hours`.
2. Middleware is central but excludes API routes. Public paths are declared in [middleware.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:14), short-link host rewrites happen in [middleware.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:107), Supabase `getUser()` validation is in [middleware.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:182), app-session validation is in [middleware.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:222), deactivation blocking is in [middleware.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:292), and `/api/*` is excluded in [middleware.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:350).
3. API auth is not `getUser`-based. Public API routes call `checkApiRateLimit()` and `requireWebsiteApiKey()` in [events route.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/api/v1/events/route.ts:26); bearer-key validation lives in [auth.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/public-api/auth.ts:81). A scanner that only greps `getUser`, `requireAuth`, or Supabase clients will misclassify these routes.
4. API responses are currently `{ data, meta }` and structured error objects, not `{ success: boolean }`: see [events route.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/api/v1/events/route.ts:145) and [public-api/auth.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/public-api/auth.ts:23).
5. Server actions often mutate indirectly through domain helpers. `saveEventDraftAction` checks user/capability in [events.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/events.ts:591), then calls helpers like `createEventDraft`, `appendEventVersion`, and `syncEventArtists` around [events.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/events.ts:831). The actual `.from()` calls are frequently in `src/lib/*`.
6. Public booking action does rate limiting, Turnstile, RPC insertion, customer upsert, consent logging, booking linkage, SMS, and revalidation in [bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:34). That is too rich for “grep table names inside exported action function” alone.
7. Client consumers use several patterns: `useActionState` imports actions directly in [users-manager.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/users/users-manager.tsx:5), app pages can pass server actions via forms in [event detail page](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/events/[eventId]/page.tsx:23), and some components dynamically import actions in [delete-event-button.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/events/delete-event-button.tsx:18).
8. Role reality is now three roles, not the older four-role model. Source defines `administrator | office_worker | executive` in [types.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/types.ts:3), and capability helpers document the venue-id switch in [roles.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/roles.ts:3). `AGENTS.md` still describes old role names in [AGENTS.md](/Users/peterpitcher/Cursor/BARONS-BaronsHub/AGENTS.md:101), while `CLAUDE.md` has the current three-role model in [CLAUDE.md](/Users/peterpitcher/Cursor/BARONS-BaronsHub/CLAUDE.md:101).
9. Generated Supabase types are stale versus migrations: `users.Row` lacks `deactivated_at` in [types.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/supabase/types.ts:12), and code works around that with casts in [users.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/users.ts:71).
10. There is no shared `fromDb<T>()`; conversion is inline, e.g. bookings in [bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/bookings.ts:5) and customers in [customers.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/customers.ts:5).

**Database Reality**

There are 59 migration files. The database agent cannot safely rely on simple `CREATE TABLE` extraction.

1. The initial migration creates base tables, RLS, policies, and `current_user_role()` in [initial_mvp.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20250218000000_initial_mvp.sql:21).
2. The schema evolved through heavy `ALTER TABLE`, table drops, storage bucket policies, RPCs, and role migration. Example: storage policies are created inside a `do $$` block in [event image storage migration](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260210122000_retire_venue_areas_and_event_image_storage.sql:20).
3. Booking support adds columns, `event_bookings`, RLS, grants, and multiple `SECURITY DEFINER` RPCs in [event_bookings.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260313000000_event_bookings.sql:22).
4. RBAC was migrated from four roles to three roles and rewrote many policies in [rbac_renovation.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260415180000_rbac_renovation.sql:4).
5. User deactivation changes foreign keys, audit constraints, `current_user_role()`, and reassignment RPCs in [user_deactivation.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260416000000_user_deactivation.sql:9).

**Hooks And MCP**

The hook infrastructure exists, but not the proposed manifest/doc guard system.

1. Current PostToolUse is only the GSD context monitor, matched on `Bash|Edit|Write|MultiEdit|Agent|Task` in [settings.json](/Users/peterpitcher/.claude/settings.json:23).
2. Current PreToolUse is only the GSD prompt guard, matched on `Write|Edit` in [settings.json](/Users/peterpitcher/.claude/settings.json:35). It would not catch `MultiEdit` edits to generated docs.
3. Existing hooks parse JSON from stdin and inject advisory context via `hookSpecificOutput.additionalContext`; see [gsd-context-monitor.js](/Users/peterpitcher/.claude/hooks/gsd-context-monitor.js:40) and [gsd-context-monitor.js](/Users/peterpitcher/.claude/hooks/gsd-context-monitor.js:144).
4. Project-local [.claude/settings.local.json](/Users/peterpitcher/Cursor/BARONS-BaronsHub/.claude/settings.local.json:1) only contains command permissions. There is no `mcpServers` block.
5. I found no `graphify-out/`, no `.claude/changes-manifest.log`, no `.claude/graphify-config.json`, and `graphify` is not on PATH in this environment. The spec currently has the only Graphify references, including the MCP proposal in [the spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-16-graphify-session-setup-overhaul-design.md:516).

**Documentation Reality**

There is a docs tree, but no `docs/architecture/` yet.

1. Existing docs directories are `docs/`, `docs/Runbooks/`, `docs/emails/`, and `docs/superpowers/`.
2. Current docs include stale material. `docs/TechStack.md` still names the old four-role auth model in [TechStack.md](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/TechStack.md:17). `docs/SupabaseSchema.md` also documents old roles and retired tables/columns in [SupabaseSchema.md](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/SupabaseSchema.md:17).
3. `docs/WebsitePublishingAPI.md` is a real public API reference and documents bearer auth and endpoints in [WebsitePublishingAPI.md](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/WebsitePublishingAPI.md:16).
4. The proposed generated docs structure begins at [the spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-16-graphify-session-setup-overhaul-design.md:397), but none of those files exist today.

**Constraints And Risks**

1. The spec should treat source/migrations/live DB as source of truth, not current docs or `AGENTS.md`; there is already role and API contract drift.
2. The database graph ingestion needs either live Supabase introspection or a real migration-evolution model. Parsing migrations as isolated SQL files will miss drops, renames, rewritten policies, storage schema, and `SECURITY DEFINER` functions.
3. Server-action enrichment needs import/call graph traversal. Table access is often in `src/lib/*`, RPCs, or admin clients, not directly inside the exported action.
4. Route auth classification needs route-type awareness: middleware excludes `/api/*`; public API uses bearer auth; cron routes use cron auth; public landing pages use service-role reads.
5. Bash-based manifest detection is underspecified. For `Bash`, the hook gets a command, not a clean file path; robust manifest logging will need either command parsing plus git diff checks, or it should limit reliable logging to `Write/Edit/MultiEdit`.
6. Add `MultiEdit` to generated-doc guard coverage. The current PreToolUse matcher would miss it.
7. The spec says add `graphify-out/` and `.claude/changes-manifest.log` to gitignore in [the spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-16-graphify-session-setup-overhaul-design.md:556), but current [.gitignore](/Users/peterpitcher/Cursor/BARONS-BaronsHub/.gitignore:1) does not include them.
8. The install command has a likely typo: `pip install graphifyy` in [the spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-16-graphify-session-setup-overhaul-design.md:596).

**Inspected / Not Reached**

Inspected: the design spec, current global session skill/hook/settings, project `.claude`, `CLAUDE.md`, `AGENTS.md`, `.env.example`, `.gitignore`, route/action/component/lib patterns, representative migrations, Supabase type files, and existing docs.

Not reached: live Supabase schema via MCP, Graphify runtime/API behavior, and any generated `docs/architecture` output because those artifacts do not exist in this repo today.