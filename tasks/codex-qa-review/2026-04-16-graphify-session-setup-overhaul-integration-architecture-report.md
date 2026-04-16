# Integration & Architecture Review: Graphify Session-Setup Overhaul

**Date:** 2026-04-16
**Spec:** `docs/superpowers/specs/2026-04-16-graphify-session-setup-overhaul-design.md`
**Reviewer role:** Integration & Architecture (adversarial)

---

## Verdict: 4 DEFECTS, 6 PREFERENCES, 2 OPEN RISKS

---

## DEFECTS (must fix before implementation)

### D1. Python runtime dependency in a pure Node.js/TypeScript project (COUPLING)

The spec introduces `pip install graphifyy` and a Python MCP server (`python -m graphify.serve`) into a project whose entire toolchain is Node.js (Next.js 16, Vitest, npm scripts). There is no `pyproject.toml`, no `requirements.txt`, no Python infrastructure.

**Consequences:**
- Every developer (and CI) needs Python 3 installed alongside Node.js
- No lockfile management for the Python dependency -- version drift across machines
- No existing pattern in the workspace for managing Python deps (21 projects, all Node.js)
- The MCP server config in `.claude/settings.local.json` assumes `python` is on PATH with `graphify` importable -- fragile

**Recommendation:** The spec acknowledges graceful degradation but does not address the dependency installation lifecycle. Require either (a) a `requirements.txt` / `pyproject.toml` at workspace root with CI integration, or (b) move to a containerised/npx-compatible distribution. If neither is feasible, document this as an explicit prerequisite in CLAUDE.md and `.claude/settings.local.json` comments.

### D2. Git hook collision risk (BOUNDARY VIOLATION)

The spec proposes `graphify install` writing `post-commit`, `post-checkout`, and `post-merge` hooks. The project currently has no custom git hooks (only `.sample` files exist). However:

- The GSD plugin already uses PreToolUse/PostToolUse hooks via Claude Code's hook system (`.claude/hooks/`)
- Husky, lint-staged, or similar tools may be added later
- `graphify install` would overwrite any future hooks silently -- the spec does not mention hook chaining (e.g., via `husky` or a multi-hook runner)
- Git hooks run synchronously before/after git operations. A slow `graphify . --incremental` in `post-commit` blocks the developer's terminal

**Recommendation:** Use a hook manager (husky is already standard in Node.js projects) or write wrapper hooks that call graphify as one step. Benchmark the incremental rebuild time on BaronsHub (148 files) and set a hard timeout (e.g., 5 seconds). If rebuild exceeds that, move to background execution.

### D3. State ownership ambiguity: who owns docs/architecture/*.md (STATE OWNERSHIP)

The spec creates machine-generated files in `docs/architecture/` that are committed to git, but also:
- Has a PreToolUse hook that warns against editing them
- Says "manual edits will be overwritten on next refresh"
- Provides `NOTES.md` as the escape hatch

Yet these files are in a directory that humans will naturally browse and edit. The `generated: true` frontmatter guard is a soft convention, not an enforcement mechanism. If a developer edits `routes.md` to fix an inaccuracy, the next session-setup silently destroys their fix.

**Recommendation:** Either (a) move generated docs to a clearly machine-owned directory (`docs/.generated/architecture/` or `graphify-out/docs/`) and symlink/copy for human consumption, or (b) implement a merge strategy that detects manual edits (git diff on frontmatter-marked files) and warns before overwriting. Option (a) is simpler and follows the pattern of `.next/` (build output) vs `src/` (source).

### D4. Changes manifest is a single-writer assumption in a multi-agent system (INTERFACE CONTRACT)

`.claude/changes-manifest.log` is an append-only log written by PostToolUse hooks. But:
- Multiple subagents can run in parallel (the spec itself dispatches parallel agents)
- File appends are not atomic across processes -- concurrent writes can interleave lines
- The manifest is truncated after consumption (Section 7.4), but what if a hook appends during consumption?
- There is no locking mechanism specified

**Recommendation:** Either (a) use a JSON array with atomic read-write-truncate via a lockfile, or (b) accept that the manifest is best-effort (which is fine for its advisory purpose) and document that explicitly. If (b), the "deduplicate by file path" step in 7.4 already handles most corruption gracefully.

---

## PREFERENCES (improve but not blocking)

### P1. Hook proliferation

The spec adds three new hook behaviours (manifest logger, doc guard, structural change detector) plus a completion gate. Combined with existing GSD hooks (`gsd-workflow-guard.js`, `gsd-context-monitor.js`, `gsd-prompt-guard.js`, `gsd-statusline.js`, `gsd-check-update.js`), every tool use now passes through 7+ hooks. Each hook parses stdin JSON and pattern-matches file paths.

