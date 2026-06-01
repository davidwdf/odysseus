import type { Locale } from '@nextbus/core'

export const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'zh-Hant', 'zh-Hans']
/** Traditional Chinese is the primary HK form; apps still auto-detect device locale. */
export const DEFAULT_LOCALE: Locale = 'zh-Hant'

/** UI chrome strings. Bus *data* names come localized from the canonical model. */
export interface Messages {
  appName: string
  tabNearby: string
  tabRoutes: string
  tabFavorites: string
  tabSettings: string
  searchPlaceholder: string
  nearbyTitle: string
  noService: string
  /** Template — replace {s} with seconds. */
  updatedAgo: string
  stale: string
  retry: string
  locating: string
  locationDenied: string
  locationDeniedHelp: string
  openSettings: string
  nearbyPrimeTitle: string
  nearbyPrimeBody: string
  enableLocation: string
  comingSoon: string
}

const en: Messages = {
  appName: 'NextBus HK',
  tabNearby: 'Nearby',
  tabRoutes: 'Routes',
  tabFavorites: 'Favorites',
  tabSettings: 'Settings',
  searchPlaceholder: 'Search route number',
  nearbyTitle: 'Stops near you',
  noService: 'No scheduled service',
  updatedAgo: 'updated {s}s ago',
  stale: 'stale',
  retry: 'Retry',
  locating: 'Finding stops near you…',
  locationDenied: 'Location access is off',
  locationDeniedHelp: 'Turn on location access in your settings, then try again.',
  openSettings: 'Open settings',
  nearbyPrimeTitle: 'Buses near you',
  nearbyPrimeBody: 'Allow location access to see real-time arrivals at the stops around you.',
  enableLocation: 'Enable location',
  comingSoon: 'Coming soon',
}

const zhHant: Messages = {
  appName: '香港巴士',
  tabNearby: '附近',
  tabRoutes: '路線',
  tabFavorites: '收藏',
  tabSettings: '設定',
  searchPlaceholder: '搜尋路線號碼',
  nearbyTitle: '附近的車站',
  noService: '暫無班次',
  updatedAgo: '{s} 秒前更新',
  stale: '資料過時',
  retry: '重試',
  locating: '正在尋找附近車站…',
  locationDenied: '未開啟定位權限',
  locationDeniedHelp: '請在系統設定中開啟定位權限，然後再試一次。',
  openSettings: '前往設定',
  nearbyPrimeTitle: '附近的巴士',
  nearbyPrimeBody: '開啟定位權限，即可查看你附近車站的即時到站時間。',
  enableLocation: '開啟定位',
  comingSoon: '即將推出',
}

const zhHans: Messages = {
  appName: '香港巴士',
  tabNearby: '附近',
  tabRoutes: '路线',
  tabFavorites: '收藏',
  tabSettings: '设置',
  searchPlaceholder: '搜索路线号码',
  nearbyTitle: '附近的车站',
  noService: '暂无班次',
  updatedAgo: '{s} 秒前更新',
  stale: '数据过时',
  retry: '重试',
  locating: '正在查找附近车站…',
  locationDenied: '未开启定位权限',
  locationDeniedHelp: '请在系统设置中开启定位权限，然后重试。',
  openSettings: '前往设置',
  nearbyPrimeTitle: '附近的巴士',
  nearbyPrimeBody: '开启定位权限，即可查看你附近车站的实时到站时间。',
  enableLocation: '开启定位',
  comingSoon: '即将推出',
}

export const messages: Record<Locale, Messages> = {
  en,
  'zh-Hant': zhHant,
  'zh-Hans': zhHans,
}

export function t<K extends keyof Messages>(locale: Locale, key: K): Messages[K] {
  return messages[locale][key]
}

/**
 * Pick the best supported locale from an ordered list of BCP-47 tags (e.g. from
 * the device). English and unsupported languages → 'en'; bare/region `zh` → the
 * HK-default Traditional. Pure (no platform deps) so it's reusable + testable.
 */
export function resolveLocale(preferred: readonly string[]): Locale {
  for (const raw of preferred) {
    const tag = raw.toLowerCase()
    if (tag === 'en' || tag.startsWith('en-') || tag.startsWith('en_')) return 'en'
    if (tag.startsWith('zh')) {
      if (tag.includes('hans') || tag.includes('cn') || tag.includes('sg')) return 'zh-Hans'
      if (tag.includes('hant') || tag.includes('hk') || tag.includes('tw') || tag.includes('mo')) {
        return 'zh-Hant'
      }
      return 'zh-Hant' // bare "zh" → Traditional (HK default)
    }
  }
  return 'en'
}
