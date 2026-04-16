# Assumption Breaker Report: Graphify Session-Setup Overhaul

**Date:** 2026-04-16
**Spec:** `docs/superpowers/specs/2026-04-16-graphify-session-setup-overhaul-design.md`
**Reviewer role:** Assumption Breaker (adversarial)
**Codebase:** BaronsHub (237 TS/TSX files, 13 server action files, 60+ migrations, ~148 src files)

---

## Critical Findings

### 1. Graphify MCP Server Capability is Unverified
**Classification:** Unverified | **Severity:** Critical

The spec assumes Graphify exposes an MCP server (`graphify.serve`) with tools like `query_graph`, `get_node`, `get_neighbors`, `shortest_path`. The PyPI package `graphifyy` (note the double-y) is at v0.4.18. I checked: it is not currently installed, and the spec author acknowledges this is a "relatively new" library (Section 13, item 2). The spec builds the entire "rich mode" agent query experience on this MCP server existing with these exact tool names. If Graphify does not expose an MCP-compatible server -- or if its query interface differs from what's assumed -- the entire persistent query layer (Section 10.1) collapses to reading flat files, which is what the current system already does.

**Material risk:** The MCP server configuration in Section 10.1 uses `python -m graphify.serve` -- but the pip package is `graphifyy`, not `graphify`. This is either a typo or indicates confusion about the package name. The `import graphify` test fails on this machine.

### 2. Database-to-Graph Ingestion Has No Defined Mechanism
**Classification:** Unfounded | **Severity:** Critical

Section 5 admits: "exact mechanism TBD -- depends on Graphify's import API; this is a discovery task during implementation." This is the single most important integration point -- the thing that makes graph queries useful for "which server actions touch the events table?" -- and it has no design. Graphify parses source code via tree-sitter AST. Injecting external data (Supabase schema) into a code-analysis graph is not a standard feature of any AST-based tool. The spec assumes this is possible but provides zero evidence.

**Material risk:** If Graphify cannot accept external node/edge injection, the database agent produces a sidecar document anyway, and the "single source of truth" claim in Section 2 is false. You'd have the graph for code and a separate markdown file for the database -- which is what you have today.

### 3. Package Name Discrepancy: `graphifyy` vs `graphify`
**Classification:** Contradicted | **Severity:** High

The spec references `graphify` throughout (Section 11.3: `pip install graphifyy && graphify install`). The PyPI package is `graphifyy` (double y). The spec uses `graphify .` and `graphify install` as CLI commands, and `python -m graphify.serve` for MCP. If the actual module name is `graphifyy`, every command in the spec is wrong. The migration path in Section 11.3 actually shows the correct pip package name but then uses the wrong CLI command on the same line.

---

## High Severity Findings

### 4. Hook System Assumes Claude Code Exposes File Paths in PostToolUse Events
**Classification:** Unverified | **Severity:** High

Section 8.1 says the PostToolUse hook "reads the file path from the tool use event." The current hook (`session-setup.js`) is a SessionStart hook that runs `process.cwd()` and reads filesystem state. Claude Code hooks receive tool use events, but the spec assumes the event payload contains the exact file path for `Edit`, `Write`, and especially `Bash` operations. For `Bash` commands, there is no structured "file path" field -- a bash command like `git checkout -- src/foo.ts` or `npm run build` touches files indirectly. The spec hand-waves this with "(when Bash touches files)" but provides no mechanism to extract which files a Bash command modifies.

### 5. Cross-Workspace Skill Modification Affects All 21 Projects
**Classification:** Verified | **Severity:** High

The session-setup skill lives at `~/.claude/skills/session-setup/SKILL.md` -- it's a user-level skill shared across all 21 projects in the workspace. The spec proposes replacing 5 agents with Graphify + 1 database agent + inline checks. This overhaul will affect every project immediately. The "rollout: project-by-project" claim (spec header) contradicts the reality that the skill is global. The per-project config (`.claude/graphify-config.json`, Section 6.6) provides toggles, but the fundamental flow change (Graphify detection, manifest hooks, doc generation) applies everywhere from day one.

