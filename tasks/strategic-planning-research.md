# Strategic Planning Enhancement — Research Synthesis

Research compiled 2026-04-14 for BaronsHub multi-venue event management.

---

## 1. OKR / Goal-Setting

### Recommended Data Model

```
Objective
  id, title, description, owner_id, venue_id (nullable),
  time_period (quarter/custom), start_date, end_date,
  status (draft | active | closed), parent_objective_id (nullable),
  progress (0-100, auto-calculated), confidence (0-100),
  created_at, updated_at

KeyResult
  id, objective_id (FK), title, owner_id,
  measurement_type (number | percentage | currency | boolean),
  start_value, target_value, current_value,
  unit_label (nullable, e.g. "covers", "GBP", "%"),
  weight (default 1.0 — for weighted rollup),
  status (not_started | on_track | at_risk | off_track | achieved),
  created_at, updated_at

Initiative
  id, key_result_id (FK), title, description, owner_id,
  status (todo | in_progress | done | blocked),
  due_date, completed_at,
  created_at, updated_at

ConfidenceLog
  id, key_result_id (FK), score (0-100), note (text),
  logged_by, logged_at
```

### How Key Results Are Measured

| Type | Start | Target | Example |
|------|-------|--------|---------|
| Number | 0 | 500 | "Serve 500 covers at Saturday brunch" |
| Percentage | 15% | 25% | "Increase repeat booking rate to 25%" |
| Currency | 0 | 10000 | "Generate GBP 10k in private event revenue" |
| Boolean | false | true | "Launch new cocktail menu" |

Progress auto-calculates: `(current - start) / (target - start) * 100`. Boolean = 0% or 100%.

### Confidence Scoring

- **Scale**: 0-100% (displayed as traffic-light: green >= 70, amber 40-69, red < 40)
- **Who sets it**: The key result owner during weekly check-ins
- **How often**: Weekly (non-negotiable in high-performing orgs like Google/LinkedIn)
- **Starting point**: All KRs start at 50% confidence at quarter start
- **Stored as**: Append-only log (ConfidenceLog) so you can see trajectory over time

### Minimum Viable OKR Structure

For BaronsHub MVP: Objective -> Key Results only (skip Initiatives initially — they can be added as a simple text list or linked to existing event tasks). Confidence scoring is optional at launch but the schema should support it.

### Real-World Examples

- **Perdoo**: Three KR types (metric, binary, milestone). Objective progress = weighted average of KR progress. Supports aligned/cascading OKRs between teams.
- **Lattice**: KR types are #, $, %, or binary. Cascading goals optional. Progress flows automatically from KRs to parent objectives.

---

## 2. Review Cadence / Retrospective Workflows

### Recommended Data Model

```
ReviewCycle
  id, venue_id, plan_id (nullable), cycle_type (30_day | 60_day | 90_day | quarterly | custom),
  scheduled_date, completed_at, status (upcoming | in_progress | completed | skipped),
  created_at

ReviewResponse
  id, review_cycle_id (FK), question_key (string), response (text),
  responded_by, responded_at

ReviewAction
  id, review_cycle_id (FK), description, owner_id,
  status (open | completed | carried_forward),
  carried_to_review_id (FK, nullable),
  due_date, completed_at
```

### Questions at Each Checkpoint

**30-Day Review**
- What's working well so far?
- What obstacles or blockers have emerged?
- Are the original goals still the right ones?
- What support or resources are needed?

**60-Day Review**
- What progress has been made against each objective?
- Which KRs are on track vs at risk?
- What should we stop, start, or continue?
- Are there new opportunities we should capture?

**90-Day Review (Full Retrospective)**
- Did we achieve what we set out to? (Score each KR)
- What were our biggest wins?
- What didn't work and why?
- What should carry forward to next quarter?
- What new objectives should we set?

### How Tools Prompt Users

