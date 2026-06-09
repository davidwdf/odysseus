import { BlurView } from 'expo-blur'
import { cssInterop } from 'nativewind'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import {
  type LayoutChangeEvent,
  Platform,
  type View as RNView,
  StyleSheet,
  View,
  type ViewProps,
} from 'react-native'
import Animated, { type AnimatedProps } from 'react-native-reanimated'
import { getDisplacementFilter, supportsBackdropFilterUrl } from '../lib/liquidGlass'
import { useTheme } from '../lib/useTheme'

// The glass root is an `Animated.View` (so a Reanimated opacity can ride on the same element that
// carries the backdrop-filter — see RouteHeader). Reanimated's Animated.View isn't NativeWind-aware
// by default, which silently drops `className` (border, the caller's layout classes). Register the
// className→style interop so `<GlassView className=…>` works exactly like a plain View again.
cssInterop(Animated.View, { className: 'style' })

type GlassViewProps = AnimatedProps<ViewProps> & {
  /** Corner radius; the glass is clipped to it and the refractive rim follows it. */
  radius?: number
  /**
   * Translucent body laid over the glass so content stays legible. A NativeWind class
   * with an alpha, e.g. `bg-surface/55`. Tinting toward `--surface` keeps the glass on
   * the active theme (light/dark); `bg-ink/…` instead makes a fixed dark glass.
   */
  tintClassName?: string
  /** Draw the hairline edge that gives the pane its "glass" rim. Default true. */
  bordered?: boolean
  /**
   * Lift floating chrome off the content scrolling underneath with a soft cast shadow.
   * **Light-only** by design: on dark a cast shadow reads as haze, not lift (the
   * contrast-budget swap, ADR-035), so the rim + border carry it there. Web-only for now,
   * like the rim-light — native consumers put `ELEVATION` on a non-clipped wrapper (as the
   * floating tab bar does). Default false; opt in for floating panes (the route-header lens/pill).
   */
  elevated?: boolean
  /** Strong magnifier refraction (the "lens" showcase) vs. the subtle panel glass. */
  lens?: boolean
  /** Refraction strength — the `feDisplacementMap` scale (px the rim bends). */
  strength?: number
  /** Width of the refractive rim band, px (`depth` in the reference). */
  depth?: number
  /** Backdrop blur px (frosting over the refraction). */
  blur?: number
  /** Chromatic aberration px — per-channel RGB split for the prismatic edge. */
  chroma?: number
  className?: string
}

const SATURATE = 1.4
const BRIGHTNESS = 1.05

/**
 * Liquid-glass material. On **web** the backdrop is genuinely *refracted* — the
 * technique is ported from **nikdelvin/liquid-glass**: a smooth SVG displacement map
 * (vector gradients + a blurred neutral-centre mask → a soft refractive rim, no
 * pixelation) embedded in a data-URI SVG filter and applied via
 * `backdrop-filter: blur() url('…#displace') brightness() saturate()`. SVG
 * `backdrop-filter` is **Chromium-only**, so Safari/Firefox fall back to a frosted
 * `blur()`; **native** uses `expo-blur`. The filter is re-derived from the element's
 * measured size, so it always fits. Seam for iOS-26 true Liquid Glass.
 */
export function GlassView({
  radius = 0,
  tintClassName = 'bg-surface/55',
  bordered = true,
  elevated = false,
  lens = false,
  strength,
  depth,
  blur,
  chroma,
  className = '',
  style,
  children,
  ...rest
}: GlassViewProps) {
  const { isDark } = useTheme()
  const ref = useRef<RNView>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  const cfgDepth = depth ?? (lens ? 12 : 8)
  const cfgStrength = strength ?? 55
  const cfgChroma = chroma ?? (lens ? 3 : 0)
  const cfgBlur = blur ?? (lens ? 0 : 4)

  useEffect(() => {
    if (Platform.OS !== 'web') return
    const node = ref.current as unknown as HTMLElement | null
    if (!node) return
    // Rim light: a thin, top-weighted inner highlight (glass is lit from above, so the
    // bright edge belongs at the top — not a uniform all-around ring, which reads as a
    // heavy border, especially on dark). A whisper of bottom shadow adds depth. Fainter
    // on dark, where a white edge is high-contrast against the surface.
    // On dark, keep the highlight faint so it reads as muted as the app's other
    // borders (a pure-white edge pops far more than the slate `--border`).
    const top = isDark ? 0.12 : 0.42
    const bottom = isDark ? 0.16 : 0.06
    const rim = `inset 0 1px 0.5px rgba(255,255,255,${top}), inset 0 -1px 1px rgba(0,0,0,${bottom})`
    // Light-only cast shadow (ADR-035): floating glass lifts off the content scrolling under
    // it. A two-stop shadow (tight contact + soft ambient) in the slate-900 ink reads as lift
    // without muddiness. On dark it's omitted — a drop shadow there is haze, not depth, so the
    // rim + border define the pane instead. (overflow:hidden clips children, not the outer shadow.)
    const cast =
      elevated && !isDark ? ', 0 1px 3px rgba(15,23,42,0.10), 0 8px 22px rgba(15,23,42,0.13)' : ''
    node.style.boxShadow = rim + cast
    if (size.w < 4 || size.h < 4) return
    const r = Math.min(radius, size.w / 2, size.h / 2)
    if (supportsBackdropFilterUrl()) {
      const filter = getDisplacementFilter({
        width: Math.round(size.w),
        height: Math.round(size.h),
        radius: Math.round(r),
        depth: cfgDepth,
        strength: cfgStrength,
        chromaticAberration: cfgChroma,
      })
      node.style.backdropFilter = `blur(${cfgBlur / 2}px) url('${filter}') blur(${cfgBlur}px) brightness(${BRIGHTNESS}) saturate(${SATURATE})`
    } else {
      // Safari / Firefox: no SVG backdrop-filter → a frosted glassmorphism fallback.
      const px = cfgBlur + 8
      node.style.backdropFilter = `blur(${px}px) saturate(1.8)`
      // @ts-expect-error vendor-prefixed property
      node.style.WebkitBackdropFilter = `blur(${px}px) saturate(1.8)`
    }
  }, [size.w, size.h, radius, cfgDepth, cfgStrength, cfgChroma, cfgBlur, isDark, elevated])

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout
    setSize((s) => (s.w === width && s.h === height ? s : { w: width, h: height }))
  }

  return (
    <Animated.View
      {...rest}
      ref={ref}
      onLayout={onLayout}
      className={`${bordered ? 'border border-border' : ''} ${className}`}
      style={[{ borderRadius: radius, overflow: 'hidden' }, style]}
    >
      {Platform.OS !== 'web' ? (
        <BlurView
          intensity={lens ? 25 : 50}
          tint={isDark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      {/* Translucent body over the refracted backdrop, BELOW the content. On web an
          absolutely-positioned sibling paints *above* in-flow children (CSS painting order),
          so without this the tint washes the content grey (e.g. a dark glyph reads as muted).
          Pin it behind with a negative z-index; native paints in declaration order, so it's
          already correct there and needs no change. */}
      <View
        className={tintClassName}
        style={[StyleSheet.absoluteFill, Platform.OS === 'web' ? { zIndex: -1 } : null]}
        pointerEvents="none"
      />
      {children as ReactNode}
    </Animated.View>
  )
}
