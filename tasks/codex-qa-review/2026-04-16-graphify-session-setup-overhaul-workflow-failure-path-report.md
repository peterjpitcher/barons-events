# Workflow & Failure-Path Review: Graphify Session-Setup Overhaul

**Date:** 2026-04-16
**Reviewer:** Workflow & Failure-Path Specialist
**Spec:** `docs/superpowers/specs/2026-04-16-graphify-session-setup-overhaul-design.md`
**Baseline:** `~/.claude/skills/session-setup/SKILL.md` + `~/.claude/hooks/session-setup.js`

---

## Severity Scale

| Level | Meaning |
|-------|---------|
| CRITICAL | Will break sessions or lose data in normal use |
| HIGH | Will cause failures in common edge cases |
| MEDIUM | Will cause confusion or degraded experience |
| LOW | Minor inefficiency or unclear behavior |

---

## Workflow A: Session Start (All 3 Tiers, Both Modes)

### A1. FULL_REFRESH Rich Mode — Graphify CLI fails during graph rebuild

**Sequence:** Session starts -> hook says FULL_REFRESH -> Step 1: `graphify . --incremental` fails (Python not installed, graphify not on PATH, graph.json corrupt, permission denied on graphify-out/).

**Issue (HIGH):** The spec says detection is "presence of `graphify-out/graph.json` signals rich mode" (Section 2). But what happens when graph.json EXISTS (from a previous session) but the rebuild command FAILS? The system detected rich mode, entered the rich-mode FULL_REFRESH flow, and then Step 1 fails. The spec does not define what happens next.

- Does it fall back to simple mode mid-flow?
- Does it retry?
- Does it abort the entire session-setup?
- Does it proceed with the stale graph.json?

**Recommendation:** Define an explicit fallback: "If `graphify . --incremental` exits non-zero, log a warning, delete the stale graph.json, and restart the flow in simple mode." This must be a clean restart, not a mid-flow switch, because Steps 2-5 in rich mode all depend on the graph.

### A2. FULL_REFRESH Rich Mode — Database ingestion agent fails

**Sequence:** Graph rebuilds fine -> Step 2: Database ingestion agent queries Supabase -> Supabase is unreachable (local Supabase stopped, network issue, credentials expired).

**Issue (MEDIUM):** The spec says the database agent "feeds into Graphify graph via JSON import or temporary SQL files (exact mechanism TBD)" (Section 5). If this agent fails, the graph has code nodes but no database nodes. All subsequent steps (session-context.md generation, docs/architecture/data-model.md, relationships.md) will produce output that is structurally wrong — it will look complete but silently omit all database relationships.

**Recommendation:** The database ingestion agent must report success/failure explicitly. On failure, session-context.md should contain a visible warning: `## Database Schema\n> WARNING: Database ingestion failed. Schema data is stale or missing.` The same warning should propagate to docs/architecture/data-model.md.

### A3. FULL_REFRESH Rich Mode — Framework enrichment scanners partially fail

**Sequence:** 5 scanners run as a single agent (Section 6). Scanner 3 (Env Var) finds no `.env.example`. Scanner 5 (Auth Tracer) can't find `middleware.ts`.

**Issue (LOW):** These are normal cases for some projects, not failures. But the spec doesn't distinguish between "scanner found nothing" and "scanner failed." If a scanner throws an error (e.g., permission denied reading a file), does the whole enrichment agent fail or do the other 4 scanners' results survive?

**Recommendation:** Each scanner should be independently fenced. The agent should collect results from all 5 scanners, marking each as `success`, `empty`, or `error`. Partial results are better than total failure.

### A4. PARTIAL_REFRESH — Manifest references files that no longer exist

**Sequence:** Session 1: Agent edits `src/actions/booking.ts` -> manifest logs it. Between sessions: user manually deletes that file. Session 2: PARTIAL_REFRESH reads manifest -> tries to rebuild for `server-action` category based on a deleted file.

