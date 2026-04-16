# Session-Setup Overhaul Phase 1 — Simple Mode Improvements

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overhaul the session-setup skill with changes manifest, consolidated hooks, framework enrichment scanners, and auto-generated architecture docs — all without requiring Graphify.

**Architecture:** A PostToolUse hook logs structural file changes to a manifest. The SessionStart hook detects non-empty manifests to upgrade CACHE_ONLY to PARTIAL_REFRESH. Session-setup inlines git/lessons agents, runs enrichment scanners, and generates `docs/architecture/*.md` with section hashing. All hooks consolidated into one file.

**Tech Stack:** Node.js (hooks), TypeScript (scanners run as Claude agents), Vitest (tests for hook logic)

**Spec:** `docs/superpowers/specs/2026-04-16-graphify-session-setup-overhaul-design.md` (Sections 5.2, 7-10, 12)

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `~/.claude/hooks/session-setup-hooks.js` | Consolidated PostToolUse + PreToolUse hook: manifest logger, doc guard, structural change detector |
| `~/.claude/hooks/__tests__/session-setup-hooks.test.js` | Unit tests for hook logic (category detection, manifest writing, nudge debouncing) |
| `docs/architecture/README.md` | Index of generated architecture docs |
| `docs/architecture/overview.md` | Architecture summary |
| `docs/architecture/routes.md` | Route inventory |
| `docs/architecture/data-model.md` | Database schema docs |
| `docs/architecture/server-actions.md` | Server action catalogue |
| `docs/architecture/relationships.md` | Cross-reference map |
| `docs/architecture/NOTES.md` | Persistent manual notes (never overwritten) |
| `docs/architecture/.section-hashes.json` | Hash registry for skip-write |

### Modified Files

| File | Change |
|------|--------|
| `~/.claude/hooks/session-setup.js` | Add manifest non-empty check to verdict logic |
| `~/.claude/skills/session-setup/SKILL.md` | Overhaul: inline agents 4/5, add enrichment pass, add doc generation, add manifest consumption |
| `~/.claude/settings.json` | Add new hook registrations |
| `.gitignore` | Add `graphify-out/`, `.claude/changes-manifest.log`, `docs/architecture/.section-hashes.json` |

---

## Task 1: Add Gitignore Entries

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Add new gitignore entries**

Add these lines to the end of `/Users/peterpitcher/Cursor/BARONS-BaronsHub/.gitignore`:

```
# Graphify / Session-Setup
graphify-out/
.claude/changes-manifest.log
docs/architecture/.section-hashes.json
```

- [ ] **Step 2: Verify entries**

Run: `grep -c "graphify-out" .gitignore`
Expected: `1`

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: add gitignore entries for graphify and session-setup artefacts"
```

---

## Task 2: Create Architecture Docs Scaffold

**Files:**
- Create: `docs/architecture/README.md`
- Create: `docs/architecture/NOTES.md`

- [ ] **Step 1: Create the README index**

Create `docs/architecture/README.md`:

```markdown
# Architecture Documentation

Auto-maintained by session-setup. Run `/session-setup full` to regenerate.

| Document | Covers | Status |
|----------|--------|--------|
| [Overview](overview.md) | God nodes, key relationships, architecture | Pending |
| [Routes](routes.md) | All pages and API endpoints | Pending |
| [Data Model](data-model.md) | Database schema, enums | Pending |
| [Server Actions](server-actions.md) | All mutations with permissions | Pending |
| [Relationships](relationships.md) | Cross-reference map | Pending |

For persistent notes that should not be overwritten, edit [NOTES.md](NOTES.md).
```

- [ ] **Step 2: Create the NOTES file**

Create `docs/architecture/NOTES.md`:

```markdown
# Architecture Notes

This file is for persistent manual notes. It is never overwritten by session-setup.
Add any observations, decisions, or context that should survive doc regeneration.
```

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/README.md docs/architecture/NOTES.md
git commit -m "chore: scaffold docs/architecture directory with README and NOTES"
```

---

## Task 3: Write Hook Logic Tests

**Files:**
- Create: `~/.claude/hooks/__tests__/session-setup-hooks.test.js`

These tests cover the core logic that the hook will use: category detection from file paths, impact mapping, manifest line formatting, and nudge debouncing. We write these first (TDD) so the hook implementation in Task 4 can be verified.

- [ ] **Step 1: Create the test file**

