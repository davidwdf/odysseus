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
      // **reanimated cannot load outside Metro**: its `NativeReanimatedModule` spec reads
      // `TurboModuleRegistry.get(...)`, and there is no registry here, so importing any screen that animates
      // dies at *import* — which vitest counts as a failed FILE rather than failed tests, the exact
      // vacuous-pass shape WP6-0's parity suite hit. The package ships its own mock for this, and it is the
      // honest substitution for these suites: the Place screen's collapsing header, its map's shrink and its
      // scroll-spy are **motion**, which ADR-075 puts on the idiom side of the line — the conformance check
      // is about the text, and `place-detail.spec.json` says so in its `reducedMotion` and `idiom` blocks.
      // `react-native-css-interop`'s `main` is `"dist/index"` — **no extension** — and the resolver picks
      // `dist/index.d.ts` ahead of `dist/index.js`, so node is handed a declaration file and dies with
      // `SyntaxError: Unexpected token 'typeof'` and **no stack at all**. It arrives through `nativewind`'s
      // `cssInterop`, which `GlassView` calls. Found by bisecting the screen's imports one at a time; worth
      // the comment because the error names neither the package nor the file.
      { find: /^react-native-css-interop$/, replacement: 'react-native-css-interop/dist/index.js' },
      // The package's own `mock.js` does not work in reanimated 4 — see `test/reanimated-shim.tsx`, which
      // is hand-written from the API the app measurably imports.
      {
        find: /^react-native-reanimated$/,
        replacement: new URL('./test/reanimated-shim.tsx', import.meta.url).pathname,
      },
    ],
  },
  // `__DEV__` is a **Metro** global, and `expo-modules-core` reads it at import time — so anything that
  // reaches an Expo native module (the Place screen does, through `expo-blur` inside `GlassView`) dies at
  // import without it, which vitest counts as a failed *file* rather than failed tests. `true` is the honest
  // value for a test run: it is the development branch of every such check, and the alternative is stubbing
  // each module that reads it.
  define: { __DEV__: 'true' },
  test: {
    include: ['{lib,test}/**/*.test.{ts,tsx}'],
    // Expo's packages ship **TypeScript source** as their entry points, and vitest externalizes
    // `node_modules` by default — so node loads a `.ts` file as JavaScript and dies with a bare
    // `SyntaxError: Unexpected token 'typeof'` and no stack, which is a spectacularly unhelpful way to learn
    // that a screen reached a native module. Inlining them makes vite transpile them like any other source.
    // `nativewind` was the actual culprit and `expo-*` the plausible suspect; both are inlined because
    // both ship TypeScript entry points. Measured by bisecting the screen's imports one at a time —
    // `GlassView` → `cssInterop` from `nativewind` — which is the only way to find it, since the error
    // arrives with no stack at all.
    server: { deps: { inline: [/^expo/, /^@expo\//, /^nativewind/, /^react-native-css-interop/] } },
  },
})