- **Automated reminders**: Email/in-app notification 3 days before scheduled review
- **Pre-populated forms**: Show current KR progress, confidence trends, and open action items
- **Guided flow**: Step-by-step wizard (review progress -> reflect -> set actions -> close)
- **Nudge if skipped**: Escalate to manager/stakeholder if review not completed within 5 days

### What Gets Carried Forward vs Archived

- **Carried forward**: Open action items (status = carried_forward, linked to next review), unfinished KRs that are still relevant, learnings/patterns
- **Archived**: Completed actions, achieved KRs, the review responses themselves (kept for historical reference)

### Real-World Examples

- **TeamRetro**: Start/Stop/Continue format, voting on action items, automatic carry-forward of unresolved items
- **Geekbot (Slack-native)**: Async retrospectives via bot prompts, aggregated team responses

---

## 3. Cross-Venue / Portfolio Dashboards

### Recommended Data Model

```
VenueSummary (materialised view or computed at query time)
  venue_id, venue_name,
  active_objectives_count, objectives_on_track_count,
  overall_progress (0-100), overall_confidence (0-100),
  kpis_reported_this_week (boolean),
  next_review_date, review_status,
  planning_completeness_score (0-100)
```

### Best Layout Patterns

1. **Card grid**: One card per venue showing RAG status dot, progress bar, headline metric, and next review date. Cards are clickable to drill down.
2. **Comparison table**: Rows = venues, columns = key metrics. Sortable by any column. Heatmap colouring on cells (use icons/shapes too for accessibility).
3. **Sparklines**: Tiny trend charts per venue showing progress over last 4 weeks.
4. **Leaderboard view**: Rank venues by a chosen metric (progress, confidence, KPI performance).

### Key Metrics for Venue Comparison

| Metric | Source |
|--------|--------|
| OKR progress (%) | Average of objective progress per venue |
| Confidence trend | Average KR confidence, with direction arrow |
| Planning completeness | Score from Section 7 |
| Review cadence adherence | % of reviews completed on time |
| KPI health | % of tracked KPIs meeting target |
| Covers / Revenue | From manual KPI entry or integration |
| Labour cost % | From manual KPI entry |
| Event count (upcoming) | From existing BaronsHub event data |

### How to Show Progress at a Glance

- **RAG dots/icons** next to each venue name (never colour alone — pair with icon shapes: checkmark, warning triangle, X)
- **Progress bars** with numeric percentage label
- **Sparkline trends** showing 4-8 week trajectory
- **Exception-based view**: Default to showing only venues needing attention (amber/red), with toggle to show all

### Real-World Examples

- **Actabl (hospitality BI)**: Multi-property dashboard with side-by-side KPI comparison, drill-down per property
- **Birdview PSA**: Portfolio dashboard with project health cards, resource utilisation bars, RAG indicators

---

## 4. Stakeholder Digest Emails

### Recommended Data Model

```
DigestConfig
  id, name, frequency (weekly | biweekly | monthly),
  day_of_week (0-6), time_of_day,
  scope (all_venues | specific_venues),
  venue_ids (array, nullable),
  recipient_emails (array),
  include_sections (array of section keys),
  is_active (boolean),
  created_by, created_at

DigestLog
  id, digest_config_id (FK), sent_at,
  recipient_count, snapshot_data (jsonb)
```

### What Goes in a Good Weekly Digest

1. **Header**: Organisation name, reporting period, overall RAG status icon
2. **Executive Summary** (1-2 sentences): "3 of 5 venues on track. The Star needs attention on brunch revenue KR."
3. **Venue Status Grid**: Mini card per venue with RAG icon, progress %, top concern
4. **Key Wins This Week**: 2-3 bullet points of achievements
5. **Items Needing Attention**: Amber/red KRs or overdue reviews (max 5)
6. **Upcoming**: Next review dates, upcoming milestones
7. **Footer**: Link to full dashboard, unsubscribe

### Structure for Quick Scanning

