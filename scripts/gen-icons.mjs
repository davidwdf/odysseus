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
// And to apps/mobile/public/ (copied verbatim to the web root by `expo export`, for the PWA):
//   apple-touch-icon.png   180, opaque — iOS "Add to Home Screen" (iOS ignores the manifest here)
//   icon-192.png           192, opaque — PWA manifest icon (purpose "any")
//   icon-512.png           512, opaque — PWA manifest icon (purpose "any")
//   icon-maskable-512.png  512, mark in the ~66% safe zone on ink — manifest "maskable" (Android)
//
// And docs/social-preview.png (1280x640) — the GitHub repo social card (upload manually at
// repo Settings → Social preview; GitHub has no API for it).

import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ASSETS = join(ROOT, 'apps', 'mobile', 'assets')
const PUBLIC = join(ROOT, 'apps', 'mobile', 'public')
const DOCS = join(ROOT, 'docs')
const INK = '#111827'
const WHITE = '#ffffff'

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

  // Web/PWA icons → apps/mobile/public (served at the web root by `expo export`).
  mkdirSync(PUBLIC, { recursive: true })
  // iOS Add-to-Home-Screen + PWA "any" icons: opaque, full-bleed (transparency renders black on iOS).
  await sharp(FULL)
    .resize(180, 180)
    .flatten({ background: INK })
    .png()
    .toFile(join(PUBLIC, 'apple-touch-icon.png'))
  await sharp(FULL)
    .resize(192, 192)
    .flatten({ background: INK })
    .png()
    .toFile(join(PUBLIC, 'icon-192.png'))
  await sharp(FULL)
    .resize(512, 512)
    .flatten({ background: INK })
    .png()
    .toFile(join(PUBLIC, 'icon-512.png'))
  // Android maskable: mark inside the ~66% safe zone on an ink field (launchers crop the edges).
  const maskable = await sharp(MARK).resize(340, 340).png().toBuffer()
  await sharp({
    create: { width: 512, height: 512, channels: 4, background: { r: 17, g: 24, b: 39, alpha: 1 } },
  })
    .composite([{ input: maskable, gravity: 'center' }])
    .png()
    .toFile(join(PUBLIC, 'icon-maskable-512.png'))

  // GitHub social-preview card: ink field, centred mark (no text — name TBD).
  const social = await sharp(MARK).resize(440, 440).png().toBuffer()
  await sharp({
    create: {
      width: 1280,
      height: 640,
      channels: 4,
      background: { r: 17, g: 24, b: 39, alpha: 1 },
    },
  })
    .composite([{ input: social, gravity: 'center' }])
    .png()
    .toFile(join(DOCS, 'social-preview.png'))

  console.log(
    'Generated assets/: icon, favicon, icon-mono, adaptive-icon, splash-icon; ' +
      'public/: apple-touch-icon, icon-192, icon-512, icon-maskable-512; docs/social-preview.png',
  )
}
run().catch((e) => {
  console.error(e)
  process.exit(1)
})
