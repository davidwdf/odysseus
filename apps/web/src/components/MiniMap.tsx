import {
  clampZoom,
  fitZoom,
  latToWorldY,
  lngToWorldX,
  type MapPin,
  TILE_SIZE,
  worldScale,
} from '@nextbus/core'
import { t } from '@nextbus/i18n'
import { MAP_COLOR, OPERATOR_ACCENT } from '@nextbus/ui'
import { useEffect, useRef, useState } from 'react'
import { linkOpener } from '../adapters/links'
import { tileSource } from '../adapters/tileSource'
import { useLocale } from '../providers/LocaleProvider'

/**
 * A static basemap of one place, laid out from raster tiles — the DOM twin of
 * `apps/mobile/components/MiniMap.tsx`.
 *
 * **It decides nothing about which dots exist or what they are called.** It is handed
 * `PlaceDetailView.pins` — already folded by coordinate, labelled with the printed code its heading uses,
 * and coloured by its own pole operator (ADR-087) — and `grouped`, which is a field of the view. The
 * projection and the framing rule are `@nextbus/core/mercator`'s, pinned by `mercator.spec.json`: deciding
 * what ground a rider sees is the same decision on every platform, while laying tiles out as `<img>`s is
 * this renderer's problem alone.
 *
 * Tiles come from the **Hong Kong Lands Department**, proxied and cached by our own Worker (ADR-049) —
 * keyless, free for commercial use, cacheable by licence, and the surveyor's own geometry. This component
 * never names a tile host: everything goes through the `TileSource` seam.
 *
 * ## The width is measured on mount, not only on resize, and that is a bug fix rather than a detail
 *
 * The RN twin measures itself with `onLayout`, and on this screen **it does not fire on first mount** under
 * `react-native-web`: the map renders with `w === 0`, which draws no tiles and no dots, and stays that way
 * until something else triggers a layout — measured on 2026-08-04, where dispatching a `resize` event by
 * hand made the whole map appear. So this one takes the first measurement synchronously in a layout effect
 * *and* keeps a `ResizeObserver` for later changes. It is in `docs/07` for the other renderer.
 */
