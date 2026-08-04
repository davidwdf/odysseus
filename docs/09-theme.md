# 09 — Theme & Design System

Implemented with **NativeWind** (Tailwind) over a semantic token system ([ADR-009](./08-decision-log.md),
[ADR-015](./08-decision-log.md)). This doc is the concrete spec: palettes, type, scales, tokens, and the
single **Ink** theme (light/dark) layered on them.

> **Every value in this doc is declared once, in [`packages/ui/tokens.json`](../packages/ui/tokens.json),
> and every file that carries it is generated from there** — see §1.1. If a number here disagrees with
> the code, the token file is right and one of the two is a bug; the *prose*, though, is the reason a
> value is what it is, so keep both in step.

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
> *Realized:* the token system (`packages/ui`, **generated from one DTCG declaration** — §1.1,
> ADR-054), **Inter loaded** as weight cuts + splash-gated, the
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

## 1.1 One declaration, generated consumers ([ADR-054](./08-decision-log.md))

**`packages/ui/tokens.json` is the only file a human edits.** It is [DTCG](https://tr.designtokens.org/)
format — groups are plain nesting, leaves carry `$value` / `$type` / `$description`, and
`{dotted.path}` is an alias, which is how the three-layer architecture above is actually expressed:
`palette.ink` is written down once and `color.semantic.{text,accent,focus}.light` plus
`color.brand.ink` all alias it.

`pnpm --filter @nextbus/ui tokens:emit` derives every consumer:

| Generated | For | Carries |
|---|---|---|
| `packages/ui/src/tokens.generated.ts` | the app | `THEME_VARS`, `RADIUS`, `SPACING`, `MOTION`, `TYPE_SCALE`, `FONT_FAMILY`, `ELEVATION`, … |
| `packages/ui/preset.js` | Tailwind / NativeWind | the semantic → `rgb(var(--x) / <alpha-value>)` map, radii, spacing, the type scale, the font stacks |
| `apps/mobile/global.css` | the web build (NativeWind's input) | the `:root` / `.dark` variable defaults |
| `packages/ui/generated/tokens.json` | tools with no TS toolchain | every token, aliases resolved, units flattened (`scripts/gen-icons.mjs` reads it) |
| `packages/ui/generated/NextBusTokens.swift` | a future iOS client | SwiftUI `Color` / `CGFloat` constants — **never compiled here** (see below) |
| `packages/ui/generated/NextBusTokens.kt` | a future Android client | Compose `Color` / `Dp` constants — **never compiled here** |

The output is **committed**, so a reviewer sees the effect of a token change in the diff, and
**gated**: `pnpm --filter @nextbus/ui test` regenerates in memory and fails if any committed artefact
differs, if an alias does not resolve, if a semantic token is missing a mode or a `tailwind` name, or
if a palette primitive is aliased by nothing. `turbo run test` runs it uncached (the gate reads
`apps/mobile/global.css`, which is outside the package turbo hashes).

Two escape hatches, both asserted rather than trusted:

- **`apps/mobile/app.json`** (Expo's static config) and **`apps/mobile/public/manifest.webmanifest`**
  hold the brand ink as a literal, because neither is in the JS bundle. The same gate pins all four
  values against `color.brand.ink` and fails if they drift.
- **`scripts/check-no-raw-colours.mjs`** (in `pnpm test`) bans hex / `rgb()` / `hsl()` literals in
  `apps/mobile/{app,components,lib,providers}` and `packages/ui/src`. One allowlisted file:
  `apps/mobile/lib/liquidGlass.ts`, whose hex values are SVG displacement-map *channel encodings*
  (`#808080` = zero displacement), not colours.

**Swift and Kotlin are unverified.** There is no Swift or Kotlin toolchain in this repo, so neither
file has ever been compiled. They are emitted deliberately plain — nested namespaces of constants, no
protocols, no generics — so the first native client can compile them as-is; a compile error there is a
bug in the emitter, not something to patch in the output.

### How it's wired (NativeWind)
Semantic colours in Tailwind reference CSS variables holding `R G B` triplets — triplets rather than
hex specifically so Tailwind's alpha modifiers (`bg-surface/55`) keep working:

```js
// packages/ui/preset.js — GENERATED from tokens.json
theme: { extend: { colors: {
  bg:        'rgb(var(--bg) / <alpha-value>)',
  'surface-2':'rgb(var(--surface-2) / <alpha-value>)',
  muted:     'rgb(var(--text-muted) / <alpha-value>)',
  // …one entry per semantic token, plus the fixed brand `ink`
}}}
```

```tsx
// Native: inject vars at the root via NativeWind's vars()
import { vars } from 'nativewind';
<View style={vars(themes[mode])}>{/* app */}</View>   // mode = light | dark (ADR-029)
// Web: the same triplets are the :root / .dark defaults in apps/mobile/global.css
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
`KMB` `#D7282F` · `CTB` `#F6C700` (dark text on it) · `LWB` `#E8A33D` · `GMB` `#00845C`. Each pairs with
a contrast-safe text colour (`color.operatorText`): white, except CTB's yellow, which takes `#0F172A`.
These do **not** invert with the appearance — operator identity is constant (§7).

**Contrast rules:** body text ≥ 4.5:1, large/UI ≥ 3:1, in both modes. The yellow accent **always**
pairs with dark text, never white. Verify every theme against [ADR-008](./08-decision-log.md) honesty +
WCAG-AA before shipping.

---

## 3. Typography

> **How it's wired:** Inter is loaded as discrete weight cuts (`Inter_400Regular` … `Inter_700Bold`)
> via `@expo-google-fonts/inter` + `expo-font` in `apps/mobile/app/_layout.tsx`, with the splash held
> until they load. The **`<Text variant weight tabular>`** primitive (`apps/mobile/components/Text.tsx`)
> is the only thing that sets a size/family — it maps a type role + weight to the right cut through
> `TYPE_SCALE` / `FONT_FAMILY`, generated from tokens.json's `type` and `font.cut` groups (§1.1). On native `fontFamily` is single-valued,
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

- **Spacing** (4px base): `1`=4 `2`=8 `3`=12 `4`=16 `5`=20 `6`=24 `8`=32 `10`=40 `12`=48. These are the
  values Tailwind ships as its default scale, but they are now **declared** in tokens.json's `spacing`
  group and emitted into the preset in `rem` (px ÷ the 16px base), so the web build still honours the
  browser font size while iOS and Android — which have no Tailwind — read the same numbers.
  Touch targets **≥ 44×44px**; **≥ 8px** (`gap-2`) between adjacent tappables. Those two are *rules*,
  not tokens, and stay prose on purpose.
- **Radius:** `sm`=6 `md`=10 `lg`=14 `xl`=20 `full`=9999, plus two off-scale component radii:
  `pill`=24 (the floating tab bar, whose corner tracks its 54px height — `TAB_BAR_RADIUS` re-exports
  it) and `sheet`=26 (a bottom sheet's top corners; 20 reads tight across the full width). Cards
  `md`/`lg`; chips/pills `full`.
- **Elevation:** `e0` none · `e1` cards · `e2` sticky headers · `e3` sheet/FAB / **floating tab bar**.
  On **dark**, prefer `surface-2` lightening + `border` over shadows (shadows read poorly on dark).
  - **The token is platform-neutral**: a shadow geometry (colour, alpha, offset, blur, spread) plus
    Android's Material `dp` where the platform wants a step instead of a geometry. `blur` carries CSS
    semantics — a 2σ radius, per the DTCG shadow type — and `elevationStyle(level, Platform.OS)`
    (`packages/ui/src/elevation.ts`) is the one place that maps it to a platform: a `boxShadow` string
    on web, `{ elevation: dp }` on Android, the `shadow*` quartet (with `shadowRadius` = blur ÷ 2,
    since RN's radius is σ) everywhere else. `e0` collapses to an empty style on every target.
    Two recipes sit off the e-scale for the same machinery: `pin` and `pinActive`, the map-pin lift.
    They declare no `androidDp` deliberately — a pin is an overlay, not a Material surface, so Android
    draws the geometry.
  - **Applied by** the **`Card`** primitive (`apps/mobile/components/Card.tsx`), the **floating tab bar**
    ([ADR-027](./08-decision-log.md#adr-027--floating-tab-bar-content-scrolls-underneath)) and
    `MiniMap`'s pins — the first two shadow on light and switch to a defining `border` on dark
    automatically.
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
  for scroll views), so the bar and the screens that pad for it share one source of truth. The bar
  pins its label **below-icon** at every width (React Navigation otherwise flips to beside-icon on
  wide/PWA viewports, breaking the phone look), and zeroes the default nav `borderTopWidth` — that
  hairline paints in the *light* nav-theme colour (no dark nav theme under Expo Router's `Stack`) and
  otherwise reads as a harsh light line along the top on dark; the `GlassView` rim/border carries the edge.
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

> **Partly superseded by the component specs (2026-08-03, WP6-2 —
> [ADR-075](./08-decision-log.md#adr-075--three-renderers-one-executable-spec-and-drift-defined-on-the-spec-rather-than-the-pixels)
> decision 2, [ADR-084](./08-decision-log.md#adr-084--a-screen-spec-a-state-that-declares-what-it-shows-and-a-slot-that-references-another-spec)).**
> Under the invariant/idiom line, **motion is idiom**: what is *shared* is the **intent** and the
> **reduced-motion behaviour**, and the curve, the duration, the physics and *whether it moves at all* are
> each renderer's. So the durations, easings and per-page transitions below are **`apps/mobile`'s recipe**,
> not a cross-platform requirement — the web app cuts where the RN app slides, deliberately, and a native
> iOS or Android client will choose its own.
> What survives as identity, and is asserted rather than described: **reduced motion must not change the
> content.** Each spec declares that as `a11y.reducedMotion`, and `packages/contract/ui/nearby.spec.json`
> lists motion under `idiom` by name — because "flexible" only means something when it is enumerated.
> The **ETA update** bullet at the end of this section is the one part still awaiting a home: it describes a
> component (`EtaBadge`) that has no spec of its own yet, living inside `StopRow`'s as three `oneOf`
> branches. Owner: the row that gives the readout its own spec.

- **Durations:** `fast` 120ms · `base` 200ms · `slow` 320ms (micro-interactions 150–300ms).
- **Easing:** ease-out entering, ease-in exiting; spring for playful toggles (favourite, sheet drag).
- **Rules:** animate **1–2 elements per view**; transform/opacity only; no infinite decorative loops.
- **Reduced-motion:** honour OS / `prefers-reduced-motion` → swap to instant or opacity-only.
- **Navigation transitions** ([ADR-043](./08-decision-log.md#adr-043--a-core-navigation-animation-system-cross-fade-tabs-slide-and-reveal-stack-web-swipe-back)):
  tab↔tab = quick **cross-fade** (web + native); opening a sub/detail page = **slide in from the right** and Back
  **slides it off, revealing the page beneath** — **native only for now** (on the web PWA it's an instant cut; a JS
  stack that animated it on web broke scrolling — see ADR-043). A left-edge **swipe-back** gesture works on web. The
  rules live in one place — `apps/mobile/lib/navTransitions.ts` + the two `_layout`s — never per page, and all
  collapse to an instant cut under reduced motion. **Two-step reveal:** a page appears *first*, then runs entrance
  work (e.g. the route page's auto-scroll to the originating stop) as a deliberate second beat via
  `usePageRevealReady()`.
- **ETA update:** per-digit **number-flip** (or crossfade) + a one-shot **freshness pulse** dot when
  new data lands. **No per-second decrement** ([ADR-008](./08-decision-log.md)). Reduced-motion → plain
  text swap with a brief highlight.

---

## 6. ETA display spec (the signature component)

> **Superseded in kind, and kept as the design intent it always was (2026-08-03, WP6-2).** ADR-075 decision 3
> is explicit that *"a component spec is data validated by a schema, never prose"* — and it names this section
> as the reason: it has been titled "spec" since Wave 1, it is prose, and **the imminence band it describes was
> written down four times with two different values** until WP4-0 hoisted it into `etaUrgency`. The executable
> version of the parts below now lives in two places, both machine-checked:
> the **rules** in `packages/core` (`etaUrgency`, `etaReadout`, `etaLabelParts`, `isStale`, `formatClock`),
> pinned by `packages/core/spec/eta.spec.json`; and **what a renderer must draw** in
> `packages/contract/ui/stop-row.spec.json`, where the readout is a `oneOf` over `label.kind` with `mins`,
> `due` and `departed` branches, and ADR-008's no-countdown rule is its declared invariant.
> Read this section for the *intent*; read the spec for what is enforced. Three of its bullets are **not yet
> anywhere else** and are therefore still aspirations rather than requirements: the user-selectable clock
> toggle, the "updated 12s ago" freshness chip as a *chip*, and the spelled-out screen-reader sentence.

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
  (operator accent, nav tab tint). In use: **tab-bar icons**, an
  optional leading icon on `Button`, and the stop-heading `ChevronRight`. (The favourite **star** returns
  per-route with [ADR-032](./08-decision-log.md#adr-032--favourites-are-route-at-stop-pairs-not-bare-routes).)
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
`0.06`→`0.16`, *stronger* on dark because the tint lightened the body for it to work against). Those four
alphas are the `glassRim` tokens, and the two-stop cast shadow is `glassShadow` — kept as their own
groups rather than `elevation` levels precisely because glass is a different channel; `GlassView`
composes both through `webBoxShadow()`.

### Glass legibility (the rules for `GlassView`)
Liquid glass is a **chrome material**, not a content surface — so legibility, not the effect, wins.
Grounded in Apple's Liquid Glass HIG (controls layer adapts to stay readable; honour *Reduce
Transparency* / *Increase Contrast*; never stack glass on glass) and WCAG (text ≥ 4.5:1, large/UI ≥ 3:1
against the **effective** background — which, behind glass, is *variable*). Our rules:
1. **Always keep a tint floor** (`bg-surface/55`+). The translucent body is the legibility **scrim** that
   guarantees a worst-case background; raise it over busy content. A pure-blur (no tint) is too transparent.
   The tint sits **below** the content, not over it — on web an absolutely-positioned scrim paints *above*
   in-flow children (CSS painting order) and washes glyphs/labels grey, so it's pinned back with a negative
   `z-index` (native already paints in declaration order).
2. **High-contrast labels/icons.** On glass, dim greys fail — tab-bar inactive items use `muted`, not
   `subtle`. Active state carries the `accent`; the route-header back lens takes that same `accent`, so the
   back control matches the active tab in both modes.
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
   haze (the budget swap, ADR-035), so it stays off. Shipped as `GlassView`'s opt-in **`elevated`** prop
   (web-only, gated on `!isDark`), on the route-header lens + pill; the tab bar lifts via its container's
   `ELEVATION.e3` (native-safe).
8. **Backlog:** honour `prefers-reduced-transparency` → swap the glass for an opaque `surface`. Not yet done.

## 9. App icon & brand mark
The app icon is a **road-sign / transit pictogram**: a clean **side-profile double-decker** (HK's
signature bus), rendered as a **white symbol on an ink field** (`color.brand.ink` = `#111827`, declared
in `packages/ui/tokens.json`; `scripts/gen-icons.mjs` reads it from the generated token set, and
`app.json` / `manifest.webmanifest` pin the same value under the §1.1 gate). Construction (master: `apps/mobile/assets/icon.svg`):
- **Body** rounded rect (radius **64** — a crisp, purposeful corner that still reads friendly, and
  holds up down to the 28px favicon); **two glassy window bands** as field-colour cut-outs, the top
  one centred with an even 56px inset, both with a softly-rounded **radius 21** (kept legible rather
  than strictly concentric with the crisper body). **Both bands run the full length (equal decks)** —
  the front/rear read is carried entirely by the tandem wheels + lean, so the lower deck is *not*
  shortened (an earlier "engine bay" cut was dropped as redundant and slightly lopsided at small sizes).
- **Motion:** body + windows skewed **−9°** (leaning into travel, right-facing); **wheels stay round
  and level** (planted) — they're *not* skewed, so the cabin lunges forward over them.
- **Wheels — tri-axle** (authentic HK double-decker): a **single front wheel** (right) and a **rear
  tandem pair** (left), radius 48. The doubled-up rear is both true to the real vehicle and the
  clearest **front/rear signal** in the mark. They're integrated white bumps (no second tone), and are
  positioned by visual balance — deliberately **rear-biased**, like a real tri-axle — rather than
  centred to the icon frame.

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
The **favicon uses the full tri-axle mark scaled up ~1.24×** (wheels and all): the padded launcher
mark gets mushy shrunk into a 16–24px tab, so the browser-tab variant fills the frame so the wheels
stay legible small. It lives alongside the full mark in `scripts/gen-icons.mjs` (`FAVICON_MASK`).
`app.json` wires `icon`, `splash`, `android.adaptiveIcon`, `web.favicon`, and **iOS
light/dark/tinted** variants. Regenerate after editing the SVG: `node scripts/gen-icons.mjs`.

**PWA / install icons** (ADR-048) are also generated into `apps/mobile/public/` (copied to the web
root by `expo export`): `apple-touch-icon.png` (180, opaque — iOS Add-to-Home-Screen), `icon-192.png`
/ `icon-512.png` (manifest "any"), and `icon-maskable-512.png` (mark in the ~66% safe zone on ink,
manifest "maskable"). They're referenced by `public/manifest.webmanifest` + `app/+html.tsx`, which
injects the manifest/apple-touch-icon/`theme-color`/`apple-mobile-web-app-*` `<head>` tags that Expo's
default HTML omits. (Installing over HTTPS + the standalone status bar are pending verification.)

**Deferred (needs the app name):** the **巴士 / 香港巴士 wordmark** + splash lockup — see
[`docs/07`](./07-backlog.md). The splash currently shows just the bus mark on ink.