Create `~/.claude/hooks/__tests__/session-setup-hooks.test.js`:

```javascript
// Tests for session-setup-hooks.js logic functions
// Run: node --test ~/.claude/hooks/__tests__/session-setup-hooks.test.js

const { describe, it } = require('node:test');
const assert = require('node:assert');

// We'll import these from the hook module after Task 4
// For now, define the expected behaviour

describe('categoriseFile', () => {
  // Will import: const { categoriseFile } = require('../session-setup-hooks');

  const testCases = [
    ['src/app/events/page.tsx', { category: 'route', impacts: ['structure', 'docs'] }],
    ['src/app/api/v1/events/route.ts', { category: 'route', impacts: ['structure', 'docs'] }],
    ['src/actions/events.ts', { category: 'server-action', impacts: ['structure', 'docs'] }],
    ['supabase/migrations/20260416_add_booking.sql', { category: 'migration', impacts: ['database'] }],
    ['src/types/events.ts', { category: 'type', impacts: ['structure'] }],
    ['src/lib/events.types.ts', { category: 'type', impacts: ['structure'] }],
    ['src/components/EventCard.tsx', { category: 'component', impacts: ['structure'] }],
    ['src/lib/roles.ts', { category: 'utility', impacts: ['structure'] }],
    ['middleware.ts', { category: 'auth', impacts: ['structure', 'docs'] }],
    ['.env.example', { category: 'env', impacts: ['docs'] }],
    ['CLAUDE.md', { category: 'documentation', impacts: ['docs'] }],
    ['tasks/lessons.md', { category: 'lessons', impacts: ['lessons'] }],
    ['tasks/todo.md', { category: 'lessons', impacts: ['lessons'] }],
    ['src/components/EventCard.tsx', { category: 'component', impacts: ['structure'] }],
    ['package.json', null], // no match
    ['README.md', null],    // no match
  ];

  for (const [filePath, expected] of testCases) {
    it(`categorises ${filePath} as ${expected?.category || 'null'}`, () => {
      const { categoriseFile } = require('../session-setup-hooks');
      const result = categoriseFile(filePath);
      if (expected === null) {
        assert.strictEqual(result, null);
      } else {
        assert.strictEqual(result.category, expected.category);
        assert.deepStrictEqual(result.impacts, expected.impacts);
      }
    });
  }
});

describe('formatManifestLine', () => {
  it('formats a manifest entry correctly', () => {
    const { formatManifestLine } = require('../session-setup-hooks');
    const line = formatManifestLine('EDIT', 'src/actions/events.ts', 'server-action', ['structure', 'docs']);
    // Format: timestamp|action|file_path|category|impact
    const parts = line.split('|');
    assert.strictEqual(parts.length, 5);
    assert.match(parts[0], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/); // ISO timestamp
    assert.strictEqual(parts[1], 'EDIT');
    assert.strictEqual(parts[2], 'src/actions/events.ts');
    assert.strictEqual(parts[3], 'server-action');
    assert.strictEqual(parts[4], 'structure,docs');
  });
});

describe('isStructuralChange', () => {
  it('returns true for new route files', () => {
    const { isStructuralChange } = require('../session-setup-hooks');
    assert.strictEqual(isStructuralChange('src/app/bookings/page.tsx', 'route'), true);
  });

  it('returns true for new action files', () => {
    const { isStructuralChange } = require('../session-setup-hooks');
    assert.strictEqual(isStructuralChange('src/actions/booking.ts', 'server-action'), true);
  });

  it('returns true for migration files', () => {
    const { isStructuralChange } = require('../session-setup-hooks');
    assert.strictEqual(isStructuralChange('supabase/migrations/20260416.sql', 'migration'), true);
  });

  it('returns true for middleware', () => {
    const { isStructuralChange } = require('../session-setup-hooks');
    assert.strictEqual(isStructuralChange('middleware.ts', 'auth'), true);
  });

  it('returns false for component edits', () => {
    const { isStructuralChange } = require('../session-setup-hooks');
    assert.strictEqual(isStructuralChange('src/components/EventCard.tsx', 'component'), false);
  });

  it('returns false for utility edits', () => {
    const { isStructuralChange } = require('../session-setup-hooks');
    assert.strictEqual(isStructuralChange('src/lib/utils.ts', 'utility'), false);
  });

  it('returns false for documentation edits', () => {
    const { isStructuralChange } = require('../session-setup-hooks');
    assert.strictEqual(isStructuralChange('CLAUDE.md', 'documentation'), false);
  });
});

describe('isGeneratedDoc', () => {
  it('returns true for docs/architecture/*.md files', () => {
    const { isGeneratedDoc } = require('../session-setup-hooks');
    assert.strictEqual(isGeneratedDoc('docs/architecture/routes.md'), true);
    assert.strictEqual(isGeneratedDoc('/full/path/docs/architecture/data-model.md'), true);
  });

  it('returns false for NOTES.md', () => {
    const { isGeneratedDoc } = require('../session-setup-hooks');
    assert.strictEqual(isGeneratedDoc('docs/architecture/NOTES.md'), false);
  });

  it('returns false for README.md', () => {
    const { isGeneratedDoc } = require('../session-setup-hooks');
    assert.strictEqual(isGeneratedDoc('docs/architecture/README.md'), false);
  });

  it('returns false for non-architecture docs', () => {
    const { isGeneratedDoc } = require('../session-setup-hooks');
    assert.strictEqual(isGeneratedDoc('docs/TechStack.md'), false);
  });
});

describe('shouldDebounceNudge', () => {
  it('allows first 3 nudges', () => {
    const { shouldDebounceNudge } = require('../session-setup-hooks');
    assert.strictEqual(shouldDebounceNudge(1), false);
    assert.strictEqual(shouldDebounceNudge(2), false);
    assert.strictEqual(shouldDebounceNudge(3), false);
  });

  it('debounces after 3 nudges', () => {
    const { shouldDebounceNudge } = require('../session-setup-hooks');
    assert.strictEqual(shouldDebounceNudge(4), true);
    assert.strictEqual(shouldDebounceNudge(10), true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test ~/.claude/hooks/__tests__/session-setup-hooks.test.js`
