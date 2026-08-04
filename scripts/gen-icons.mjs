// Generate the app icon asset set from one master design (see apps/mobile/assets/icon.svg).
// Run from repo root: `node scripts/gen-icons.mjs`. Requires `sharp` (already a dep).
//
// Outputs to apps/mobile/assets/:
//   icon.png           1024, full-bleed ink (iOS/PWA; OS masks the corners)
//   adaptive-icon.png  1024, white mark on transparent, scaled into Android's safe zone
//   splash-icon.png    1024, white mark on transparent, smaller (shown on ink via app.json)
//   favicon.png        196,  full-bleed ink (web tab) — enlarged full mark (fills the tab, crisper small)
//   icon-mono.png      1024, white mark on transparent (reuse: in-app logo / iOS tinted source)
//
// And to EVERY web root in PUBLIC_DIRS below (apps/mobile/public, copied verbatim by `expo export`;
// apps/web/public, copied verbatim by `vite build`) — the PWA install set:
//   apple-touch-icon.png   180, opaque — iOS "Add to Home Screen" (iOS ignores the manifest here)
//   icon-192.png           192, opaque — PWA manifest icon (purpose "any")
//   icon-512.png           512, opaque — PWA manifest icon (purpose "any")
//   icon-maskable-512.png  512, mark in the ~66% safe zone on ink — manifest "maskable" (Android)
//   landsd-logo.png        the Lands Department credit mark — COPIED, not generated: it is a licence
//                          obligation on the map face (ADR-049) and it is not ours to redraw. Only
//                          apps/web needs it as a file; apps/mobile bundles it through Metro.
//   manifest.webmanifest   the install manifest, whose two colours are the ink TOKEN rather than a
//                          hand-copied hex — it was hand-maintained beside the icons until WP6-0,
//                          which needed a second copy of it and would have made the hex a third
//
// And docs/social-preview.png (1280x640) — the GitHub repo social card (upload manually at
// repo Settings → Social preview; GitHub has no API for it).

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ASSETS = join(ROOT, 'apps', 'mobile', 'assets')
/**
 * Every web root that ships the PWA install set. **Two, for as long as two renderers ship a PWA** —
 * `apps/mobile` is the reference implementation until WP6-8 (ADR-075 decision 6) and `apps/web` is
 * the one that survives. The files are byte-identical by construction because they are written from
 * one run of one generator, which is the cheapest form of "one declaration" available for a binary.
 */
const PUBLIC_DIRS = [join(ROOT, 'apps', 'mobile', 'public'), join(ROOT, 'apps', 'web', 'public')]
const DOCS = join(ROOT, 'docs')
// The mark's field colour is the brand-ink *token*, read from the generated token set rather
// than repeated here — the icon, the splash, the PWA `theme-color` and any brand chrome are one
// family by construction (packages/ui/tokens.json). Nothing below is a colour choice: in the
// masks that follow, white means "keep" and black means "knock out".
const TOKENS = JSON.parse(
  readFileSync(join(ROOT, 'packages', 'ui', 'generated', 'tokens.json'), 'utf8'),
)
const INK = TOKENS['color.brand.ink']
const WHITE = TOKENS['palette.white']

/**
 * The PWA install manifest, emitted beside the icons it references.
 *
 * `start_url` / `scope` are `/` because both builds are served from a domain root, and `display:
 * standalone` is what makes an installed copy lose the browser chrome. The two colours are the ink
 * token — the same value the icons are drawn on — so the splash a launcher paints and the mark on it
 * cannot end up a shade apart. `lang: "en"` is the *manifest's* language, not the app's: the UI locale
 * is resolved per session from the browser's ordered language list and can be overridden, which a
 * static file cannot express.
 */
const MANIFEST = {
  name: 'NextBus HK',
  short_name: 'NextBus HK',
  description: 'Fast, mobile-first Hong Kong bus arrival times.',
  lang: 'en',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  orientation: 'portrait',
  background_color: INK,
  theme_color: INK,
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}

// Bus mask: white = keep, black = knock out (the two windows become transparent so the
// mark composites on any background). Body + windows lean -9deg; tri-axle wheels stay round
// (front wheel + rear tandem — the doubled rear also signals the engine end).
const MASK = `<defs><mask id="b" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">
  <g transform="translate(0,500) skewX(-9) translate(0,-500)">
    <rect x="176" y="300" width="672" height="372" rx="64" fill="#fff"/>
    <rect x="232" y="356" width="560" height="86" rx="21" fill="#000"/>
    <rect x="232" y="502" width="560" height="86" rx="21" fill="#000"/>
  </g>
  <circle cx="276" cy="676" r="48" fill="#fff"/>
  <circle cx="394" cy="676" r="48" fill="#fff"/>
  <circle cx="692" cy="676" r="48" fill="#fff"/>
</mask></defs>`
const BUS = `<rect width="1024" height="1024" fill="${WHITE}" mask="url(#b)"/>`
const svg = (inner) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">${inner}</svg>`,
  )
const FULL = svg(`<rect width="1024" height="1024" fill="${INK}"/>${MASK}${BUS}`)
const MARK = svg(`${MASK}${BUS}`)

