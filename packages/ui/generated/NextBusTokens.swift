// Generated from packages/ui/tokens.json by its scripts/generate-tokens.mjs — do not edit.
// Run `pnpm --filter @nextbus/ui tokens:emit`; `pnpm --filter @nextbus/ui test` fails on a stale
// copy, so drifting from the declaration is a red build, not a silent surprise.
//
// UNVERIFIED: this repo has no Swift or Kotlin toolchain, so nothing below has ever been compiled.
// It is deliberately plain — nested namespaces of constants, no protocols, no generics, no
// extensions — so the first native client can compile it as-is, and so any fix is a one-line
// change to the emitter. Treat a compile error here as a bug in generate-tokens.mjs, not something
// to patch in place.
//
// Assumes SwiftUI (iOS 13+) for `Color` and `CGFloat`.

import SwiftUI

public enum NextBusTokens {
    /// The two modes of the single Ink theme (ADR-029).
    public enum Mode {
        case light
        case dark
    }

    /// The semantic colours in the light mode (docs/09 §2).
    public enum LightColor {
        /// Page background.
        public static let bg = Color(red: 255 / 255, green: 255 / 255, blue: 255 / 255)
        /// A raised surface — cards, sheets, rows.
        public static let surface = Color(red: 248 / 255, green: 250 / 255, blue: 252 / 255)
        /// The second lift. On dark this carries the elevation cue that a shadow carries on light
        /// (ADR-035).
        public static let surface2 = Color(red: 241 / 255, green: 245 / 255, blue: 249 / 255)
        /// Hairline divider and the silhouette a dark-mode surface uses instead of a shadow.
        public static let border = Color(red: 226 / 255, green: 232 / 255, blue: 240 / 255)
        /// Body text. ≥ 4.5:1 against `bg` in both modes.
        public static let text = Color(red: 17 / 255, green: 24 / 255, blue: 39 / 255)
        /// Secondary text. Also the tab bar's inactive tint — `text-subtle` was too low-contrast to
        /// read on glass (docs/09 §Glass legibility, rule 2).
        public static let textMuted = Color(red: 71 / 255, green: 85 / 255, blue: 105 / 255)
        /// Tertiary text — timestamps, captions. Never essential information.
        public static let textSubtle = Color(red: 100 / 255, green: 116 / 255, blue: 139 / 255)
        /// The monochrome accent — ink on light, paper on dark. Not a colour: operator identity and
        /// ETA status carry meaning, so the accent must not compete with them.
        public static let accent = Color(red: 17 / 255, green: 24 / 255, blue: 39 / 255)
        /// What sits on top of `accent`.
        public static let accentContrast = Color(red: 255 / 255, green: 255 / 255, blue: 255 / 255)
        /// Keyboard/web focus ring. Must stay visible in both modes (docs/09 §8).
        public static let focus = Color(red: 17 / 255, green: 24 / 255, blue: 39 / 255)
        /// Arriving / good. Always paired with an icon or label — never colour alone.
        public static let positive = Color(red: 22 / 255, green: 163 / 255, blue: 74 / 255)
        /// A few minutes away / uncertain.
        public static let warning = Color(red: 217 / 255, green: 119 / 255, blue: 6 / 255)
        /// No service / error.
        public static let danger = Color(red: 220 / 255, green: 38 / 255, blue: 38 / 255)
    }

