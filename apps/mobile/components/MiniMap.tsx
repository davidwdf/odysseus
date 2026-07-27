import type { OperatorId } from '@nextbus/core'
import { OPERATOR_ACCENT } from '@nextbus/ui'
import { useState } from 'react'
import { Image, Platform, Pressable, StyleSheet, View, type ViewStyle } from 'react-native'
import { openExternal, openInMaps } from '../lib/openExternal'
import { tileSource } from '../lib/tileSource'
import { useTheme } from '../lib/useTheme'
import { useLocale } from '../providers/LocaleProvider'
import { Text } from './Text'

// A small, **static** map of one point — no map library, no API key, works on web + native.
// We compute the Web-Mercator tile coordinates for the centre ourselves and lay the raster
// tiles down as plain <Image>s in a clipped viewport, with a pin at the centre. Tapping it
// hands off to the platform maps app (openInMaps).
//
// Tiles come from the **Hong Kong Lands Department**, proxied and cached by our own Worker
// (ADR-049, WP0-2) — keyless, free for commercial use, cacheable by licence, and the surveyor's
// own geometry. The component never names a tile host: everything goes through the `TileSource`
// seam in lib/tileSource.ts, so the basemap can be repointed without an app release.
//
// Two raster layers stack here, which is the part that differs from the old OSM setup: a
// language-free **basemap** plus a **label overlay chosen by `useLocale()`**. That is how the
// map relabels itself in en / zh-Hant / zh-Hans with no restyling — the base tiles carry no
// CJK at all.
//
// LandsD's raster service has no dark variant, so **dark mode is still derived with a CSS-style
// `filter`** (invert + hue-rotate, see DARK_TILE_FILTER) applied to both raster layers — which
// also flips the black label text to white. `TileSource.invertForDark` records that this is a
// property of the source, not of the component; a vector basemap would turn it off (ADR-041).
const TILE = 256
const DEFAULT_ZOOM = 16
// Vivid pin fill fallback (a stop with no known operator) that reads over the map in both modes.
// A lone stop is brand-coloured by its `operator`, and a multi-pole place colours each dot by its
// own operator (OPERATOR_ACCENT) — e.g. GMB green; this rose is only the last-resort default.
const PIN_COLOR = '#E11D48'
// Turn the light tiles into a dark map: invert the luminance, then hue-rotate 180° so water
// and parks land back near their real colour; trim brightness/contrast so it isn't harsh. Applied
// to the tiles only — the pin and attribution sit outside it.
//
// The shape differs by platform: react-native-web (0.21) has no `filter` handler, so it passes a
// **string** value straight to the DOM (the array form becomes an unusable object and is dropped);
// native RN wants the **array** form. Hence the Platform split.
const DARK_TILE_FILTER = Platform.select<NonNullable<ViewStyle['filter']>>({
  web: 'invert(1) hue-rotate(180deg) brightness(0.9) contrast(0.9)',
  default: [{ invert: 1 }, { hueRotate: '180deg' }, { brightness: 0.9 }, { contrast: 0.9 }],
})

/** A pinnable point on the map. `id` keys the dot for highlighting/tapping; `operator` picks its
 *  brand colour; `label` is the short stop code shown beside it (multi-pole places, ADR-042). */
export type MapPoint = {
  id: string
  lat: number
  lng: number
  operator?: OperatorId
  label?: string
}

const lngToWorldX = (lng: number, scale: number) => ((lng + 180) / 360) * scale
const latToWorldY = (lat: number, scale: number) => {
  const s = Math.sin((lat * Math.PI) / 180)
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale
}

