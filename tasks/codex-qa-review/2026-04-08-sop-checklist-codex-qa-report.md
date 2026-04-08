# QA Review Report — SOP Checklist Design Spec

**Scope:** `docs/superpowers/specs/2026-04-08-sop-checklist-design.md`
**Date:** 2026-04-08
**Mode:** Spec Compliance Review (pre-implementation design audit)
**Engines:** Claude + Codex
**Specialists:** Bug Hunter (Codex), Security Auditor (Codex), Spec Compliance Auditor (Codex), Performance Analyst (Claude), Standards Enforcer (Claude)

---

## Executive Summary

The SOP Checklist design spec was reviewed by four specialist agents (two Codex, two Claude) looking at bugs/edge cases, security, performance, and project standards compliance. **38 total findings** were identified across all specialists.

The design is sound in its overall approach — using the existing planning system, generating tasks from a global template, and supporting multi-assignee with dependencies. However, the review surfaced **5 critical/blocking issues** that must be resolved before implementation:

1. **No mechanism to attach SOP tasks to events** — `planning_tasks` only has `planning_item_id`, not `event_id`
2. **Generation flow is not atomic** — partial failures leave orphaned checklists
3. **Executive write access contradicts the established role model**
4. **Dependency resolution at query time is architecturally expensive** — needs a cached `is_blocked` column
5. **`sop_depends_on uuid[]` has no referential integrity** — dangling references when tasks are deleted

Additionally, the Spec Compliance Auditor surfaced important integration gaps:
- The existing recurring series task template system (`planning_series_task_templates`) is not addressed — SOP must define coexistence
- Event creation triggers run through different code paths than planning items
- The `manager_responsible` field needs full event pipeline integration
- The visibility behaviour is internally contradictory (goals vs UI section)

| Severity | Count |
|----------|-------|
| Critical | 5 |
| High | 20 |
| Medium | 18 |
| Low | 9 |

---

## Critical Findings

### CRIT-001: No mechanism to attach SOP tasks to events
- **Source:** Bug Hunter (BUG-001)
- **Description:** `planning_tasks` requires `planning_item_id` and has no `event_id` column. The spec's `generateSopChecklist(targetId, targetType, targetDate)` assumes a polymorphic parent, but no such relationship exists in the schema. Event-generated SOP tasks cannot be persisted without either adding an `event_id` column or creating an automatic planning item per event.
- **Impact:** The core feature — generating checklists for events — is impossible under the current schema.
- **Resolution:** Choose one model: (a) add `event_id` to `planning_tasks` with a nullable polymorphic parent, or (b) auto-create a planning item for each event and attach tasks there. Option (b) is more consistent with the existing system.

### CRIT-002: Generation flow is not atomic — partial failures leave broken checklists
- **Source:** Bug Hunter (BUG-002), Performance Analyst (PERF-001)
- **Description:** The spec inserts the event first, then calls `generateSopChecklist()` as a separate step. If generation fails midway (e.g. task 16 of 35 fails), the event exists with a partial checklist. There's no transaction boundary, no idempotency key, and no retry mechanism.
- **Impact:** Production data violates the invariant that every event gets a complete SOP checklist.
- **Resolution:** Wrap generation in a database transaction (or Postgres function via `.rpc()`). Add an idempotency check to prevent duplicate generation on retry. Use batch inserts (not row-by-row) for both `planning_tasks` and `planning_task_assignees`.

### CRIT-003: Dependency resolution at query time is architecturally expensive
- **Source:** Performance Analyst (PERF-002, PERF-005)
- **Description:** The spec says dependency-based visibility is "evaluated at query time." For a board view with 10-20 events × 35 tasks = 350-700 tasks, checking all dependencies per task requires correlated subqueries. The "Actionable now" filter compounds this.
- **Impact:** Board view latency of 200-500ms+ that worsens as events accumulate.
- **Resolution:** Add an `is_blocked` boolean column on `planning_tasks`, updated via trigger or application logic when any task's status changes. Read queries become simple `WHERE is_blocked = false` filters.

