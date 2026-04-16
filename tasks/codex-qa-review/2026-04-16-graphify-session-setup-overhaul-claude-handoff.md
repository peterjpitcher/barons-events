# Claude Hand-Off Brief: Graphify Session-Setup Overhaul

**Generated:** 2026-04-16
**Review mode:** Adversarial Challenge (Mode A)
**Overall risk assessment:** High (unverified core dependency + security gaps in committed docs)

---

## DO NOT REWRITE

These areas are sound and should be preserved:

1. **Graceful degradation architecture** — rich/simple mode split with `graph.json` detection (Section 2)
2. **Nudge-don't-block philosophy** — advisory hooks, deferred updates (Section 8.5)
3. **Inlining agents 4 and 5** — git state and lessons don't need subagents (Section 4.3)
4. **The relationships.md concept** — cross-reference documentation (Section 9.3)
5. **Three-layer token efficiency design** — SHA256, manifest targeting, section hashing (Section 12)
6. **Per-project config via `.claude/graphify-config.json`** (Section 6.6)
7. **Changes manifest format** — append-only log with category/impact (Section 7.1)
8. **Tier decision flow** — FULL_REFRESH / PARTIAL_REFRESH / CACHE_ONLY logic (Section 4)

---

## SPEC REVISION REQUIRED

- [ ] **SR-001: Fix package name discrepancy.** The spec uses `graphify` for CLI commands but the PyPI package is `graphifyy`. Verify the actual CLI binary name and module path after installing. Update all references in Sections 4.1, 10.1, 10.2, 11.3, and 13.

- [ ] **SR-002: Remove Bash from manifest hook triggers.** Section 8.1 says "Fires on: Edit, Write, Bash (when Bash touches files)." Change to: "Fires on: Edit, Write, MultiEdit." Bash file path extraction is fundamentally unreliable. Add rationale: "Bash events contain command strings, not structured file paths. The vast majority of structural changes go through Edit/Write where paths are structured."

- [ ] **SR-003: Add MultiEdit to all hook triggers.** Current spec mentions Edit and Write but not MultiEdit. The existing PreToolUse guard (Section 8.2) would miss MultiEdit edits to generated docs. Add MultiEdit to Sections 8.1, 8.2, and 8.3 trigger lists.

- [ ] **SR-004: Add manifest check to SessionStart hook verdict logic.** Section 4 defines CACHE_ONLY as "Read session-context.md, inline git check, confirm." This breaks eventual consistency because the manifest is never consumed. Add: "If `.claude/changes-manifest.log` exists and is non-empty, upgrade CACHE_ONLY to PARTIAL_REFRESH." This is the single most important spec fix.

- [ ] **SR-005: Fix `.claude/rules/` path assumption.** Section 7.2 lists `.claude/rules/**` as a category trigger. BaronsHub has no project-level `.claude/rules/` — rules are at workspace level (`/Users/peterpitcher/Cursor/.claude/rules/`). Either check both locations or remove from category detection.

- [ ] **SR-006: Remove CLAUDE.md and `.claude/rules/*` from structural change triggers.** Section 8.3 fires nudges for documentation edits. These aren't structural code changes. Move to a separate "docs" category that only impacts the `docs` column, not `structure`.

- [ ] **SR-007: Add NOTES.md to directory structure.** Section 8.2 references `docs/architecture/NOTES.md` as the escape hatch. Add it to Section 9.1's directory listing.

- [ ] **SR-008: Define rich-mode fallback on Graphify CLI failure.** Add to Section 4.1: "If `graphify . --incremental` exits non-zero during FULL_REFRESH, log a warning, and restart the flow in simple mode. Do not use stale graph.json — the graph may be partially written."

- [ ] **SR-009: Add graph.json validation to mode detection.** Section 2 says detection is "presence of graphify-out/graph.json." Change to: "graph.json exists AND file size > 0 AND parses as valid JSON." Invalid graph.json triggers simple mode with a warning.

- [ ] **SR-010: Add commit hash validation to graph.json.** On session start, compare the graph's commit hash (if available in metadata) against current HEAD. If they diverge significantly and git hooks aren't installed, warn: "Graph may be stale — run `graphify .` or install hooks with `graphify install`."

- [ ] **SR-011: Document MCP stale data limitation.** Add to Section 10: "MCP queries reflect the last graph rebuild (typically last commit), not the current working tree. For changes made during the current session, use the changes manifest or direct Grep."

- [ ] **SR-012: Address committed docs security risk.** Add a new section addressing which docs are safe to commit vs which should be gitignored or have sensitive data stripped. Recommendation: gitignore `data-model.md`, `auth-and-permissions.md`, and `relationships.md` for private repos, or strip RLS policy details and auth gap information from committed versions.

- [ ] **SR-013: Add env scanner safety constraint.** Section 6.3: Add explicit constraint: "Scanner MUST only read `.env.example`. Never read `.env`, `.env.local`, or any `.env*.local` file. Never capture env var values — only names and which files reference them."

- [ ] **SR-014: Add nudge debouncing.** Section 8.3: "If more than 3 structural nudges have been injected in the current session, suppress further per-change nudges. Instead inject a single summary at the next natural pause."