/** Ground metres per screen pixel at a zoom and latitude (Web Mercator, 256 px tiles). */
const metresPerPixel = (lat: number, z: number) =>
  (156_543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z

/**
 * Highest zoom whose viewport still shows at least `metres` of ground across.
 *
 * This is how a **lone** stop gets framed. It used to take a flat `DEFAULT_ZOOM = 16` while a
 * multi-pole place went through `fitZoom` and landed at 18–19 — eight times the ground per axis,
 * so a single-pole stop (every GMB stand, most Citybus stops) rendered visibly more zoomed-out
 * than its multi-pole neighbour for no reason a rider could see. Framing by metres rather than by
 * a zoom constant also makes the two agree on a tablet, where a fixed zoom covers far more ground
 * than it does on a phone.
 */
function zoomForSpan(metres: number, w: number, lat: number): number {
  for (let z = Math.min(19, tileSource.maxZoom); z > tileSource.minZoom; z--) {
    if (w * metresPerPixel(lat, z) >= metres) return z
  }
  return tileSource.minZoom
}

/**
 * **Minimum** ground a single-pin map must show across. 100 m is just under what z19 covers on a
 * ~390 px phone (108 m), so a lone stop lands on the same z19 a real place's poles do — the two
 * read at exactly one scale — and steps down only on a genuinely narrow viewport. Close enough to
 * see which side of the road the pin is on, which is why we took LandsD's dense cartography
 * (ADR-049).
 */
const SINGLE_PIN_MIN_SPAN_M = 100

/** Highest zoom at which all points fit within ~70% of the viewport (so pins aren't clipped).
 *  The poles of a place sit ≤30 m apart, so this lands ~18–19, inside LandsD's z10–20 range. */
function fitZoom(pts: Array<{ lat: number; lng: number }>, w: number, h: number): number {
  if (w <= 0) return DEFAULT_ZOOM
  const lat = pts[0]?.lat ?? 22.3
  if (pts.length < 2) return zoomForSpan(SINGLE_PIN_MIN_SPAN_M, w, lat)
  const minLat = Math.min(...pts.map((p) => p.lat))
  const maxLat = Math.max(...pts.map((p) => p.lat))
  const minLng = Math.min(...pts.map((p) => p.lng))
  const maxLng = Math.max(...pts.map((p) => p.lng))
  for (let z = Math.min(19, tileSource.maxZoom); z > 11; z--) {
    const scale = TILE * 2 ** z
    const spanX = Math.abs(lngToWorldX(maxLng, scale) - lngToWorldX(minLng, scale))
    const spanY = Math.abs(latToWorldY(maxLat, scale) - latToWorldY(minLat, scale))
    if (spanX <= w * 0.7 && spanY <= h * 0.7) return z
  }
  return 12
}

/**
 * A static LandsD mini-map that opens the platform maps app on tap. Centres on `{ lat, lng }`
 * with a single pin; or pass `points` (a place's member poles, ADR-042) to drop a pin per
 * pole, auto-zoomed to fit them all. Full-bleed to its container width (measured on layout).
 *
 * For a multi-pole place each dot is brand-coloured by operator and labelled with its stop code.
 * `activeId` highlights one dot (the pole the list is scrolled to); `onPointPress(id)` fires when
 * a dot is tapped (the caller scrolls its group into view) — see stop/[id].tsx.
 */
export function MiniMap({
  lat,
  lng,
  points,
  operator,
  label,
  actionLabel,
  height = 150,
  zoom,
  activeId,
  onPointPress,
  deferAttribution,
  className,
}: {
  lat: number
  lng: number
  /** Member poles to pin (multi-pole place). Omit/≤1 → a single centre pin at `lat,lng`. */
  points?: MapPoint[]
  /** Operator of the lone stop — brand-colours the single centre pin (e.g. GMB green). Ignored
   *  when `points` drives a multi-pole place (each dot is coloured by its own operator). */
  operator?: OperatorId
  /** Stop name — names the maps pin. */
  label?: string
  /** Accessible label for the tap target, e.g. "Open in Maps". */
  actionLabel: string
  height?: number
  /** Override the automatic framing. Omit it — `fitZoom` frames one pin and many consistently. */
  zoom?: number
  /** Id of the pole to highlight (dims the rest). Only meaningful with `points`. */
  activeId?: string | null
  /** Tapping a pole's dot fires this with its id (the caller scrolls to its group). */
  onPointPress?: (id: string) => void
  /** The parent renders `<MapAttribution />` itself. **Not** a licence opt-out: LandsD require the
   *  credit on the map face (ADR-049). Set it only when the parent crops or transforms the map and
   *  must anchor the credit to the visible window instead — as `StickyMap` in stop/[id].tsx does. */
  deferAttribution?: boolean
  className?: string
}) {
  const { isDark } = useTheme()
  const locale = useLocale()
  const [w, setW] = useState(0)
  const multi = !!points && points.length > 1
  const pts: MapPoint[] = multi
    ? (points as MapPoint[])
    : [{ id: '__single__', lat, lng, operator }]
  // Centre on the points' centroid (so all pins are framed); zoom to fit them.
  const cLat = pts.reduce((s, p) => s + p.lat, 0) / pts.length
  const cLng = pts.reduce((s, p) => s + p.lng, 0) / pts.length
  // One framing rule for one pin and for many (see `fitZoom`), clamped into the source's
  // supported range — outside it LandsD 404s and we'd render a hole.
  const z = Math.min(
    tileSource.maxZoom,
    Math.max(tileSource.minZoom, zoom ?? fitZoom(pts, w, height)),
  )
  const scale = TILE * 2 ** z
  const n = 2 ** z
  // Viewport top-left in world pixels, so the centroid lands dead-centre.
  const left = lngToWorldX(cLng, scale) - w / 2
  const top = latToWorldY(cLat, scale) - height / 2

  const tiles: Array<{ tx: number; ty: number; x: number; y: number }> = []
  if (w > 0) {
    for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + w) / TILE); tx++) {
      for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + height) / TILE); ty++) {
        if (tx < 0 || ty < 0 || tx >= n || ty >= n) continue
        tiles.push({ tx, ty, x: tx * TILE - left, y: ty * TILE - top })
      }
    }
  }

  // Dim the non-active dots only once a dot is actually highlighted (scrolled-to pole).
  const hasActive = multi && !!activeId
  // Screen position per pole (needed both to draw dots and to decide label placement).
  const placed = pts.map((p) => ({
    p,
    cx: lngToWorldX(p.lng, scale) - left,
    cy: latToWorldY(p.lat, scale) - top,
  }))

  return (
    <View
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      className={`overflow-hidden bg-surface-2 ${className ?? ''}`}
      style={{ height }}
    >
      {/* Tiles live in their own layer so the dark `filter` recolours the map only — the pins
          and attribution above stay true-colour. Two stacked rasters: the language-free
          basemap, then the label overlay for the active locale (ADR-049). */}
      <View
        style={[
          StyleSheet.absoluteFill,
          isDark && tileSource.invertForDark ? { filter: DARK_TILE_FILTER } : null,
        ]}
      >
        {tiles.map((t) => (
          <Image
            key={`base-${t.tx}/${t.ty}`}
            source={{ uri: tileSource.basemap(z, t.tx, t.ty) }}
            style={{ position: 'absolute', left: t.x, top: t.y, width: TILE, height: TILE }}
          />
        ))}
        {tileSource.label
          ? tiles.map((t) => (
              <Image
                key={`label-${t.tx}/${t.ty}`}
                source={{ uri: tileSource.label?.(z, t.tx, t.ty, locale) }}
                style={{ position: 'absolute', left: t.x, top: t.y, width: TILE, height: TILE }}
              />
            ))
          : null}
      </View>

      {/* Background tap target — hands the whole map off to the platform maps app. Sits above the
          tiles (transparent, so the map still shows) but below the pins, which catch their own
          taps. Kept a sibling of the pins (never a wrapper) so the two don't nest. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={actionLabel}
        onPress={() => openInMaps(cLat, cLng, label)}
        style={StyleSheet.absoluteFill}
      />

      {/* A dot per pole, centred on its exact coordinate; smaller when there are several, brand-
          coloured + labelled + tappable for a multi-pole place. Labels normally sit below the dot,
          but flip **above** when another pole sits directly below within a chip's height — the
          common along-the-kerb stack — so the label doesn't cover the next dot. */}
      {w > 0
        ? placed.map(({ p, cx, cy }) => {
            const isActive = multi && p.id === activeId
            const labelAbove = placed.some(
              (o) => o.p.id !== p.id && o.cy > cy && o.cy - cy < 26 && Math.abs(o.cx - cx) < 44,
            )
            return (
              <Pin
                key={p.id}
                cx={cx}
                cy={cy}
                size={multi ? 14 : 18}
                color={(p.operator && OPERATOR_ACCENT[p.operator]) || PIN_COLOR}
                active={isActive}
                dim={hasActive && !isActive}
                label={multi ? p.label : undefined}
                labelAbove={labelAbove}
                onPress={multi && onPointPress ? () => onPointPress(p.id) : undefined}
                pressLabel={p.label}
              />
            )
          })
        : null}

      {deferAttribution ? null : <MapAttribution />}
    </View>
  )
}

