// Generate the app icon asset set from one master design (see apps/mobile/assets/icon.svg).
// Run from repo root: `node scripts/gen-icons.mjs`. Requires `sharp` (already a dep).
//
// Outputs to apps/mobile/assets/:
//   icon.png           1024, full-bleed ink (iOS/PWA; OS masks the corners)
//   adaptive-icon.png  1024, white mark on transparent, scaled into Android's safe zone
//   splash-icon.png    1024, white mark on transparent, smaller (shown on ink via app.json)
//   favicon.png        196,  full-bleed ink (web tab)
//   icon-mono.png      1024, white mark on transparent (reuse: in-app logo / iOS tinted source)

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'mobile', 'assets')
const INK = '#111827'
const WHITE = '#ffffff'

// Bus mask: white = keep, black = knock out (the two windows become transparent so the
// mark composites on any background). Body + windows lean -8deg; wheels stay round/centred.
const MASK = `<defs><mask id="b" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">
  <g transform="translate(0,500) skewX(-8) translate(0,-500)">
    <rect x="176" y="300" width="672" height="372" rx="84" fill="#fff"/>
    <rect x="232" y="356" width="560" height="86" rx="28" fill="#000"/>
    <rect x="232" y="502" width="450" height="86" rx="28" fill="#000"/>
  </g>
  <circle cx="350" cy="676" r="60" fill="#fff"/>
  <circle cx="674" cy="676" r="60" fill="#fff"/>
</mask></defs>`
const BUS = `<rect width="1024" height="1024" fill="${WHITE}" mask="url(#b)"/>`
const svg = (inner) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">${inner}</svg>`,
  )
const FULL = svg(`<rect width="1024" height="1024" fill="${INK}"/>${MASK}${BUS}`)
const MARK = svg(`${MASK}${BUS}`)

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
  await sharp(FULL)
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

  console.log('Generated: icon.png, favicon.png, icon-mono.png, adaptive-icon.png, splash-icon.png')
}
run().catch((e) => {
  console.error(e)
  process.exit(1)
})
