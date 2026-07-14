import type { OperatorId } from '@nextbus/core'
import { OPERATOR_ACCENT } from '@nextbus/ui'
import { useState } from 'react'
import { Image, Platform, Pressable, StyleSheet, View, type ViewStyle } from 'react-native'
import { openInMaps } from '../lib/openExternal'
import { useTheme } from '../lib/useTheme'
import { Text } from './Text'

// A small, **static** map of one point — no map library, no API key, works on web + native.
// We compute the Web-Mercator tile coordinates for the centre ourselves and lay the raster
// tiles down as plain <Image>s in a clipped viewport, with a pin at the centre. Tapping it
// hands off to the platform maps app (openInMaps).
//
// Tiles are the standard **OpenStreetMap** raster set — keyless. We only ever fetch the light
// tiles; **dark mode is derived from the same images with a CSS-style `filter`** (invert +
// hue-rotate, see DARK_TILE_FILTER) rather than a second tile source — so the map keeps the OSM
// look in both modes (ADR-041). Suits the PWA/dev build; OSM's tile policy discourages heavy
// embedding, so a production/native build should repoint `TILE_URL` at our own tiles (the
// own-crawl → R2 roadmap step) or a proper provider — this is the seam.
const TILE = 256
const DEFAULT_ZOOM = 16
// Vivid pin fill fallback (a stop with no known operator) that reads over the map in both modes.
// A lone stop is brand-coloured by its `operator`, and a multi-pole place colours each dot by its
// own operator (OPERATOR_ACCENT) — e.g. GMB green; this rose is only the last-resort default.
const PIN_COLOR = '#E11D48'
const TILE_URL = (z: number, x: number, y: number) =>
  `https://tile.openstreetmap.org/${z}/${x}/${y}.png`
// Turn the light OSM tiles into a dark map: invert the luminance, then hue-rotate 180° so water
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

/** Highest zoom at which all points fit within ~70% of the viewport (so pins aren't clipped).
 *  Single point → DEFAULT_ZOOM. The poles of a place sit ≤30 m apart, so this lands ~18–19. */
function fitZoom(pts: Array<{ lat: number; lng: number }>, w: number, h: number): number {
  if (pts.length < 2 || w <= 0) return DEFAULT_ZOOM
  const minLat = Math.min(...pts.map((p) => p.lat))
  const maxLat = Math.max(...pts.map((p) => p.lat))
  const minLng = Math.min(...pts.map((p) => p.lng))
  const maxLng = Math.max(...pts.map((p) => p.lng))
  for (let z = 19; z > 11; z--) {
    const scale = TILE * 2 ** z
    const spanX = Math.abs(lngToWorldX(maxLng, scale) - lngToWorldX(minLng, scale))
    const spanY = Math.abs(latToWorldY(maxLat, scale) - latToWorldY(minLat, scale))
    if (spanX <= w * 0.7 && spanY <= h * 0.7) return z
  }
  return 12
}

/**
 * A static OSM mini-map that opens the platform maps app on tap. Centres on `{ lat, lng }`
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
  zoom = DEFAULT_ZOOM,
  activeId,
  onPointPress,
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
  zoom?: number
  /** Id of the pole to highlight (dims the rest). Only meaningful with `points`. */
  activeId?: string | null
  /** Tapping a pole's dot fires this with its id (the caller scrolls to its group). */
  onPointPress?: (id: string) => void
  className?: string
}) {
  const { isDark } = useTheme()
  const [w, setW] = useState(0)
  const multi = !!points && points.length > 1
  const pts: MapPoint[] = multi
    ? (points as MapPoint[])
    : [{ id: '__single__', lat, lng, operator }]
  // Centre on the points' centroid (so all pins are framed); zoom to fit them.
  const cLat = pts.reduce((s, p) => s + p.lat, 0) / pts.length
  const cLng = pts.reduce((s, p) => s + p.lng, 0) / pts.length
  const z = multi ? fitZoom(pts, w, height) : zoom
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
          and attribution above stay true-colour. */}
      <View style={[StyleSheet.absoluteFill, isDark ? { filter: DARK_TILE_FILTER } : null]}>
        {tiles.map((t) => (
          <Image
            key={`${t.tx}/${t.ty}`}
            source={{ uri: TILE_URL(z, t.tx, t.ty) }}
            style={{ position: 'absolute', left: t.x, top: t.y, width: TILE, height: TILE }}
          />
        ))}
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

      {/* Attribution — required by the OSM tile licence. */}
      <View
        pointerEvents="none"
        className="absolute bottom-0 right-0 rounded-tl bg-bg/70 px-1 py-0.5"
      >
        <Text variant="caption" className="text-[9px] text-subtle">
          © OpenStreetMap
        </Text>
      </View>
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
