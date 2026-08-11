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
// Assumes Jetpack Compose for `Color`, `Dp` and `TextUnit`.

package hk.nextbus.tokens

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

object NextBusTokens {
    /** The two modes of the single Ink theme (ADR-029). */
    enum class Mode { LIGHT, DARK }

    /** The semantic colours in the light mode (docs/09 §2). */
    object LightColor {
        /** Page background. */
        val bg: Color = Color(0xFFFFFFFF)
        /** A raised surface — cards, sheets, rows. */
        val surface: Color = Color(0xFFF8FAFC)
        /**
         * The second lift. On dark this carries the elevation cue that a shadow carries on
         * light (ADR-035).
         */
        val surface2: Color = Color(0xFFF1F5F9)
        /** Hairline divider and the silhouette a dark-mode surface uses instead of a shadow. */
        val border: Color = Color(0xFFE2E8F0)
        /** Body text. ≥ 4.5:1 against `bg` in both modes. */
        val text: Color = Color(0xFF111827)
        /**
         * Secondary text. Also the tab bar's inactive tint — `text-subtle` was too
         * low-contrast to read on glass (docs/09 §Glass legibility, rule 2).
         */
        val textMuted: Color = Color(0xFF475569)
        /** Tertiary text — timestamps, captions. Never essential information. */
        val textSubtle: Color = Color(0xFF64748B)
        /**
         * The monochrome accent — ink on light, paper on dark. Not a colour: operator identity
         * and ETA status carry meaning, so the accent must not compete with them.
         */
        val accent: Color = Color(0xFF111827)
        /** What sits on top of `accent`. */
        val accentContrast: Color = Color(0xFFFFFFFF)
        /** Keyboard/web focus ring. Must stay visible in both modes (docs/09 §8). */
        val focus: Color = Color(0xFF111827)
        /** Arriving / good. Always paired with an icon or label — never colour alone. */
        val positive: Color = Color(0xFF16A34A)
        /** A few minutes away / uncertain. */
        val warning: Color = Color(0xFFD97706)
        /** No service / error. */
        val danger: Color = Color(0xFFDC2626)
    }

    /** The semantic colours in the dark mode (docs/09 §2). */
    object DarkColor {
        /** Page background. */
        val bg: Color = Color(0xFF0D111C)
        /** A raised surface — cards, sheets, rows. */
        val surface: Color = Color(0xFF161B29)
        /**
         * The second lift. On dark this carries the elevation cue that a shadow carries on
         * light (ADR-035).
         */
        val surface2: Color = Color(0xFF202636)
        /** Hairline divider and the silhouette a dark-mode surface uses instead of a shadow. */
        val border: Color = Color(0xFF2C3343)
        /** Body text. ≥ 4.5:1 against `bg` in both modes. */
        val text: Color = Color(0xFFF4F6FA)
        /**
         * Secondary text. Also the tab bar's inactive tint — `text-subtle` was too
         * low-contrast to read on glass (docs/09 §Glass legibility, rule 2).
         */
        val textMuted: Color = Color(0xFF9EA5B4)
        /** Tertiary text — timestamps, captions. Never essential information. */
        val textSubtle: Color = Color(0xFF6B7280)
        /**
         * The monochrome accent — ink on light, paper on dark. Not a colour: operator identity
         * and ETA status carry meaning, so the accent must not compete with them.
         */
        val accent: Color = Color(0xFFE2E8F0)
        /** What sits on top of `accent`. */
        val accentContrast: Color = Color(0xFF0D111C)
        /** Keyboard/web focus ring. Must stay visible in both modes (docs/09 §8). */
        val focus: Color = Color(0xFFE2E8F0)
        /** Arriving / good. Always paired with an icon or label — never colour alone. */
        val positive: Color = Color(0xFF22C55E)
        /** A few minutes away / uncertain. */
        val warning: Color = Color(0xFFF59E0B)
        /** No service / error. */
        val danger: Color = Color(0xFFEF4444)
    }

    /**
     * Fixed, theme-independent brand values. Not semantic tokens — they do not invert with the
     * appearance.
     */
    object BrandColor {
        /**
         * The app-icon field colour (apps/mobile/assets/icon.svg), the PWA `theme-color`, and
         * a fixed dark glass tint (`bg-ink/55`). Promoted to a token so the icon, the splash,
         * the browser chrome and any brand chrome stay one family.
         */
        val ink: Color = Color(0xFF111827)
    }

    /**
     * Operator brand accents — used sparingly (a route-number chip, a thin route line), never
     * as a background. Unaffected by the appearance so operator identity is constant (docs/09
     * §7).
     */
    object OperatorColor {
        val kmb: Color = Color(0xFFD7282F)
        val lwb: Color = Color(0xFFE8A33D)
        val ctb: Color = Color(0xFFF6C700)
        val gmb: Color = Color(0xFF00845C)
    }

