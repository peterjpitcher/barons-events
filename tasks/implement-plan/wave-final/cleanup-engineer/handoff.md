# Cleanup Engineer Handoff (B6 + C3)

## B6: Removed all 5 `as any` casts in `src/actions/events.ts`

- L437–438 (venue embed): introduced local `EmbeddedVenue` type; cast bounded to embed boundary.
- L442 (artists embed): introduced local `EmbeddedArtistEntry` type; embed cast typed.
- L559, L572 (`update(payload)`): typed via `Database["public"]["Tables"]["events"]["Update"]`.

`grep -c " as any" src/actions/events.ts` → 0.

## C3: Added `npm run advisors`

- `package.json` script: `"advisors": "supabase db lint --linked"`.
- Documented in project `CLAUDE.md` Commands section: run pre-deploy / before merging migrations.

## Verification (all green)

- `npm run typecheck` — clean
- `npm run lint` — 0 errors (2 pre-existing unrelated warnings)
- `npm test -- events` — 10 files / 59 tests passed

## Commits

- `87f65d3` chore(events): replace as-any casts with generated Supabase types
- `0f2042f` chore(ci): add npm run advisors script for Supabase db lint