Expected: All tests FAIL with `Cannot find module '../session-setup-hooks'`

---

## Task 4: Implement the Consolidated Hook

**Files:**
- Create: `~/.claude/hooks/session-setup-hooks.js`

This single file handles three hook behaviours: manifest logger (PostToolUse), generated doc guard (PreToolUse), and structural change detector (PostToolUse).

- [ ] **Step 1: Write the hook implementation**

Create `~/.claude/hooks/session-setup-hooks.js`:

```javascript
#!/usr/bin/env node
// session-setup-hooks — Consolidated PostToolUse + PreToolUse hook
// Handles: manifest logging, generated doc guard, structural change nudges
//
// PostToolUse (Edit|Write|MultiEdit): log file changes to manifest, nudge on structural changes
// PreToolUse (Write|Edit|MultiEdit): warn when editing generated docs
//
// All behaviours are advisory (non-blocking). Failures are silent.

const fs = require('fs');
const path = require('path');
const os = require('os');

// --- Category Detection Rules (spec Section 8.2) ---
const CATEGORY_RULES = [
  { pattern: /(?:^|\/)src\/app\/.*\/page\.tsx$/, category: 'route', impacts: ['structure', 'docs'] },
  { pattern: /\/route\.ts$/, category: 'route', impacts: ['structure', 'docs'] },
  { pattern: /(?:^|\/)src\/actions\//, category: 'server-action', impacts: ['structure', 'docs'] },
  { pattern: /(?:^|\/)supabase\/migrations\//, category: 'migration', impacts: ['database'] },
  { pattern: /(?:^|\/)src\/types\//, category: 'type', impacts: ['structure'] },
  { pattern: /\.types\.ts$/, category: 'type', impacts: ['structure'] },
  { pattern: /(?:^|\/)src\/components\//, category: 'component', impacts: ['structure'] },
  { pattern: /(?:^|\/)src\/lib\//, category: 'utility', impacts: ['structure'] },
  { pattern: /(?:^|\/)middleware\.ts$/, category: 'auth', impacts: ['structure', 'docs'] },
  { pattern: /(?:^|\/)\.env\.example$/, category: 'env', impacts: ['docs'] },
  { pattern: /(?:^|\/)CLAUDE\.md$/, category: 'documentation', impacts: ['docs'] },
  { pattern: /(?:^|\/)tasks\/lessons\.md$/, category: 'lessons', impacts: ['lessons'] },
  { pattern: /(?:^|\/)tasks\/todo\.md$/, category: 'lessons', impacts: ['lessons'] },
];

// Structural change categories — triggers nudge to agent
const STRUCTURAL_CATEGORIES = new Set(['route', 'server-action', 'migration', 'auth', 'env']);

// Max nudges before debouncing
const MAX_NUDGES_BEFORE_DEBOUNCE = 3;

// --- Exported Logic Functions (testable) ---

function categoriseFile(filePath) {
  const normalised = filePath.replace(/\\/g, '/');
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(normalised)) {
      return { category: rule.category, impacts: rule.impacts };
    }
  }
  return null;
}

function formatManifestLine(action, filePath, category, impacts) {
  const ts = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  return `${ts}|${action}|${filePath}|${category}|${impacts.join(',')}`;
}

function isStructuralChange(filePath, category) {
  return STRUCTURAL_CATEGORIES.has(category);
}

function isGeneratedDoc(filePath) {
  const normalised = filePath.replace(/\\/g, '/');
  if (!normalised.includes('docs/architecture/')) return false;
  const basename = path.basename(normalised);
  if (basename === 'NOTES.md' || basename === 'README.md' || basename === '.section-hashes.json') return false;
  return basename.endsWith('.md');
}

function shouldDebounceNudge(nudgeCount) {
  return nudgeCount > MAX_NUDGES_BEFORE_DEBOUNCE;
}

// --- Export for testing ---
if (typeof module !== 'undefined') {
  module.exports = { categoriseFile, formatManifestLine, isStructuralChange, isGeneratedDoc, shouldDebounceNudge };
}

// --- Hook Execution (only when run directly, not when required for tests) ---
if (require.main === module) {
  let input = '';
  const stdinTimeout = setTimeout(() => process.exit(0), 5000);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => input += chunk);
  process.stdin.on('end', () => {
    clearTimeout(stdinTimeout);
    try {
      const data = JSON.parse(input);
      const hookEvent = data.hook_event_name || '';
      const toolName = data.tool_name || '';
      const cwd = data.cwd || process.cwd();

      // --- PreToolUse: Generated Doc Guard ---
      if (hookEvent === 'PreToolUse') {
        const filePath = data.tool_input?.file_path || '';
        if (isGeneratedDoc(filePath)) {
          const output = {
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              additionalContext: 'This file is auto-generated by session-setup. Edit the source code instead — docs will regenerate on next session. If you need persistent notes, use docs/architecture/NOTES.md'
            }
          };
          process.stdout.write(JSON.stringify(output));
        }
        process.exit(0);
      }

      // --- PostToolUse: Manifest Logger + Structural Change Detector ---
      if (hookEvent === 'PostToolUse') {
        const filePath = data.tool_input?.file_path || '';
        if (!filePath) process.exit(0);

        // Make path relative to cwd
        const relativePath = filePath.startsWith(cwd)
          ? filePath.slice(cwd.length + 1)
          : filePath;

        const result = categoriseFile(relativePath);
        if (!result) process.exit(0);

        // Determine action from tool name
        const action = toolName === 'Write' ? 'CREATE' : 'EDIT';

        // Append to manifest
        const manifestPath = path.join(cwd, '.claude', 'changes-manifest.log');
        const manifestDir = path.join(cwd, '.claude');
        try {
          if (!fs.existsSync(manifestDir)) fs.mkdirSync(manifestDir, { recursive: true });

          // Check if manifest needs version header
          let needsHeader = !fs.existsSync(manifestPath);
          const line = formatManifestLine(action, relativePath, result.category, result.impacts);
          const content = needsHeader
            ? `# manifest-version: 1\n${line}\n`
            : `${line}\n`;
          fs.appendFileSync(manifestPath, content);
        } catch (e) {
          // Silent fail on manifest write — emit warning to conversation
          const output = {
            hookSpecificOutput: {
              hookEventName: 'PostToolUse',
              additionalContext: `Warning: Could not write to changes manifest at ${manifestPath}: ${e.message}`
            }
          };
          process.stdout.write(JSON.stringify(output));
          process.exit(0);
        }

        // Structural change nudge (with debouncing)
        if (isStructuralChange(relativePath, result.category)) {
          const nudgeFile = path.join(os.tmpdir(), `session-setup-nudge-${data.session_id || 'unknown'}.json`);
          let nudgeCount = 0;
          try {
            if (fs.existsSync(nudgeFile)) {
              nudgeCount = JSON.parse(fs.readFileSync(nudgeFile, 'utf8')).count || 0;
            }
          } catch (e) { /* ignore */ }

          nudgeCount++;
          try {
            fs.writeFileSync(nudgeFile, JSON.stringify({ count: nudgeCount }));
          } catch (e) { /* ignore */ }

          if (!shouldDebounceNudge(nudgeCount)) {
            const output = {
              hookSpecificOutput: {
                hookEventName: 'PostToolUse',
                additionalContext: `Structural change detected: ${result.category} file edited (${relativePath}). The changes manifest has been updated. When you finish this task, run /session-setup partial to refresh docs or note it for the next session.`
              }
            };
            process.stdout.write(JSON.stringify(output));
          } else if (nudgeCount === MAX_NUDGES_BEFORE_DEBOUNCE + 1) {
            // One summary nudge when debouncing kicks in
            const output = {
              hookSpecificOutput: {
                hookEventName: 'PostToolUse',
                additionalContext: `${nudgeCount} structural changes logged this session. Further per-change nudges suppressed. Run /session-setup partial when ready.`
              }
            };
            process.stdout.write(JSON.stringify(output));
          }
        }

        process.exit(0);
      }
    } catch (e) {
      // Silent fail — never block tool execution
      process.exit(0);
    }
  });
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `node --test ~/.claude/hooks/__tests__/session-setup-hooks.test.js`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add ~/.claude/hooks/session-setup-hooks.js ~/.claude/hooks/__tests__/session-setup-hooks.test.js
git commit -m "feat: add consolidated session-setup hooks with manifest logging and doc guard"
```

---

## Task 5: Register Hooks in Global Settings

**Files:**
- Modify: `~/.claude/settings.json`

- [ ] **Step 1: Add PostToolUse hook registration**

In `~/.claude/settings.json`, add a new entry to the `PostToolUse` array (after the existing `gsd-context-monitor` entry):

```json
{
  "matcher": "Edit|Write|MultiEdit",
  "hooks": [
    {
      "type": "command",
      "command": "node \"/Users/peterpitcher/.claude/hooks/session-setup-hooks.js\"",
      "timeout": 5
    }
  ]
}
```

- [ ] **Step 2: Add PreToolUse hook registration**

In `~/.claude/settings.json`, add a new entry to the `PreToolUse` array (after the existing `gsd-prompt-guard` entry):

```json
{
  "matcher": "Write|Edit|MultiEdit",
  "hooks": [
    {
      "type": "command",
      "command": "node \"/Users/peterpitcher/.claude/hooks/session-setup-hooks.js\"",
      "timeout": 5
    }
  ]
}
```

- [ ] **Step 3: Verify settings are valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync(process.env.HOME + '/.claude/settings.json', 'utf8')); console.log('Valid JSON')"`
Expected: `Valid JSON`

