# 09 — Theme & Design System

Implemented with **NativeWind** (Tailwind) over a semantic token system ([ADR-009](./08-decision-log.md),
[ADR-015](./08-decision-log.md)). This doc is the concrete spec: palettes, type, scales, tokens, and the
single **Ink** theme (light/dark) layered on them.

## Philosophy
Utility-first, calm, fast. The UI gets out of the way; **the next-arrival data is the hero.** Colour
is mostly neutral so that **status** (how soon / how fresh) and **operator accents** carry meaning.
Delight is applied in small doses — motion *on change*, not decoration.

**Layered & immersive.** Primary navigation **floats** over the content rather than boxing it in, and
**content scrolls underneath** that chrome — it reads as one continuous, layered surface, not stacked
panels. The floating bar is the realization of this (§4); scroll views therefore must reserve room so
the last item still clears the chrome (see `useTabBarLayout().contentInset`,
[ADR-027](./08-decision-log.md#adr-027--floating-tab-bar-content-scrolls-underneath)). Lists stay
**full-bleed and flat** for the same reason (no floating cards — [ADR-026](./08-decision-log.md)).

> **Implementation status** ([ADR-017](./08-decision-log.md#adr-017--design-system-realization-fonts-text-scale-elevation-themed-nav-chrome),
> [ADR-018](./08-decision-log.md#adr-018--two-axis-theme-livery--appearance-with-persistence)).
> *Realized:* the token system (`packages/ui`), **Inter loaded** as weight cuts + splash-gated, the
> **`<Text>` typography primitive** (the canonical consumer of the §3 scale), **elevation** tokens +
> a `Card` primitive (§4), **themed nav chrome** (tab bar via `useTheme()`), the **single Ink theme**
> (light/dark/auto via a **Settings appearance** control + persistence; the multi-livery axis was
> **retired** — [ADR-029](./08-decision-log.md#adr-029--collapse-to-a-single-ink-theme-lightdarkauto-retire-the-livery-axis)), and **Lucide icons** behind an
> `<Icon tone>` primitive (§8, [ADR-025](./08-decision-log.md#adr-025--iconography-lucide-via-an-icon-primitive-on-the-token-system)).
> The Nearby/Favorites home is a **flat `StopRow` list** (no card chrome) showing distance + walk time
> ([ADR-026](./08-decision-log.md#adr-026--nearby-is-a-flat-list-not-cards-surface-distance--walk-time)).
> *Still spec-only:* `font-display`
> faces, auto-theme-by-operator, and the §5 motion / §6 number-flip animations. *Decided against for v1:*
> bundling **Noto** for CJK — we use the platform face instead ([ADR-019](./08-decision-log.md#adr-019--cjk-use-the-platform-font-do-not-bundle-noto-v1)).
> Per-component aesthetic: **role-based** type (`<Text variant>`), never raw Tailwind sizes.

---

## 1. Token architecture (3 layers)

```
Primitive tokens   →   Semantic tokens   →   Theme
(raw palette:          (what components       (a set of VALUES for the
 slate-500, ink, …)     ever reference:        semantic tokens; one Ink
                        bg, text, accent,      theme, light + dark)
                        positive, eta-soon…)
```

- **Components never use raw hex or primitive names** — only semantic classes (`bg-bg`,
  `text-muted`, `text-accent`, `bg-positive`…).
- A **theme** is just a different set of values for the semantic tokens → swapping `light`↔`dark`
  re-skins the whole app with **zero component changes** (and made re-adding liveries cheap, if ever).

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
// themes.ts — values are "R G B" triplets; one Ink theme, two modes (ADR-029)
export const themes: Record<Mode, ThemeVars> = {
  light: { '--bg':'255 255 255', '--text':'17 24 39', '--accent':'17 24 39', /* ink on paper */ },
  dark:  { '--bg':'13 17 28',    '--text':'244 246 250','--accent':'226 232 240', /* paper on ink */ },
}
```

```tsx
// Native: inject vars at the root via NativeWind's vars()
import { vars } from 'nativewind';
<View style={vars(themes[mode])}>{/* app */}</View>   // mode = light | dark (ADR-029)
// Web: the same triplets are the :root / .dark defaults in global.css
```

Components stay theme-agnostic: `className="bg-bg text-text"`, `className="text-accent"`, etc.

The active theme is resolved in one place — **`useTheme()`** (`apps/mobile/lib/useTheme.ts`) — which
returns the `vars()` set (injected at the app root) plus a `color(token)` resolver. The resolver
(`themeColor()` in `packages/ui`) turns a token into a concrete `rgb()` string for the few surfaces
that can't take a className — notably the **React Navigation tab bar** (it takes colour values).

---

## 2. Colour — the **Ink** theme (one theme, light + dark; [ADR-029](./08-decision-log.md#adr-029--collapse-to-a-single-ink-theme-lightdarkauto-retire-the-livery-axis))

A monochrome **"ink & paper"** system: the accent is the *ink* on light and inverts to *paper* on dark.

### Neutral base
| Semantic | Light | Dark |
|---|---|---|
| `bg` | `#FFFFFF` | `#0D111C` (ink-950) |
| `surface` | `#F8FAFC` (slate-50) | `#161B29` (ink-900) |
| `surface-2` | `#F1F5F9` (slate-100) | `#202636` (ink-800) |
| `border` | `#E2E8F0` (slate-200) | `#2C3343` (ink-700) |
| `text` | `#111827` (ink) | `#F4F6FA` (paper) |
| `text-muted` | `#475569` (slate-600) | `#9EA5B4` |
| `text-subtle` | `#64748B` (slate-500) | `#6B7280` |

### Accent — monochrome (ink ↔ paper; NOT a colour — distinct from operator reds/yellows & status)
| Semantic | Light | Dark |
|---|---|---|
| `accent` | `#111827` (ink) | `#E2E8F0` (paper) |
| `accent-contrast` | `#FFFFFF` | `#0D111C` (ink) |
| `focus` | `#111827` | `#E2E8F0` |

### Status (always paired with an icon/label — **never colour alone**)
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
- **Elevation:** `e0` none · `e1` cards · `e2` sticky headers · `e3` sheet/FAB / **floating tab bar**.
  On **dark**, prefer `surface-2` lightening + `border` over shadows (shadows read poorly on dark). RN
  needs both the iOS `shadow*` and Android `elevation` recipes per token. **Implemented** as `ELEVATION`
  in `packages/ui/src/tokens.ts`, applied by the **`Card`** primitive (`apps/mobile/components/Card.tsx`)
  and the **floating tab bar** ([ADR-027](./08-decision-log.md#adr-027--floating-tab-bar-content-scrolls-underneath)),
  both of which shadow on light and switch to a defining `border` on dark automatically.
  - **Why the dark branch ([ADR-035](./08-decision-log.md#adr-035--elevation-is-two-channels-opaque-shadowlighten-and-glass-defocus-led)):**
    elevation is a lighting metaphor with two cues — a surface *casts a shadow* and *catches more light*. On
    **light** the shadow has contrast to spend (bright field to darken) and added lightness has none
    (already near-white); on **dark** it inverts — a drop shadow has almost no budget on a near-black field
    (reads as haze), while *lightening* the surface has lots. So dark elevation makes **two** substitutions:
    shadow's *lift* → surface lightness, shadow's *edge/silhouette* → the hairline `border`. Drop either and
    it looks wrong. "Shadows read poorly on dark" is a *consequence* of this budget swap, not a style choice.
  - **Glass is a separate channel, not an `ELEVATION` level** — see §"Glass legibility" below and ADR-035.
- **Floating chrome:** the tab bar is a `position:absolute` rounded **pill** (`radius` 24) with side +
  bottom margins lifted clear of the safe-area inset; content **scrolls underneath** it (§1). Geometry is
  centralized in `apps/mobile/lib/tabBarLayout.ts` (`useTabBarLayout()` → `bottom` offset + `contentInset`
  for scroll views), so the bar and the screens that pad for it share one source of truth.
- **Glass (liquid material):** the **`GlassView`** primitive (`apps/mobile/components/GlassView.tsx`) is a
  translucent pane that lets the content underneath show through. On **web** it does **true optical
  refraction**, ported from **nikdelvin/liquid-glass** (`apps/mobile/lib/liquidGlass.ts`): a smooth **vector
  SVG displacement map** (X/Y gradients + a blurred neutral-centre mask → a soft refractive rim, no
  pixelation), wrapped in a data-URI SVG filter (3-pass **chromatic aberration**, `sRGB`) and applied via
  `backdrop-filter: blur() url('…#displace') brightness() saturate()`. SVG `backdrop-filter` is
  **Chromium-only**, so **Safari & Firefox** fall back to a frosted `blur()`; **native** uses `expo-blur`.
  Props mirror the reference — `depth` (rim width), `strength` (bend), `blur` (frosting), `chroma`. The tint
  follows the appearance (`useTheme`) and a `bg-surface/55`-style body keeps labels legible — so **each
  glass tints with the active theme** (frosted ink); `bg-ink` makes a fixed dark glass. The `lens` prop = wider rim + chroma (the workbench
  magnifier) vs. the subtle panel/tab-bar glass. It's the iOS-26 seam for Apple's true Liquid Glass
  (`expo-glass-effect`) — see [ADR-028](./08-decision-log.md#adr-028--liquid-glass-material--ink-livery).

---

## 5. Motion tokens (Reanimated)
- **Durations:** `fast` 120ms · `base` 200ms · `slow` 320ms (micro-interactions 150–300ms).
- **Easing:** ease-out entering, ease-in exiting; spring for playful toggles (favourite, sheet drag).
- **Rules:** animate **1–2 elements per view**; transform/opacity only; no infinite decorative loops.
- **Reduced-motion:** honour OS / `prefers-reduced-motion` → swap to instant or opacity-only.
- **ETA update:** per-digit **number-flip** (or crossfade) + a one-shot **freshness pulse** dot when
  new data lands. **No per-second decrement** ([ADR-008](./08-decision-log.md)). Reduced-motion → plain
  text swap with a brief highlight.

---

## 6. ETA display spec (the signature component)
- Big **tabular** numeral + unit (`7 min`) **or** absolute clock (`3:42`); user-selectable, smart
  default (minutes when small, clock when large). Sub-minute → **"Arriving" / "Due"**.
- Coloured by `eta-*` urgency token **and** an icon — never colour alone.
- **Freshness chip** "updated 12s ago"; past a threshold → `eta-stale` styling + a refresh affordance.
- Up to 3 upcoming: first big, next two smaller/muted.
- Screen-reader label spells it out: *"Route 6, arriving in 7 minutes, updated 10 seconds ago."*

---

## 7. Theme: Ink (one theme, light + dark)
There is **one** theme — **Ink** — chosen via the **appearance** axis only: `auto` (follows the OS) /
`light` / `dark`, in **Settings**. The appearance is persisted (Zustand + AsyncStorage) and survives reload
with no flash. The active theme is `themes[mode]`; `useTheme()` resolves it. See the palette in §2.

It's a monochrome **"ink & paper"** system (the accent is the *ink* on light, *paper* on dark — §2). It
**never** touches status or operator-accent tokens, so ETA honesty and operator identity are constant.

> **Retired ([ADR-029](./08-decision-log.md#adr-029--collapse-to-a-single-ink-theme-lightdarkauto-retire-the-livery-axis)):**
> the earlier multi-**livery** axis (Classic/KMB/Citybus/CMB/Dot-Matrix/Split-Flap × appearance, ADR-018)
> was dropped. `LiveryId`/`LIVERIES`/`DISPLAY_LIVERIES` are gone; `themes` is `Record<Mode, ThemeVars>`.
> Re-introducing liveries later is a localized change (restore the map + a Settings picker).

### Backlog — display treatments (deferred with the liveries)
A **`<FlipTile>`** Solari/split-flap component (one tile per character; flaps a `rotateX` on a **real**
value change, never a fake timer — [ADR-008](./08-decision-log.md)) and a dot-matrix `font-display` face
were specced for the display liveries. They're parked until liveries return; the honest on-change ETA
animation (§5/§6) is the part worth building regardless. Reduced-motion would collapse the flap to an
instant swap; the rendered text stays exposed to screen readers.

---

## 8. Iconography & accessibility
- **Lucide** icons (consistent 24px line set; RN + Web). **No emoji as icons.** **Implemented**
  ([ADR-025](./08-decision-log.md#adr-025--iconography-lucide-via-an-icon-primitive-on-the-token-system)):
  `lucide-react-native` (+ SDK-pinned `react-native-svg`) behind one primitive, **`<Icon icon tone>`**
  (`apps/mobile/components/Icon.tsx`). `tone` is a semantic role resolved through `useTheme().color()`,
  so icons re-skin with the appearance (light/dark); an explicit `color` is the rare value-driven exception
  (operator accent, nav tab tint). In use: favourite **star** (`SaveButton`), **tab-bar icons**, an
  optional leading icon on `Button`, and the stop-heading `ChevronRight`.
- AA contrast both modes; **status never colour-only**; visible **focus ring** (`focus`) for
  keyboard/web; honour **dynamic type**; **reduced-motion** downgrade; screen-reader labels on every
  icon button and ETA. Decorative icons stay unlabeled — the wrapping pressable carries the label.
  (Cross-checked against the UX rules in [`docs/04`](./04-frontend-and-design.md).)

### Glass as elevation ([ADR-035](./08-decision-log.md#adr-035--elevation-is-two-channels-opaque-shadowlighten-and-glass-defocus-led))
Glass is the app's **top-of-stack chrome (≈`e3`)** — the floating tab bar + route-header lens/pill — and a
**distinct elevation channel** from the `ELEVATION` tokens above (it uses none of them, and casts no shadow).
Its primary depth cue is the **blurred/refracted backdrop**: defocus reads as "behind glass = a nearer
plane", and that cue is **theme-neutral** — it doesn't swap budgets between light and dark the way opaque
shadow does, which is exactly why glass survives dark mode gracefully. On **dark**, refraction quietens
(dark-on-dark has little contrast to bend), so glass leans on its **tint floor** (`bg-surface/55–60` over a
darker `bg` = the dark-mode "raise = lighten" cue, for free) and its **rim-light** — whose values already
encode the per-channel budget (white top highlight `0.42`→`0.12` light→dark; dark bottom inset shadow
`0.06`→`0.16`, *stronger* on dark because the tint lightened the body for it to work against).

### Glass legibility (the rules for `GlassView`)
Liquid glass is a **chrome material**, not a content surface — so legibility, not the effect, wins.
Grounded in Apple's Liquid Glass HIG (controls layer adapts to stay readable; honour *Reduce
Transparency* / *Increase Contrast*; never stack glass on glass) and WCAG (text ≥ 4.5:1, large/UI ≥ 3:1
against the **effective** background — which, behind glass, is *variable*). Our rules:
1. **Always keep a tint floor** (`bg-surface/55`+). The translucent body is the legibility **scrim** that
   guarantees a worst-case background; raise it over busy content. A pure-blur (no tint) is too transparent.
2. **High-contrast labels/icons.** On glass, dim greys fail — tab-bar inactive items use `muted`, not
   `subtle`. Active state carries the `accent`.
3. **Refraction/blur on chrome only** — never behind body text or long lists (legibility + GPU cost).
4. **Rim light is decoration, kept muted** — a thin top highlight, faint on dark (a white edge over-reads
   against a dark surface), tuned to sit no louder than the app's `--border`.
5. **A dark tint (`bg-ink`) needs light content** — an ink-glass pane reads as a dark element regardless of
   theme, so its labels/icons must be light to stay legible. Note it also **opts out of the dark-mode
   lightening cue** (ink-over-ink barely lifts), so reserve it for recessive panes / the workbench showcase —
   not live floating chrome.
6. **Never stack glass on glass** — two translucent layers compound the blur + tint, muddy legibility, and
   destroy the single clean "near plane". Glass marks *the* top of the stack; anything above it is opaque.
7. **Cast shadow is light-only, never dark** — on **light**, blur + border can under-lift chrome off
   scrolling content, so a faint cast shadow under floating glass is permissible; on **dark** it only adds
   haze (the budget swap, ADR-035), so it stays off. *(The light cast shadow is **backlog** — not yet added.)*
8. **Backlog:** honour `prefers-reduced-transparency` → swap the glass for an opaque `surface`. Not yet done.

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

**In-app bus glyph (distinct from the icon above).** The route schematic's rail token uses a **front-view**
double-decker line glyph — `BusGlyph` (`apps/mobile/components/BusGlyph.tsx`), a custom **Lucide-style** icon
(24px grid, round caps/joins, **2px stroke** to match the Lucide set; Lucide has no decker). Same decker DNA
reworked head-on: **two glazed window bands** whose gap *is* the deck split (no divider line), over
**front-view tyres** as **solid pills** at the corners — filled because at a 2px stroke their interior is too
small to outline, a deliberate, documented break from Lucide's stroke-only convention. It rides a
**stationary** accent disc as the `BusToken`: the disc stays put and only the glyph animates — a gentle eased
**bob** with a ~4× slower side-to-side **rock** and a small **squash on impact** (squash-and-stretch),
all declarative reanimated timings on an ease-in-out curve (native-driven, **no JS clock**). Decorative idle
motion only — it signals *buses move*, never an ETA value (ADR-008). See
[ADR-030](./08-decision-log.md#adr-030--route-view-as-a-vertical-schematic-line-strip-with-two-state-bus-tokens).

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
