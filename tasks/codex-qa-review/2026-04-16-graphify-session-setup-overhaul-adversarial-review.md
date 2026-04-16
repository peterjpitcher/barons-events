# Adversarial Review: Graphify Session-Setup Overhaul

**Date:** 2026-04-16
**Mode:** Adversarial Challenge (Mode A)
**Engines:** Claude + Codex (full dual-engine)
**Scope:** Design spec at `docs/superpowers/specs/2026-04-16-graphify-session-setup-overhaul-design.md`
**Reviewers deployed:** Repo Reality Mapper (Codex), Assumption Breaker (Claude), Integration & Architecture (Claude), Workflow & Failure-Path (Claude), Security & Data Risk (Claude)

---

## Inspection Inventory

### Inspected
- The full design spec (614 lines)
- Current session-setup skill (`~/.claude/skills/session-setup/SKILL.md`)
- Current SessionStart hook (`~/.claude/hooks/session-setup.js`)
- Global settings (`~/.claude/settings.json`) — all hook configurations
- Project `.claude/settings.local.json` — permissions only, no MCP
- `.claude/session-context.md` — current cached snapshot (29 tables)
- `middleware.ts` (350+ lines) — auth flow, public paths, short-link rewrites
- `src/actions/` — 13 server action files (events.ts, bookings.ts, etc.)
- `src/lib/public-api/` — API auth, rate limiting, bearer key validation
- `src/lib/roles.ts`, `src/lib/types.ts` — role model and type definitions
- `src/app/` — 27 page.tsx files, 15 route.ts files
- `supabase/migrations/` — 59 migration files
- `.env.example`, `.gitignore`
- `docs/` — existing docs including stale TechStack.md and SupabaseSchema.md
- `package.json` — Node.js only, no Python infrastructure
- GSD hooks (`gsd-context-monitor.js`, `gsd-prompt-guard.js`, `gsd-statusline.js`)

### Not Inspected
- Live Supabase schema via MCP (would require runtime connection)
- Graphify runtime/API behaviour (not installed in this environment)
- Graphify MCP server actual tool interface (unverified)
- `graphify --incremental` flag existence (unverified)

### Limited Visibility Warnings
- All Graphify capability claims (MCP server, incremental rebuild, external data injection) are unverified
- The database-to-graph ingestion mechanism is "TBD" in the spec itself
- Scanner accuracy against this codebase's specific patterns is theoretical

---

## Executive Summary

The spec's vision is strong: a knowledge graph replacing flat file analysis, with cross-references, MCP querying, and auto-generated docs. The graceful degradation design (rich/simple mode) is well-thought-out. However, **the core value proposition rests on three unverified Graphify capabilities** (MCP server, database ingestion, incremental rebuild), and the review uncovered **6 blocking issues** spanning security, workflow integrity, and codebase fit. The simple-mode improvements (manifest, inline agents, enrichment scanners) are independently valuable and should ship first as a validation step.

---

## What Appears Solid

1. **Graceful degradation architecture** — The rich/simple mode split with `graph.json` detection is clean and well-specified. Simple mode preserves all current functionality while adding improvements.
2. **Nudge-don't-block philosophy** — Advisory hooks and deferred documentation updates are the right design for developer experience.
3. **Inlining agents 4 and 5** — Git state (4 bash commands) and lessons (read 2 files) never needed dedicated subagents. Clear efficiency win.
4. **The relationships.md concept** — Cross-reference documentation addresses a genuine gap. Even grep-based approximation in simple mode would be valuable.
5. **Three-layer token efficiency** — SHA256 caching, manifest-based targeting, and section hashing are architecturally sound.
6. **Per-project config** — `.claude/graphify-config.json` allows scanner customisation per project, essential for a 21-project workspace.

---

## Critical Risks (Must Address Before Implementation)

### CR-001: Graphify Core Capabilities Are Unverified
**Engines:** Both | **Severity:** Critical | **Confidence:** High

The spec builds the entire "rich mode" on three assumed Graphify capabilities:
1. MCP server (`python -m graphify.serve`) with `query_graph`, `get_node`, `get_neighbors`, `shortest_path` tools
2. External data injection (database schema as graph nodes/edges) — spec says "TBD"
3. `--incremental` flag for efficient rebuilds

None of these have been tested. The PyPI package is `graphifyy` (double-y) at v0.4.18. If any capability doesn't exist as assumed, the rich mode architecture collapses to reading flat files — which is what the current system already does.

**Action:** Validation spike required before implementation. Install `graphifyy`, run on BaronsHub, verify each capability.

