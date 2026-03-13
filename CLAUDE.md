# CLAUDE.md — BaronsHub

This file provides project-specific guidance. See the workspace-level `CLAUDE.md` one directory up for shared conventions.

## Quick Profile

- **Framework**: Next.js 16.1, React 19.1
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
- `/events` — Event browsing, listing (public and authenticated)
- `/admin` — Event creation, management, setup
- `/api/events` — Public event API with rate limiting and auth
- `/api/webhooks` — Incoming webhooks from external systems

**Auth**: Supabase Auth with JWT + HTTP-only cookies. User context available in server and client components. Permission checks via `src/lib/` helpers.

**Database**: Supabase PostgreSQL with RLS. `src/lib/` contains data access helpers. `supabase/seed.sql` provides test data setup.

**Key Integrations**:
- **QR Codes**: `qrcode` library for event ticket generation
- **Email**: Resend for event notifications and confirmations
- **Public API**: `src/lib/public-api/` — rate-limited REST API for events
- **Notifications**: `src/lib/notifications.ts` — event alerts and reminders

**Data Flow**: Server actions for mutations (create/update/delete events). React Query for data fetching. All API responses validated with Zod. RLS enforces permission at database level.

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
| `src/app/api/events` | Public event REST API |
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
- `src/lib/public-api/auth.ts` validates API keys (Bearer token or query param)
- All responses return `{ success: boolean; data?: T; error?: string }`
- Minimum 80% test coverage on API logic (see `src/lib/public-api/__tests__/`)

### Rate Limiting
- Per-IP limiting for anonymous requests
- Per-API-key limiting for authenticated requests
- Limits configurable in `src/lib/public-api/rate-limit.ts`
- Return 429 (Too Many Requests) when exceeded

### Event Model
- Events have status: `draft` → `published` → `completed`
- Optional artists/performers with bios
- Date/time handling via `src/lib/datetime.ts` (respects timezone)
- QR codes generated on demand (not pre-stored)

### Permissions
- Event creators can edit own events
- Reviewers/admins can moderate all events
- Check permissions in both UI and server actions (defense in depth)
- RLS enforces at database level

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
- Use service-role client only for system operations (migrations, seeding)
- Client operations use anon-key (respects RLS)
- Always wrap DB results with conversion helper (snake_case → camelCase)

### Database Seeding
- `supabase/seed.sql` creates test events and users
- Run seeding after `supabase db reset`
- Keep seed data minimal (fast test setup)

### Artist/Reviewer Logic
- `src/lib/artists.ts` — fetch artist info, bios, links
- `src/lib/reviewers.ts` — fetch reviewer assignments, approval status
- Always verify reviewer permissions before allowing edits

### Datetime Handling
- Use `src/lib/datetime.ts` for all user-facing dates
- Store all times in UTC in database
- Convert to user's timezone on display
- See workspace CLAUDE.md for timezone conventions