/**
 * The mandatory LandsD credit: the department logo plus the copyright notice, linked to their
 * disclaimer. Their terms make **both** parts required and **on the map face**, so this is a
 * licence obligation, not decoration — see ADR-049. Their own sample renders the logo at 28×28
 * bottom-right; no size or placement rules are published. The notice is a real link (not plain
 * text) — the mistake the old OSM attribution made.
 *
 * It's a separate component because it must anchor to whatever the viewer actually *sees*. When
 * the map is cropped rather than resized — as `StickyMap` in stop/[id].tsx does to shrink the hero
 * into a PIP — an attribution pinned to the map canvas slides out of the visible window with the
 * rest of the right-hand crop. The clipping container renders this itself instead, and passes
 * `deferAttribution` to `MiniMap`. Position it with `className`; the default is bottom-right.
 */
export function MapAttribution({ className }: { className?: string }) {
  const locale = useLocale()
  return (
    <View
      className={`absolute bottom-0 right-0 flex-row items-center gap-1 rounded-tl-md bg-bg/85 py-1 pl-1.5 pr-2 ${className ?? ''}`}
    >
      {tileSource.attribution.logo ? (
        <Image
          source={tileSource.attribution.logo}
          accessibilityLabel="Lands Department"
          style={{ width: 16, height: 16 }}
          resizeMode="contain"
        />
      ) : null}
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={tileSource.attribution.a11yLabel[locale]}
        onPress={() => openExternal(tileSource.attribution.href)}
        hitSlop={8}
      >
        <Text variant="caption" className="text-[9px] leading-3 text-subtle">
          {tileSource.attribution.notice[locale]}
        </Text>
      </Pressable>
    </View>
  )
}