    /// The semantic colours in the dark mode (docs/09 §2).
    public enum DarkColor {
        /// Page background.
        public static let bg = Color(red: 13 / 255, green: 17 / 255, blue: 28 / 255)
        /// A raised surface — cards, sheets, rows.
        public static let surface = Color(red: 22 / 255, green: 27 / 255, blue: 41 / 255)
        /// The second lift. On dark this carries the elevation cue that a shadow carries on light
        /// (ADR-035).
        public static let surface2 = Color(red: 32 / 255, green: 38 / 255, blue: 54 / 255)
        /// Hairline divider and the silhouette a dark-mode surface uses instead of a shadow.
        public static let border = Color(red: 44 / 255, green: 51 / 255, blue: 67 / 255)
        /// Body text. ≥ 4.5:1 against `bg` in both modes.
        public static let text = Color(red: 244 / 255, green: 246 / 255, blue: 250 / 255)
        /// Secondary text. Also the tab bar's inactive tint — `text-subtle` was too low-contrast to
        /// read on glass (docs/09 §Glass legibility, rule 2).
        public static let textMuted = Color(red: 158 / 255, green: 165 / 255, blue: 180 / 255)
        /// Tertiary text — timestamps, captions. Never essential information.
        public static let textSubtle = Color(red: 107 / 255, green: 114 / 255, blue: 128 / 255)
        /// The monochrome accent — ink on light, paper on dark. Not a colour: operator identity and
        /// ETA status carry meaning, so the accent must not compete with them.
        public static let accent = Color(red: 226 / 255, green: 232 / 255, blue: 240 / 255)
        /// What sits on top of `accent`.
        public static let accentContrast = Color(red: 13 / 255, green: 17 / 255, blue: 28 / 255)
        /// Keyboard/web focus ring. Must stay visible in both modes (docs/09 §8).
        public static let focus = Color(red: 226 / 255, green: 232 / 255, blue: 240 / 255)
        /// Arriving / good. Always paired with an icon or label — never colour alone.
        public static let positive = Color(red: 34 / 255, green: 197 / 255, blue: 94 / 255)
        /// A few minutes away / uncertain.
        public static let warning = Color(red: 245 / 255, green: 158 / 255, blue: 11 / 255)
        /// No service / error.
        public static let danger = Color(red: 239 / 255, green: 68 / 255, blue: 68 / 255)
    }

    /// Fixed, theme-independent brand values. Not semantic tokens — they do not invert with the
    /// appearance.
    public enum BrandColor {
        /// The app-icon field colour (apps/mobile/assets/icon.svg), the PWA `theme-color`, and a
        /// fixed dark glass tint (`bg-ink/55`). Promoted to a token so the icon, the splash, the
        /// browser chrome and any brand chrome stay one family.
        public static let ink = Color(red: 17 / 255, green: 24 / 255, blue: 39 / 255)
    }

    /// Operator brand accents — used sparingly (a route-number chip, a thin route line), never as a
    /// background. Unaffected by the appearance so operator identity is constant (docs/09 §7).
    public enum OperatorColor {
        public static let kmb = Color(red: 215 / 255, green: 40 / 255, blue: 47 / 255)
        public static let lwb = Color(red: 232 / 255, green: 163 / 255, blue: 61 / 255)
        public static let ctb = Color(red: 246 / 255, green: 199 / 255, blue: 0 / 255)
        public static let gmb = Color(red: 0 / 255, green: 132 / 255, blue: 92 / 255)
    }

    /// The contrast-safe text colour to sit on each operator accent. The yellow CTB accent always
    /// pairs with dark text, never white (docs/09 §2).
    public enum OperatorTextColor {
        public static let kmb = Color(red: 255 / 255, green: 255 / 255, blue: 255 / 255)
        public static let lwb = Color(red: 255 / 255, green: 255 / 255, blue: 255 / 255)
        public static let ctb = Color(red: 15 / 255, green: 23 / 255, blue: 42 / 255)
        public static let gmb = Color(red: 255 / 255, green: 255 / 255, blue: 255 / 255)
    }

    /// Basemap overlay colours. The map is not themed (the LandsD tiles are inverted by filter
    /// instead — ADR-041/049), so these are fixed values chosen to read over both the light and the
    /// inverted-dark tiles.
    public enum MapColor {
        /// Last-resort pin fill for a stop with no known operator. A lone stop is coloured by its
        /// operator and each pole of a multi-pole place by its own, so this rose is only the
        /// fallback.
        public static let pin = Color(red: 225 / 255, green: 29 / 255, blue: 72 / 255)
        /// The ring that separates a pin from the tiles underneath it.
        public static let pinBorder = Color(red: 255 / 255, green: 255 / 255, blue: 255 / 255)
    }