---

## High Findings

### HIGH-001: `sop_depends_on uuid[]` lacks referential integrity and efficient querying
- **Source:** Bug Hunter (BUG-004), Performance Analyst (PERF-003)
- **Both engines flagged this.**
- **Description:** UUID arrays cannot have foreign keys or `ON DELETE` behaviour. Deleting a dependency target leaves dangling UUIDs. Array queries also prevent standard B-tree indexes.
- **Resolution:** Replace with a `planning_task_dependencies` junction table mirroring `sop_task_dependencies`. This gives FK constraints, cascade rules, and indexed joins.

### HIGH-002: Backwards compatibility claim is false — existing stack assumes single assignee + two states
- **Source:** Bug Hunter (BUG-005)
- **Description:** Current types, queries, actions, and UI all assume one `assignee_id`, one `assigneeName`, and status `open|done`. The junction table and `not_required` status will break existing views, grouping logic (`todos-by-person`), and the `togglePlanningTaskStatus()` function.
- **Resolution:** The migration must update the existing planning stack: update `PlanningTaskStatus` type, `togglePlanningTaskStatus()`, `taskStatusSchema`, and the board query. Define `assignee_id` as the canonical primary assignee with the junction table as the multi-assignee source of truth for SOP tasks.

### HIGH-003: Executive write access violates established role model
- **Source:** Standards Enforcer (STD-001), Security Auditor (SEC-001), Bug Hunter (BUG-007)
- **All three engines/specialists flagged this.**
- **Description:** The spec grants `executive` full CRUD on SOP settings. The project explicitly defines `executive` as read-only. `canManageSettings()` only returns true for `central_planner`.
- **Resolution:** Only `central_planner` gets write access. `executive` gets read-only view of the SOP template. If the client needs executive write access, document it as a deliberate deviation.

### HIGH-004: Race condition — no idempotency or locking for generation
- **Source:** Bug Hunter (BUG-003)
- **Description:** No unique constraint per target/template task. Retries or concurrent triggers can duplicate the entire SOP. Concurrent Settings edits can produce mixed-version checklists.
- **Resolution:** Add a unique constraint on `(planning_item_id, sop_template_task_id)` to prevent duplicates. Read the template snapshot inside the generation transaction.

### HIGH-005: Due date recalculation overwrites manual customisations
- **Source:** Bug Hunter (BUG-006)
- **Description:** The spec allows per-event due date customisation but then recalculates all open tasks when the target date changes, using the current template's `t_minus_days` (not the original generated value).
- **Resolution:** Snapshot `t_minus_days` on each generated task (add `sop_t_minus_days` column). Add a `due_date_manually_overridden` boolean. Only recalculate tasks where `due_date_manually_overridden = false`.

### HIGH-006: `planning_task_assignees` can become self-authorisation table
- **Source:** Security Auditor (SEC-003)
- **Description:** If insert/delete on the junction table isn't tightly scoped, users can add themselves as assignees and then mark tasks complete.
- **Resolution:** RLS on `planning_task_assignees`: only `central_planner` and the event's authorised editor can add/remove assignees.

### HIGH-007: Task completion has no server-side assignee verification
- **Source:** Security Auditor (SEC-004)
- **Description:** The spec says "any assignee can mark a task complete" but doesn't enforce this. The current update path accepts `taskId + status` without checking the caller is an assignee. Also, the spec references `completed_by` but this column doesn't exist yet.
- **Resolution:** Add `completed_by` column to `planning_tasks`. Server action must verify `(task_id, auth.uid())` exists in `planning_task_assignees` before allowing status change. Set `completed_by` server-side.