- [ ] **Step 4: Commit**

```bash
git add ~/.claude/settings.json
git commit -m "feat: register session-setup hooks in global settings"
```

---

## Task 6: Update SessionStart Hook — Manifest Check

**Files:**
- Modify: `~/.claude/hooks/session-setup.js`

The critical fix: if `.claude/changes-manifest.log` exists and is non-empty, upgrade CACHE_ONLY to PARTIAL_REFRESH so deferred doc updates are eventually consumed.

- [ ] **Step 1: Add manifest staleness check**

In `~/.claude/hooks/session-setup.js`, after the existing staleness checks (around line 92, after the lessons staleness check), add:

```javascript
  // Manifest staleness — if changes were logged but not consumed, force refresh
  const manifestPath = path.join(cwd, '.claude', 'changes-manifest.log');
  try {
    if (fs.existsSync(manifestPath)) {
      const manifestContent = fs.readFileSync(manifestPath, 'utf8').trim();
      // Check if manifest has actual entries (not just the version header)
      const lines = manifestContent.split('\n').filter(l => l && !l.startsWith('#'));
      if (lines.length > 0) {
        staleSections.push('manifest');
      }
    }
  } catch { /* manifest unreadable — skip */ }
```

- [ ] **Step 2: Verify the hook still outputs valid verdict**

