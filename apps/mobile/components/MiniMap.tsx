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
// Vivid pin fill that reads over the map in both modes.
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
 */
export function MiniMap({
  lat,
  lng,
  points,
  label,
  actionLabel,
  height = 150,
  zoom = DEFAULT_ZOOM,
  className,
}: {
  lat: number
  lng: number
  /** Member poles to pin (multi-pole place). Omit/≤1 → a single centre pin at `lat,lng`. */
  points?: Array<{ lat: number; lng: number }>
  /** Stop name — names the maps pin. */
  label?: string
  /** Accessible label for the tap target, e.g. "Open in Maps". */
  actionLabel: string
  height?: number
  zoom?: number
  className?: string
}) {
  const { isDark } = useTheme()
  const [w, setW] = useState(0)
  const pts = points && points.length > 1 ? points : [{ lat, lng }]
  // Centre on the points' centroid (so all pins are framed); zoom to fit them.
  const cLat = pts.reduce((s, p) => s + p.lat, 0) / pts.length
  const cLng = pts.reduce((s, p) => s + p.lng, 0) / pts.length
  const z = pts.length > 1 ? fitZoom(pts, w, height) : zoom
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

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={actionLabel}
      onPress={() => openInMaps(cLat, cLng, label)}
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      className={`overflow-hidden bg-surface-2 active:opacity-90 ${className ?? ''}`}
      style={{ height }}
    >
      {/* Tiles live in their own layer so the dark `filter` recolours the map only — the pins
          and attribution below stay true-colour. */}
      <View style={[StyleSheet.absoluteFill, isDark ? { filter: DARK_TILE_FILTER } : null]}>
        {tiles.map((t) => (
          <Image
            key={`${t.tx}/${t.ty}`}
            source={{ uri: TILE_URL(z, t.tx, t.ty) }}
            style={{ position: 'absolute', left: t.x, top: t.y, width: TILE, height: TILE }}
          />
        ))}
      </View>

      {/* A dot per pole, centred on its exact coordinate; smaller when there are several. */}
      {w > 0
        ? pts.map((p) => (
            <Pin
              key={`${p.lat},${p.lng}`}
              cx={lngToWorldX(p.lng, scale) - left}
              cy={latToWorldY(p.lat, scale) - top}
              size={pts.length > 1 ? 14 : 18}
            />
          ))
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
    </Pressable>
  )
}

/**
 * A clean circular marker centred on `(cx, cy)`: a vivid core inside a white ring with a soft
 * drop shadow, so it reads on any tile in light or dark mode without a fussy glyph. The white
 * ring is what separates it from the map; the shadow lifts it off the tiles.
 */
function Pin({ cx, cy, size = 18 }: { cx: number; cy: number; size?: number }) {
  const ring = Math.max(2, Math.round(size * 0.22))
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: cx - size / 2,
        top: cy - size / 2,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: PIN_COLOR,
        borderWidth: ring,
        borderColor: '#ffffff',
        // box-shadow on web (react-native-web 0.21 takes the string), shadow* on native.
        ...Platform.select({
          web: { boxShadow: '0 1px 4px rgba(0,0,0,0.35)' },
          default: {
            shadowColor: '#000000',
            shadowOpacity: 0.35,
            shadowRadius: 2,
            shadowOffset: { width: 0, height: 1 },
          },
        }),
      }}
    />
  )
}