**Concern:** Cumulative latency on every Edit/Write/Bash call. Each hook has a 3-second stdin timeout (observed in `gsd-workflow-guard.js`). Seven hooks x potential timeout = 21 seconds worst case.

**Suggestion:** Consolidate the three new hooks into a single `session-setup-hooks.js` that handles all three concerns in one process. The GSD hooks already demonstrate this pattern with `gsd-statusline.js` combining multiple status checks.

### P2. Section hash optimisation adds complexity for modest benefit

`.section-hashes.json` prevents unnecessary file writes. But `docs/architecture/` files are committed to git. Git itself is a content-addressed store -- writing identical content produces no diff and no commit noise. The three-layer caching (Graphify SHA256, manifest, section hashes) is architecturally sound but the third layer duplicates git's own behaviour.

**Suggestion:** Skip `.section-hashes.json` in v1. If doc regeneration proves slow (benchmark first), add it later.

### P3. Framework enrichment scanners duplicate Graphify's purpose

The five scanners (routes, server actions, env vars, integrations, auth) use Glob/Grep to extract structure -- exactly what Graphify's AST parsing already does. The spec says they "fill gaps Graphify's generic AST cannot cover," but the gaps are speculative (Section 13, item 4 acknowledges this).

**Suggestion:** Implement scanners as the simple-mode fallback (where they are clearly needed). For rich mode, validate which gaps actually exist after Graphify analysis before building duplicate extraction logic.

### P4. Per-project config file adds to .claude/ sprawl

`.claude/graphify-config.json` joins `session-context.md`, `settings.local.json`, `changes-manifest.log`, and `worktrees/`. This is manageable now but trending toward a complex `.claude/` directory.

**Suggestion:** Consider whether `graphify-config.json` can be a section within `settings.local.json` to reduce file count.

### P5. MCP server lifecycle is underspecified

The spec configures the MCP server in `.claude/settings.local.json` but does not address:
- How/when the server starts (Claude Code auto-starts MCP servers, but only at session init)
- What happens if `graph.json` does not exist yet (first clone)
- Whether the server survives a graph rebuild (does it detect file changes?)

**Suggestion:** Document the MCP server lifecycle explicitly. Add a health check to session-setup that verifies the MCP server is responding before switching to rich mode.

### P6. The "God Nodes" concept in session-context.md is novel but untested

Surfacing high-connectivity nodes is interesting but the usefulness depends on Graphify's edge quality. In a 148-file project, `getSupabaseServerClient` appearing in every server action is obvious, not surprising.

**Suggestion:** Include a "minimum connection threshold" config to filter noise. The "Surprising Connections" section is higher value -- prioritise that.

---

## OPEN RISKS

### R1. Graphify library maturity

The spec itself flags this (Section 13, items 2-3). The library is relatively new. The MCP server, import API, and incremental rebuild behaviour are all discovery tasks. If Graphify's API changes or the project is abandoned, the entire rich-mode architecture becomes tech debt.

**Mitigation already in spec:** Simple mode fallback. This is well-designed. Ensure the fallback is the default path and rich mode is an opt-in enhancement, not a requirement.

### R2. Generated docs committed to git create merge conflicts

When multiple developers work on different branches, each running session-setup, `docs/architecture/*.md` will diverge. On merge, these auto-generated files create conflicts that are meaningless to resolve manually.

**Mitigation:** Add `docs/architecture/*.md` to `.gitattributes` with `merge=ours` strategy, or generate docs only on the main branch via CI. Alternatively, do not commit them (add to `.gitignore` like `session-context.md`).

---

## ARCHITECTURAL FIT SUMMARY

| Dimension | Rating | Notes |
|-----------|--------|-------|
| Boundary respect | FAIR | Python/Node.js boundary is the main concern |
| Coupling | GOOD | Graceful degradation is well-designed |
| State ownership | POOR | Generated docs ownership is ambiguous |
| Interface contracts | FAIR | Manifest concurrency gap; MCP lifecycle gaps |
| Maintainability | FAIR | Hook proliferation and three-layer caching add complexity |
| Consistency with workspace patterns | FAIR | No precedent for Python deps or git hooks in this workspace |

**Overall:** The design is ambitious and well-structured. The graceful degradation (rich/simple mode) is the strongest architectural decision. The weakest points are the Python dependency boundary, generated file ownership, and hook proliferation. Fix D1-D4 before implementation; the preferences can be deferred to iteration.