    /**
     * The contrast-safe text colour to sit on each operator accent. The yellow CTB accent
     * always pairs with dark text, never white (docs/09 §2).
     */
    object OperatorTextColor {
        val kmb: Color = Color(0xFFFFFFFF)
        val lwb: Color = Color(0xFFFFFFFF)
        val ctb: Color = Color(0xFF0F172A)
        val gmb: Color = Color(0xFFFFFFFF)
    }

    /**
     * Basemap overlay colours. The map is not themed (the LandsD tiles are inverted by filter
     * instead — ADR-041/049), so these are fixed values chosen to read over both the light and
     * the inverted-dark tiles.
     */
    object MapColor {
        /**
         * Last-resort pin fill for a stop with no known operator. A lone stop is coloured by
         * its operator and each pole of a multi-pole place by its own, so this rose is only
         * the fallback.
         */
        val pin: Color = Color(0xFFE11D48)
        /** The ring that separates a pin from the tiles underneath it. */
        val pinBorder: Color = Color(0xFFFFFFFF)
    }

    /**
     * Corner radii (docs/09 §4). Cards `md`/`lg`; bottom sheets `sheet`; chips and pills
     * `full`.
     */
    object Radius {
        val sm: Dp = 6.dp
        val md: Dp = 10.dp
        val lg: Dp = 14.dp
        val xl: Dp = 20.dp
        val full: Dp = 9999.dp
        /**
         * The floating tab bar's rounded-pill corner (ADR-027). Off the sm–xl scale on
         * purpose: the bar is a pill, and its radius tracks its 54px height, not the card
         * scale.
         */
        val pill: Dp = 24.dp
        /**
         * The bottom sheet's top corners. Slightly softer than `xl` because the sheet spans
         * the full width, where 20px reads tight.
         */
        val sheet: Dp = 26.dp
    }

    /**
     * The 4px spacing scale (docs/09 §4). These are the same values Tailwind ships as its
     * default rem-based scale — declared here so the native platforms, which have no Tailwind,
     * read them from the same place. The emitted preset publishes them in rem so the web build
     * keeps honouring the browser's font size. Touch targets stay ≥ 44×44px and adjacent
     * tappables ≥ 8px apart, which is a rule, not a token.
     */
    object Spacing {
        val s1: Dp = 4.dp
        val s2: Dp = 8.dp
        val s3: Dp = 12.dp
        val s4: Dp = 16.dp
        val s5: Dp = 20.dp
        val s6: Dp = 24.dp
        val s8: Dp = 32.dp
        val s10: Dp = 40.dp
        val s12: Dp = 48.dp
    }

    /**
     * Animation durations (docs/09 §5). Micro-interactions stay in the 150–300ms band; all of
     * them collapse to an instant swap under reduced motion. Emitted in milliseconds, the unit
     * Compose `tween` takes.
     */
    object Motion {
        const val fast: Int = 120
        const val base: Int = 200
        const val slow: Int = 320
    }

    object Opacity {
        /**
         * RETIRED — do not apply this to anything. It was the staleness cue: an ETA reading
         * whose board had aged was faded to 45%. The cue is now a muted `~` before the figure,
         * declared in the component specs (`stop-row`, `place-row`, `route-detail`) and drawn
         * by both renderers, and NO renderer applies this token any more. It is kept rather
         * than deleted because this file's readers include a hand-written iOS/Android client
         * (ADR-067/075) that will meet the same design problem, and the answer to it is not
         * obvious: a fade is *noticed* rather than read — a rider with one reading on screen
         * has nothing to compare it against — and it dims the one number they are trying to
         * read. Deleting the token would leave that decision nowhere a porter looks, and the
         * next 0.45 would be re-invented. Retiring it in place puts the warning in the file
         * they are reading, because this description is emitted verbatim into
         * `NextBusTokens.swift` and `.kt`. If you are implementing a third renderer: draw the
         * mark, not the fade. `check-tokens-current` counts tokens; it cannot see that one has
         * no consumer, so this sentence is the mechanism.
         */
        const val etaStale: Float = 0.45f
    }

    /**
     * Inter is loaded as discrete weight cuts (apps/mobile/app/_layout.tsx). RN's `fontFamily`
     * is single-valued, so a weight maps to its exact registered family name rather than to a
     * numeric weight; CJK glyphs fall back to the OS face.
     */
    object FontCut {
        const val regular: String = "Inter_400Regular"
        const val medium: String = "Inter_500Medium"
        const val semibold: String = "Inter_600SemiBold"
        const val bold: String = "Inter_700Bold"
    }