    /// Corner radii (docs/09 §4). Cards `md`/`lg`; bottom sheets `sheet`; chips and pills `full`.
    public enum Radius {
        public static let sm: CGFloat = 6
        public static let md: CGFloat = 10
        public static let lg: CGFloat = 14
        public static let xl: CGFloat = 20
        public static let full: CGFloat = 9999
        /// The floating tab bar's rounded-pill corner (ADR-027). Off the sm–xl scale on purpose:
        /// the bar is a pill, and its radius tracks its 54px height, not the card scale.
        public static let pill: CGFloat = 24
        /// The bottom sheet's top corners. Slightly softer than `xl` because the sheet spans the
        /// full width, where 20px reads tight.
        public static let sheet: CGFloat = 26
    }

    /// The 4px spacing scale (docs/09 §4). These are the same values Tailwind ships as its default
    /// rem-based scale — declared here so the native platforms, which have no Tailwind, read them
    /// from the same place. The emitted preset publishes them in rem so the web build keeps
    /// honouring the browser's font size. Touch targets stay ≥ 44×44px and adjacent tappables ≥ 8px
    /// apart, which is a rule, not a token.
    public enum Spacing {
        public static let s1: CGFloat = 4
        public static let s2: CGFloat = 8
        public static let s3: CGFloat = 12
        public static let s4: CGFloat = 16
        public static let s5: CGFloat = 20
        public static let s6: CGFloat = 24
        public static let s8: CGFloat = 32
        public static let s10: CGFloat = 40
        public static let s12: CGFloat = 48
    }

    /// Animation durations (docs/09 §5). Micro-interactions stay in the 150–300ms band; all of them
    /// collapse to an instant swap under reduced motion. Emitted in seconds, the unit SwiftUI
    /// animations take.
    public enum Motion {
        public static let fast: Double = 0.12
        public static let base: Double = 0.2
        public static let slow: Double = 0.32
    }

    public enum Opacity {
        /// Applied to an ETA reading that has gone stale. Honesty, not decoration: a dimmed number
        /// says "this is old" without inventing a fresher one (ADR-008).
        public static let etaStale: Double = 0.45
    }

    /// Inter is loaded as discrete weight cuts (apps/mobile/app/_layout.tsx). RN's `fontFamily` is
    /// single-valued, so a weight maps to its exact registered family name rather than to a numeric
    /// weight; CJK glyphs fall back to the OS face.
    public enum FontCut {
        public static let regular = "Inter_400Regular"
        public static let medium = "Inter_500Medium"
        public static let semibold = "Inter_600SemiBold"
        public static let bold = "Inter_700Bold"
    }

    /// The stack appended after every cut on web, so CJK and the no-webfont case land on a sensible
    /// face. Declared once: the generator composes each cut with it, which is why the tail is not
    /// written out four times in the preset. On native `fontFamily` is single-valued and the OS
    /// handles CJK fallback, so only the cut is used (ADR-019 — v1 bundles no CJK webfont).
    public static let fontFallback: [String] = ["Noto Sans HK", "Noto Sans SC", "PingFang HK", "system-ui", "sans-serif"]

    /// The named type scale (docs/09 §3), mobile-first on a 16px base. Components reference a role,
    /// never a raw size, so type stays consistent across every screen; `<Text variant>` is the
    /// canonical consumer.
    public enum TypeScale {
        public struct Style {
            public let size: CGFloat
            public let lineHeight: CGFloat
            /// One of `FontCut`'s names: RN and SwiftUI both want the concrete cut.
            public let cut: String
        }
        /// The hero ETA numeral.
        public static let display = Style(size: 40, lineHeight: 44, cut: "bold")
        /// Screen titles.
        public static let h1 = Style(size: 28, lineHeight: 34, cut: "bold")
        /// Section headers.
        public static let h2 = Style(size: 22, lineHeight: 28, cut: "semibold")
        /// Card titles and route numbers.
        public static let h3 = Style(size: 18, lineHeight: 24, cut: "semibold")
        /// The default, and the minimum size on mobile.
        public static let body = Style(size: 16, lineHeight: 24, cut: "regular")
        /// Secondary labels.
        public static let label = Style(size: 14, lineHeight: 20, cut: "medium")
        /// Timestamps only — never essential information.
        public static let caption = Style(size: 12, lineHeight: 16, cut: "regular")
    }

