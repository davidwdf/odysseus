import { MapPin } from 'lucide-react-native'
import { useState } from 'react'
import { Image, Pressable, View } from 'react-native'
import { openInMaps } from '../lib/openExternal'
import { useTheme } from '../lib/useTheme'
import { Icon } from './Icon'
import { Text } from './Text'

// A small, **static** map of one point — no map library, no API key, works on web + native.
// We compute the Web-Mercator tile coordinates for the centre ourselves and lay the raster
// tiles down as plain <Image>s in a clipped viewport, with a pin at the centre. Tapping it
// hands off to the platform maps app (openInMaps).
//
// Tiles come from CARTO's free **light/dark** basemaps (OSM data) — keyless, and they give us a
// real dark-mode map that re-skins with the theme (ADR-041). CARTO's free tier suits the PWA/dev
// build but discourages heavy embedding, so a production/native build should repoint `tileUrl`
// at our own tiles (the own-crawl → R2 roadmap step) or a proper provider — this is the seam.
const TILE = 256
const DEFAULT_ZOOM = 16
const tileUrl = (dark: boolean) => (z: number, x: number, y: number) =>
  `https://basemaps.cartocdn.com/${dark ? 'dark_all' : 'light_all'}/${z}/${x}/${y}.png`

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
  const url = tileUrl(isDark)
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
      {tiles.map((t) => (
        <Image
          key={`${t.tx}/${t.ty}`}
          source={{ uri: url(zoom, t.tx, t.ty) }}
          style={{ position: 'absolute', left: t.x, top: t.y, width: TILE, height: TILE }}
        />
      ))}

      {/* Centre pin — its tip (bottom) sits on the exact coordinate. */}
      {w > 0 ? (
        <View style={{ position: 'absolute', left: w / 2 - 14, top: height / 2 - 28 }}>
          <Icon icon={MapPin} tone="accent" size={28} fill="white" />
        </View>
      ) : null}

      {/* Attribution — required by the OSM data + CARTO tile licences. */}
      <View
        pointerEvents="none"
        className="absolute bottom-0 right-0 rounded-tl bg-bg/70 px-1 py-0.5"
      >
        <Text variant="caption" className="text-[9px] text-subtle">
          © OpenStreetMap, © CARTO
        </Text>
      </View>
    </Pressable>
  )
}