- **Subject line format**: "[BaronsHub] Weekly Digest — 3/5 Venues On Track — W/C 14 Apr"
- **Total length**: Under 300 words / 60-second read
- **Visual hierarchy**: RAG icon first, then one-line summary, then detail
- **No more than 5 priorities** per section
- **Use tables** for multi-venue comparison (venue | status | progress | top issue)
- **CTA button**: "View Full Dashboard" linking back to app

### Real-World Examples

- **Monday.com**: Automated digest of completed tasks, configurable per board
- **Airtable**: Executive status report via automation — pulls data, formats email, sends on schedule

---

## 5. KPI Tracking

### Recommended Data Model

```
KpiDefinition
  id, venue_id (nullable — null = org-wide),
  name, description,
  unit_type (number | percentage | currency | boolean),
  unit_label (e.g. "covers", "GBP", "%"),
  direction (higher_is_better | lower_is_better),
  target_value (nullable),
  frequency (weekly | monthly),
  owner_id,
  is_active (boolean),
  created_at, updated_at

KpiEntry
  id, kpi_definition_id (FK), period_start (date), period_end (date),
  value (numeric), note (text, nullable),
  entered_by, entered_at

KpiTarget
  id, kpi_definition_id (FK), period_start, period_end,
  target_value,
  created_at
```

### How to Let Users Define Custom KPIs

- **Setup wizard**: Name -> unit type -> direction (up/down good) -> target -> frequency -> owner
- **Preset library**: Offer common hospitality KPIs (covers, revenue, labour %, satisfaction score) as one-click templates
- **Per-venue or org-wide**: Toggle whether KPI applies to one venue or all

### Best UX for Manual Metric Entry (Weekly Check-ins)

1. **Prompted check-in page**: "It's Monday — time to log last week's numbers"
2. **Single form, all KPIs**: Table layout with KPI name | Last week | This week | Target | Note
3. **Inline validation**: Warn if value seems unusual (>2x standard deviation from recent entries)
4. **Pre-fill where possible**: If data can be pulled from events table (e.g. event count), auto-populate
5. **Mobile-friendly**: Large touch targets, numeric keyboard for number fields
6. **Reminder system**: Email + in-app badge on Monday mornings if not yet submitted
7. **Streak indicator**: "You've logged 8 weeks in a row" — gamification to encourage consistency

### How to Visualise KPI Trends

- **Line chart**: Primary view — value over time with target line overlay
- **Sparklines**: In table/card views for at-a-glance trends
- **RAG indicator**: Current value vs target (green = meeting, amber = within 10%, red = >10% off)
- **Period comparison**: This week vs last week, this month vs same month last year
- **Venue comparison**: Same KPI across venues on one chart

### Real-World Examples

- **Geckoboard**: Manual KPI entry via simple forms, real-time dashboard display
- **Databox**: Custom metric definition, scheduled data entry prompts, trend visualisation

---

## 6. Playbook / Template Library

### Recommended Data Model

```
PlanTemplate
  id, title, description, category (e.g. "brunch_launch", "seasonal_event", "quarterly_plan"),
  tags (array), created_from_plan_id (nullable),
  is_public (boolean — visible to all venues),
  created_by, created_at, updated_at

TemplateObjective
  id, template_id (FK), title, description, sort_order

TemplateKeyResult
  id, template_objective_id (FK), title,
  measurement_type, suggested_target,
  sort_order

TemplateChecklist
  id, template_id (FK), title, items (jsonb array of strings),
  sort_order
```

### How Tools Let Users Save and Clone Plans

1. **"Save as Template"**: Button on any completed or active plan. Strips venue-specific data (dates, actual values, owners) but keeps structure (objectives, KR definitions, checklists).
2. **Template gallery**: Browsable library with search, category filter, and preview. Shows: title, description, number of objectives/KRs, tags, who created it, times used.
3. **"Use Template"**: One-click to create a new plan from template. Wizard asks: which venue? what time period? who owns each objective? Optionally adjust targets.
4. **Version tracking**: Templates can be updated; plans created from older versions are not affected.