    /// Elevation recipes (docs/09 §4): `e0` none · `e1` cards · `e2` sticky headers · `e3`
    /// sheet/FAB/floating tab bar. Platform-neutral at source — a shadow geometry plus, where the
    /// platform wants one instead, Android's Material dp. `blur` carries CSS semantics (a 2σ blur
    /// radius), because that is what the DTCG shadow type means; the iOS recipe halves it to get
    /// `shadowRadius`, which is σ. Consumers never read a level directly: `elevationStyle(level,
    /// Platform.OS)` picks the recipe. On dark, prefer `surface-2` + `border` over any of these — a
    /// drop shadow has almost no contrast budget on a near-black field (ADR-035).
    public enum Elevation {
        public struct Shadow {
            public let color: Color
            public let opacity: Double
            /// SwiftUI's shadow radius is σ, so this is the token's CSS blur halved.
            public let radius: CGFloat
            public let x: CGFloat
            public let y: CGFloat
            /// Material step, Android only; nil when the platform draws the geometry.
            public let androidDp: CGFloat?
        }
        /// Flat on the surface. Every platform recipe collapses to an empty style.
        public static let e0 = Shadow(color: Color(red: 0 / 255, green: 0 / 255, blue: 0 / 255), opacity: 0, radius: 0, x: 0, y: 0, androidDp: 0)
        /// A resting card.
        public static let e1 = Shadow(color: Color(red: 15 / 255, green: 23 / 255, blue: 42 / 255), opacity: 0.06, radius: 6, x: 0, y: 2, androidDp: 1)
        /// A sticky header.
        public static let e2 = Shadow(color: Color(red: 15 / 255, green: 23 / 255, blue: 42 / 255), opacity: 0.1, radius: 12, x: 0, y: 4, androidDp: 3)
        /// A sheet, a FAB, or the floating tab bar.
        public static let e3 = Shadow(color: Color(red: 15 / 255, green: 23 / 255, blue: 42 / 255), opacity: 0.16, radius: 20, x: 0, y: 8, androidDp: 6)
        /// A map pin at rest, lifted off the tiles. Declares no `androidDp` on purpose: a pin is a
        /// small overlay on a map, not a Material surface, so Android draws the same shadow
        /// geometry as iOS rather than a dp step.
        public static let pin = Shadow(color: Color(red: 0 / 255, green: 0 / 255, blue: 0 / 255), opacity: 0.35, radius: 2, x: 0, y: 1, androidDp: nil)
        /// The selected map pin — a little more lift so it reads above its neighbours.
        public static let pinActive = Shadow(color: Color(red: 0 / 255, green: 0 / 255, blue: 0 / 255), opacity: 0.45, radius: 3, x: 0, y: 2, androidDp: nil)
    }

    /// The cast shadow under floating glass — deliberately NOT an `elevation` level, because glass
    /// is a separate elevation channel whose primary depth cue is the refracted backdrop (ADR-035,
    /// docs/09 §Glass legibility rule 7). Two stops: a tight contact shadow plus a soft ambient
    /// one. Light mode only; on dark a drop shadow is haze, not depth. Web only — native glass
    /// lifts via its container's `e3`.
    public enum GlassShadow {
        public static let contact = Elevation.Shadow(color: Color(red: 15 / 255, green: 23 / 255, blue: 42 / 255), opacity: 0.1, radius: 1.5, x: 0, y: 1, androidDp: nil)
        public static let ambient = Elevation.Shadow(color: Color(red: 15 / 255, green: 23 / 255, blue: 42 / 255), opacity: 0.13, radius: 11, x: 0, y: 8, androidDp: nil)
    }
}