Run: `cd /Users/peterpitcher/Cursor/BARONS-BaronsHub && node ~/.claude/hooks/session-setup.js`
Expected: Output containing `VERDICT:` and `STALE_SECTIONS:` — if manifest has entries, verdict should be `PARTIAL_REFRESH` and stale sections should include `manifest`.

- [ ] **Step 3: Test with empty manifest**

Run:
```bash
# Create empty manifest (just header)
echo "# manifest-version: 1" > .claude/changes-manifest.log
cd /Users/peterpitcher/Cursor/BARONS-BaronsHub && node ~/.claude/hooks/session-setup.js
```
Expected: Verdict should remain `CACHE_ONLY` (empty manifest doesn't trigger refresh).

- [ ] **Step 4: Test with non-empty manifest**

Run:
```bash
echo "# manifest-version: 1
2026-04-16T14:30:00Z|EDIT|src/app/events/page.tsx|route|structure" > .claude/changes-manifest.log
cd /Users/peterpitcher/Cursor/BARONS-BaronsHub && node ~/.claude/hooks/session-setup.js
```
Expected: Verdict should be `PARTIAL_REFRESH` with `manifest` in stale sections.

- [ ] **Step 5: Clean up test manifest**

Run: `rm -f /Users/peterpitcher/Cursor/BARONS-BaronsHub/.claude/changes-manifest.log`

- [ ] **Step 6: Commit**

```bash
git add ~/.claude/hooks/session-setup.js
git commit -m "feat: SessionStart hook upgrades CACHE_ONLY when manifest has entries"
```

---

## Task 7: Overhaul Session-Setup Skill — Part 1 (Inline Agents + Manifest)

**Files:**
- Modify: `~/.claude/skills/session-setup/SKILL.md`

This is the largest change. We break it into two tasks: Part 1 handles inlining agents 4/5 and adding manifest consumption. Part 2 (Task 8) adds the enrichment pass and doc generation.

- [ ] **Step 1: Replace Agent 4 (Git State) with inline instructions**

In `~/.claude/skills/session-setup/SKILL.md`, replace the `### Agent 4 -- Git State` section (lines ~185-203) with:

````markdown
### Inline: Git State (replaces Agent 4)

No agent needed. Run these commands directly using the Bash tool:

```bash
git branch --show-current
git status --short
git log --oneline -15
git stash list
```

Format as:

```markdown
## Git State
**Branch:** <branch name>
**Working tree:** <clean / N modified, N untracked>
**Stashes:** <count or "none">

### Recent Commits
<numbered list of last 15 commits>
```
````

- [ ] **Step 2: Replace Agent 5 (Lessons) with inline instructions**

Replace the `### Agent 5 -- Lessons & TODOs` section (lines ~205-225) with:

````markdown
### Inline: Lessons & TODOs (replaces Agent 5)

No agent needed. Read these files directly using the Read tool:

1. `tasks/lessons.md` — if it exists, include as bullet list
2. `tasks/todo.md` — if it exists, include as checklist

Format as:

```markdown
## Lessons
<bullet list, or "No lessons file found.">

## TODOs
<checklist, or "No TODO file found.">
```
````

- [ ] **Step 3: Add manifest consumption to PARTIAL_REFRESH tier**

In the `## Tier 2 -- PARTIAL_REFRESH` section, add after step 2:

````markdown
2b. Check `.claude/changes-manifest.log`:
    - If it exists and has entries (lines not starting with `#`):
      - Parse each line: `timestamp|action|file_path|category|impact`
      - Collect unique impacts across all entries
      - Add corresponding sections to the refresh list:
        - `structure` impact → refresh structure, types
        - `database` impact → refresh database schema
        - `docs` impact → flag for doc regeneration (Task 8)
        - `lessons` impact → refresh lessons
    - After processing, truncate the manifest to just `# manifest-version: 1\n`
    - Validate file paths still exist; log "file removed since last session" for missing files
````

- [ ] **Step 4: Add manifest consumption to FULL_REFRESH tier**

In the `## Tier 3 -- FULL_REFRESH` section, add as the final step:

````markdown
6. Consume and clear `.claude/changes-manifest.log` (if it exists):
   - Truncate to just `# manifest-version: 1\n`
   - No need to parse — full refresh covers everything
````

- [ ] **Step 5: Commit**

```bash
git add ~/.claude/skills/session-setup/SKILL.md
git commit -m "feat: inline git/lessons agents, add manifest consumption to session-setup"
```

---

## Task 8: Overhaul Session-Setup Skill — Part 2 (Enrichment + Doc Generation)

**Files:**
- Modify: `~/.claude/skills/session-setup/SKILL.md`

Adds the framework enrichment scanner agent prompt and doc generation instructions to the skill.

- [ ] **Step 1: Add the Framework Enrichment Agent prompt**

After the `### Inline: Lessons & TODOs` section, add:

````markdown
### Agent: Framework Enrichment Scanner

**Runs during:** FULL_REFRESH (both modes), PARTIAL_REFRESH when `structure` or `docs` impact detected.

```
You are a framework-aware enrichment scanner for a Next.js + Supabase project.
Run these 5 scans and return structured results. Each scan is independent — if one
fails or finds nothing, continue with the others. Mark each as success/empty/error.

SCAN 1 — ROUTES:
1. Use Glob: **/page.tsx, **/route.ts, **/layout.tsx
2. Map file paths to URLs via App Router conventions
3. For route.ts files, grep for exported GET/POST/PUT/DELETE
4. Check auth patterns — grep for ALL of:
   - getUser, getSupabaseServerClient (session auth)
   - requireWebsiteApiKey, checkApiRateLimit (API key auth)
   - Any cron auth patterns
5. Output table: | Path | Method | Auth Type | File |

SCAN 2 — SERVER ACTIONS:
1. Grep for 'use server' across codebase
2. For each file, list exported async functions
3. For each function AND its imported helpers in src/lib/:
   - Grep for .from('table'), .rpc('fn')
   - Grep for getUser, role checks
   - Grep for logAuditEvent, revalidatePath
4. Output table: | Action | File | Tables | Auth | Audit |

SCAN 3 — ENV VARS:
SAFETY: Only read .env.example. NEVER read .env, .env.local, or .env*.local.
1. Read .env.example — list var names (NOT values)
2. Grep for process.env. across src/
3. Cross-reference declared vs used, NEXT_PUBLIC_ vs server
4. Output table: | Var | Public/Server | Declared | Used In |

SCAN 4 — INTEGRATIONS:
1. Grep for imports: resend, stripe, qrcode, @supabase, openai, anthropic, twilio
2. For each match, note file and usage context
3. Output table: | Service | Files | Purpose |

SCAN 5 — AUTH FLOW:
1. Read middleware.ts (project root or src/)
2. Note excluded paths (e.g. /api/*)
3. Read layout.tsx files with auth checks
4. Map: middleware → layout → page → action
5. Cross-reference with roles.ts capability functions
6. Output: auth flow description with file references

Return all 5 scan results as structured markdown under 300 lines.
```
````

- [ ] **Step 2: Add doc generation instructions**

After the enrichment agent section, add:

````markdown
### Doc Generation (Simple Mode)

**Runs during:** FULL_REFRESH (after all data is gathered), PARTIAL_REFRESH (only affected sections).

Generate/update files in `docs/architecture/` using the enrichment scanner output, database schema, and type information.

**v1 docs to generate:**

1. **overview.md** — Project summary: stack, table count, route count, action count, key integrations
2. **routes.md** — Full route table from Scan 1 output
3. **data-model.md** — Database schema from the database agent output. Include table/column/FK info. Omit RLS policy details (security: keep queryable only, not committed).
4. **server-actions.md** — Full action table from Scan 2 output
5. **relationships.md** — Cross-reference map:
   - Database → Code: for each table, grep which actions/components reference it
   - Components → Usage: for each component, grep which pages import it
   - Actions → Consumers: for each action, grep which components/pages call it
   - Types → Database: map TypeScript types to their source tables

**Each file must use this template:**

```markdown
---
generated: true
last_updated: <ISO timestamp>
source: session-setup
project: <project name from hook verdict>
---

# <Title>

> Auto-generated by session-setup. Manual edits will be overwritten.

<content>
```

**Section hash optimisation:**

1. After generating each file's content in memory, compute SHA256 hash
2. Read `docs/architecture/.section-hashes.json` (create if missing, treat parse errors as empty)
3. Compare hash against stored value
4. Only write the file if hash differs (or file doesn't exist)
5. Update `.section-hashes.json` with new hashes after all writes

**Update README.md** after all docs are generated:
- Update the status column from "Pending" to the last_updated date
- This file is not hash-checked (always updated)
````

- [ ] **Step 3: Add completion gate instructions**

After the doc generation section, add:

````markdown
### Completion Gate — Documentation Check

When finishing a task (before marking complete), check:

1. Read `.claude/changes-manifest.log`
2. If it has entries with `docs` or `structure` in the impact column:
   - Inform the user: "Structural changes were made this session that affect architecture docs. Consider running `/session-setup partial` to refresh, or docs will update next session."
3. This is advisory — do not block task completion
````

- [ ] **Step 4: Commit**

```bash
git add ~/.claude/skills/session-setup/SKILL.md
git commit -m "feat: add enrichment scanners and doc generation to session-setup skill"
```

---

## Task 9: Integration Test — Full Refresh

**Files:** No new files — this is a manual verification task.

- [ ] **Step 1: Run a full session-setup refresh**

Run: `/session-setup full`

This should:
1. Dispatch database agent (if Supabase detected)
2. Run enrichment scanners (routes, actions, env, integrations, auth)
3. Generate `docs/architecture/overview.md`, `routes.md`, `data-model.md`, `server-actions.md`, `relationships.md`
4. Create `.section-hashes.json`
5. Update `docs/architecture/README.md` with dates
6. Write `session-context.md`

- [ ] **Step 2: Verify generated docs exist**

Run: `ls -la docs/architecture/*.md`
Expected: 7 files (README.md, NOTES.md, overview.md, routes.md, data-model.md, server-actions.md, relationships.md)

- [ ] **Step 3: Verify section hashes exist**

Run: `cat docs/architecture/.section-hashes.json | python3 -m json.tool`
Expected: Valid JSON with keys for each generated doc

- [ ] **Step 4: Verify generated docs have frontmatter**

Run: `head -5 docs/architecture/routes.md`
Expected: Should start with `---\ngenerated: true\n...`

- [ ] **Step 5: Run a second full refresh — verify idempotency**

Run: `/session-setup full`

Then check git status:
Run: `git diff --stat docs/architecture/`
Expected: Only README.md changed (timestamp update). Other files should be unchanged thanks to section hashing.

- [ ] **Step 6: Commit the generated docs**

```bash
git add docs/architecture/
git commit -m "feat: initial auto-generated architecture documentation"
```

---

## Task 10: Integration Test — Manifest Lifecycle

**Files:** No new files — manual verification.

- [ ] **Step 1: Edit a route file to trigger the manifest hook**

Make a trivial edit to any route file (e.g., add a comment to `src/app/events/page.tsx`), then revert it.

- [ ] **Step 2: Verify manifest was created**

Run: `cat .claude/changes-manifest.log`
Expected: Header line + one entry for the edited file with `route` category and `structure,docs` impact.

- [ ] **Step 3: Verify structural nudge was shown**

The PostToolUse hook should have injected a nudge message into the conversation about the structural change.

- [ ] **Step 4: Start a new session (or simulate)**

The SessionStart hook should detect the non-empty manifest and upgrade CACHE_ONLY to PARTIAL_REFRESH.

- [ ] **Step 5: Run partial refresh**

Run: `/session-setup`

Verify: manifest is consumed (truncated to just the version header).

Run: `cat .claude/changes-manifest.log`
Expected: Only `# manifest-version: 1`

- [ ] **Step 6: Clean up test edits**

Revert any test changes:
```bash
git checkout -- src/app/events/page.tsx
```

---

## Task 11: Integration Test — Doc Guard

**Files:** No new files — manual verification.

- [ ] **Step 1: Attempt to edit a generated doc**

Try to edit `docs/architecture/routes.md` (e.g., add a line).

- [ ] **Step 2: Verify the guard warning appeared**

The PreToolUse hook should inject an advisory warning about the file being auto-generated.

- [ ] **Step 3: Verify NOTES.md is not guarded**

Try to edit `docs/architecture/NOTES.md`.
Expected: No warning — NOTES.md is excluded from the guard.

---

## Summary

| Task | Description | Estimated Effort |
|------|-------------|-----------------|
| 1 | Gitignore entries | XS |
| 2 | Architecture docs scaffold | XS |
| 3 | Hook logic tests (TDD) | S |
| 4 | Consolidated hook implementation | M |
| 5 | Register hooks in settings | XS |
| 6 | SessionStart hook manifest check | S |
| 7 | Skill overhaul Part 1 (inline + manifest) | M |
| 8 | Skill overhaul Part 2 (enrichment + docs) | M |
| 9 | Integration test — full refresh | S |
| 10 | Integration test — manifest lifecycle | S |
| 11 | Integration test — doc guard | XS |

**Total: 11 tasks, ~8 commits, complexity score: 3 (M)**

After Phase 1 is complete, the system is functional without Graphify. Phase 2 (Graphify integration) builds on top once the Phase 0 validation spike confirms capabilities.