    /**
     * The stack appended after every cut on web, so CJK and the no-webfont case land on a
     * sensible face. Declared once: the generator composes each cut with it, which is why the
     * tail is not written out four times in the preset. On native `fontFamily` is
     * single-valued and the OS handles CJK fallback, so only the cut is used (ADR-019 — v1
     * bundles no CJK webfont).
     */
    val fontFallback: List<String> = listOf("Noto Sans HK", "Noto Sans SC", "PingFang HK", "system-ui", "sans-serif")

    /**
     * The named type scale (docs/09 §3), mobile-first on a 16px base. Components reference a
     * role, never a raw size, so type stays consistent across every screen; `<Text variant>`
     * is the canonical consumer.
     */
    object TypeScale {
        data class Style(val size: TextUnit, val lineHeight: TextUnit, val cut: String)
        /** The hero ETA numeral. */
        val display = Style(40.sp, 44.sp, "bold")
        /** Screen titles. */
        val h1 = Style(28.sp, 34.sp, "bold")
        /** Section headers. */
        val h2 = Style(22.sp, 28.sp, "semibold")
        /** Card titles and route numbers. */
        val h3 = Style(18.sp, 24.sp, "semibold")
        /** The default, and the minimum size on mobile. */
        val body = Style(16.sp, 24.sp, "regular")
        /** Secondary labels. */
        val label = Style(14.sp, 20.sp, "medium")
        /** Timestamps only — never essential information. */
        val caption = Style(12.sp, 16.sp, "regular")
    }

    /**
     * Elevation recipes (docs/09 §4): `e0` none · `e1` cards · `e2` sticky headers · `e3`
     * sheet/FAB/floating tab bar. Platform-neutral at source — a shadow geometry plus, where
     * the platform wants one instead, Android's Material dp. `blur` carries CSS semantics (a
     * 2σ blur radius), because that is what the DTCG shadow type means; the iOS recipe halves
     * it to get `shadowRadius`, which is σ. Consumers never read a level directly:
     * `elevationStyle(level, Platform.OS)` picks the recipe. On dark, prefer `surface-2` +
     * `border` over any of these — a drop shadow has almost no contrast budget on a near-black
     * field (ADR-035).
     */
    object Elevation {
        data class Shadow(
            val color: Color,
            val opacity: Float,
            /** The CSS blur radius. Compose draws from `dp`; this is for a painter. */
            val blur: Dp,
            val offsetX: Dp,
            val offsetY: Dp,
            /** Material step; null when the platform draws the geometry instead. */
            val dp: Dp?,
        )
        /** Flat on the surface. Every platform recipe collapses to an empty style. */
        val e0 = Shadow(Color(0xFF000000), 0f, 0.dp, 0.dp, 0.dp, 0.dp)
        /** A resting card. */
        val e1 = Shadow(Color(0xFF0F172A), 0.06f, 12.dp, 0.dp, 2.dp, 1.dp)
        /** A sticky header. */
        val e2 = Shadow(Color(0xFF0F172A), 0.1f, 24.dp, 0.dp, 4.dp, 3.dp)
        /** A sheet, a FAB, or the floating tab bar. */
        val e3 = Shadow(Color(0xFF0F172A), 0.16f, 40.dp, 0.dp, 8.dp, 6.dp)
        /**
         * A map pin at rest, lifted off the tiles. Declares no `androidDp` on purpose: a pin
         * is a small overlay on a map, not a Material surface, so Android draws the same
         * shadow geometry as iOS rather than a dp step.
         */
        val pin = Shadow(Color(0xFF000000), 0.35f, 4.dp, 0.dp, 1.dp, null)
        /** The selected map pin — a little more lift so it reads above its neighbours. */
        val pinActive = Shadow(Color(0xFF000000), 0.45f, 6.dp, 0.dp, 2.dp, null)
    }

    /**
     * The cast shadow under floating glass — deliberately NOT an `elevation` level, because
     * glass is a separate elevation channel whose primary depth cue is the refracted backdrop
     * (ADR-035, docs/09 §Glass legibility rule 7). Two stops: a tight contact shadow plus a
     * soft ambient one. Light mode only; on dark a drop shadow is haze, not depth. Web only —
     * native glass lifts via its container's `e3`.
     */
    object GlassShadow {
        val contact = Elevation.Shadow(Color(0xFF0F172A), 0.1f, 3.dp, 0.dp, 1.dp, null)
        val ambient = Elevation.Shadow(Color(0xFF0F172A), 0.13f, 22.dp, 0.dp, 8.dp, null)
    }
}