**Material risk:** A regression in session-setup breaks onboarding for all 21 projects simultaneously.

### 6. No `.claude/rules/` Directory Exists in BaronsHub
**Classification:** Contradicted | **Severity:** High

Section 7.2's category detection includes `.claude/rules/**` as a documentation trigger. The BaronsHub project has no `.claude/rules/` directory -- rules are loaded from the parent workspace at `/Users/peterpitcher/Cursor/.claude/rules/`. The manifest category detection would miss rule edits entirely because it pattern-matches against project-local paths. The spec assumes project-local `.claude/rules/` directories exist.

### 7. Server Actions Live in `src/actions/`, Not `src/app/actions/`
**Classification:** Verified (partial mismatch) | **Severity:** Medium

The spec's category detection (Section 7.2) lists patterns: `src/actions/**`, `**/actions/**`. The actual project uses `src/actions/` (13 files, 6074 total lines). The `**/actions/**` glob would also match `src/app/actions/` which doesn't exist. This works by accident -- the `src/actions/**` pattern catches the real location. However, the Route Scanner (Section 6.1) and Server Action Scanner (Section 6.2) grep for `'use server'` "across codebase" which is correct. No material bug here, but the spec's mental model of where actions live is slightly off from this project's actual structure.

---

## Medium Severity Findings

### 8. 10 Generated Docs for a 237-File Project is Disproportionate
**Classification:** Verified | **Severity:** Medium

Section 9.1 proposes 10 generated architecture docs (`README.md`, `overview.md`, `routes.md`, `data-model.md`, `server-actions.md`, `components.md`, `relationships.md`, `integrations.md`, `auth-and-permissions.md`, `environment.md`). BaronsHub has 237 TS/TSX files. This is a documentation-to-code ratio that creates significant maintenance burden even with automation. Each session-setup FULL_REFRESH would need to generate/validate all 10 files. The token cost of generating 10 markdown documents from graph queries -- even with section hashing -- is non-trivial.

**Question the spec doesn't answer:** What is the estimated token cost of a FULL_REFRESH in rich mode? The current 5-agent approach has a known cost. The proposed approach replaces it with graph rebuild + database agent + framework enrichment pass + 10 doc generations. Is this actually cheaper?

### 9. Git Hooks Conflict Risk with Existing Project Hooks
**Classification:** Unverified | **Severity:** Medium

Section 10.2 proposes `post-commit`, `post-checkout`, and `post-merge` git hooks installed via `graphify install`. The spec does not check whether the project already has git hooks (e.g., Husky, lint-staged, or custom hooks). BaronsHub's `package.json` may or may not have hook managers. Installing additional hooks via a Python tool risks overwriting existing hooks or creating ordering conflicts.

### 10. `middleware.ts` Location Assumption
**Classification:** Verified (with note) | **Severity:** Medium

Section 6.5 says "Read `middleware.ts` (if exists)". In BaronsHub, `middleware.ts` exists at the project root (`/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts`), not in `src/`. This is correct for Next.js App Router. However, the spec should be explicit about checking both locations since some projects in the workspace may use `src/middleware.ts` (the `src` directory approach).

### 11. Structural Change Detector Over-Triggers
**Classification:** Verified | **Severity:** Medium

Section 8.3 fires nudges when `.claude/rules/*` or `CLAUDE.md` is edited. These are documentation files that don't affect code structure. Editing `CLAUDE.md` to update a typo would trigger "Structural change detected" -- creating alert fatigue. The spec says "Only structural changes trigger nudges" but then includes documentation edits in the trigger list.

### 12. Incremental Rebuild Assumes Graphify Supports `--incremental` Flag
**Classification:** Unverified | **Severity:** Medium