**Issue (MEDIUM):** The manifest says "EDIT|src/actions/booking.ts" but the file is gone. The graph rebuild for that area will silently succeed (the file just won't be in the graph). But if the docs generation references the manifest entries directly, it could reference non-existent files.

**Recommendation:** During manifest consumption (Section 7.4 step 2), validate that each file path still exists. Log stale entries as "file removed since last session" and adjust the impact accordingly (a DELETE impact may need to regenerate docs differently than an EDIT impact).

### A5. CACHE_ONLY — session-context.md is corrupt or truncated

**Sequence:** Previous session crashed mid-write to session-context.md. New session starts -> hook sees the file exists and is recent -> verdict: CACHE_ONLY -> skill reads the file -> it's half-written.

**Issue (HIGH):** The current hook (`session-setup.js`) only checks if the file exists and its `last_updated` metadata. If the file is corrupt (e.g., truncated mid-write), the metadata extraction might fail silently (the catch block on line 48 swallows errors), and the hook could still emit CACHE_ONLY with `snapshotAgeHours: 'none'`. The skill would then try to read a broken file.

**Recommendation:** Add a basic integrity check to the hook: verify the file has the closing sections or a minimum expected length. If corrupt, force FULL_REFRESH. Alternatively, write to a temp file first and atomic-rename on completion.

### A6. Mode detection ambiguity — graph.json exists but is from a different branch

**Sequence:** User runs Graphify on `feat/booking` branch. Switches to `main`. Session starts. `graphify-out/graph.json` exists (rich mode detected), but its content reflects the booking branch, not main.

**Issue (HIGH):** Section 10.2 says `post-checkout` triggers a full graph rebuild. But this relies on git hooks being properly installed via `graphify install`. If the hooks aren't installed (user cloned the repo fresh, or hooks were cleared), the stale graph will be used silently.

**Recommendation:** The session-setup skill should compare the commit hash in session-context.md (or graph.json metadata, if it has one) against current HEAD. If they diverge by more than N commits, force a rebuild regardless of graph.json existence. The current hook already does this for session-context.md — extend the same logic to graph.json.

---

## Workflow B: During-Work (Hooks Firing, Manifest Logging)

### B1. PostToolUse hook fails to write to manifest

**Sequence:** Agent edits a file -> PostToolUse fires -> tries to append to `.claude/changes-manifest.log` -> file is locked, permission denied, or disk full.

**Issue (MEDIUM):** The spec says the hook is "just a log line" (Section 8.1). But if the append fails silently, the manifest will be incomplete. The next PARTIAL_REFRESH will miss those changes, producing stale docs.

**Recommendation:** If the hook can't append, it should emit a warning to the conversation. The hook should also create the file if it doesn't exist (first edit of a session).

### B2. Manifest grows unbounded during a long session

**Sequence:** Agent makes 200+ file edits in a single session (e.g., large refactor). Each fires the PostToolUse hook. The manifest grows to hundreds of lines.

**Issue (LOW):** Section 7.4 says "deduplicate by file path (keep latest action per file)." This handles it at consumption time, but during the session the file is append-only. Not a real problem, but worth noting that a 200-line log file with 50 unique paths will be deduplicated to 50 entries at consumption.

**No action needed** — the deduplication logic is sound. But document that the manifest is append-only and deduplication happens at consumption.

### B3. Bash tool edits files — how does the hook detect the file path?

**Sequence:** Agent runs `sed -i 's/foo/bar/' src/lib/utils.ts` via Bash tool. The PostToolUse hook fires for a Bash event.

**Issue (HIGH):** Section 8.1 says the hook fires on `Bash` "when Bash touches files" and "reads the file path from the tool use event." But Bash tool events contain the command string, not a structured file path. The hook would need to parse arbitrary bash commands to extract file paths. This is brittle — consider:
- `cat foo.ts > bar.ts`
- `mv src/old.ts src/new.ts`
- `npm run build` (touches hundreds of files)
- `git checkout -- src/lib/utils.ts`

**Recommendation:** Either (a) limit manifest logging to `Edit` and `Write` tool events only (where file paths are structured), or (b) define explicit patterns the hook will regex-match from Bash commands (e.g., `sed`, `mv`, `cp`, redirect operators). Option (a) is simpler and more reliable. Most structural changes go through Edit/Write anyway.

### B4. Structural change nudge fatigue

**Sequence:** Agent is refactoring 15 route files. Each triggers the structural change detector (Section 8.3). The agent receives 15 nudge messages in rapid succession.

**Issue (MEDIUM):** Nudge fatigue will cause agents to ignore the messages entirely, defeating the purpose. The spec says "only structural changes trigger nudges" but doesn't throttle them.

**Recommendation:** Add debouncing: "If more than 3 structural nudges have been injected in the current session, suppress further nudges and instead inject a single summary at the next natural pause: 'N structural changes logged this session — run /session-setup partial when ready.'"

### B5. Race condition — two parallel agents editing files simultaneously

**Sequence:** Two subagents are dispatched in parallel (common in this workspace). Both edit files. Both PostToolUse hooks fire. Both try to append to the same manifest file.

**Issue (MEDIUM):** Concurrent appends to the same file can interleave lines, producing corrupt entries (partial lines mixed together). This depends on the hook implementation — if it's a simple `fs.appendFileSync`, the OS may or may not guarantee atomic appends for short lines.

**Recommendation:** Use file locking (e.g., `lockfile` npm package) or write via atomic append (O_APPEND flag, which is atomic for writes under PIPE_BUF on POSIX systems — 4096 bytes, well above a single manifest line). Alternatively, use per-agent manifest files and merge them at consumption.

---

## Workflow C: Commit Workflow (Git Hooks Rebuilding Graph)

### C1. post-commit hook blocks the commit experience

**Sequence:** User commits -> post-commit fires -> `graphify . --incremental` starts -> takes 10+ seconds for a large project.

**Issue (MEDIUM):** Section 10.2 says "post-commit: incremental graph rebuild." The spec claims "keeps commits fast" but doesn't define a timeout or async strategy. If Graphify takes 10 seconds, every commit feels sluggish.

**Recommendation:** The post-commit hook should run Graphify in the background (fork and exit immediately). The hook script should be: `graphify . --incremental &` with output redirected to a log file. This is standard practice for post-commit hooks.

### C2. post-checkout full rebuild on large repo

**Sequence:** User switches branches -> post-checkout fires -> FULL rebuild (not incremental, per Section 10.2). For a 500-file project, this could take 30+ seconds.

**Issue (HIGH):** Branch switches are frequent during development. A full rebuild on every checkout will frustrate users enough to remove the hook.

**Recommendation:** Run post-checkout rebuild in the background. Add a sentinel file (e.g., `graphify-out/.rebuilding`) that session-setup checks — if present, wait briefly or warn "graph rebuild in progress, using stale data."

### C3. Git hooks not installed — silent degradation

**Sequence:** User clones repo -> opens Claude Code session -> hook sees no `graphify-out/graph.json` -> falls back to simple mode. User then runs `pip install graphifyy && graphify .` -> graph.json now exists. But git hooks are NOT installed (user skipped `graphify install`).

**Issue (MEDIUM):** The graph will never be updated by git hooks. It will silently go stale after every commit. Session-setup may not detect this because it compares commit hashes in session-context.md, not in graph.json.

**Recommendation:** During FULL_REFRESH in rich mode, check if `.git/hooks/post-commit` contains a graphify reference. If not, inject a one-time warning: "Graphify graph detected but git hooks not installed. Run `graphify install` to keep the graph fresh between sessions."

### C4. Graphify rebuild fails inside a git hook

**Sequence:** User commits -> post-commit fires -> graphify crashes (Python segfault, incompatible version, etc.) -> git hook exits non-zero.

**Issue (HIGH):** A non-zero exit from a post-commit hook does NOT abort the commit (the commit already happened), but it will print an error to the terminal. However, for `pre-commit` or `post-merge` hooks, unexpected behavior could occur. More importantly, if graphify crashes, `graph.json` may be left in a corrupt state (partially written).

**Recommendation:** The git hook script should wrap graphify in a try/catch: `graphify . --incremental || echo "Warning: graph rebuild failed"`. Also, graphify should write to a temp file and atomic-rename, but that's on the Graphify side.

---

## Workflow D: Task Completion (Documentation Check Gate)

### D1. Completion gate fires but no verification skill exists

**Sequence:** Section 8.4 says the gate "hooks into the existing `verification-before-completion` skill pattern." Agent finishes a task -> completion gate fires -> but the verification skill isn't installed or isn't configured for this project.

**Issue (MEDIUM):** The spec assumes a specific skill exists. If it doesn't, the completion gate silently never fires. No nudge, no documentation check, the manifest just grows until the next session.

**Recommendation:** The completion gate should be implemented as a standalone PostToolUse hook (firing on task-completion signals) rather than depending on another skill's existence. Or at minimum, document the dependency explicitly and check for it during setup.

### D2. Agent ignores the completion gate nudge

**Sequence:** Completion gate fires -> "Structural changes were made... Consider running /session-setup" -> Agent says "I'll note that for the next session" -> moves on. The manifest persists. Next session: user asks a quick question -> CACHE_ONLY tier -> manifest is NOT consumed (CACHE_ONLY doesn't read the manifest per Section 4.1).

**Issue (HIGH):** CACHE_ONLY tier (Section 4.1) only reads `session-context.md`, runs inline git check, and confirms. It does NOT consume the manifest. So if the previous session deferred documentation updates, and the new session gets CACHE_ONLY, the manifest grows stale. It will only be consumed on the next PARTIAL_REFRESH or FULL_REFRESH.

But the hook (`session-setup.js`) currently triggers PARTIAL_REFRESH when sections are stale — and the manifest is NOT one of the staleness signals in the hook. The hook checks: migration files, type files, and lessons files by mtime. It does NOT check `.claude/changes-manifest.log` existence or content.

**This means: if a user has short CACHE_ONLY sessions between larger work sessions, deferred manifest entries could persist indefinitely without being consumed.**

**Recommendation:** Add manifest existence/non-empty check to the SessionStart hook. If `.claude/changes-manifest.log` exists and is non-empty, upgrade CACHE_ONLY to PARTIAL_REFRESH. This is the single most important fix — without it, the "nudge, don't block / eventual consistency" promise (Section 8.5) is broken.

### D3. Multiple sessions defer — manifest accumulates entries across many sessions

**Sequence:** Session 1: 5 structural changes, deferred. Session 2 (CACHE_ONLY): quick fix, 2 more changes, deferred. Session 3 (CACHE_ONLY): question only, no changes. Session 4: finally gets FULL_REFRESH (24h elapsed).

**Issue (MEDIUM):** The manifest now has 7 entries spanning 4 sessions. The deduplication logic (Section 7.4) handles this correctly for files edited multiple times. But files created in session 1 and deleted in session 3 would appear as both CREATE and DELETE — the "keep latest action per file" logic would keep DELETE, which is correct. However, what about files that were created, then renamed? The manifest would have CREATE for old path and CREATE for new path, but no link between them.

**Recommendation:** This is acceptable behavior — the worst case is slightly over-broad doc regeneration, not incorrect output. Document this as expected behavior.

---

## Workflow E: Cross-Session (Manifest Persists Between Sessions)

### E1. Manifest is gitignored — lost on repo clean

**Sequence:** Section 10.4 says `.claude/changes-manifest.log` is gitignored. User runs `git clean -fdx` -> manifest is deleted -> next session has no knowledge of pending structural changes.

**Issue (MEDIUM):** This is by design (the manifest is a local artifact), but the consequence is that `git clean` silently resets the documentation debt tracker. The spec's "eventual consistency" guarantee is broken.

**Recommendation:** Accept this as a known limitation. But document it: "If you run `git clean -fdx`, the changes manifest will be lost. Run `/session-setup full` afterward to ensure docs are current."

### E2. Manifest format versioning

**Sequence:** The spec defines a specific manifest format (Section 7.1). Future versions may need additional fields (e.g., a session ID, or a change size metric). Old manifests from before the format change would fail to parse.

**Issue (LOW):** No versioning in the manifest format.

**Recommendation:** Add a header line: `# manifest-version: 1` as the first line. Consumer should check this and handle gracefully.

---

## Workflow F: Mode Detection (graph.json exists/doesn't)

### F1. graph.json exists but is empty (0 bytes)

**Sequence:** Graphify crashes during initial `graphify .` -> writes 0-byte graph.json -> session starts -> file exists -> rich mode detected -> MCP server fails to parse empty JSON -> all graph queries fail.

**Issue (HIGH):** The mode detection is purely based on file existence, not content validity.

**Recommendation:** Mode detection should validate graph.json: check file size > 0 AND that it parses as valid JSON AND contains at least one node. If any check fails, treat as simple mode and warn the user.

### F2. graph.json is valid but from a different project

**Sequence:** User copies a project directory, or `graphify-out/` leaks from a sibling project via misconfigured symlinks. The graph.json contains nodes for a completely different codebase.

**Issue (LOW):** Unlikely but worth noting. The session-context.md would contain "God Nodes" that don't exist in the current project.

**Recommendation:** graph.json metadata should include the project root path. Session-setup should verify it matches the current working directory.

---

## Workflow G: Fallback (Graphify Crashes, MCP Server Dies)

### G1. MCP server dies mid-session

**Sequence:** Session starts in rich mode -> MCP server is running -> agent queries `query_graph` -> works fine. 30 minutes later, MCP server process is killed (OOM, user closes terminal tab, Python error).

**Issue (HIGH):** Section 10.3 says "If MCP server isn't running: agents fall back to reading session-context.md." But this fallback is not automatic — the MCP tool call will simply fail with an error. The agent would need to know to retry via session-context.md. There is no mechanism in the spec for the agent to detect MCP server health or automatically switch strategies.

**Recommendation:** The session-setup skill should document a fallback instruction that gets injected into session-context.md: "If MCP queries fail, use Grep/Read against the codebase directly. The session-context.md contains a cached summary." Also consider a health-check wrapper that the agent can call before relying on MCP.

### G2. MCP server returns stale results (graph not rebuilt after changes)

**Sequence:** Agent edits files during the session -> graph.json is NOT rebuilt (graph only rebuilds on commit via git hooks) -> agent queries MCP -> gets pre-edit results.

**Issue (HIGH):** This is a fundamental design tension. The spec says graph rebuilds happen on git commits (Section 10.2) and at session start (Section 4.1). During active editing, the graph is always behind. If an agent adds a new server action and then queries "what server actions exist?", the new one won't appear.

**Recommendation:** Document this explicitly: "MCP queries reflect the last commit, not the current working tree. For current-session changes, check the changes manifest or use direct Grep." This is a trade-off worth making (rebuild on every edit would be too expensive), but agents need to be told about it.

### G3. Graphify Python version incompatibility

**Sequence:** User has Python 3.8 installed. Graphify requires Python 3.10+. `pip install graphifyy` succeeds but `graphify .` fails with a syntax error.

**Issue (MEDIUM):** The migration path (Section 11.3) shows `pip install graphifyy && graphify install` but doesn't check prerequisites.

**Recommendation:** Add a prerequisite check to the session-setup skill: before entering rich mode, verify `python --version` meets the minimum requirement. If not, warn and fall back to simple mode.

---

## Workflow H: Section Hash Comparison (Skip-Write Optimization)

### H1. .section-hashes.json is deleted or corrupt

**Sequence:** User deletes `docs/architecture/.section-hashes.json` (or it's never been created). Session-setup tries to compare hashes -> file missing.

**Issue (LOW):** Without the hash file, session-setup should treat all sections as "changed" and write everything. This is the correct degradation.

**Recommendation:** The spec should explicitly state: "If `.section-hashes.json` is missing or unparseable, treat all sections as changed and regenerate all docs."

### H2. Hash collision (different content, same hash)

**Issue (NEGLIGIBLE):** SHA256 collision probability is astronomically low. Not a real concern.

### H3. Docs committed to git but hashes file is local

**Sequence:** Section 9.1 shows `.section-hashes.json` in the `docs/architecture/` directory. Section 10.4 says `graphify-out/` and `.claude/changes-manifest.log` are gitignored — but does NOT mention `.section-hashes.json`. If it's committed, it will cause merge conflicts when two developers generate docs on different machines.

**Issue (MEDIUM):** The spec is ambiguous about whether `.section-hashes.json` is committed.

**Recommendation:** Clarify: either gitignore `.section-hashes.json` (and accept that every developer always regenerates all docs), or commit it (and accept occasional merge conflicts). Gitignoring is simpler.

---

## Workflow I: PreToolUse Hook — Generated Doc Guard

### I1. Agent overrides the guard and edits a generated file

**Sequence:** Section 8.2 says the guard is "non-blocking — agent can override if truly needed." Agent edits `docs/architecture/routes.md` directly. Next session-setup regenerates it, overwriting the manual edit.

**Issue (MEDIUM):** The spec acknowledges this ("Manual edits will be overwritten on next refresh" in the template). But the guard should tell the agent WHERE to put persistent notes.

**Recommendation:** The guard message already mentions `docs/architecture/NOTES.md`. Verify this file is excluded from regeneration. Add it to the spec's directory structure (Section 9.1) explicitly — it's mentioned in Section 8.2 but not listed in 9.1.

---

## Summary: Priority Fixes

### CRITICAL (0)
None — no data-loss or session-breaking issues in normal operation.

### HIGH (7)
1. **A1:** Graphify CLI fails during rich-mode FULL_REFRESH — no defined fallback path
2. **A5:** Corrupt session-context.md leads to broken CACHE_ONLY sessions
3. **A6:** Stale graph.json from wrong branch used silently
4. **B3:** Bash tool file path extraction is fundamentally brittle
5. **C2:** post-checkout full rebuild blocks branch switching
6. **D2:** CACHE_ONLY never consumes the manifest — breaks eventual consistency promise
7. **F1:** Empty/invalid graph.json triggers rich mode that immediately fails
8. **G1:** MCP server death mid-session has no automatic fallback
9. **G2:** MCP returns stale data during active editing — not documented

### MEDIUM (9)
1. **A2:** Database ingestion failure produces silently incomplete output
2. **B1:** Manifest append failure goes unnoticed
3. **B4:** Structural change nudge fatigue from rapid edits
4. **B5:** Race condition on concurrent manifest writes
5. **C1:** post-commit hook may block commit experience
6. **C3:** Git hooks not installed — graph silently goes stale
7. **D1:** Completion gate depends on unverified skill existence
8. **E1:** git clean deletes manifest — breaks eventual consistency
9. **H3:** .section-hashes.json commit status ambiguous
10. **I1:** NOTES.md not listed in directory structure

### LOW (4)
1. **A3:** Scanner failure vs. empty result not distinguished
2. **A4:** Manifest references deleted files
3. **E2:** No manifest format versioning
4. **F2:** graph.json from wrong project
5. **H1:** Missing hash file behavior not specified

---

## Top 3 Recommendations (Highest Impact)

1. **Add manifest check to the SessionStart hook (D2):** If `.claude/changes-manifest.log` is non-empty, upgrade CACHE_ONLY to PARTIAL_REFRESH. Without this, the entire "eventual consistency" architecture fails silently.

2. **Define explicit rich-mode fallback (A1, F1):** When graph.json is invalid or Graphify CLI fails, restart the flow in simple mode rather than crashing or using stale/corrupt data. Add validation: file exists AND size > 0 AND valid JSON.

3. **Limit manifest logging to Edit/Write tools only (B3):** Bash tool file path extraction is unreliable. The vast majority of structural changes go through Edit/Write, where file paths are structured data. Accept the small coverage gap for reliability.