### CR-002: Env Var Scanner Could Capture Live Secrets
**Engines:** Claude (Security) | **Severity:** Critical | **Confidence:** High

Section 6.3's env var scanner reads `.env.example` and greps for `process.env.`. If the implementation accidentally reads `.env.local` instead, live secrets (Supabase service role key, Resend API key, Turnstile secret) flow into `docs/architecture/environment.md`, which IS committed to git.

**Action:** Scanner MUST hardcode `.env.example` as the only env file to read. Add a pre-commit hook that blocks commits containing known secret patterns in `docs/architecture/`.

### CR-003: Committed Docs Expose Full Internal Architecture
**Engines:** Claude (Security) | **Severity:** Critical | **Confidence:** High

`docs/architecture/*.md` is committed and would contain: complete database schema with RLS policy details, all server action names with tables they mutate, full route map with auth requirements (including which routes LACK auth), middleware chain details, and cross-reference maps. This is a penetration tester's complete map.

**Action:** Either (a) gitignore the sensitive files (`data-model.md`, `auth-and-permissions.md`, `relationships.md`), (b) strip sensitive details from committed docs (RLS policies, auth gaps queryable via MCP only), or (c) accept as documented risk for a private repo.

### CR-004: CACHE_ONLY Never Consumes the Changes Manifest
**Engines:** Claude (Workflow) | **Severity:** Critical | **Confidence:** High

The SessionStart hook's staleness checks do NOT include `.claude/changes-manifest.log`. If a session defers doc updates, and subsequent sessions get CACHE_ONLY verdicts, the manifest entries persist indefinitely. The spec's "eventual consistency" promise (Section 8.5) is broken.

**Action:** Add manifest non-empty check to the SessionStart hook. If manifest exists and is non-empty, upgrade CACHE_ONLY to PARTIAL_REFRESH.

### CR-005: .gitignore Gap — First `git add .` Would Commit the Knowledge Graph
**Engines:** Both | **Severity:** Critical | **Confidence:** High

The current `.gitignore` does not contain entries for `graphify-out/`, `.claude/changes-manifest.log`, or `docs/architecture/.section-hashes.json`. The spec assumes these are gitignored (Section 10.4) but the entries haven't been added.

**Action:** Add gitignore entries before any Graphify work begins.

### CR-006: Scanner Complexity Massively Underestimated
**Engines:** Codex (RRM) | **Severity:** High | **Confidence:** High

The Codex Repo Reality Mapper found that the spec's simple grep-based scanners will fail against this codebase's actual patterns:

- **API auth is NOT `getUser`-based.** Public API uses `checkApiRateLimit()` and `requireWebsiteApiKey()` with bearer tokens. A scanner grepping for `getUser`/`requireAuth` misclassifies these routes.
- **Server actions call through domain helpers.** The actual `.from()` calls are in `src/lib/*`, not in the exported action functions. Grepping inside actions for table names misses most database access.
- **Middleware excludes `/api/*` entirely.** Route auth classification needs route-type awareness.
- **59 migration files with complex evolution.** Drops, renames, RPCs, `SECURITY DEFINER` functions, storage policies inside `do $$` blocks. Simple `CREATE TABLE` extraction fails.

**Action:** Scanners need import/call graph traversal (which Graphify should provide in rich mode). For simple mode, document known limitations and use Supabase live schema introspection for database rather than migration parsing.

---

## Spec Defects (Require Spec Revision)

### SD-001: Package Name Discrepancy
The spec uses `graphify` for CLI commands throughout but the PyPI package is `graphifyy`. `python -m graphify.serve` may not work if the module is `graphifyy`. Every CLI reference needs verification.

### SD-002: Bash Tool File Path Extraction is Unfeasible
Section 8.1 says the PostToolUse hook "reads the file path from the tool use event" for Bash. Bash events contain command strings, not structured file paths. Parsing `sed -i`, `mv`, `npm run build`, `git checkout --` is brittle and unreliable. Limit manifest logging to `Edit`, `Write`, and `MultiEdit` tools only.

### SD-003: Skill is Global but Rollout is "Project-by-Project"
The session-setup skill at `~/.claude/skills/session-setup/SKILL.md` is shared across all 21 projects. Any overhaul applies everywhere immediately. The per-project config provides toggles, but the fundamental flow change affects all projects from day one. A regression breaks onboarding for all projects simultaneously.

### SD-004: `.claude/rules/` Pattern Doesn't Exist in BaronsHub
Section 7.2's category detection includes `.claude/rules/**`. BaronsHub has no `.claude/rules/` directory — rules are at the parent workspace level (`/Users/peterpitcher/Cursor/.claude/rules/`). The pattern would miss rule edits entirely.