// Favicon mark: the FULL tri-axle mark (wheels and all) scaled up ~1.24x about centre so it fills
// the browser tab and the wheels stay legible small — rather than shrinking the padded launcher mark.
const FAVICON_MASK = `<defs><mask id="fb" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">
  <g transform="translate(512,512) scale(1.24) translate(-512,-512)">
    <g transform="translate(0,500) skewX(-9) translate(0,-500)">
      <rect x="176" y="300" width="672" height="372" rx="64" fill="#fff"/>
      <rect x="232" y="356" width="560" height="86" rx="21" fill="#000"/>
      <rect x="232" y="502" width="560" height="86" rx="21" fill="#000"/>
    </g>
    <circle cx="276" cy="676" r="48" fill="#fff"/>
    <circle cx="394" cy="676" r="48" fill="#fff"/>
    <circle cx="692" cy="676" r="48" fill="#fff"/>
  </g>
</mask></defs>`
const FAVICON = svg(
  `<rect width="1024" height="1024" fill="${INK}"/>${FAVICON_MASK}<rect width="1024" height="1024" fill="${WHITE}" mask="url(#fb)"/>`,
)

const blank = () =>
  sharp({
    create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })

async function run() {
  // Full-bleed opaque icon (no alpha — iOS requires it) + web favicon.
  await sharp(FULL)
    .resize(1024, 1024)
    .flatten({ background: INK })
    .png()
    .toFile(join(ASSETS, 'icon.png'))
  await sharp(FAVICON)
    .resize(196, 196)
    .flatten({ background: INK })
    .png()
    .toFile(join(ASSETS, 'favicon.png'))

  // Transparent mark (reusable logo + iOS tinted source).
  await sharp(MARK).resize(1024, 1024).png().toFile(join(ASSETS, 'icon-mono.png'))

  // Android adaptive foreground: mark scaled into the ~66% safe zone, centred, transparent.
  const fg = await sharp(MARK).resize(740, 740).png().toBuffer()
  await blank()
    .composite([{ input: fg, gravity: 'center' }])
    .png()
    .toFile(join(ASSETS, 'adaptive-icon.png'))

  // Splash mark: smaller, centred, transparent (app.json paints the ink background).
  const sp = await sharp(MARK).resize(460, 460).png().toBuffer()
  await blank()
    .composite([{ input: sp, gravity: 'center' }])
    .png()
    .toFile(join(ASSETS, 'splash-icon.png'))

  // Web/PWA install set → every web root (each app's bundler copies its own verbatim).
  // iOS Add-to-Home-Screen + PWA "any" icons: opaque, full-bleed (transparency renders black on iOS).
  const opaque = (px) => sharp(FULL).resize(px, px).flatten({ background: INK }).png().toBuffer()
  // Android maskable: mark inside the ~66% safe zone on an ink field (launchers crop the edges).
  const maskableMark = await sharp(MARK).resize(340, 340).png().toBuffer()
  const web = {
    'apple-touch-icon.png': await opaque(180),
    'icon-192.png': await opaque(192),
    'icon-512.png': await opaque(512),
    'icon-maskable-512.png': await sharp({
      create: { width: 512, height: 512, channels: 4, background: INK },
    })
      .composite([{ input: maskableMark, gravity: 'center' }])
      .png()
      .toBuffer(),
    'manifest.webmanifest': Buffer.from(`${JSON.stringify(MANIFEST, null, 2)}\n`),
  }
  for (const dir of PUBLIC_DIRS) {
    mkdirSync(dir, { recursive: true })
    for (const [name, bytes] of Object.entries(web)) writeFileSync(join(dir, name), bytes)
  }

  // The **Lands Department credit logo** — not generated, and not ours. `apps/mobile` reads it through
  // Metro (`require('../assets/landsd-logo.png')` in `lib/tileSource.ts`); a Vite app has to be handed a
  // URL, so the same bytes are copied into `apps/web/public/` from the one source rather than committed
  // twice by hand. It is a **licence** asset (ADR-049 requires the logo on the map face), so "the same
  // bytes by construction" matters here for the same reason it does for the icons.
  copyFileSync(
    join(ASSETS, 'landsd-logo.png'),
    join(ROOT, 'apps', 'web', 'public', 'landsd-logo.png'),
  )

  // GitHub social-preview card: ink field, centred mark (no text — name TBD).
  const social = await sharp(MARK).resize(440, 440).png().toBuffer()
  await sharp({
    create: { width: 1280, height: 640, channels: 4, background: INK },
  })
    .composite([{ input: social, gravity: 'center' }])
    .png()
    .toFile(join(DOCS, 'social-preview.png'))

  console.log(
    'Generated assets/: icon, favicon, icon-mono, adaptive-icon, splash-icon; ' +
      `${Object.keys(web).length} PWA files × ${PUBLIC_DIRS.length} web roots ` +
      `(${PUBLIC_DIRS.map((d) => relative(ROOT, d)).join(', ')}); docs/social-preview.png`,
  )
}
run().catch((e) => {
  console.error(e)
  process.exit(1)
})
