import {
  clampZoom,
  fitZoom,
  latToWorldY,
  lngToWorldX,
  type MapPin,
  TILE_SIZE,
  worldScale,
} from '@nextbus/core'
import { type LocalizedString, t } from '@nextbus/i18n'
import { elevationStyle, MAP_COLOR, OPERATOR_ACCENT } from '@nextbus/ui'
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
// The projection and the **framing rule** are not here — they are `@nextbus/core/mercator`
// (WP2-4), because deciding what ground a rider sees is the same decision on every platform,
// while laying tiles out as `<Image>`s is this renderer's problem alone. What is left below is
// layout: which tiles cover the viewport, where each dot goes, when a label chip flips above it.
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

/**
 * A static LandsD mini-map that opens the platform maps app on tap. It is handed the pins to draw
 * — `PlaceDetailView.pins`, already folded, labelled and coloured by the kernel — and frames them
 * all. Full-bleed to its container width (measured on layout).
 *
 * **It decides nothing about which dots exist or what they are called** (WP6-3b). It used to: it
 * took a `MapPoint[]` the screen had built from the member poles and called
 * `mergeCoincidentPins` itself, so a second renderer's map would have had to arrive at the same
 * label fallback and the same fold independently. Both are `placeDetailView`'s now — see
 * `PlaceDetailView.pins`.
 *
 * `activeId` highlights one dot (the pole the list is scrolled to); `onPointPress(id)` fires when
 * a dot is tapped (the caller scrolls its group into view) — see stop/[id].tsx.
 */
export function MiniMap({
  pins,
  grouped,
  label,
  actionLabel,
  height = 150,
  zoom,
  activeId,
  onPointPress,
  deferAttribution,
  className,
}: {
  /** The pins to draw, from `PlaceDetailView.pins`. Never empty — a lone stop is one pin. */
  pins: MapPin[]
  /** True when the place has more than one boarding point, from `PlaceDetailView.grouped`. It is what
   *  makes the dots smaller, labelled, tappable and dimmable: a lone stop's single dot is none of those.
   *  A boolean rather than `pins.length > 1`, because a place whose every pole shares one coordinate
   *  folds to a single pin and still needs its code chip — and because deriving it here would be a
   *  second declaration of "is this place grouped". */
  grouped: boolean
  /** Stop name — names the maps pin. */
  label?: string
  /** Accessible label for the tap target, e.g. "Open in Maps". */
  actionLabel: LocalizedString
  height?: number
  /** Override the automatic framing. Omit it — `fitZoom` frames one pin and many consistently. */
  zoom?: number
  /** Id of the pole to highlight (dims the rest). Only meaningful when `grouped`. */
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
  // Centre on the pins' centroid (so all are framed); zoom to fit them.
  // Folded pins mean the centroid is no longer weighted by how many times upstream published one spot,
  // which is the better framing: one physical place counts once.
  const cLat = pins.reduce((s, p) => s + p.location.lat, 0) / pins.length
  const cLng = pins.reduce((s, p) => s + p.location.lng, 0) / pins.length
  // One framing rule for one pin and for many (see `fitZoom`), clamped into the source's
  // supported range — outside it LandsD 404s and we'd render a hole. `tileSource` is passed
  // whole: it satisfies the `ZoomRange` the kernel asks for, which may not name a port type.
  const z = clampZoom(
    zoom ??
      fitZoom(
        // `fitZoom` frames coordinates; a folded pin contributes its one coordinate, which is the point.
        pins.map((p) => p.location),
        w,
        height,
        tileSource,
      ),
    tileSource,
  )
  const scale = worldScale(z)
  const n = 2 ** z
  // Viewport top-left in world pixels, so the centroid lands dead-centre.
  const left = lngToWorldX(cLng, scale) - w / 2
  const top = latToWorldY(cLat, scale) - height / 2

  const tiles: Array<{ tx: number; ty: number; x: number; y: number }> = []
  if (w > 0) {
    for (let tx = Math.floor(left / TILE_SIZE); tx <= Math.floor((left + w) / TILE_SIZE); tx++) {
      for (
        let ty = Math.floor(top / TILE_SIZE);
        ty <= Math.floor((top + height) / TILE_SIZE);
        ty++
      ) {
        if (tx < 0 || ty < 0 || tx >= n || ty >= n) continue
        tiles.push({ tx, ty, x: tx * TILE_SIZE - left, y: ty * TILE_SIZE - top })
      }
    }
  }

  // Dim the non-active dots only once a dot is actually highlighted (scrolled-to pole).
  const hasActive = grouped && !!activeId
  // Screen position per pole (needed both to draw dots and to decide label placement).
  const placed = pins.map((p) => ({
    p,
    cx: lngToWorldX(p.location.lng, scale) - left,
    cy: latToWorldY(p.location.lat, scale) - top,
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
            style={{
              position: 'absolute',
              left: t.x,
              top: t.y,
              width: TILE_SIZE,
              height: TILE_SIZE,
            }}
          />
        ))}
        {tileSource.label
          ? tiles.map((t) => (
              <Image
                key={`label-${t.tx}/${t.ty}`}
                source={{ uri: tileSource.label?.(z, t.tx, t.ty, locale) }}
                style={{
                  position: 'absolute',
                  left: t.x,
                  top: t.y,
                  width: TILE_SIZE,
                  height: TILE_SIZE,
                }}
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
            // Active when the scrolled-to pole is **any** of the poles folded into this pin — otherwise a
            // folded dot would go dim exactly when the rider scrolled to one of the kerbs it stands for.
            const isActive = grouped && !!activeId && p.ids.includes(activeId)
            const key = p.ids.join('+')
            const labelAbove = placed.some(
              (o) =>
                o.p.ids.join('+') !== key &&
                o.cy > cy &&
                o.cy - cy < 26 &&
                Math.abs(o.cx - cx) < 44,
            )
            return (
              <Pin
                key={key}
                cx={cx}
                cy={cy}
                size={grouped ? 14 : 18}
                color={
                  // A folded pin whose poles disagree about the operator has none, and takes the neutral
                  // colour — see `MapPin.operator`.
                  (p.operator !== undefined && OPERATOR_ACCENT[p.operator]) || MAP_COLOR.pin
                }
                active={isActive}
                dim={hasActive && !isActive}
                label={grouped ? p.label : undefined}
                labelAbove={labelAbove}
                // A tap on a folded pin scrolls to the first of its poles. Ambiguous by construction —
                // that is what "one spot, two published poles" means — and the list is where the rider
                // then reads which is which.
                onPress={
                  grouped && onPointPress ? () => onPointPress(p.ids[0] as string) : undefined
                }
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
          accessibilityLabel={t(locale, 'mapAttribution')}
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
  color = MAP_COLOR.pin,
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
  // A pin's lift is an elevation token like any other; the platform split (a CSS boxShadow on
  // web, the shadow* quartet elsewhere) lives once, in `elevationStyle`, instead of here.
  const shadow = elevationStyle(active ? 'pinActive' : 'pin', Platform.OS)
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
          borderColor: MAP_COLOR.pinBorder,
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