### HIGH-008: Permission model contradictions — RLS vs spec vs existing policies
- **Source:** Bug Hunter (BUG-007), Security Auditor (SEC-002)
- **Both engines flagged this.**
- **Description:** Existing planning RLS only allows `central_planner` writes. The spec says venue managers can edit event tasks and any assignee can update status. These rules conflict.
- **Resolution:** Write an explicit permission matrix in the spec for template CRUD and generated task CRUD. Define new RLS policies that match.

### HIGH-009: SOP mutations are completely unaudited
- **Source:** Standards Enforcer (STD-003), Security Auditor (SEC-008)
- **Both engines flagged this.**
- **Description:** The spec adds mutable global SOP template objects and task status changes but never mentions audit logging. Project standard requires `logAuditEvent()` on all mutations.
- **Resolution:** Add audit logging for: template CRUD, task generation, task status changes, reassignment, and date recalculation. Extend audit schema to support SOP entity types.

### HIGH-010: `src/lib/sop/` module breaks existing file organisation
- **Source:** Standards Enforcer (STD-002)
- **Description:** All planning-related logic lives under `src/lib/planning/`. The spec proposes a separate top-level module.
- **Resolution:** Move to `src/lib/planning/sop.ts` and extend `src/lib/planning/types.ts`.

---

## Medium Findings

| ID | Summary | Source |
|----|---------|--------|
| MED-001 | Dependency model allows self-dependencies and cycles | Bug Hunter (BUG-008) |
| MED-002 | `default_assignee_ids` can't handle deactivated users | Bug Hunter (BUG-009) |
| MED-003 | Empty templates and past target dates have undefined behaviour | Bug Hunter (BUG-010) |
| MED-004 | Input validation schemas not defined | Security Auditor (SEC-005) |
| MED-005 | Multi-assignee queries leak user identity data broadly | Security Auditor (SEC-006) |
| MED-006 | `default_assignee_ids uuid[]` unsafe as authorisation source | Security Auditor (SEC-007) |
| MED-007 | Date recalculation should be a single SQL UPDATE, not N queries | Performance Analyst (PERF-004) |
| MED-008 | Multi-assignee display risks N+1 query pattern | Performance Analyst (PERF-006) |
| MED-009 | Settings UI should fetch full template tree in one query | Performance Analyst (PERF-007) |
| MED-010 | Server action pattern incompletely specified | Standards Enforcer (STD-004) |
| MED-011 | T-minus calculation doesn't reference project date utilities | Standards Enforcer (STD-005) |
| MED-012 | No `fromDb`/snake_case conversion mentioned | Standards Enforcer (STD-006) |
| MED-013 | Missing loading/error/empty states for UI components | Standards Enforcer (STD-007) |
| MED-014 | Missing accessibility requirements for drag-and-drop/accordion | Standards Enforcer (STD-008) |

## Low Findings

| ID | Summary | Source |
|----|---------|--------|
| LOW-001 | `PlanningTaskStatus` modification impact not fully traced | Standards Enforcer (STD-009) |
| LOW-002 | Testing strategy missing mock strategy and coverage targets | Standards Enforcer (STD-010) |
| LOW-003 | No Zod validation schemas defined | Standards Enforcer (STD-011) |
| LOW-004 | RLS policy description is vague | Standards Enforcer (STD-012) |
| LOW-005 | Generation flow reads templates with sequential queries | Performance Analyst (PERF-008) |
| LOW-006 | Generation flow should use batch inserts | Performance Analyst (PERF-001) — addressed in CRIT-002 |
| LOW-007 | Settings template tree query risk | Performance Analyst (PERF-007) — addressed in MED-009 |

---

## Cross-Engine Analysis

### Agreed (both Codex AND Claude flagged)

These findings were independently identified by both engines — highest confidence:

| Finding | Codex Source | Claude Source |
|---------|-------------|--------------|
| Executive write access violation | BUG-007, SEC-001 | STD-001 |
| `sop_depends_on` array integrity issues | BUG-004 | PERF-003 |
| Missing audit logging | — | STD-003, SEC-008 |
| Permission model contradictions | BUG-007, SEC-002 | STD-001 |
| Generation atomicity concerns | BUG-002 | PERF-001 |