/**
 * A clean circular marker centred on `(cx, cy)`: a vivid core inside a white ring with a soft
 * drop shadow, so it reads on any tile in light or dark mode without a fussy glyph. The white
 * ring is what separates it from the map; the shadow lifts it off the tiles. `active` swells it
 * and lifts it above its siblings; `dim` fades it when another dot is the active one. An optional
 * `label` (the short stop code) sits in a legibility chip just below the dot.
 */
function Pin({
  cx,
  cy,
  size = 18,
  color = PIN_COLOR,
  active = false,
  dim = false,
  label,
  labelAbove = false,
  onPress,
  pressLabel,
}: {
  cx: number
  cy: number
  size?: number
  color?: string
  active?: boolean
  dim?: boolean
  label?: string
  labelAbove?: boolean
  onPress?: () => void
  pressLabel?: string
}) {
  const d = active ? size + 6 : size
  const ring = Math.max(2, Math.round(d * 0.22))
  // The visible dot stays small; the touch target is a comfortable fixed box (RN-web ignores
  // hitSlop, so the box itself must be big enough to hit without catching the map behind it).
  const tap = Math.max(d, 32)
  const shadow = Platform.select({
    web: { boxShadow: active ? '0 2px 6px rgba(0,0,0,0.45)' : '0 1px 4px rgba(0,0,0,0.35)' },
    default: {
      shadowColor: '#000000',
      shadowOpacity: active ? 0.45 : 0.35,
      shadowRadius: active ? 3 : 2,
      shadowOffset: { width: 0, height: 1 },
    },
  })
  return (
    <>
      {/* Tap target — a sibling under the (pointer-events-none) dot, so taps land here without
          nesting a pressable inside the background one. Only present when the dot is interactive. */}
      {onPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={pressLabel}
          onPress={onPress}
          hitSlop={8}
          style={{
            position: 'absolute',
            left: cx - tap / 2,
            top: cy - tap / 2,
            width: tap,
            height: tap,
            zIndex: active ? 3 : 2,
          }}
        />
      ) : null}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: cx - d / 2,
          top: cy - d / 2,
          width: d,
          height: d,
          borderRadius: d / 2,
          backgroundColor: color,
          borderWidth: ring,
          borderColor: '#ffffff',
          opacity: dim ? 0.5 : 1,
          zIndex: active ? 3 : 2,
          ...shadow,
        }}
      />
      {label ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: cx - 30,
            // Below the dot by default; flipped above when a pole sits directly beneath.
            top: labelAbove ? cy - d / 2 - 16 : cy + d / 2 + 2,
            width: 60,
            alignItems: 'center',
            opacity: dim ? 0.5 : 1,
            zIndex: active ? 3 : 2,
          }}
        >
          <View className="rounded bg-bg/85 px-1">
            <Text variant="caption" className="text-[9px] text-text" numberOfLines={1}>
              {label}
            </Text>
          </View>
        </View>
      ) : null}
    </>
  )
}
