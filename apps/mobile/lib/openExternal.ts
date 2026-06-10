import { Linking, Platform } from 'react-native'

/**
 * Open an external URL. On web/PWA this opens a **new tab** (`_blank`, with
 * `noopener` so the new page can't reach back into ours); on native there are no
 * tabs, so it hands off to the system browser via `Linking`.
 */
export function openExternal(url: string): void {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer')
    return
  }
  void Linking.openURL(url)
}

/**
 * Open a coordinate in the platform's maps app — keyless, no SDK. iOS hands off to
 * **Apple Maps**, Android to a **`geo:`** URI (the OS chooses the maps app), and web
 * to a **Google Maps** URL in a new tab. `label` names the pin where the scheme allows.
 */
export function openInMaps(lat: number, lng: number, label?: string): void {
  const q = label ? encodeURIComponent(label) : ''
  if (Platform.OS === 'ios') {
    openExternal(`https://maps.apple.com/?ll=${lat},${lng}${q ? `&q=${q}` : ''}`)
    return
  }
  if (Platform.OS === 'android') {
    // geo: with a `q` label drops a named pin; the bare coords keep the centre exact.
    void Linking.openURL(`geo:${lat},${lng}?q=${lat},${lng}${q ? `(${q})` : ''}`)
    return
  }
  openExternal(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`)
}
