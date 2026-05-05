# AGENTS.md — BaronsHub

This file provides project-specific guidance. See the workspace-level `AGENTS.md` one directory up for shared conventions.

## Quick Profile

- **Framework**: Next.js 16.3 canary, React 19.1
- **Test runner**: Vitest
- **Database**: Supabase (PostgreSQL + RLS)
- **Key integrations**: QR code generation, Email (Resend), public event API, event management
- **Size**: ~148 files in src/

## Commands

```bash
npm run dev              # Start development server
npm run build            # Production build
npm run start            # Start production server
npm run lint             # ESLint check
npm run test             # Vitest run (single pass)
npm run test:watch       # Vitest watch mode
npm run typecheck        # TypeScript check (tsc --noEmit)
npm run supabase:migrate # Apply pending migrations
npm run supabase:reset   # Reset database (linked, requires confirmation)
```

## Architecture

**Route Structure**: App Router with event management focus. Key sections:
- `/events` — event listing, details, draft/edit/review/approval workflows
- `/events/propose` — lightweight event proposals
- `/events/[eventId]/bookings`, `/bookings`, `/customers` — booking/customer workflows
- `/planning` — planning board, SOP tasks, event-linked planning
- `/settings`, `/users`, `/venues`, `/links`, `/artists` — admin and operations surfaces
- `/l/[slug]` and `/[code]` — public landing page and short-link redirects
- `/api/v1/*` — public website API with bearer auth and rate limiting

**Auth**: Supabase Auth with JWT + HTTP-only cookies. User context available in server and client components. Permission checks via `src/lib/` helpers.

**Database**: Supabase PostgreSQL with RLS. `src/lib/` contains data access helpers. `supabase/seed.sql` provides test data setup.

**Key Integrations**:
- **QR Codes**: `qrcode` library for event ticket generation
- **Email**: Resend for event notifications and confirmations
- **Public API**: `src/lib/public-api/` — rate-limited REST API for events
- **Notifications**: `src/lib/notifications.ts` — event alerts and reminders

**Data Flow**: Server actions for mutations. Server components for data fetching. Public API responses are validated/serialized through `src/lib/public-api/`. Role checks are layered through UI controls, server actions, shared helpers, and RLS.

## Key Files

| Path | Purpose |
|------|---------|
| `src/types/` | TypeScript definitions (event models, API) |
| `src/lib/public-api/` | Rate-limited public REST API endpoints |
| `src/lib/public-api/rate-limit.ts` | API rate limiting (per IP/API key) |
| `src/lib/public-api/auth.ts` | API key validation |
| `src/lib/validation.ts` | Zod schemas for events, bookings, etc. |
| `src/lib/datetime.ts` | Date/time utilities for event scheduling |
| `src/lib/artists.ts` | Artist/performer data helpers |
| `src/lib/reviewers.ts` | Event reviewer/moderator logic |
| `src/lib/notifications.ts` | Email and notification dispatch |
| `src/app/api/v1/events` | Public event REST API |
| `src/actions/` | Server actions for mutations |
| `supabase/migrations/` | Database schema migrations |
| `supabase/seed.sql` | Database seed for testing |
| `vitest.config.ts` | Vitest configuration |

## Environment Variables

| Var | Purpose |
|-----|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (public) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key (server-only) |
| `RESEND_API_KEY` | Resend email service key |
| `BARONSHUB_WEBSITE_API_KEY` | BaronsHub website integration API key |

## Project-Specific Rules / Gotchas

### Public API
- Endpoints in `src/lib/public-api/events.ts` require rate limiting
- `src/lib/public-api/auth.ts` validates bearer API keys only.
- Success responses use `{ data, meta? }`; errors use `{ error: { code, message, details? } }`.
- Public event `description` uses `events.public_description` only. Do not select or expose `events.notes`.
- Minimum 80% test coverage on API logic (see `src/lib/public-api/__tests__/`)

### Rate Limiting
- Missing/invalid key probes are rate-limited by `ip:<client IP>`.
- Valid API-key requests are rate-limited by `apiKey:<sha256 hash prefix>`.
- Limits configurable in `src/lib/public-api/rate-limit.ts`
- Return 429 (Too Many Requests) when exceeded

### Event Model
- Events use statuses including `proposed`, `pending_approval`, `draft`, `submitted`, `needs_revisions`, `approved`, `rejected`, `cancelled`, and `completed`.
- Optional artists/performers with bios
- Date/time handling via `src/lib/datetime.ts` (respects timezone)
- QR codes generated on demand (not pre-stored)

### Permissions
- Administrators can manage all non-deleted events and planning items.
- Executives can read events, planning, and reporting but cannot mutate.
- Office workers with `venue_id` can see and write event/planning records linked to their venue through `event_venues` / `planning_item_venues`, with fallback to the legacy `venue_id`.
- Office workers without `venue_id` have global event/planning read and can propose events for any venue, but do not get planning write rights.
- Booking/customer PII remains globally readable to office workers by product decision.
- Check permissions in both UI and server actions (defense in depth)
- RLS enforces at database level

### Auth Standard Deviation: Custom Role Model

**Deviation from workspace standard (auth-standard.md §7):** The workspace standard mandates three generic roles (`admin`, `editor`, `viewer`). This project uses three domain-specific roles approved for this application:

| Application Role | Maps to Standard Tier | Capabilities |
|---|---|---|
| `administrator` | `admin` | Full platform access, user management, all event operations |
| `office_worker` | `editor` | Venue-scoped event/planning visibility and writes if `venue_id` set; global read and any-venue event proposal if no `venue_id`; global booking/customer read |
| `executive` | `viewer` | Read-only access to all events, planning, and reporting |

**Why:** Event management requires venue-scoped write access for some staff and global read-only for others, expressed through a single role with venue_id as the capability switch.

**Implementation notes:**
- Roles stored in `public.users.role` column (not Supabase `app_metadata`)
- Role helpers in `src/lib/roles.ts` and venue-linked visibility helpers in `src/lib/visibility.ts` use explicit capability checks with optional `venueId` context.
- Permission checks use `role === "administrator"` for admin operations
- `venue_id` on the user record acts as a capability switch for `office_worker`.
- Event and planning reads should follow join-table venue links first and legacy `venue_id` fallback second.

### Email & Notifications
- `src/lib/notifications.ts` handles async dispatch
- Never await email sends in critical paths — queue for background jobs
- Use Resend templates for transactional emails

### Testing with Vitest
- Test API endpoints in `src/lib/public-api/__tests__/`
- Mock Resend and Supabase in tests
- Use `vitest.config.ts` for test setup (environment, ports, etc.)
- Run tests before pushing: `npm run test`

### QR Code Generation
- Use `qrcode` library (not `qrcode.react`)
- Generate QR codes server-side for ticket URLs
- Embed event ID and user ID in URL
- Cache generated QR images (optional, not required)

### Supabase Data Access
- Use service-role client only for system operations or server actions that have already performed explicit authorization.
- Client operations use anon-key (respects RLS)
- Always wrap DB results with conversion helper (snake_case → camelCase)

### Database Seeding
- `supabase/seed.sql` creates test events and users
- Run seeding after `supabase db reset`
- Keep seed data minimal (fast test setup)

### Artist Logic
- `src/lib/artists.ts` — fetch artist info, bios, links
- Always verify permissions via `src/lib/roles.ts` capability functions before allowing edits

### Datetime Handling
- Use `src/lib/datetime.ts` for all user-facing dates
- Store all times in UTC in database
- Convert to user's timezone on display
- See workspace AGENTS.md for timezone conventions
