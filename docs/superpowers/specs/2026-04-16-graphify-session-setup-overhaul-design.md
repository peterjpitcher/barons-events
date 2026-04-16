# Graphify-Enhanced Session-Setup Overhaul

**Date:** 2026-04-16
**Status:** Approved (brainstorming complete, adversarial review applied)
**Scope:** Session-setup skill overhaul + hook enhancements + auto-generated documentation
**Rollout:** Project-by-project as each project is worked on
**Adversarial review:** 2026-04-16 — 5 reviewers (Codex + Claude), 18 revisions applied

---

## 1. Problem Statement

The current session-setup skill dispatches 5 parallel agents to build a flat markdown snapshot of the project. This has three limitations:

1. **No relationships** — the snapshot lists files, types, and tables independently. It cannot answer "which server actions touch the events table?" or "what components use this type?"
2. **No cross-references** — database fields, components, routes, and actions are documented in isolation. Mapping between them requires manual grep.
3. **Documentation drift** — when agents make structural changes (new routes, new tables, new actions), there is no mechanism to ensure documentation is updated. CLAUDE.md is manual. Session-context.md only refreshes at session start.

## 2. Solution Overview

Integrate [Graphify](https://github.com/safishamsi/graphify) as the structural analysis engine. Graphify transforms codebases into interactive knowledge graphs via tree-sitter AST parsing (local, no LLM needed) with relationship extraction, cross-file dependency mapping, and confidence-scored inferred edges.

**Three layers, one source of truth:**

```
+-----------------------------------------------------+
|                    GRAPHIFY GRAPH                     |
|              (graphify-out/graph.json)                |
|         Single source of truth per project           |
+----------------+------------------+------------------+
|   MCP Server   |   Wiki Mode      |   Graph Queries  |
|  (persistent)  |  (on rebuild)    |  (session-setup) |
+----------------+------------------+------------------+
| AI agents      | docs/architecture| .claude/session- |
| query during   | /*.md            | context.md       |
| sessions       | (human-readable) | (AI-optimised)   |
+----------------+------------------+------------------+
```

**Approach: Graphify-First, Fallback-Ready**

- **With Graphify installed:** MCP queries for AI context, wiki mode for human docs, graph-aware database ingestion, full cross-reference mapping
- **Without Graphify:** Falls back to lightweight inline checks (Glob/Read/Bash). Produces simpler docs with grep-based relationship approximation
- **Detection:** `graphify-out/graph.json` exists AND file size > 0 AND parses as valid JSON containing at least one node. Invalid or empty graph.json triggers simple mode with a warning.

## 3. Prerequisites & Validation Spike (Phase 0)

**Before implementing rich mode**, run a validation spike to confirm Graphify's capabilities:

1. Install `graphifyy` (`pip install graphifyy`) on a development machine
2. Run on BaronsHub (verify the actual CLI binary name — the PyPI package is `graphifyy` with double-y; the CLI binary may differ)
3. Verify each assumed capability:
   - [ ] MCP server exists and exposes `query_graph`, `get_node`, `get_neighbors`, `shortest_path` tools
   - [ ] Incremental rebuild flag exists (check CLI help for `--incremental` or equivalent)
   - [ ] External data injection is possible (can non-AST nodes be added to graph.json programmatically?)
4. Benchmark graph rebuild time on BaronsHub (148 files)
5. Update this spec with actual CLI commands, MCP tool names, and confirmed capabilities

**If any capability is missing:** Implement simple-mode improvements first (manifest, inline agents, enrichment scanners, doc generation). These are independently valuable. Layer Graphify on top once capabilities are confirmed or workarounds are found.

**Important:** All `graphify` CLI references in this spec are provisional. The PyPI package is `graphifyy` (double-y). The actual CLI binary name and Python module path must be verified during the spike. References throughout this spec use `graphify` as a placeholder — replace with the confirmed command after validation.

## 4. System Components

| Component | Purpose | Location |
|-----------|---------|----------|
| Graphify graph | Source of truth — code structure, relationships, types | `graphify-out/graph.json` |
| Graphify MCP server | Persistent query interface for agents during sessions | Claude Code MCP config |
| Database ingestion agent | Supabase schema as graph nodes/edges | Session-setup (1 agent) |
| Changes manifest | Lightweight change log during work | `.claude/changes-manifest.log` |
| Session-context | AI-optimised compact snapshot | `.claude/session-context.md` |
| Architecture docs | Human-readable docs per domain with cross-references | `docs/architecture/*.md` |
| Section hashes | Skip-write optimisation for generated docs | `docs/architecture/.section-hashes.json` |
| Framework enrichment | Stack-specific scanners (Next.js + Supabase aware) | Part of session-setup skill |
| PostToolUse hook | Manifest logger + structural change nudges | `.claude/hooks/` |
| PreToolUse hook | Prevents accidental edits to generated docs | `.claude/hooks/` |
| Completion gate | Documentation check before task completion | Integrated with verification skill |

## 5. Session-Setup Skill Overhaul

### 5.1 New Tier Flow (Rich Mode — Graphify available)

**FULL_REFRESH:**

1. Validate graph.json (exists, > 0 bytes, valid JSON). If invalid, log warning and restart in simple mode.
2. Rebuild Graphify graph (`graphify . --incremental`). If rebuild fails (non-zero exit), log warning and restart in simple mode. Do not use stale graph.json — it may be partially written.
3. Run database ingestion agent (Supabase schema into graph as nodes/edges). On failure, add visible warning to session-context.md database section.
4. Run framework-aware enrichment pass (5 scanners — see Section 7). Each scanner independently fenced; partial results survive individual scanner failures.
5. Generate `session-context.md` from graph queries
6. Generate/update `docs/architecture/*.md` with section hash comparison
7. Inline git state check (4 bash commands, no agent)
8. Inline lessons check (read 2 files, no agent)
9. Consume and clear changes manifest
10. Check if `.git/hooks/post-commit` contains a graphify reference. If not, inject one-time warning: "Graphify graph detected but git hooks not installed. Run `graphify install` to keep the graph fresh between sessions."

**PARTIAL_REFRESH:**

1. Read changes manifest to identify affected areas
2. Validate graph.json. If invalid, fall back to simple mode FULL_REFRESH.
3. Incremental graph rebuild (SHA256 — only changed files)
4. Re-query graph for affected doc sections only
5. Regenerate only changed docs (section hash comparison)
6. Inline git state check
7. Inline lessons check

**CACHE_ONLY:**

1. Read `session-context.md` (no graph rebuild)
2. Inline git state check
3. Confirm loaded — one line

**Important:** The SessionStart hook must check `.claude/changes-manifest.log`. If the manifest exists and is non-empty, upgrade CACHE_ONLY to PARTIAL_REFRESH. Without this, deferred doc updates are never consumed and the "eventual consistency" promise breaks.

### 5.2 New Tier Flow (Simple Mode — no Graphify)

**FULL_REFRESH:**

1. Glob/Read for file structure
2. Glob/Read for type definitions
3. Supabase MCP or migration file parsing for schema
4. Run framework-aware enrichment scanners (results written directly to docs)
5. Inline git + lessons checks
6. Write `session-context.md` (flat format)
7. Generate `docs/architecture/*.md` with grep-based relationship approximation

**PARTIAL_REFRESH and CACHE_ONLY:** Same logic as rich mode, minus graph operations.

### 5.3 Agent Changes

**Removed (replaced by Graphify + inline logic):**

| Old Agent | Replacement |
|-----------|-------------|
| Agent 1 — Database Schema | Evolved into database ingestion agent (feeds graph) |
| Agent 2 — Type Definitions | Graphify AST extraction |
| Agent 3 — File Structure | Graphify AST extraction |
| Agent 4 — Git State | Inlined (4 bash commands) |
| Agent 5 — Lessons & TODOs | Inlined (read 2 files) |

**New:**

| New Component | Purpose |
|---------------|---------|
| Database ingestion agent | Queries Supabase, transforms tables/columns/FKs/RLS into graph nodes and edges |
| Framework enrichment pass | 5 stack-specific scanners run as single agent (see Section 7) |

### 5.4 Session-Context Format (Rich Mode)

```markdown
<!-- session-context -->
<!-- last_updated: 2026-04-16T14:30:00Z -->
<!-- project: barons-events-mvp -->
<!-- commit_hash: abc1234 -->
<!-- mode: rich -->
<!-- graph_nodes: 247 -->
<!-- graph_edges: 891 -->

## God Nodes
- `events` table — 23 connections (actions, components, API routes, types)
- `getSupabaseServerClient` — 18 connections (every server action)
- `Event` type — 15 connections

## Key Relationships
- Auth flow: middleware -> getUser -> roles.ts -> server actions
- Event lifecycle: draft -> published -> completed (6 actions, 4 components)

## Database Schema
[Compact summary — full detail queryable via MCP]

## Surprising Connections
[From Graphify analysis — cross-cutting concerns, unexpected dependencies]

## Git State
**Branch:** main | **Working tree:** clean | **Recent:** 3 commits since last session

## Lessons
[Bullet list from tasks/lessons.md]
```

**Note:** MCP queries reflect the last graph rebuild (typically last commit), not the current working tree. For changes made during the current session, use the changes manifest or direct Grep. If MCP queries fail mid-session (server crash), fall back to reading session-context.md and using Grep/Read against the codebase directly.

### 5.5 Session-Context Format (Simple Mode)

```markdown
<!-- session-context -->
<!-- last_updated: 2026-04-16T14:30:00Z -->
<!-- project: barons-events-mvp -->
<!-- commit_hash: abc1234 -->
<!-- mode: simple -->

## Database Schema
[Direct from Supabase queries]

## File Structure
[Glob-based tree listing]

## Type Definitions
[Read-based extraction]

## Server Actions
[Grep for 'use server' — enrichment scanner output]

## Routes
[Glob for page.tsx/route.ts — enrichment scanner output]

## Git State
[Inline bash]

## Lessons
[Inline read]
```

## 6. Database Ingestion Agent

The database agent evolves from a schema dumper to a graph feeder.

**Process:**

1. Query Supabase schema (same SQL queries as current agent):
   - `information_schema.columns` for tables and columns
   - `pg_constraint` for foreign keys
   - `pg_policies` for RLS policies
   - `pg_enum` for enum types
2. Transform results into graph-compatible structures:
   - Tables become nodes (type: `database_table`)
   - Columns become nodes (type: `database_column`) with edges to their table
   - Foreign keys become edges between tables (type: `foreign_key`)
   - RLS policies become metadata on table nodes
   - Enum types become nodes with edges to columns that use them
3. Feed into Graphify graph via JSON import or temporary SQL files (exact mechanism TBD — depends on Graphify's import API; this is a discovery task during the Phase 0 validation spike)

**On failure:** If Supabase is unreachable or schema queries fail, session-context.md must contain a visible warning: `## Database Schema\n> WARNING: Database ingestion failed. Schema data is stale or missing.` The same warning should propagate to `docs/architecture/data-model.md`.

**Result:** "Which server actions touch the events table?" becomes a single graph query traversing `events` node neighbours filtered by `server_action` type.

## 7. Framework-Aware Enrichment Pass

Five scanners that fill gaps Graphify's generic AST cannot cover. Run as a single agent after the graph rebuild. Results feed into the graph as additional nodes and edges. Each scanner is independently fenced — a failure in one scanner does not prevent others from completing. Each reports `success`, `empty` (nothing found), or `error` (failed).

**Codebase-specific notes (from adversarial review):**
- API routes use bearer auth (`checkApiRateLimit()`, `requireWebsiteApiKey()`), not just `getUser`. Scanners must detect both patterns.
- Server actions often call through domain helpers in `src/lib/*`. The actual `.from()` calls are frequently in helpers, not in the exported action function. Scanners should follow import chains.
- Middleware excludes `/api/*` routes from auth checks. The auth tracer must account for this.
- Database has 59 migration files with complex evolution (drops, renames, RPCs, `SECURITY DEFINER` functions). Use live schema introspection via Supabase MCP where possible; migration file parsing is a fallback.

### 7.1 Route Scanner

1. Glob for `**/page.tsx`, `**/route.ts`, `**/layout.tsx`
2. Map file paths to URL routes via App Router conventions (e.g., `src/app/events/[id]/page.tsx` maps to `/events/:id`)
3. For each `route.ts`, grep for exported function names (`GET`, `POST`, `PUT`, `DELETE`)
4. Check for auth — grep for multiple patterns: `getUser`, `getSupabaseServerClient`, `requireAuth`, `requireWebsiteApiKey`, `checkApiRateLimit`. Classify auth type: `session` (getUser), `api-key` (bearer), `cron`, `public`.
5. Output: route nodes with `method`, `path`, `auth_type`, `auth_required`, `file_location`

### 7.2 Server Action Scanner

1. Grep for `'use server'` across codebase
2. For each file found, extract exported async function names
3. For each function, grep within it AND in its imported helpers (follow imports into `src/lib/*`) for:
   - Table names (`from('table_name')`, `.rpc('function_name')`)
   - Auth checks (`getUser`, `requireRole`, capability functions from `roles.ts`)
   - Audit logging (`logAuditEvent`)
   - `revalidatePath` calls
4. Output: action nodes with `mutations`, `permissions`, `revalidation_targets`

### 7.3 Env Var Scanner

**Safety constraint: This scanner MUST only read `.env.example`. Never read `.env`, `.env.local`, or any `.env*.local` file. Never capture env var values — only names and which files reference them.**

1. Read `.env.example` (canonical list of var names only)
2. Grep for `process.env.` across codebase (captures usage, not values)
3. Cross-reference: which vars are declared, which are used, which are `NEXT_PUBLIC_`
4. Flag: vars used but not in `.env.example`, vars declared but never used
5. Output: env nodes with `public/server`, `required/optional`, `used_in` files

### 7.4 Integration Scanner

1. Grep for known SDK imports:
   - `resend` (email), `stripe` (payments), `qrcode` (QR generation)
   - `@supabase` (database), `openai`/`anthropic` (AI), `twilio` (SMS)
2. For each match, trace which files import it and what functions use it
3. Output: integration nodes with `service_name`, `files_using`, `purpose`

### 7.5 Middleware & Auth Tracer

1. Read `middleware.ts` at project root (Next.js App Router convention). Also check `src/middleware.ts` for projects using the `src` directory approach.
2. Read all `layout.tsx` files — extract auth checks, role guards
3. Map the request lifecycle: middleware -> layout -> page -> action
4. Note excluded paths (e.g., `/api/*` excluded from middleware in BaronsHub)
5. Cross-reference with `roles.ts` capability functions
6. Output: `auth_flow` edges connecting middleware -> layouts -> role checks -> actions

### 7.6 Configuration

Per-project config at `.claude/graphify-config.json`:

```json
{
  "stack": "nextjs-supabase",
  "scanners": ["routes", "server-actions", "env", "integrations", "auth"],
  "custom_integrations": ["resend", "qrcode"],
  "auth_pattern": "supabase-jwt"
}
```

Scanners are toggled per project. When rolling out to a non-Supabase project, adjust the config — drop the database agent, swap scanner patterns.

## 8. Changes Manifest & PostToolUse Hook

### 8.1 Manifest Format

File: `.claude/changes-manifest.log`

```
# manifest-version: 1
# Format: timestamp|action|file_path|category|impact
2026-04-16T14:30:00Z|EDIT|src/app/events/page.tsx|route|structure
2026-04-16T14:31:00Z|CREATE|src/actions/booking.ts|server-action|structure,docs
2026-04-16T14:32:00Z|EDIT|supabase/migrations/20260416_add_booking.sql|migration|database
2026-04-16T14:33:00Z|DELETE|src/components/old-form.tsx|component|structure
2026-04-16T14:34:00Z|EDIT|src/lib/roles.ts|auth|structure,docs
```

The manifest is append-only during a session. Deduplication happens at consumption time. The manifest is best-effort — concurrent writes from parallel agents may occasionally interleave lines, but the deduplication step handles this gracefully.

### 8.2 Category Detection Rules

| File Pattern | Category | Impacts |
|-------------|----------|---------|
| `src/app/**/page.tsx`, `**/route.ts` | `route` | structure, docs |
| `src/actions/**`, `**/actions/**` | `server-action` | structure, docs |
| `supabase/migrations/**` | `migration` | database |
| `src/types/**`, `**/*.types.ts` | `type` | structure |
| `src/components/**` | `component` | structure |
| `src/lib/**` | `utility` | structure |
| `middleware.ts` | `auth` | structure, docs |
| `.env.example` | `env` | docs |
| `CLAUDE.md` | `documentation` | docs |
| `tasks/lessons.md`, `tasks/todo.md` | `lessons` | lessons |

**Note:** `.claude/rules/**` is not included in project-level detection because BaronsHub (and potentially other projects) uses workspace-level rules at `/Users/peterpitcher/Cursor/.claude/rules/`, not project-local rules. CLAUDE.md edits trigger `docs` impact only, not `structure`, to avoid alert fatigue from documentation-only changes.

### 8.3 Impact Mapping

| Impact | Triggers Rebuild Of |
|--------|-------------------|
| `structure` | Graph rebuild (incremental) + session-context.md |
| `database` | Database agent re-run + graph ingestion |
| `docs` | `docs/architecture/*.md` relevant sections |
| `lessons` | Lessons section of session-context.md |

### 8.4 Session-Setup Manifest Consumption

1. Read `.claude/changes-manifest.log`
2. Validate each file path still exists. Log stale entries as "file removed since last session" and adjust impact accordingly.
3. Deduplicate by file path (keep latest action per file)
4. Collect unique impacts — determines which sections to refresh
5. After refresh, clear the manifest (truncate file)

## 9. Hook Enhancements

All three new hook behaviours (manifest logger, doc guard, structural change detector) should be consolidated into a single `session-setup-hooks.js` file to avoid hook proliferation. Combined with existing GSD hooks, every tool use passes through multiple hooks — consolidation reduces cumulative latency.

### 9.1 PostToolUse Hook — Changes Manifest Logger

**Fires on:** `Edit`, `Write`, `MultiEdit`

**Not on Bash.** Bash events contain command strings, not structured file paths. Parsing arbitrary bash commands to extract file paths is brittle and unreliable. The vast majority of structural changes go through Edit/Write/MultiEdit where file paths are structured data.

**Behaviour:**
- Reads the file path from the tool use event
- Pattern-matches to determine category and impact (see Section 8.2)
- Appends one line to `.claude/changes-manifest.log` (creates the file if it doesn't exist)
- If append fails (permission denied, disk full), emit a warning to the conversation
- No graph rebuild, no doc generation, no token cost — just a log line

### 9.2 PreToolUse Hook — Generated Doc Guard

**Fires on:** `Write`, `Edit`, `MultiEdit` targeting `docs/architecture/*.md`

**Behaviour:**
- Checks if file has `generated: true` in frontmatter
- If yes, injects advisory warning: "This file is auto-generated by session-setup. Edit the source code instead — docs will regenerate on next session. If you need persistent notes, use `docs/architecture/NOTES.md`"
- Non-blocking — agent can override if truly needed

### 9.3 PostToolUse Hook — Structural Change Detector

**Fires on:** `Edit`, `Write`, `MultiEdit` for files matching structural patterns

**Trigger conditions (any of):**
- New file created matching `page.tsx`, `route.ts`, `actions/*.ts`
- File deleted or renamed in `src/`
- Migration file created in `supabase/migrations/`
- `middleware.ts` edited
- `.env.example` edited

**Excluded from triggers:** `CLAUDE.md` and `.claude/rules/*` edits. These are documentation changes, not structural code changes. Including them caused alert fatigue in review testing.

**When triggered, injects context nudge:**

```
Structural change detected: [description]
This affects project documentation. The changes manifest has been updated.
When you finish this task, run a targeted doc refresh for affected sections
or note it for the next session-setup.
```

**Debouncing:** If more than 3 structural nudges have been injected in the current session, suppress further per-change nudges. Instead, inject a single summary at the next natural pause: "N structural changes logged this session — run `/session-setup partial` when ready."

### 9.4 Task Completion Gate — Documentation Check

Hooks into the existing `verification-before-completion` skill pattern. If that skill is not installed, implement as a standalone PostToolUse hook firing on task-completion signals.

**When an agent finishes a task:**
- If `.claude/changes-manifest.log` has entries with impact `docs`:
  - Remind agent: "Structural changes were made this session that affect architecture docs. Consider running `/session-setup` to refresh, or confirm docs will be updated next session."
- Agent or user decides: refresh now (`/session-setup partial`) or defer (manifest persists for next session)

### 9.5 Hook Lifecycle Example

```
Agent edits src/app/bookings/page.tsx (new route)
  -> PostToolUse: manifest entry logged [cheap]
  -> PostToolUse: structural change nudge injected [advisory]

Agent continues working...

Agent edits src/actions/bookings.ts (new server action)
  -> PostToolUse: manifest entry logged
  -> PostToolUse: structural change nudge injected

Agent edits 10 more route files in rapid succession
  -> PostToolUse: manifest entries logged (10x)
  -> PostToolUse: nudges suppressed after 3rd; summary queued

Agent finishes task, runs verification
  -> Completion gate: "12 structural changes affect docs —
     refresh now or defer to next session?"

Agent (or user) decides:
  -> Option A: /session-setup partial — refreshes affected docs now
  -> Option B: Defer — manifest persists, next session picks it up

Next session:
  -> SessionStart hook detects non-empty manifest
  -> Upgrades CACHE_ONLY to PARTIAL_REFRESH
  -> session-setup reads manifest, rebuilds affected sections only
```

**Design principle:** Nudge, don't block. Agents stay fast during work. The manifest ensures nothing is lost even if nudges are ignored. Session-setup is the backstop that guarantees eventual consistency.

## 10. Human-Readable Documentation Output

### 10.1 Directory Structure (v1 — 5 high-value docs)

Start with the highest-value docs. Add remaining docs in v2 after proving the system works.

```
docs/architecture/
  README.md                 # Index — links to all docs, last updated timestamps
  overview.md               # God nodes, key relationships, architecture summary
  routes.md                 # All routes with methods, auth requirements, parameters
  data-model.md             # Tables, columns, foreign keys, enums (see Security Note)
  server-actions.md         # All actions with mutations, permissions, return types
  relationships.md          # Full cross-reference map (the "glue" document)
  NOTES.md                  # Persistent manual notes (never overwritten by session-setup)
  .section-hashes.json      # Hash registry for skip-write optimisation (gitignored)
```

**v2 additions** (add when v1 is proven):
- `components.md` — Component inventory grouped by feature/domain
- `integrations.md` — External services (Resend, Stripe, QR, Supabase Auth)
- `auth-and-permissions.md` — Middleware chain, role model, capability functions
- `environment.md` — All env vars (names only, never values)

### 10.2 Security Note on Committed Docs

**Decision required:** `docs/architecture/*.md` is committed to git and will contain database schema details, route maps, and cross-reference information. For a **private repo**, this is an accepted risk — the documentation value outweighs the exposure. For repos that may become **public**, sensitive details must be handled:

- **RLS policy details:** Strip from committed docs. Queryable via MCP only.
- **Auth gap identification** (which routes lack auth): Strip from committed docs.
- **Table structures and foreign keys:** Include — these are standard documentation.
- **Server action permission maps:** Include — useful for onboarding.

If the repo is private and will remain so, commit all docs as-is and document this as an accepted risk.

### 10.3 File Template

Every generated file follows this template:

```markdown
---
generated: true
last_updated: 2026-04-16T14:30:00Z
source: graphify
project: barons-events-mvp
---

# [Section Title]

> Auto-generated by session-setup from the Graphify knowledge graph.
> Manual edits will be overwritten on next refresh.

[Content]
```

The `generated: true` frontmatter signals to both humans and agents that this file is machine-maintained. Persistent notes go in `docs/architecture/NOTES.md` (no frontmatter, never overwritten).

### 10.4 Cross-Reference Document (`relationships.md`)

The key differentiator — maps everything to everything:

**Database -> Code:**

| Table.Column | Used In | How |
|-------------|---------|-----|
| events.id | src/actions/events.ts:23 | CRUD operations |
| events.id | src/app/events/[id]/page.tsx:15 | Route parameter |
| events.status | src/components/EventCard.tsx:31 | Badge display |
| users.role | src/lib/roles.ts:12 | Permission checks |

**Components -> Usage:**

| Component | Used In | Props From |
|-----------|---------|-----------|
| EventCard | src/app/events/page.tsx:44 | events query |
| RoleGuard | src/app/admin/layout.tsx:12 | user session |

**Server Actions -> Consumers:**

| Action | Called From | Touches Tables |
|--------|-----------|---------------|
| createEvent | src/components/EventForm.tsx:89 | events, audit_log |
| deactivateUser | src/app/admin/users/page.tsx:56 | users, audit_log |

**Types -> Database Mapping:**

| TypeScript Type | DB Table | Conversion |
|----------------|----------|-----------|
| Event | events | inline conversion (no shared fromDb) |
| User | users | inline conversion (no shared fromDb) |

**Integration Touchpoints:**

| Service | Used In | Purpose |
|---------|---------|---------|
| Resend | src/lib/notifications.ts:15 | Event confirmation emails |
| qrcode | src/lib/qr.ts:8 | Ticket QR generation |

### 10.5 Enriched Existing Docs

Each doc includes back-references to the cross-reference map:

**In `data-model.md`**, each table gets:
```
Referenced by: 8 server actions, 12 components, 3 API routes
Full map: See relationships.md -> Database -> Code
```

**In `server-actions.md`**, each action gets:
```
Called from: EventForm.tsx, admin/events/[eventId]/page.tsx
Touches tables: events, audit_log (via src/lib/events.ts helpers)
```

### 10.6 Section Hash Optimisation

`.section-hashes.json` (gitignored):

```json
{
  "routes.md": "a1b2c3d4...",
  "data-model.md": "e5f6g7h8...",
  "server-actions.md": "i9j0k1l2...",
  "overview.md": "m3n4o5p6..."
}
```

Session-setup generates new content in memory, hashes it, compares against this registry. Only writes files where the hash differs. Updates the registry after writes.

If `.section-hashes.json` is missing or unparseable, treat all sections as changed and regenerate all docs.

**Note:** Section hashing only works reliably for mechanically-generated sections (tables, lists, cross-references). If any LLM-generated prose is included, output may vary per run and hashes will rarely match. Keep generated content structured and deterministic where possible.

Three layers of efficiency:

1. **Graphify SHA256 caching** — only reprocesses changed source files
2. **Changes manifest** — tells session-setup which doc sections are affected
3. **Section hashing** — prevents writes when the output hasn't actually changed

## 11. Graphify MCP Server & Git Hooks

### 11.1 MCP Server Configuration

Per-project in `.claude/settings.local.json` (command and module path are provisional — verify during Phase 0 spike):

```json
{
  "mcpServers": {
    "graphify": {
      "command": "python",
      "args": ["-m", "graphify.serve", "graphify-out/graph.json"],
      "env": {}
    }
  }
}
```

**Available MCP tools** (to be confirmed during Phase 0):
- `query_graph` — natural language queries ("show the auth flow", "what touches the events table")
- `get_node` — specific node details and metadata
- `get_neighbors` — all connected nodes (imports, callers, dependents)
- `shortest_path` — trace connections between two concepts

**MCP server is local-only.** It must not bind to network interfaces. The server inherits the security posture of the local machine — any MCP client can query the complete graph including database schema. This is acceptable for local development tooling.

**Lifecycle:**
- Claude Code auto-starts MCP servers at session init
- If graph.json doesn't exist yet (first clone), the server will fail to start — this is expected and triggers simple mode
- Session-setup should verify the MCP server is responding before relying on rich mode queries
- If the MCP server dies mid-session, agents fall back to reading `session-context.md` and using Grep/Read directly

### 11.2 Git Hooks

Installed via `graphify install` per project. **Audit the installed hook scripts before first use** to verify they only contain expected graphify commands (supply chain precaution).

| Hook | Trigger | Action |
|------|---------|--------|
| `post-commit` | After each commit | Background incremental rebuild (`graphify . --incremental &` with output redirected to log) |
| `post-checkout` | Branch switch | Background full rebuild with sentinel file (`graphify-out/.rebuilding`) |
| `post-merge` | After pull/merge | Background incremental rebuild |

**All hooks run graphify in the background** (fork and exit immediately) to avoid blocking the developer's terminal. The sentinel file `graphify-out/.rebuilding` signals to session-setup that a rebuild is in progress — wait briefly or warn "graph rebuild in progress, using stale data."

**Hook failure handling:** Wrap graphify in error handling: `graphify . --incremental || echo "Warning: graph rebuild failed" >&2`. A non-zero exit from post-commit does NOT abort the commit.

**Hook chaining:** Do not overwrite existing git hooks. If hooks already exist (Husky, lint-staged, custom), use a hook manager or append graphify as an additional step. Check for existing hooks before installing.

Git hooks only rebuild `graph.json` — they do NOT regenerate docs. Doc generation is session-setup's job.

### 11.3 Graceful Degradation

- If MCP server isn't running: agents fall back to reading `session-context.md` and using direct Grep/Read
- If `graph.json` is stale: session-setup compares commit hash in session-context.md against current HEAD. If diverged significantly, force rebuild.
- If Graphify isn't installed: entire system falls back to simple mode
- If Python version is incompatible: session-setup checks `python --version` meets minimum requirement before entering rich mode. If not, warn and fall back.

### 11.4 Gitignore

Add these entries to `.gitignore` **before any Graphify work begins:**

```
graphify-out/
.claude/changes-manifest.log
docs/architecture/.section-hashes.json
```

The graph, manifest, and section hashes are local developer artefacts — not committed. `docs/architecture/*.md` (except `.section-hashes.json`) IS committed since it's the human-readable output.

**Known limitation:** If a developer runs `git clean -fdx`, the changes manifest will be lost. Run `/session-setup full` afterward to ensure docs are current.

## 12. Simple Mode Fallback

For projects where Graphify isn't installed yet.

### 12.1 What Stays the Same

- Changes manifest + PostToolUse hook
- Structural change nudges
- Completion gate documentation check
- `docs/architecture/` directory structure and templates
- Section hashing for skip-write optimisation
- `.claude/session-context.md` format (minus graph-specific fields)
- Framework enrichment scanners (results written directly to docs instead of graph)

### 12.2 Capability Comparison

| Capability | Rich Mode | Simple Mode |
|-----------|-----------|-------------|
| Structure analysis | Graphify AST + graph queries | Glob + Read (flat listing) |
| Type extraction | Graph node traversal | Glob for `*.types.ts` + Read |
| Relationship mapping | Graph edge traversal | Grep for imports/references (best-effort) |
| Cross-references | `relationships.md` with full graph data | `relationships.md` with grep-based approximation |
| Agent queries mid-session | MCP server (query_graph, get_neighbors) | Read session-context.md + targeted Grep |
| God nodes / surprising connections | Graphify analysis | Not available |
| Database schema | Agent feeds graph nodes/edges | Agent produces markdown (current behaviour) |
| Enrichment scanners | Results fed into graph | Results written directly to docs |
| Graph visualisation | `graphify-out/graph.html` | Not available |

### 12.3 Migration Path (Simple -> Rich)

```bash
pip install graphifyy                # Install Graphify (note: double-y)
# Verify actual CLI binary name:
graphifyy --help                     # or graphify --help — check which works
graphifyy install                    # Install git hooks (audit hooks after install)
graphifyy .                          # Initial graph build — benchmark this
# Add MCP server to .claude/settings.local.json (see Section 11.1)
/session-setup full                  # Detects graph.json, switches to rich mode
```

**Prerequisites:** Python 3.10+ (verify minimum version during Phase 0 spike). Pin the graphifyy version in installation docs.

## 13. Token Efficiency Design

Three layers prevent unnecessary work:

1. **Graphify SHA256 caching** — on rebuild, only reprocesses files whose hash changed. A commit touching 3 files only re-analyses those 3 files.
2. **Changes manifest** — session-setup reads the manifest to know exactly which doc sections are affected. If only server actions changed, only regenerate `server-actions.md` and `relationships.md` — don't touch `routes.md`.
3. **Section-level hashing** — each generated markdown file's content is hashed. When session-setup regenerates a section from the graph, it compares the new hash against the existing one. If identical — skip the write entirely. No git noise, no wasted tokens.

## 14. Implementation Phasing

Given the adversarial review findings, implementation should be phased:

### Phase 0: Validation Spike (see Section 3)
- Install graphifyy, verify capabilities, benchmark performance
- Update this spec with confirmed CLI commands and MCP tool names
- Decision gate: proceed with rich mode or focus on simple mode only

### Phase 1: Simple Mode Improvements (no Graphify dependency)
- Overhaul session-setup skill: inline agents 4/5, restructure tier flow
- Implement changes manifest and PostToolUse hook
- Add manifest check to SessionStart hook (CACHE_ONLY upgrade)
- Implement framework enrichment scanners
- Generate `docs/architecture/*.md` (v1 — 5 docs)
- Add gitignore entries
- Consolidate hooks into single `session-setup-hooks.js`

### Phase 2: Rich Mode (after Phase 0 validates Graphify)
- Integrate Graphify graph as structural analysis engine
- Configure MCP server
- Install and audit git hooks
- Evolve database agent to graph feeder
- Feed enrichment scanner results into graph
- Enable graph-powered doc generation and MCP queries

### Phase 3: Expansion
- Add v2 docs (components, integrations, auth-and-permissions, environment)
- Roll out to additional projects
- Refine scanners based on per-project patterns
- Add God Nodes minimum threshold filtering

## 15. Open Questions (Discovery During Implementation)

1. **Database-to-graph ingestion mechanism** — Graphify's exact import API for external data (Supabase schema) needs investigation during Phase 0. Options: JSON import, temporary SQL files that Graphify can parse, or direct graph.json manipulation.
2. **Graphify MCP server stability** — the library is relatively new. Implementation should include error handling and graceful fallback if the MCP server crashes mid-session.
3. **Graph rebuild time** — benchmark on BaronsHub (148 files) during Phase 0 and set expectations. If > 5 seconds, git hooks must run in background.
4. **Enrichment scanner accuracy** — the grep-based approach for server action scanning (finding table names within functions) may miss indirect access via helpers. Validate against BaronsHub's actual patterns.
5. **Python dependency management** — no Python infrastructure exists in the workspace. Document as dev-only tooling dependency. Consider adding to `.dockerignore` if containerised.
6. **Generated docs merge conflicts** — multiple developers running session-setup on different branches will diverge `docs/architecture/*.md`. Consider adding `docs/architecture/*.md` to `.gitattributes` with `merge=ours` strategy.
