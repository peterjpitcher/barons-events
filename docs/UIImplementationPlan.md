# UI Implementation Plan

## Objective
Replace the interim “construction” UI with the production-ready Barons Events workspace experience. The work covers visual identity, shared components, and role-specific screens for venue managers, reviewers, and Central planners.

## Task Breakdown

### 1. Visual Foundations
- [x] Define the Barons palette (primary #273640 plus complementary accents) as Tailwind tokens.
- [x] Set up typography, spacing, radius, and shadow tokens aligned with docs/UXFlowNotes.md.
- [x] Build reusable primitives (button, badge, card, stat pill, table, alert, avatar) to drive consistency.
- [x] Implement loading skeleton and empty-state patterns referenced across views.

### 2. Application Shell
- [x] Redesign the authenticated layout (header, navigation, sign-out/user summary) using the new palette.
- [x] Create a `PageHeader` pattern with title, description, CTA slot, and breadcrumb support.
- [x] Introduce a responsive content grid/stack helper for cards and panels.
- [x] Ensure dark-mode fallbacks and accessibility contrast compliance.

### 3. Venue Manager Experience
- [x] Refresh the home dashboard with stat tiles, workstream cards, and quick actions.
- [x] Upgrade the venue list to a searchable table with status chips and audit highlights.
- [x] Implement the multi-step event creation/edit flow with progress indicator and contextual tips.
- [x] Polish the event detail timeline view with badges showing status transitions and AI/manual diffs.

## Remaining Workstreams (A/B/C)

The construction copy is partially removed. The next phase focuses on replacing all technical or internal build phrasing with guest-friendly language, validating tone, and updating documentation.

### Workstream A – Planning Surfaces & Shared Mirrors (owner: me)
- [x] Rewrite copy in `src/app/planning/page.tsx` to focus on scheduling guidance, conflict alerts, and calendar prep without internal jargon.
- [x] Replace system terms inside planning partials (`src/components/planning/*.tsx`) including the AI metadata panel, conflict callouts, and timeline helpers.
- [x] Update shared dashboard panels (`src/components/dashboard/role-glance.tsx`, `src/components/common/*.tsx`) so workstream summaries read as user-facing benefits.
- [x] Add a brief copy tone guideline to `docs/Runbooks/UICopy.md` and cross-link from `docs/UXFlowNotes.md`.

### Workstream B – Events & Venue Journeys (developer: Workstream B)
- [ ] Refresh event creation/edit strings in `src/components/events/event-form.tsx` and related helpers to explain steps plainly (no references to seeds, Supabase, or migrations).
- [ ] Simplify venue directory and assignment copy (`src/components/venues/*`, `src/app/venues/page.tsx`) into user tasks and status explanations.
- [ ] Audit empty states, tooltips, and banners in events/venues routes for technical leftovers; align them with the copy tone guideline.
- [ ] Provide quick QA notes in `docs/Runbooks/EventVenueQA.md` covering new user-first phrasing.

### Workstream C – Reviews, Settings & Wrap-Up (developer: Workstream C)
- [ ] Rework reviewer queue strings (`src/app/reviews/page.tsx`, decision modals) into action-oriented prompts with response deadline hints.
- [ ] Translate settings and debrief placeholders (`src/app/settings/page.tsx`, `src/components/settings/*`, debrief forms) into approachable language with help links.
- [ ] Sweep global alerts, error banners, and auth surfaces for technical references (“build”, “seed”, “sprint”), updating to friendly support language.
- [ ] Finalise documentation touchpoints (`README.md`, `docs/UXFlowNotes.md`, relevant runbooks) once Workstreams A/B updates land.

## Execution Order
1. Complete Visual Foundations.
2. Ship the Application Shell updates.
3. Tackle Venue Manager screens.
4. Harmonise copy across planning, events, venues, reviews, and settings (Workstreams A–C in parallel).
5. Close with testing and documentation updates.

Progress will be tracked by ticking the tasks above and committing incrementally once each execution step is complete.