export function MiniMap({
  pins,
  grouped,
  label,
  height = 150,
  activeId,
  onPinPress,
  className,
}: {
  /** The pins to draw, from `PlaceDetailView.pins`. Never empty — a lone stop is one pin. */
  pins: MapPin[]
  /** `PlaceDetailView.grouped`: makes the dots smaller, labelled, tappable and dimmable. Never derived
   *  from `pins.length > 1` — a place whose every pole shares one coordinate folds to a single pin and
   *  still needs its code chip (ADR-087 decision 3). */
  grouped: boolean
  /** The place name, for the maps hand-off. */
  label?: string
  height?: number
  /** The pole the list is scrolled to; its dot is emphasised and the rest are dimmed. */
  activeId?: string | null
  /** A dot was tapped — the caller scrolls that kerb's section into view. */
  onPinPress?: (poleId: string) => void
  className?: string
}) {
  const locale = useLocale()
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = box.current
    if (!el) return
    // The first measurement, taken now rather than waited for. See the note above.
    setWidth(el.clientWidth)
    // `ResizeObserver` is absent in jsdom, so the conformance suites would otherwise throw inside this
    // effect and React would drop the whole screen — which is what the first run of
    // `test/place-detail-states.test.tsx` reported, as an empty tree for every state. Feature-detecting it
    // is also simply correct: the initial measurement above is what a map needs to draw at all, and
    // tracking a *later* resize is the enhancement.
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Centre on the pins' centroid so all of them are framed, and zoom to fit. Folding first means the
  // centroid is not weighted by how many times upstream published one spot — one physical place counts once.
  let sumLat = 0
  let sumLng = 0
  for (const pin of pins) {
    sumLat += pin.location.lat
    sumLng += pin.location.lng
  }
  const centre = { lat: sumLat / pins.length, lng: sumLng / pins.length }
  // One framing rule for one pin and for many, clamped into the source's supported range — outside it
  // LandsD 404s and we would render a hole. `tileSource` is passed whole: it satisfies the `ZoomRange` the
  // kernel asks for, which may not name a port type.
  const zoom = clampZoom(
    fitZoom(
      pins.map((pin) => pin.location),
      width,
      height,
      tileSource,
    ),
    tileSource,
  )
  const scale = worldScale(zoom)
  const tilesAcross = 2 ** zoom
  // Viewport top-left in world pixels, so the centroid lands dead-centre.
  const left = lngToWorldX(centre.lng, scale) - width / 2
  const top = latToWorldY(centre.lat, scale) - height / 2

  const tiles: Array<{ tx: number; ty: number; x: number; y: number }> = []
  if (width > 0) {
    for (
      let tx = Math.floor(left / TILE_SIZE);
      tx <= Math.floor((left + width) / TILE_SIZE);
      tx++
    ) {
      for (
        let ty = Math.floor(top / TILE_SIZE);
        ty <= Math.floor((top + height) / TILE_SIZE);
        ty++
      ) {
        if (tx < 0 || ty < 0 || tx >= tilesAcross || ty >= tilesAcross) continue
        tiles.push({ tx, ty, x: tx * TILE_SIZE - left, y: ty * TILE_SIZE - top })
      }
    }
  }

  const hasActive = grouped && !!activeId
  const placed = pins.map((pin) => ({
    pin,
    cx: lngToWorldX(pin.location.lng, scale) - left,
    cy: latToWorldY(pin.location.lat, scale) - top,
  }))

  return (
    <div
      ref={box}
      className={`relative overflow-hidden bg-surface-2 ${className ?? ''}`}
      style={{ height }}
    >
      {/* Tiles live in their own layer so the dark filter recolours the map only — the dots and the credit
          above it stay true-colour. Two stacked rasters: the language-free basemap, then the label overlay
          for the active locale, which is how the map relabels itself with no restyling (ADR-049).
          `invertForDark` is the *source's* property, not this component's: a vector basemap would turn it
          off. The recipe is per renderer — a CSS class here, a `Platform.select` there. */}
      <div
        className={`absolute inset-0 ${tileSource.invertForDark ? 'map-tiles-invert' : ''}`}
        aria-hidden
      >
        {tiles.map((tile) => (
          <img
            key={`base-${tile.tx}/${tile.ty}`}
            src={tileSource.basemap(zoom, tile.tx, tile.ty)}
            alt=""
            width={TILE_SIZE}
            height={TILE_SIZE}
            className="absolute"
            style={{ left: tile.x, top: tile.y }}
          />
        ))}
        {tileSource.label
          ? tiles.map((tile) => (
              <img
                key={`label-${tile.tx}/${tile.ty}`}
                src={tileSource.label?.(zoom, tile.tx, tile.ty, locale)}
                alt=""
                width={TILE_SIZE}
                height={TILE_SIZE}
                className="absolute"
                style={{ left: tile.x, top: tile.y }}
              />
            ))
          : null}
      </div>

      {/* The background tap target hands the whole map to the platform's maps app. A **sibling** of the
          dots, never a wrapper, so the two never nest (ADR-024 / `sibling-not-nested`). */}
      <button
        type="button"
        aria-label={t(locale, 'openInMaps')}
        onClick={() => linkOpener.openMap({ ...centre, ...(label ? { label } : {}) })}
        className="absolute inset-0 border-0 bg-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
      />

      {width > 0
        ? placed.map(({ pin, cx, cy }) => {
            // Active when the scrolled-to pole is **any** of the poles folded into this pin — otherwise a
            // folded dot goes dim exactly when the rider scrolls to one of the kerbs it stands for, which
            // is what made the label appear to *swap* rather than highlight (ADR-086).
            const isActive = grouped && !!activeId && pin.ids.includes(activeId)
            const size = grouped ? 14 : 18
            const diameter = isActive ? size + 6 : size
            return (
              <Pin
                key={pin.ids.join('+')}
                cx={cx}
                cy={cy}
                diameter={diameter}
                // A folded pin whose poles disagree about the operator has none, and takes the neutral
                // colour — stating something the data does not is the mistake to avoid here.
                colour={
                  (pin.operator !== undefined && OPERATOR_ACCENT[pin.operator]) || MAP_COLOR.pin
                }
                dim={hasActive && !isActive}
                label={grouped ? pin.label : undefined}
                // A tap on a folded pin scrolls to the first of its poles and does not guess: ambiguity is
                // what "one spot, two published poles" means, and the list is where the rider reads which
                // is which.
                onPress={grouped && onPinPress ? () => onPinPress(pin.ids[0] as string) : undefined}
              />
            )
          })
        : null}

      <MapAttribution />
    </div>
  )
}