- [ ] **SR-015: Add Phase 0 — Validation Spike.** Add a new section before implementation guidance: "Before implementing rich mode, run a validation spike: install graphifyy, run on BaronsHub, verify (a) MCP server exists and exposes expected tools, (b) --incremental flag works, (c) external data injection is possible. Update this spec with findings."

- [ ] **SR-016: Reduce initial doc count.** Section 9.1 lists 10 generated docs. For v1, start with 5 high-value docs: `overview.md`, `routes.md`, `data-model.md`, `server-actions.md`, `relationships.md`. Add `components.md`, `integrations.md`, `auth-and-permissions.md`, `environment.md` in v2 after proving the system works.

- [ ] **SR-017: Specify git hook execution strategy.** Section 10.2: Add that post-commit and post-merge hooks should run Graphify in the background (`graphify . --incremental &` with output redirected). post-checkout should use a sentinel file (`graphify-out/.rebuilding`) checked by session-setup. Document hook timeout strategy.

- [ ] **SR-018: Address scanner accuracy for this codebase.** Section 6 scanners assume simple patterns. Add notes: (a) Route Scanner must handle API routes using bearer auth, not just getUser; (b) Server Action Scanner must follow import chains into src/lib/ for actual DB access; (c) Auth Tracer must account for middleware excluding /api/* routes. Reference the Repo Reality Mapper findings.

---

## IMPLEMENTATION CHANGES REQUIRED

- [ ] **IC-001:** `~/.claude/hooks/session-setup.js` — Add manifest non-empty check to verdict logic. If `.claude/changes-manifest.log` exists and has content, set `staleSections.push('manifest')` and force at least PARTIAL_REFRESH.

- [ ] **IC-002:** `/Users/peterpitcher/Cursor/BARONS-BaronsHub/.gitignore` — Add entries: `graphify-out/`, `.claude/changes-manifest.log`, `docs/architecture/.section-hashes.json`

- [ ] **IC-003:** New hook should consolidate manifest logger + doc guard + structural change detector into a single `session-setup-hooks.js` file to avoid hook proliferation (7+ hooks per tool use).

---

## ASSUMPTIONS TO RESOLVE

- [ ] **A-001: Graphify MCP server exists and works as described.** If it doesn't, the entire rich-mode agent query experience needs redesign. Ask: What MCP tools does `graphifyy` actually expose? -> Install and test.

- [ ] **A-002: External data can be injected into a Graphify graph.** If not, the "single source of truth" claim fails — database schema stays as a sidecar document. Ask: Can graph.json be programmatically extended with non-AST nodes? -> Test with a minimal example.

- [ ] **A-003: `--incremental` flag exists.** If not, every rebuild is full, negating efficiency claims. Ask: What rebuild flags does `graphifyy` support? -> Check CLI help.

- [ ] **A-004: Graph rebuild time on BaronsHub.** The spec doesn't estimate time. 148 files is small, but tree-sitter parsing + relationship extraction could take 10-60 seconds. Ask: How long does `graphify .` take on a 148-file TypeScript project? -> Benchmark.

- [ ] **A-005: Committed docs risk is acceptable.** The security reviewer flagged that committed architecture docs expose the full attack surface. This is a product/business decision, not a technical one. Ask the user: Is this repo private-only? Is the architecture documentation valuable enough to commit despite the risk?

---

## REPO CONVENTIONS TO PRESERVE

- Server actions live in `src/actions/`, not `src/app/actions/`
- API auth uses `checkApiRateLimit()` + `requireWebsiteApiKey()` (bearer tokens), not `getUser`
- Roles are `administrator | office_worker | executive` (three roles, not four)
- No `fromDb<T>()` exists — conversion is inline per module
- Middleware excludes `/api/*` from auth checks
- Generated Supabase types are stale — code works around this with casts
- Database access often goes through `src/lib/*` helpers, not directly in actions

---

## RE-REVIEW REQUIRED AFTER FIXES

- [ ] **CR-001:** After Graphify validation spike — re-evaluate Sections 4-5, 10 based on actual capabilities
- [ ] **CR-006:** After scanner implementation — test against BaronsHub's API auth, action helpers, and migration patterns
- [ ] **CR-003:** After committed docs decision — verify sensitive data is stripped or gitignored as chosen
- [ ] **SD-004:** After hook implementation — verify CACHE_ONLY upgrade works when manifest has entries

---

## REVISION PROMPT

You are revising the Graphify Session-Setup Overhaul design spec based on an adversarial review.

Apply these changes in order:

1. **Add Phase 0 — Validation Spike** as a new Section 3.5, before any implementation starts
2. **Fix all 18 spec revisions** (SR-001 through SR-018) in the spec document
3. **Preserve these decisions:** graceful degradation, nudge-don't-block, inline agents 4/5, relationships.md, three-layer efficiency, per-project config
4. **Flag these for human decision:** committed docs security risk (SR-012), initial doc count (SR-016)
5. **Do not implement rich mode** until the validation spike (SR-015) confirms Graphify capabilities

After applying changes, confirm:
- [ ] All 18 spec revisions applied
- [ ] Phase 0 validation spike added
- [ ] No sound decisions were overwritten
- [ ] Security constraints (SR-012, SR-013) are explicit
- [ ] SessionStart hook manifest check (SR-004) is specified
- [ ] Bash removed from hook triggers (SR-002), MultiEdit added (SR-003)
