# 09 — Theme & Design System

Implemented with **NativeWind** (Tailwind) over a semantic token system ([ADR-009](./08-decision-log.md),
[ADR-015](./08-decision-log.md)). This doc is the concrete spec: palettes, type, scales, tokens, and
how the livery themes layer on top.

## Philosophy
Utility-first, calm, fast. The UI gets out of the way; **the next-arrival data is the hero.** Color
is mostly neutral so that **status** (how soon / how fresh) and **operator accents** carry meaning.
Delight is applied in small doses — motion *on change*, not decoration.

> **Implementation status** ([ADR-017](./08-decision-log.md#adr-017--design-system-realization-fonts-text-scale-elevation-themed-nav-chrome),
> [ADR-018](./08-decision-log.md#adr-018--two-axis-theme-livery--appearance-with-persistence)).
> *Realized:* the token system (`packages/ui`), **Inter loaded** as weight cuts + splash-gated, the
> **`<Text>` typography primitive** (the canonical consumer of the §3 scale), **elevation** tokens +
> a `Card` primitive (§4), **themed nav chrome** (tab bar via `useTheme()`), and the **two-axis theme**
> (livery × appearance) with a **Settings picker** + persistence (§7). *Still spec-only:* `font-display`
> faces, auto-theme-by-operator, and the §5 motion / §6 number-flip animations. *Decided against for v1:*
> bundling **Noto** for CJK — we use the platform face instead ([ADR-019](./08-decision-log.md#adr-019--cjk-use-the-platform-font-do-not-bundle-noto-v1)).
> Per-component aesthetic: **role-based** type (`<Text variant>`), never raw Tailwind sizes.

---

## 1. Token architecture (3 layers)

```
Primitive tokens   →   Semantic tokens   →   Theme
(raw palette:          (what components       (a set of VALUES for the
 slate-500, blue-600,   ever reference:        semantic tokens; light,
 op-kmb-red, …)         bg, text, accent,      dark, and each livery)
                        positive, eta-soon…)
```

- **Components never use raw hex or primitive names** — only semantic classes (`bg-bg`,
  `text-muted`, `text-accent`, `bg-positive`…).
- A **theme** is just a different set of values for the semantic tokens → swapping it re-skins the
  whole app with **zero component changes**. This is what makes the livery themes cheap.

### How it's wired (NativeWind)
Semantic colors in Tailwind reference CSS variables holding `R G B` triplets:

```js
// tailwind.config.js  (in packages/ui preset)
theme: { extend: { colors: {
  bg:        'rgb(var(--bg) / <alpha-value>)',
  surface:   'rgb(var(--surface) / <alpha-value>)',
  'surface-2':'rgb(var(--surface-2) / <alpha-value>)',
  border:    'rgb(var(--border) / <alpha-value>)',
  text:      'rgb(var(--text) / <alpha-value>)',
  muted:     'rgb(var(--text-muted) / <alpha-value>)',
  subtle:    'rgb(var(--text-subtle) / <alpha-value>)',
  accent:    'rgb(var(--accent) / <alpha-value>)',
  'accent-contrast':'rgb(var(--accent-contrast) / <alpha-value>)',
  positive:  'rgb(var(--positive) / <alpha-value>)',
  warning:   'rgb(var(--warning) / <alpha-value>)',
  danger:    'rgb(var(--danger) / <alpha-value>)',
}}}
```

```ts
// themes.ts — values are "R G B" triplets
export const themes = {
  light: { '--bg':'255 255 255', '--text':'15 23 42', '--accent':'37 99 235', /* … */ },
  dark:  { '--bg':'2 6 23',      '--text':'248 250 252','--accent':'59 130 246', /* … */ },
  kmbLight:  { /* …light, */ '--accent':'215 40 47',  '--accent-contrast':'255 255 255' },
  ctbLight:  { /* …light, */ '--accent':'246 199 0',  '--accent-contrast':'15 23 42'  }, // yellow → dark text
  // …one entry per livery × {light,dark}
}
```

```tsx
// Native: inject vars at the root via NativeWind's vars()
import { vars } from 'nativewind';
<View style={vars(themes[livery][mode])}>{/* app */}</View>   // theme = livery × mode (ADR-018)
// Web: the same triplets are written to :root[data-theme="…"]
```

Components stay theme-agnostic: `className="bg-bg text-text"`, `className="text-accent"`, etc.

The active theme is resolved in one place — **`useTheme()`** (`apps/mobile/lib/useTheme.ts`) — which
returns the `vars()` set (injected at the app root) plus a `color(token)` resolver. The resolver
(`themeColor()` in `packages/ui`) turns a token into a concrete `rgb()` string for the few surfaces
that can't take a className — notably the **React Navigation tab bar** (it takes colour values). This
hook is also the seam where the **livery override** (§7) will layer on top.

---

## 2. Color

### Neutral base (slate ramp)

| Semantic | Light | Dark |
|---|---|---|
| `bg` | `#FFFFFF` | `#020617` (slate-950) |
| `surface` | `#F8FAFC` (slate-50) | `#0F172A` (slate-900) |
| `surface-2` | `#F1F5F9` (slate-100) | `#1E293B` (slate-800) |
| `border` | `#E2E8F0` (slate-200) | `#1E293B` / `#334155` |
| `text` | `#0F172A` (slate-900) | `#F8FAFC` (slate-50) |
| `text-muted` | `#475569` (slate-600) | `#94A3B8` (slate-400) |
| `text-subtle` | `#64748B` (slate-500) | `#64748B` (slate-500) |

### Accent (default "Classic" livery — a wayfinding blue, distinct from operator reds/yellows)
| Semantic | Light | Dark |
|---|---|---|
| `accent` | `#2563EB` (blue-600) | `#3B82F6` (blue-500) |
| `accent-contrast` | `#FFFFFF` | `#FFFFFF` |
| `focus` | `#2563EB` | `#60A5FA` |

### Status (always paired with an icon/label — **never color alone**)
| Semantic | Meaning | Light | Dark |
|---|---|---|---|
| `positive` | arriving / good | `#16A34A` | `#22C55E` |
| `warning` | a few min / uncertain | `#D97706` | `#F59E0B` |
| `danger` | no service / error | `#DC2626` | `#EF4444` |

### ETA urgency (a tuned subset, used for the big number)
- `eta-imminent` → uses `danger`/`accent` weight + **"Due/Arriving"** label (sub-minute).
- `eta-soon` (≈1–5 min) → `warning`.
- `eta-later` (>5 min) → `text` (neutral).
- `eta-stale` → desaturated `text-subtle` + a "stale" flag.

### Operator accents (used **sparingly** — a route-number chip, a thin route line; not backgrounds)
`op-kmb` `#D7282F` · `op-ctb` `#F6C700` (dark text on it) · `op-lwb` `#E8A33D` · `op-nwfb-legacy` `#F58220`.

**Contrast rules:** body text ≥ 4.5:1, large/UI ≥ 3:1, in both modes. The yellow accent **always**
pairs with dark text, never white. Verify every theme against [ADR-008](./08-decision-log.md) honesty +
WCAG-AA before shipping.

---

## 3. Typography

> **How it's wired:** Inter is loaded as discrete weight cuts (`Inter_400Regular` … `Inter_700Bold`)
> via `@expo-google-fonts/inter` + `expo-font` in `apps/mobile/app/_layout.tsx`, with the splash held
> until they load. The **`<Text variant weight tabular>`** primitive (`apps/mobile/components/Text.tsx`)
> is the only thing that sets a size/family — it maps a type role + weight to the right cut through
> `TYPE_SCALE` / `FONT_FAMILY` in `packages/ui/src/typography.ts`. On native `fontFamily` is single-valued,
> so CJK renders in the **platform face** (PingFang HK / system Noto) — v1 bundles **no** CJK webfont by
> decision ([ADR-019](./08-decision-log.md#adr-019--cjk-use-the-platform-font-do-not-bundle-noto-v1)).

### Fonts (bilingual is core)
- **Latin UI → Inter** (variable). Clean, functional, superb small-size legibility.
- **CJK (繁/简) → system first, Noto fallback.** Use the platform CJK face for zero-download speed
  (**PingFang HK** on iOS/macOS, system Sans on Android), with **Noto Sans HK** (Traditional, HK
  glyphs) / **Noto Sans SC** (Simplified) bundled as a cross-platform fallback. Inter + Noto Sans
  pair cleanly (both humanist sans, similar metrics).
- **Numerals (ETAs, route numbers) → Inter with `tabular-nums`.** Tabular figures keep digit width
  fixed so the number doesn't jiggle when it updates/flips.
- **`font-display` (Dot-Matrix livery only) → a dedicated LED/dot-matrix face** for the route-blind look.

```
--font-sans:    Inter, "Noto Sans HK", "Noto Sans SC", "PingFang HK", system-ui, sans-serif
--font-numeric: Inter (font-variant-numeric: tabular-nums)
--font-display: <dot-matrix face>   // swapped in by the Dot-Matrix livery only
```

### Type scale (mobile-first, 16px base)
| Token | Size / line-height | Use |
|---|---|---|
| `display` | 40 / 44 | the hero ETA number |
| `h1` | 28 / 34 | screen titles |
| `h2` | 22 / 28 | section headers |
| `h3` | 18 / 24 | card titles / route no. |
| `body` | 16 / 24 | default (min on mobile) |
| `label` | 14 / 20 | secondary labels |
| `caption` | 12 / 16 | timestamps only — never essential info |

Weights: Inter 400 / 500 / 600 / 700. 600 for emphasis, 700 for hero numerals. Body line-height 1.5.

---

## 4. Spacing, radius, elevation

- **Spacing** (4px base — Tailwind default): `1`=4 `2`=8 `3`=12 `4`=16 `5`=20 `6`=24 `8`=32 `10`=40 `12`=48.
  Touch targets **≥ 44×44px**; **≥ 8px** (`gap-2`) between adjacent tappables.
- **Radius:** `sm`=6 `md`=10 `lg`=14 `xl`=20 `full`=9999. Cards `md`/`lg`; bottom-sheets `xl` (top
  corners); chips/pills `full`.
- **Elevation:** `e0` none · `e1` cards · `e2` sticky headers · `e3` sheet/FAB. On **dark**, prefer
  `surface-2` lightening + `border` over shadows (shadows read poorly on dark). RN needs both the
  iOS `shadow*` and Android `elevation` recipes per token. **Implemented** as `ELEVATION` in
  `packages/ui/src/tokens.ts`, applied by the **`Card`** primitive (`apps/mobile/components/Card.tsx`),
  which shadows on light and switches to `surface-2` + border on dark automatically.

---

## 5. Motion tokens (Reanimated)
- **Durations:** `fast` 120ms · `base` 200ms · `slow` 320ms (micro-interactions 150–300ms).
- **Easing:** ease-out entering, ease-in exiting; spring for playful toggles (favorite, sheet drag).
- **Rules:** animate **1–2 elements per view**; transform/opacity only; no infinite decorative loops.
- **Reduced-motion:** honor OS / `prefers-reduced-motion` → swap to instant or opacity-only.
- **ETA update:** per-digit **number-flip** (or crossfade) + a one-shot **freshness pulse** dot when
  new data lands. **No per-second decrement** ([ADR-008](./08-decision-log.md)). Reduced-motion → plain
  text swap with a brief highlight.

---

## 6. ETA display spec (the signature component)
- Big **tabular** numeral + unit (`7 min`) **or** absolute clock (`3:42`); user-selectable, smart
  default (minutes when small, clock when large). Sub-minute → **"Arriving" / "Due"**.
- Colored by `eta-*` urgency token **and** an icon — never color alone.
- **Freshness chip** "updated 12s ago"; past a threshold → `eta-stale` styling + a refresh affordance.
- Up to 3 upcoming: first big, next two smaller/muted.
- Screen-reader label spells it out: *"Route 6, arriving in 7 minutes, updated 10 seconds ago."*

---

## 7. Livery themes (the fun-feature layering)
Each livery is a theme that **remaps only** `accent`, `accent-contrast`, an optional `surface` tint,
and (for the display liveries) a **display treatment** (`font-display` and/or the `<FlipTile>`
component). It **never** touches status/contrast tokens, so legibility and ETA honesty are identical
across every skin. Each ships **light + dark**.

> **Two independent axes** ([ADR-018](./08-decision-log.md#adr-018--two-axis-theme-livery--appearance-with-persistence)).
> The user picks a **livery** (colour identity, below) *and* an **appearance** (`auto` follows the OS /
> `light` / `dark`) — separately, in **Settings**. The active theme is the cross-product
> `themes[livery][mode]`; both are persisted (Zustand + AsyncStorage) and survive reload with no flash.
> So every livery below is defined for **both** modes — including light variants for the
> normally-dark Dot-Matrix (daytime) and Split-Flap (paper board).

| Livery | Accent | Notes |
|---|---|---|
| **Classic** (default) | wayfinding blue `#2563EB` | neutral, brand-agnostic |
| **KMB** | red `#D7282F` | faint red surface tint (light) |
| **Citybus** | yellow `#F6C700` | dark text on accent (contrast) |
| **CMB Nostalgia** | deep blue on cream / warm night | cream `surface` (light), warm dark (dark), retro feel |
| **Dot-Matrix** | LED orange `#FF8C00` | dark bg + `font-display` = dot-matrix; light = daytime variant |
| **Split-Flap (Solari)** | warm white on charcoal / paper | airport/station **flip-tile** board; tiles flap to new values |

Picker metadata (id, label key, swatch) lives in `LIVERIES` (`packages/ui/src/themes.ts`); the Settings
screen renders from it. State + persistence: `apps/mobile/lib/preferences.ts`.

### Display treatments: Dot-Matrix & Split-Flap
These two liveries swap *how characters render*, not the layout:
- **Dot-Matrix** is mostly a `font-display` swap (LED blind look).
- **Split-Flap (Solari)** is a small reusable **`<FlipTile>`** component (one tile per character):
  on a **real value change**, each tile animates a `rotateX` flap (top half down → bottom half up)
  to the new glyph, optionally cascading left→right like a real board. It is the *premium
  realization of the honest on-change animation* in §5 — **it only flaps when new data lands**, never
  on a fake timer ([ADR-008](./08-decision-log.md)).
- **Accessibility:** the rendered text is exposed to screen readers (`accessibilityLabel` /
  `aria-live`), and **reduced-motion** collapses the flap to an instant swap with a brief highlight.
- **Optional polish:** a soft flap *click* sound + haptic per settled tile (off by default; respects
  the sound/haptic and reduced-motion preferences). Reusable for any value: route no., destination, ETA.

**Auto-theme** (optional): the app adopts the livery of the operator you're currently viewing
(viewing a KMB route → KMB accent), then reverts. User can also pin a favorite livery.

---

## 8. Iconography & accessibility
- **Lucide** icons (consistent 24px line set; RN + Web). **No emoji as icons.**
- AA contrast both modes; **status never color-only**; visible **focus ring** (`focus`) for
  keyboard/web; honor **dynamic type**; **reduced-motion** downgrade; screen-reader labels on every
  icon button and ETA. (Cross-checked against the UX rules in [`docs/04`](./04-frontend-and-design.md).)

## 9. App icon & brand mark
The app icon is a **road-sign / transit pictogram**: a clean **side-profile double-decker** (HK's
signature bus), rendered as a **white symbol on an ink field** (`BRAND.ink` = `#111827`, in
`packages/ui/src/tokens.ts`). Construction (master: `apps/mobile/assets/icon.svg`):
- **Body** rounded rect (radius 84); **two glassy window bands** as field-colour cut-outs, the top
  one centred with an even 56px inset and a **concentric corner radius** (84 − 56 = 28); the lower
  band shortened to imply a **door** and give the bus a front (orientation).
- **Motion:** body + windows skewed **−8°** (leaning into travel, right-facing); **wheels stay round
  and centred** (planted) — they're *not* skewed, so the cabin lunges forward over them.
- **Wheels** are integrated white bumps (no second tone), so it reads as a bus without clutter.

**Why this and not the alternatives:** we explored a bilingual **巴/車 character dual-read** and a
**white-body negative-space** version; both consistently lost legibility (a clean bus *or* a clean
glyph, never both; white bodies vanish on light backgrounds). Front-view read as tram/train. The
side-profile pictogram is unambiguously a HK double-decker and pops on any wallpaper.

**Assets** are generated from the master by `scripts/gen-icons.mjs` (uses `sharp`):
`icon.png` (1024, full-bleed ink), `adaptive-icon.png` (Android foreground, mark in the safe zone),
`splash-icon.png` (mark on transparent; ink background via `app.json`), `favicon.png`, and
`icon-mono.png` (white mark on transparent — reused as the iOS **tinted** source and any in-app logo).
`app.json` wires `icon`, `splash`, `android.adaptiveIcon`, `web.favicon`, and **iOS
light/dark/tinted** variants. Regenerate after editing the SVG: `node scripts/gen-icons.mjs`.

**Deferred (needs the app name):** the **巴士 / 香港巴士 wordmark** + splash lockup — see
[`docs/07`](./07-backlog.md). The splash currently shows just the bus mark on ink.
