# EventHub Style Guide (plain English)

This is the visual system used in EventHub. Copy these notes into your new app to reproduce the same look and feel.

## Palette
- Base: warm navy. Primary shade is `#273640`; lighter tones range up to `#ccd4db`.
- Accents: bronze `#b98c5b` (main accent), sage `#4f7a69` (success), cranberry `#8d4446` (danger), slate/cool blue `#5d7488` (info), amber `#c08b3c` (warning).
- Surfaces: canvas `#f4f1eb` (app background), white cards, muted surface `#edf0f3`, border `#d4d9dd`.
- Text: main `#1c252d`, muted `#56616a`, subtle `#6d7780`.
- Dark mode: auto via `prefers-color-scheme`; surfaces flip to deep navy/charcoal, text to light, accents gently lighten.
- Soft accent wash: `rgba(185,140,91,0.18)` (bronze tint) for muted backgrounds.

## Radii & Shadows
- Radii: small `0.5rem`, default `0.75rem`, large `1rem`. Pills use full rounding.
- Shadows: card shadow is broad and soft; a lighter “soft” shadow is used on buttons/inputs/cards.

## Typography
- Body: Geist sans (variable), tight letter spacing. Mono: Geist Mono.
- Brand/hero: Playfair Display serif for logos and big titles.
- Typical sizes: page titles around `text-3xl` serif; card titles `text-lg` semibold; helper text `text-xs` muted/subtle.

## Layout patterns
- App shell: dark navy sidebar (primary-700) with bronze “EventHub” serif mark and white nav links; main area sits on the canvas background with white cards.
- Header bar: white surface with subtle bottom border and soft shadow; muted labels for metadata.
- Grid spacing: generous `gap-6` between cards/sections; card padding usually `p-6`.

## Buttons
- Shape: pill, medium weight text, small icon gap.
- Primary: navy background, light text, soft shadow, darker hover.
- Secondary: bronze background, dark text.
- Outline: white bg, light border, navy text, faint hover tint.
- Ghost: transparent with navy text and light hover wash.
- Subtle: muted-surface fill with navy text.
- Destructive: cranberry red with white text.
- Sizes: sm (h-9), md (h-10), lg (h-12), icon (square h/w-10). Focus ring uses a translucent primary outline.

## Forms
- Inputs/selects/textareas: white fill, light gray border, medium radius, soft shadow. Focus adds primary-colored border + outline ring. Placeholders are muted; disabled state uses a faint gray fill and reduced opacity.
- Labels: small, medium weight, main text color (often set to subtle on auth pages).

## Cards
- White background, large radius, light border, card shadow.
- Headers: subtle bottom border, slightly translucent white, padding `p-6`.
- Titles: semibold, main text color; descriptions: `text-sm` muted.
- Footers: top border with padding; used for actions or totals.

## Badges & statuses
- Badges: rounded pills, uppercase `text-xs` semibold. Neutral (muted surface), info (cool gray/primary text), success (sage), warning (bronze), danger (cranberry).
- Status styling in lists/calendars: draft gray, submitted slate/info, needs revisions bronze, approved/completed sage, rejected cranberry.
- Note: the badge component references text tokens `--color-olive-smoke`, `--color-aged-brass`, `--color-antique-burgundy` that aren’t defined. Either add those tokens (matching sage/amber/cranberry text) or replace with existing `var(--color-success/warning/danger)` when reusing.

## Auth screens
- Full-bleed dark navy background with a bronze radial glow.
- Centered layout: left column has bronze serif “EventHub” logo and uppercase microcopy; right column hosts the form card.
- Auth card: semi-opaque white (`bg-white/95`), soft shadow, subtle ring, generous padding (`p-8`), tight gaps (`gap-6`).

## Utilities & misc
- Helpers: `.text-muted`, `.text-subtle`, `.bg-surface`, `.bg-muted-surface`, `.border-subtle`, `.font-brand-serif`, `.sr-only`.
- Toasts: Sonner with surface background, main text color, border, default radius, soft shadow, top-right position.
- Focus states: outline ring in a soft primary tint; hover states favor light washes over heavy color flips.
- Links: often dark navy with hover to a lighter navy tint.

## How to port this to a new app
- Copy the CSS variables and `@theme` block from `src/app/globals.css` (includes light/dark tokens and radii/shadows).
- Bring over the font setup in `src/app/layout.tsx` (Geist + Playfair via `next/font`) and apply the font variables to the `<body>` class.
- Reuse component patterns from `src/components/ui` (buttons, inputs, selects, textarea, card, badge, submit-button, toaster) to keep consistent rounding, shadows, and focus states.
- Mirror the layout conventions: dark sidebar + light content area, white headers with subtle borders, canvas background for the main area, and white cards for content blocks.
- Resolve the badge text color tokens by adding them to your globals or swapping to existing success/warning/danger text colors.
