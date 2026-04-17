# Audit Coverage Gap Map — 2026-04-17

Produced as Wave 0.2 of the client enhancement batch (see [spec](../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)). Analyses every exported action in `src/actions/*.ts` and classifies whether the action calls `recordAuditLogEntry` / `logAuthEvent` within the same function scope as its DB mutation.

Wave 0.1 (migration `20260417120000_audit_entities_and_actions.sql`) is already applied, so previously silent-failing writes (`venue.*`, `artist.*`, `event_type.*`, `link.*`, `opening_hours.*`, `planning.*`, `user.sensitive_column_changed`) now land successfully.

## Summary

| File | Exports | Mutating | Audited | Gap | Notes |
|---|---:|---:|---:|---:|---|
| artists.ts | 4 | 4 | 4 | 0 | create/update/archive/restore — all audit. |
| auth.ts | 4 | 4 | 4 | 0 | signIn, signOut, requestPasswordReset, completePasswordReset — all via logAuthEvent. |
| bookings.ts | 2 | 2 | 1 | **1** | createBookingAction lacks audit. |
| customers.ts | 1 | 1 | 1 | 0 | deleteCustomer audits customer.erased. |
| debriefs.ts | 1 | 1 | 1 | 0 | submitDebrief audits event.debrief_updated. |
| event-types.ts | 3 | 3 | 3 | 0 | create/update/delete — all audit. |
| events.ts | 10 | 10 | 10 | 0 | Canonical pattern — every action audits (multiple rows per action where relevant). |
| links.ts | 4 | 3 | 3 | 0 | getOrCreateUtmVariant is read/upsert hybrid; create/update/delete all audit. |
| opening-hours.ts | 8 | 8 | 8 | 0 | All 8 actions audit. |
| planning.ts | 15 | 15 | 9 | **6** | Six actions lack audit — see detail below. |
| sop.ts | 12 | 10 | 10 | 0 | 2 read-only (load) + 10 mutating all audited. |
| users.ts | 8 | 6 | 5 | **1** (partial) | updateUserAction only audits role changes (via logAuthEvent), not other field changes. |
| venues.ts | 3 | 3 | 3 | 0 | create/update/delete — all audit. |

**Total gaps: 8** across 3 files. Seven full gaps + one partial.

## Gaps

### GAP-1 — `createBookingAction` (bookings.ts:34)
**Severity:** High. Booking creation is customer-facing and has PII.
**Fix:** after successful booking insert, call `recordAuditLogEntry({entity: 'event', entityId: eventId, action: 'booking.created', meta: {booking_id, ticket_count, mobile_hash}})`. `booking.created` is **not** currently in the audit action CHECK — add it to the Wave 0.1-extended CHECK (or widen in a follow-up migration).

### GAP-2 — `movePlanningItemDateAction` (planning.ts:169)
**Severity:** Medium. Date change is a material edit to a planning item.
**Fix:** reuse `planning.item_updated` with `meta: {changed_fields: ['target_date'], old_date, new_date}`.

### GAP-3 — `togglePlanningTaskStatusAction` (planning.ts:572)
**Severity:** High. Status changes are the most common audit target for ops review.
**Fix:** call `recordAuditLogEntry({entity: 'planning_task', entityId: task.id, action: 'planning_task.status_changed', meta: {from_status, to_status, completed_by}})`. `planning_task.status_changed` is already in the CHECK.

### GAP-4 — `reassignPlanningTaskAction` (planning.ts:597)
**Severity:** High. Assignee changes affect who's notified and responsible.
**Fix:** `recordAuditLogEntry({entity: 'planning_task', entityId: task.id, action: 'planning_task.reassigned', meta: {from_user_id, to_user_id}})`. `planning_task.reassigned` is already in the CHECK.

### GAP-5 — `convertInspirationItemAction` (planning.ts:691)
**Severity:** Medium. Converts an inspiration suggestion into a real planning item — should log the provenance.
**Fix:** emit `planning.item_created` (existing action value) with `meta: {source: 'inspiration', inspiration_item_id}`.

### GAP-6 — `dismissInspirationItemAction` (planning.ts:757)
**Severity:** Low. Dismissal is reversible and internal.
**Fix:** optional — if we want a full trail, add `planning.inspiration_dismissed` to the action CHECK and call it. Otherwise skip with a `// audit: intentionally skipped — low-value noise` comment so the CI guard's allowlist can accept it.

### GAP-7 — `refreshInspirationItemsAction` (planning.ts:786)
**Severity:** Low. Bulk refresh of inspiration items from the gov.uk API + OpenAI.
**Fix:** one audit row per refresh run summarising `{count_generated, sources, triggered_by}`. Add `planning.inspiration_refreshed` to the action CHECK.

### GAP-8 — `updateUserAction` (users.ts:25) — PARTIAL
**Severity:** Medium. Only logs role changes via `logAuthEvent('auth.role.changed')`. Other updatable fields (email, full_name, venue_id) are not audited from this action.
**Fix:** add a generic `recordAuditLogEntry({entity: 'user', entityId: user.id, action: 'user.updated', meta: {changed_fields: [...]}})` when the diff includes any non-role field. Requires adding `user.updated` to the action CHECK.

Note: `users.deactivated_at` changes are captured by the DB trigger `audit_users_sensitive_columns` writing `user.sensitive_column_changed` — so deactivation is not a gap at the app level.

## Action values that need adding to the CHECK (for Wave 0.3 migration)

```sql
-- These will be added in the next audit CHECK migration as part of Wave 0.3:
'booking.created',                   -- GAP-1
'planning.inspiration_dismissed',    -- GAP-6 (optional)
'planning.inspiration_refreshed',    -- GAP-7
'user.updated'                       -- GAP-8
```

## Wave 0.3 plan

1. **Small migration** (follow-on to `20260417120000_audit_entities_and_actions.sql`) extending the action CHECK with the four values above.
2. **Action patches in batches:**
   - Batch A (high severity): GAP-1, GAP-3, GAP-4.
   - Batch B (medium): GAP-2, GAP-5, GAP-8.
   - Batch C (low): GAP-6, GAP-7.
3. **Smoke test** each batch in app — confirm the audit rows land.

## Wave 0.4 plan (CI guard)

Vitest test that scans `src/actions/*.ts`. For every exported async function that contains `.insert(`, `.update(`, `.delete(`, `.upsert(`, or `.rpc(` in its body, require either `recordAuditLogEntry` or `logAuthEvent` in the same function scope.

Starter allowlist (while Wave 0.3 batches land):
```
bookings.ts:createBookingAction
planning.ts:movePlanningItemDateAction
planning.ts:togglePlanningTaskStatusAction
planning.ts:reassignPlanningTaskAction
planning.ts:convertInspirationItemAction
planning.ts:dismissInspirationItemAction
planning.ts:refreshInspirationItemsAction
users.ts:updateUserAction  (partial — keep on allowlist until user.updated action value is added)
```

Target: allowlist empty after Wave 0.3 Batch C lands.