/**
 * The mandatory Lands Department credit: the logo plus the copyright notice, linked to their disclaimer.
 *
 * Their terms make **both** parts required and **on the map face**, so this is a licence obligation rather
 * than decoration (ADR-049) — which is why it is a required member of the `TileSource` port and an asserted
 * slot in `place-detail.spec.json`. The notice is a real link, not plain text: the mistake the old OSM
 * attribution made.
 */
export function MapAttribution({ className }: { className?: string }) {
  const locale = useLocale()
  return (
    <div
      className={`absolute bottom-0 right-0 flex items-center gap-1 rounded-tl-md bg-bg/85 py-1 pl-1.5 pr-2 ${className ?? ''}`}
    >
      {tileSource.attribution.logo ? (
        <img
          src={tileSource.attribution.logo}
          alt={t(locale, 'mapAttribution')}
          width={16}
          height={16}
          className="h-4 w-4 object-contain"
        />
      ) : null}
      <button
        type="button"
        aria-label={tileSource.attribution.a11yLabel[locale]}
        onClick={() => linkOpener.open(tileSource.attribution.href)}
        className="border-0 bg-transparent p-0 text-[9px] leading-3 text-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
      >
        {tileSource.attribution.notice[locale]}
      </button>
    </div>
  )
}

/**
 * One marker: a vivid core inside a white ring with a soft lift, so it reads on any tile in either mode.
 * The ring is what separates it from the map; an optional label chip sits just below the dot.
 *
 * The label is **always below** here, where the RN twin flips it above when another dot sits directly
 * beneath. That flip needs a pass over the other dots' screen positions — which is presentation, but it is
 * also the sort of thing two renderers should not disagree about, so it is `docs/07`'s to promote into the
 * kernel if the map ever earns it. Coincident poles, the case that actually bites, are already folded.
 */
function Pin({
  cx,
  cy,
  diameter,
  colour,
  dim,
  label,
  onPress,
}: {
  cx: number
  cy: number
  diameter: number
  colour: string
  dim: boolean
  label?: string
  onPress?: () => void
}) {
  const ring = Math.max(2, Math.round(diameter * 0.22))
  // The visible dot stays small; the touch target is a comfortable fixed box, per the 44 px rule the
  // invariant table puts on the identity side.
  const tap = 44
  return (
    <>
      {onPress ? (
        <button
          type="button"
          aria-label={label}
          onClick={onPress}
          className="absolute border-0 bg-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
          style={{ left: cx - tap / 2, top: cy - tap / 2, width: tap, height: tap, zIndex: 2 }}
        />
      ) : null}
      <div
        aria-hidden
        className="pointer-events-none absolute rounded-full shadow-md"
        style={{
          left: cx - diameter / 2,
          top: cy - diameter / 2,
          width: diameter,
          height: diameter,
          backgroundColor: colour,
          border: `${ring}px solid ${MAP_COLOR.pinBorder}`,
          opacity: dim ? 0.5 : 1,
          zIndex: 2,
        }}
      />
      {label ? (
        // Centred on the dot and sized to its content — never a fixed box: a folded pin's label is two
        // codes joined ("TN511 · TN510", ADR-086) and a clipped one is worse than none, because
        // "TN511 · T…" reads as a code that does not exist.
        <div
          aria-hidden
          className="pointer-events-none absolute -translate-x-1/2 whitespace-nowrap"
          style={{ left: cx, top: cy + diameter / 2 + 2, opacity: dim ? 0.5 : 1, zIndex: 2 }}
        >
          <span className="rounded bg-bg/85 px-1 text-[9px] text-text">{label}</span>
        </div>
      ) : null}
    </>
  )
}
