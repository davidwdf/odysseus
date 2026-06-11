import { MapPin } from 'lucide-react-native'
import { useState } from 'react'
import { Image, Pressable, StyleSheet, View, type ViewStyle } from 'react-native'
import { openInMaps } from '../lib/openExternal'
import { useTheme } from '../lib/useTheme'
import { Icon } from './Icon'
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
// and parks land back near their real colour; trim brightness/contrast so it isn't harsh. The
// array form of `filter` works on web and native (RN ≥0.76). Applied to the tiles only — the pin
// and attribution sit outside it.
const DARK_TILE_FILTER: NonNullable<ViewStyle['filter']> = [
  { invert: 1 },
  { hueRotate: '180deg' },
  { brightness: 0.9 },
  { contrast: 0.9 },
]

const lngToWorldX = (lng: number, scale: number) => ((lng + 180) / 360) * scale
const latToWorldY = (lat: number, scale: number) => {
  const s = Math.sin((lat * Math.PI) / 180)
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale
}

/**
 * A static OSM mini-map centred on `{ lat, lng }`, with a centre pin, that opens the
 * platform maps app on tap. Full-bleed to its container width (measured on layout);
 * `height` and `zoom` are tunable. `label` names the dropped pin and the tap target.
 */
export function MiniMap({
  lat,
  lng,
  label,
  actionLabel,
  height = 150,
  zoom = DEFAULT_ZOOM,
  className,
}: {
  lat: number
  lng: number
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
  const scale = TILE * 2 ** zoom
  const n = 2 ** zoom
  const cx = lngToWorldX(lng, scale)
  const cy = latToWorldY(lat, scale)
  // Viewport top-left in world pixels, so the point lands dead-centre.
  const left = cx - w / 2
  const top = cy - height / 2

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
      onPress={() => openInMaps(lat, lng, label)}
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      className={`overflow-hidden bg-surface-2 active:opacity-90 ${className ?? ''}`}
      style={{ height }}
    >
      {/* Tiles live in their own layer so the dark `filter` recolours the map only — the pin
          and attribution below stay true-colour. */}
      <View style={[StyleSheet.absoluteFill, isDark ? { filter: DARK_TILE_FILTER } : null]}>
        {tiles.map((t) => (
          <Image
            key={`${t.tx}/${t.ty}`}
            source={{ uri: TILE_URL(zoom, t.tx, t.ty) }}
            style={{ position: 'absolute', left: t.x, top: t.y, width: TILE, height: TILE }}
          />
        ))}
      </View>

      {/* Centre pin — its tip (bottom) sits on the exact coordinate. */}
      {w > 0 ? <CentrePin cx={w / 2} cy={height / 2} /> : null}

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
 * The centre marker: a vivid pin with a **white halo** behind it, so it reads on any tile in
 * both light and dark mode (a single themed pin washed out — accent is near-white in dark).
 * Both glyphs are bottom-anchored, so each pin tip lands on `(cx, cy)` — the exact coordinate.
 */
function CentrePin({ cx, cy }: { cx: number; cy: number }) {
  const HALO = 36
  const PIN = 30
  return (
    <View pointerEvents="none">
      <View style={{ position: 'absolute', left: cx - HALO / 2, top: cy - HALO }}>
        <Icon icon={MapPin} color="#ffffff" fill="#ffffff" size={HALO} strokeWidth={2} />
      </View>
      <View style={{ position: 'absolute', left: cx - PIN / 2, top: cy - PIN }}>
        <Icon icon={MapPin} color="#ffffff" fill={PIN_COLOR} size={PIN} strokeWidth={2} />
      </View>
    </View>
  )
}
