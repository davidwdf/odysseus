import { defineConfig } from 'vitest/config'

// `apps/mobile` had no vitest config: its one suite (`lib/preferences.migration.test.ts`) is pure logic
// and ran on the defaults. WP4-1's follow-up adds a suite that has to *render* the React Native card, so
// the config exists to make that possible without changing how the existing one runs.
//
// **`react-native` is aliased to `react-native-web`, and that is not a shortcut.** It is the renderer
// Expo already uses for the PWA — one of the three platforms this app ships to — so the tree under test
// is a real target rather than a simulation. The alternative, `react-test-renderer`, would need
// `@react-native/babel-preset` to strip Flow types out of the `react-native` source and would still not
// exercise a real layout. What neither approach covers is iOS/Android *native* rendering; what both
// cover is the thing that actually goes wrong, which is a component dropping or reordering a field.
//
// Each test file declares its own environment with a `@vitest-environment` docblock, so the logic suite
// keeps running in node and only the rendering suite pays for jsdom.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^react-native$/, replacement: 'react-native-web' },
      // `lucide-react-native` cannot be loaded outside Metro: its `.mjs` entry imports names its own
      // `context.mjs` does not export, and inlining it drags in `react-native-svg`'s Flow-typed source.
      // Aliasing to the DOM twin is sound **for this suite specifically**, and the reason is checkable
      // rather than convenient: the property under test is the card's *text*, and an icon package
      // contributes no text nodes at all. `test/stoprow-projection.test.tsx` asserts that directly, so
      // the assumption fails loudly if either package ever renders a label.
      { find: /^lucide-react-native$/, replacement: 'lucide-react' },
    ],
  },
  test: {
    include: ['{lib,test}/**/*.test.{ts,tsx}'],
  },
})
