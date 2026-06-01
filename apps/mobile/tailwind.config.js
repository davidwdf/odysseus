const nextbusPreset = require('@nextbus/ui/preset')

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  presets: [require('nativewind/preset'), nextbusPreset],
  darkMode: 'class',
  theme: { extend: {} },
}