### What Metadata Makes Templates Useful

| Field | Why |
|-------|-----|
| Category/tags | Enables filtering (e.g. "brunch", "seasonal", "quarterly") |
| Description | Explains when/why to use this template |
| Created from | Links back to the real plan that proved this template works |
| Times used | Social proof — popular templates surface first |
| Suggested targets | Pre-filled but editable KR targets as starting points |
| Estimated duration | How long the plan typically runs |
| Venue type fit | Which venue types this template suits |

### Real-World Examples

- **Asana**: "Save project as template" strips assignees/dates, keeps structure. Template gallery with categories. One-click duplicate with customisation options.
- **Jira**: Project templates with pre-configured workflows, issue types, and boards. Can be shared across teams.

---

## 7. Planning Maturity / Completeness Scoring

### Recommended Data Model

```
CompletenessScore (computed, not stored — or cached in a materialised view)
  plan_id, venue_id, score (0-100),
  factor_scores (jsonb: { objectives_defined: 20, krs_measurable: 15, ... }),
  calculated_at
```

### What Factors Contribute to a Planning Quality Score

| Factor | Weight | Scoring Rule |
|--------|--------|-------------|
| Objectives defined | 15% | >= 1 active objective = full marks |
| Key results per objective | 15% | >= 2 KRs per objective = full marks, 1 = half |
| KRs are measurable | 15% | All KRs have target_value set = full marks |
| Owners assigned | 10% | Every objective and KR has an owner |
| Review cycle scheduled | 10% | At least one upcoming review = full marks |
| Confidence logged recently | 10% | Confidence updated in last 7 days = full marks |
| KPIs being tracked | 10% | >= 1 active KPI with entry in last period = full marks |
| Review completion rate | 10% | % of scheduled reviews actually completed |
| Action item follow-through | 5% | % of review actions completed or carried forward (not abandoned) |

Total = weighted sum, capped at 100.

### How It's Calculated and Displayed

**Calculation**:
- Run on-demand or nightly via cron
- Each factor returns 0-100%, multiplied by its weight
- Sum of weighted factors = overall score
- Store in cache/view for dashboard performance

**Display**:
- **Circular progress gauge**: Large number in centre, coloured ring (green/amber/red)
- **Factor breakdown**: Expandable section showing each factor's individual score with actionable label ("Add owners to 2 objectives to improve score")
- **Trend**: Small sparkline showing score over last 4 weeks
- **Venue comparison**: Bar chart of completeness scores across all venues
- **Nudge system**: "Your planning score is 62% — here are 3 things to improve it" (link to specific actions)

### Real-World Examples

- **PMI Project Health Index**: Weighted composite of schedule, budget, scope, and quality factors
- **Procore**: Construction project health chart combining cost, schedule, and safety metrics into a single visual indicator

---

## Cross-Cutting Implementation Notes for BaronsHub

### Phasing Recommendation

1. **Phase 1 (MVP)**: OKR model (Objectives + Key Results), basic KPI tracking with manual entry, planning completeness score
2. **Phase 2**: Review cycles with guided retrospective flow, cross-venue dashboard
3. **Phase 3**: Stakeholder digest emails, template library, confidence logging
4. **Phase 4**: Advanced features — cascading OKRs, KPI integrations, trend analytics

### Key Technical Decisions

- **All scores use 0-100 integer scale** — simple, consistent, maps to percentage display
- **RAG thresholds standardised**: Green >= 70, Amber 40-69, Red < 40 (configurable per org)
- **Time periods**: Default to quarterly OKR cycles aligned to calendar quarters
- **Venue scoping**: Every entity either belongs to a venue or is org-wide (venue_id nullable)
- **Append-only logs**: Confidence scores and KPI entries are never edited, only appended — preserves audit trail

### Accessibility Reminders

- RAG status always paired with icon shape (checkmark/warning/X) and text label — never colour alone
- Progress bars include numeric label
- Dashboard cards navigable by keyboard
- All tables use proper semantic markup