Section 4.1 uses `graphify . --incremental`. Whether `graphifyy` v0.4.18 supports this flag is unverified. The spec also references "SHA256 -- only changed files" as if this is a known Graphify feature. If incremental mode doesn't exist, every rebuild is a full rebuild, which negates the efficiency claims in Section 12.

---

## Low Severity Findings

### 13. Changes Manifest is Gitignored but Persists Across Sessions
**Classification:** Verified | **Severity:** Low

Section 10.4 gitignores `.claude/changes-manifest.log`. This means the manifest survives between sessions (it's a local file) but is never committed. This is correct for the use case, but if a developer clones fresh or switches machines, the manifest doesn't travel. The spec doesn't address multi-machine workflows.

### 14. `.env.example` Exists but Env Scanner Cross-Reference Value is Low
**Classification:** Verified | **Severity:** Low

BaronsHub has 5 documented env vars in CLAUDE.md and a `.env.example` file. The Env Var Scanner (Section 6.3) would produce a small, mostly-obvious document. The cost-benefit of running this scanner on every session is questionable for a project this size.

### 15. Section Hashes Assume Deterministic Output
**Classification:** Unverified | **Severity:** Low

Section 9.5's skip-write optimization hashes generated content and compares. This only works if the generation is deterministic -- same inputs produce same outputs. If an LLM generates any of the doc content (which it would for rich natural-language descriptions), the output varies per run, and hashes never match. The hashing optimization only works for mechanically-generated sections.

---

## What the Spec Gets Right

- **Fallback design is sound.** The simple-mode fallback (Section 11) preserves all current functionality and adds incremental improvements (manifest, nudges, doc generation) without requiring Graphify.
- **Nudge-don't-block philosophy.** Section 8.5's design principle is correct -- blocking agents mid-task for documentation would be disruptive.
- **Inlining Agents 4 and 5.** Git state (4 bash commands) and lessons (read 2 files) never needed dedicated agents. This is a clear efficiency win regardless of Graphify.
- **The relationships.md concept.** Cross-reference documentation (Section 9.3) addresses a genuine gap in the current system. Even in simple mode with grep-based approximation, this would be valuable.
- **Per-project config.** Section 6.6's `.claude/graphify-config.json` allows scanner customization per project, which is necessary for a 21-project workspace.

---

## Recommendations

1. **Validate Graphify capabilities before finalizing spec.** Install `graphifyy`, run it on BaronsHub, verify: (a) MCP server exists, (b) `--incremental` flag works, (c) external data injection is possible. Update spec with findings.
2. **Prototype the database ingestion.** This is the spec's biggest unknown. Spike it before committing to the full design.
3. **Phase the rollout.** Ship simple-mode improvements first (manifest, inline agents 4/5, doc generation). Layer Graphify on top once capabilities are validated. The spec already supports this but doesn't make it the explicit plan.
4. **Fix the package name.** All references to `graphify` CLI commands need verification against `graphifyy`'s actual CLI interface.
5. **Scope the generated docs.** For a 237-file project, start with 3-4 high-value docs (relationships, data-model, server-actions, routes) rather than 10. Add others when proven useful.
6. **Address the hook file-path extraction problem.** Design the Bash command file-path detection explicitly, or scope the manifest hook to only Edit/Write events where the path is structured.

---

## Summary Scorecard

| Category | Score |
|----------|-------|
| Assumptions verified against codebase | 4/10 |
| Completeness (all cases handled) | 6/10 |
| Codebase fit (works with this repo) | 7/10 |
| Implementation readiness | 3/10 |
| Risk documentation | 5/10 |

**Bottom line:** The spec's vision is strong and the fallback design is well-thought-out. But the core value proposition -- Graphify as a knowledge graph replacing flat analysis -- rests on three unverified assumptions: MCP server availability, database ingestion mechanism, and incremental rebuild support. These must be validated with a spike before this spec should be implemented beyond simple-mode improvements.