### Codex-Only Findings (investigate)

- Event-to-task relationship gap (BUG-001) — **Critical and real.** Claude didn't flag because the performance/standards agents weren't tasked with schema validation.
- Race condition / idempotency (BUG-003) — Valid concern for production.
- Self-authorisation via junction table (SEC-003) — Nuanced security gap.
- Due date recalculation overwrites (BUG-006) — Subtle logic bug.

### Claude-Only Findings

- File organisation (STD-002) — Project-context-dependent, Codex lacks this familiarity.
- Date utility references (STD-005) — Codebase convention only Claude knows.
- Accessibility requirements (STD-008) — UI standards expertise.
- `fromDb` conversion (STD-006) — Codebase-specific pattern.

---

## Recommendations — Prioritised Fix Order

### Must fix before implementation (spec revision required)

1. **CRIT-001:** Define event-to-planning-task relationship (add event_id or auto-create planning items for events)
2. **CRIT-002:** Specify transaction boundary and batch insert strategy for generation
3. **CRIT-003:** Add `is_blocked` cached column design to replace query-time dependency resolution
4. **HIGH-001:** Replace `sop_depends_on uuid[]` with `planning_task_dependencies` junction table
5. **HIGH-002:** Document existing planning stack changes needed for multi-assignee + not_required
6. **HIGH-003:** Revert executive to read-only for SOP settings
7. **HIGH-005:** Add `sop_t_minus_days` snapshot and `due_date_manually_overridden` flag
8. **HIGH-008:** Write explicit permission matrix for all operations
9. **HIGH-009:** Add audit logging requirements for all mutations
10. **HIGH-010:** Move SOP module into `src/lib/planning/`

### Should fix before implementation (spec refinement)

11. **HIGH-004:** Add unique constraint for idempotent generation
12. **HIGH-006 + HIGH-007:** Define RLS and server-side checks for task completion
13. **MED-001:** Add DAG validation for dependencies
14. **MED-010 + MED-011 + MED-012:** Specify server action patterns, date utilities, and type conversion

### Can fix during implementation

15. All Low findings and remaining Medium items (validation schemas, UI states, accessibility, testing details)

---

## Appendix: Spec Compliance Auditor Findings (Codex)

The following additional findings were reported by the Spec Compliance Auditor:

| ID | Summary | Severity | Status |
|----|---------|----------|--------|
| SPEC-001 | Event SOP tasks have no valid parent in current schema | Critical | Conflict |
| SPEC-002 | Spec ignores existing recurring-series task template system | High | Conflict |
| SPEC-003 | Trigger points and modified files wrong for event generation | High | Deviated |
| SPEC-004 | Permission model contradicts current RLS and server-action guards | Critical | Conflict |
| SPEC-005 | Multi-assignee support underspecified against single-assignee read model | High | Partial |
| SPEC-006 | Completion UI depends on non-existent `completed_by` field | High | Conflict |
| SPEC-007 | Due-date recalculation not defined against actual event date model | High | Missing |
| SPEC-008 | Executive CRUD conflicts with existing role contract | High | Conflict |
| SPEC-009 | `manager_responsible` field requirement is incomplete | High | Partial |
| SPEC-010 | UI/file list misses actual event and planning detail surfaces | Medium | Deviated |
| SPEC-011 | Array columns poor fit for current relational patterns | Medium | Ambiguous |
| SPEC-012 | Migration strategy omits companion work (indexes, types, seed IDs) | Medium | Missing |
| SPEC-013 | Visibility behaviour is internally contradictory | Medium | Ambiguous |
| SPEC-014 | Testing/file-path guidance not aligned with project conventions | Low | Deviated |

Full details in: `tasks/codex-qa-review/2026-04-08-sop-checklist-spec-compliance-auditor-report.md`