### SD-005: Structural Change Detector Over-Triggers
Section 8.3 fires nudges when `CLAUDE.md` or `.claude/rules/*` is edited. These are documentation files, not structural code changes. Editing CLAUDE.md to fix a typo triggers "Structural change detected" — alert fatigue.

### SD-006: `NOTES.md` Not Listed in Directory Structure
Section 8.2 mentions `docs/architecture/NOTES.md` as the escape hatch for persistent manual notes, but Section 9.1's directory listing doesn't include it.

### SD-007: 10 Generated Docs May Be Disproportionate
For a 237-file project, 10 generated architecture docs is a high documentation-to-code ratio. The estimated token cost of generating all 10 during FULL_REFRESH is unquantified. Consider starting with 4-5 high-value docs.

---

## Implementation Defects

### ID-001: Rich Mode Has No Defined Fallback When Graphify CLI Fails Mid-Flow
If `graph.json` EXISTS (from previous session) but `graphify . --incremental` FAILS (Python not installed, crash, permission denied), the spec doesn't define what happens. The system entered rich mode but can't rebuild the graph. Should it use stale graph? Fall to simple mode? Abort?

### ID-002: MCP Server Lifecycle Unspecified
No specification of: how/when the server starts, what happens if graph.json doesn't exist yet (first clone), whether the server survives a graph rebuild, or health checking.

### ID-003: MCP Server Returns Stale Data During Active Editing
The graph only rebuilds on commit (git hooks) and session start. During active editing, the graph is always behind. If an agent adds a new server action then queries "what server actions exist?", the new one won't appear. This is a reasonable trade-off but must be documented.

### ID-004: Manifest Concurrent Write Risk
Parallel subagents can write to `.claude/changes-manifest.log` simultaneously. File appends without locking can interleave lines. The deduplication step handles most corruption gracefully, so this is advisory — but document as best-effort.

---

## Architecture & Integration Defects

### AI-001: Python Runtime in Node.js Project
No Python infrastructure exists in the workspace (no `pyproject.toml`, `requirements.txt`, CI support). Every developer needs Python alongside Node.js. No lockfile management for the Python dependency.

### AI-002: Git Hook Collision Risk
`graphify install` writes raw git hooks with no chaining strategy and no timeout. No hook manager (Husky). Slow rebuilds could block developer terminals. Future hook additions risk overwriting.

### AI-003: Generated Docs Ownership Ambiguity
Machine-generated files in `docs/architecture/` are committed but silently overwritten on refresh. If a developer fixes an inaccuracy manually, next session-setup destroys their fix. The `generated: true` frontmatter is a soft convention, not enforcement.

### AI-004: Generated Docs Will Cause Merge Conflicts
Multiple developers on different branches running session-setup will diverge `docs/architecture/*.md`. These auto-generated conflicts are meaningless to resolve manually.

---

## Security & Data Risks

### SEC-001: Supply Chain Risk via Git Hooks
`graphifyy` (double-y package name) increases typosquat risk. Git hooks execute Python on every commit, checkout, and merge as the current user. A compromised package would execute malicious code on every git operation.

### SEC-002: MCP Server Exposes Full Graph to Any Connected Agent
No authentication or scoping. Any MCP client can query the complete graph including database schema and auth flow. Local-only (good), but not explicitly restricted from network binding.

### SEC-003: Changes Manifest Logs All File Paths
Includes `.env*` file paths. Gitignored (good), but if accidentally committed or read by exfiltration tool, reveals schema change hints and file tree structure.

---

## Recommended Fix Order

1. **Validation spike** — Install `graphifyy`, run on BaronsHub, verify MCP server, incremental rebuild, and data injection capabilities
2. **Add gitignore entries** — `graphify-out/`, `.claude/changes-manifest.log`, `docs/architecture/.section-hashes.json`
3. **Revise spec** — Fix all SD-001 through SD-007
4. **Decide committed docs strategy** — gitignore sensitive files OR strip sensitive data
5. **Add manifest check to SessionStart hook** — upgrade CACHE_ONLY when manifest is non-empty
6. **Phase the implementation** — Ship simple-mode improvements first, layer Graphify after spike validates capabilities
7. **Address Python boundary** — Pin version, document prereqs, audit hooks after install

---

## Follow-Up Review Required

- After Graphify validation spike: re-evaluate Sections 4-5 and 10 based on actual capabilities
- After scanner implementation: test against BaronsHub's actual patterns (API auth, action helpers, migration complexity)
- After first FULL_REFRESH in rich mode: benchmark token cost vs current 5-agent approach
