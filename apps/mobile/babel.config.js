module.exports = (api) => {
  api.cache(true)
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
    // Worklets plugin powers Reanimated; it MUST be listed last.
    plugins: ['react-native-worklets/plugin'],
  }
}
