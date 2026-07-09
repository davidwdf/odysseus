import type { Locale } from '@nextbus/core'

export const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'zh-Hant', 'zh-Hans']
/** Traditional Chinese is the primary HK form; apps still auto-detect device locale. */
export const DEFAULT_LOCALE: Locale = 'zh-Hant'

/** UI chrome strings. Bus *data* names come localized from the canonical model. */
export interface Messages {
  appName: string
  tabNearby: string
  tabSearch: string
  tabFavorites: string
  tabSettings: string
  searchPlaceholder: string
  // Search (Routes tab) — segment, prompts, filters
  searchSegRoutes: string
  searchSegStops: string
  searchStopPlaceholder: string
  searchRoutePrompt: string
  searchStopPrompt: string
  searchNoResults: string
  searchRecent: string
  searchClearRecent: string
  back: string
  filterNight: string
  filterAirport: string
  filterExpress: string
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
  // Settings — appearance (the one Ink theme, auto/light/dark)
  settingsAppearance: string
  appearanceAuto: string
  appearanceLight: string
  appearanceDark: string
  // Settings — language
  settingsLanguage: string
  languageAuto: string
  // Settings — about / data attribution (P10, ADR-038)
  settingsAbout: string
  /** Row label in Settings and the title of the dedicated screen. */
  aboutData: string
  aboutIntro: string
  aboutSourcesTitle: string
  // Each source is a link row (opens the portal in a new tab).
  aboutGovHk: string
  aboutGovHkBody: string
  aboutKmb: string
  aboutKmbBody: string
  aboutCtb: string
  aboutCtbBody: string
  aboutLicenceTitle: string
  /** Link row to the data.gov.hk terms (opens externally). */
  aboutTerms: string
  aboutTermsBody: string
  aboutVersion: string
  // Settings — FAQ (own screen, accordion; honesty/freshness notes live here)
  settingsFaq: string
  faqFreshnessQ: string
  faqFreshnessA: string
  faqTimingsQ: string
  faqTimingsA: string
  faqCoverageQ: string
  faqCoverageA: string
  faqMergeQ: string
  faqMergeA: string
  faqOfflineQ: string
  faqOfflineA: string
  faqMapQ: string
  faqMapA: string
  faqRemarksQ: string
  faqRemarksA: string
  // Stop / route detail + favorites (Slice 2)
  routesAtStop: string
  stopsOnRoute: string
  /** Stop detail: "Served by {operators}" lead-in for the summary line. */
  servedBy: string
  /** Stop detail: the noun for the route count, e.g. "12 routes". */
  routesLabel: string
  /** Nearby card: tappable row revealing the routes not shown. Template — replace {n}. */
  moreRoutes: string
  /** Stop detail: accessible label for the map tap target. */
  openInMaps: string
  /** Route detail, when opened from a stop: the route's upcoming arrivals here. */
  arrivalsHere: string
  save: string
  saved: string
  /** Route schematic action sheet: favourite this route at the tapped stop. */
  addFavorite: string
  /** Route schematic action sheet: remove the favourite. */
  removeFavorite: string
  /** Route schematic action sheet: open the tapped stop's place detail. */
  viewStop: string
  /** Route header: accessible label for the reverse-direction toggle / FAB (ADR-046). */
  reverseDirection: string
  /** Circular-route destination line; `{place}` is the loop's turnaround terminus (ADR-046). */
  circularVia: string
  favoritesEmpty: string
  favoritesEmptyHelp: string
  // Route detail — tap-to-expand fact sheets (ADR-044)
  fareTitle: string
  /** Honesty lead: fares drop boarding further along. */
  fareSectionalNote: string
  concessionsTitle: string
  /** Honesty note: concessions are policy, shown as estimates. */
  concessionsNote: string
  fareAdult: string
  fareChild: string
  /** How the child estimate is derived. */
  fareChildNote: string
  fareElderly: string
  /** How the elderly/PwD $2 Scheme is paid. */
  fareElderlyNote: string
  freqTitle: string
  /** Honesty lead: frequencies are scheduled, not live. */
  freqNote: string
  hoursTitle: string
  firstBus: string
  lastBus: string
  // Day-type labels for frequency/hours patterns.
  dayWeekday: string
  daySaturday: string
  daySunday: string
  dayDaily: string
  dayOther: string
  /** Comma-separated short day names, Sunday-first — split by the UI for `other` day masks. */
  daysShort: string
  // Route overview sheet (behind the stop-count badge — ADR-044)
  overviewTitle: string
  overviewJourney: string
  /** Honesty note: journey time is scheduled/typical, not live. */
  overviewJourneyNote: string
  overviewDistance: string
  /** Honesty note: distance is a straight-line-through-stops estimate. */
  overviewDistanceNote: string
}

const en: Messages = {
  appName: 'NextBus HK',
  tabNearby: 'Nearby',
  tabSearch: 'Search',
  tabFavorites: 'Favourites',
  tabSettings: 'Settings',
  searchPlaceholder: 'Search route number',
  searchSegRoutes: 'Routes',
  searchSegStops: 'Stops',
  searchStopPlaceholder: 'Search stops & places',
  searchRoutePrompt: 'Tap in a route number',
  searchStopPrompt: 'Search by stop or place name',
  searchNoResults: 'No matches',
  searchRecent: 'Recent',
  searchClearRecent: 'Clear',
  back: 'Back',
  filterNight: 'Night',
  filterAirport: 'Airport',
  filterExpress: 'Express',
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
  settingsAppearance: 'Appearance',
  appearanceAuto: 'Auto',
  appearanceLight: 'Light',
  appearanceDark: 'Dark',
  settingsLanguage: 'Language',
  languageAuto: 'Automatic',
  settingsAbout: 'About',
  aboutData: 'About the data',
  aboutIntro:
    'NextBus HK is built entirely on Hong Kong open data — no scraping, no private feeds.',
  aboutSourcesTitle: 'Sources',
  aboutGovHk: 'DATA.GOV.HK',
  aboutGovHkBody: 'The Government open-data portal — routes, stops & fares, refreshed daily.',
  aboutKmb: 'KMB / LWB (Long Win)',
  aboutKmbBody: 'Real-time arrivals, via the Transport Department.',
  aboutCtb: 'Citybus',
  aboutCtbBody: 'Real-time arrivals (incl. former NWFB routes).',
  aboutLicenceTitle: 'Licence',
  aboutTerms: 'Terms and Conditions of Use',
  aboutTermsBody: "Open data from DATA.GOV.HK is used under the Government's terms.",
  aboutVersion: 'Version',
  settingsFaq: 'FAQ',
  faqFreshnessQ: 'How fresh are the arrival times?',
  faqFreshnessA:
    'Live arrival times refresh about once a minute at source — we can never be fresher than that, and we grey out figures that have gone stale.',
  faqTimingsQ: 'Are the fares and timings live?',
  faqTimingsA:
    'No — fares, frequencies and journey times are scheduled reference data, shown as published, not live.',
  faqCoverageQ: 'Which bus operators are covered?',
  faqCoverageA:
    'KMB, LWB (Long Win), Citybus — including the former New World First Bus routes — and green minibuses (GMB). New Lantao Bus, MTR Bus and rail are planned.',
  faqMergeQ: 'Why do some stops list two companies?',
  faqMergeA:
    'When KMB and Citybus serve the same kerb, we merge them into one stop so you see every route arriving there at once.',
  faqOfflineQ: 'Does the app work offline?',
  faqOfflineA:
    'Route and stop search work offline from an on-device index. Live arrival times need a connection — they come straight from the operators.',
  faqMapQ: "Why isn't there a live bus map?",
  faqMapA:
    "Hong Kong's open data publishes stop-by-stop arrival estimates, not live vehicle positions or route shapes — so we can't honestly show buses moving on a map.",
  faqRemarksQ: 'What do "Scheduled" and "Last bus" mean?',
  faqRemarksA:
    'They are notes from the operator. "Scheduled" means the time is timetable-based (lower confidence than a live estimate); "Last bus" flags the final departure of the day.',
  routesAtStop: 'Routes',
  stopsOnRoute: 'Stops',
  servedBy: 'Served by',
  routesLabel: 'routes',
  moreRoutes: '+{n} more routes',
  openInMaps: 'Open in Maps',
  arrivalsHere: 'Next buses at this stop',
  save: 'Save',
  saved: 'Saved',
  addFavorite: 'Add to favourites',
  removeFavorite: 'Remove from favourites',
  viewStop: 'View stop',
  reverseDirection: 'Reverse direction',
  circularVia: 'Circular via {place}',
  favoritesEmpty: 'No saved routes yet',
  favoritesEmptyHelp: 'Save a route at a stop and it will appear here for quick access.',
  fareTitle: 'Fares',
  fareSectionalNote: 'Fares are sectional — you pay less boarding further along the route.',
  concessionsTitle: 'Estimated concessions',
  concessionsNote: 'Concessions are set by policy, not route data — these figures are estimates.',
  fareAdult: 'Adult',
  fareChild: 'Child (3–11)',
  fareChildNote: 'Roughly half the adult fare.',
  fareElderly: 'Elderly 65+ / disabled',
  fareElderlyNote: '$2 Scheme, via a JoyYou or eligible Octopus (not cash).',
  freqTitle: 'Frequency',
  freqNote: 'How often buses run — scheduled frequencies, not live.',
  hoursTitle: 'Service hours',
  firstBus: 'First',
  lastBus: 'Last',
  dayWeekday: 'Mon – Fri',
  daySaturday: 'Saturday',
  daySunday: 'Sunday',
  dayDaily: 'Daily',
  dayOther: 'Other days',
  daysShort: 'Sun,Mon,Tue,Wed,Thu,Fri,Sat',
  overviewTitle: 'Route overview',
  overviewJourney: 'Full journey',
  overviewJourneyNote: 'Typical end-to-end time — scheduled, not live.',
  overviewDistance: 'Distance',
  overviewDistanceNote: 'Estimated from stop positions; the road distance is a little longer.',
}

const zhHant: Messages = {
  appName: '香港巴士',
  tabNearby: '附近',
  tabSearch: '搜尋',
  tabFavorites: '收藏',
  tabSettings: '設定',
  searchPlaceholder: '搜尋路線號碼',
  searchSegRoutes: '路線',
  searchSegStops: '車站',
  searchStopPlaceholder: '搜尋車站或地點',
  searchRoutePrompt: '輸入路線號碼',
  searchStopPrompt: '以車站或地點名稱搜尋',
  searchNoResults: '沒有相符結果',
  searchRecent: '最近',
  searchClearRecent: '清除',
  back: '返回',
  filterNight: '通宵',
  filterAirport: '機場',
  filterExpress: '特快',
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
  settingsAppearance: '外觀',
  appearanceAuto: '自動',
  appearanceLight: '淺色',
  appearanceDark: '深色',
  settingsLanguage: '語言',
  languageAuto: '自動',
  settingsAbout: '關於',
  aboutData: '關於資料',
  aboutIntro: '香港巴士完全建基於香港開放資料 — 沒有抓取網頁，亦沒有私有數據源。',
  aboutSourcesTitle: '資料來源',
  aboutGovHk: 'DATA.GOV.HK',
  aboutGovHkBody: '政府開放資料平台 — 路線、車站及車費，每日更新。',
  aboutKmb: '九巴／龍運',
  aboutKmbBody: '即時到站時間，由運輸署提供。',
  aboutCtb: '城巴',
  aboutCtbBody: '即時到站時間（包括前新巴路線）。',
  aboutLicenceTitle: '授權條款',
  aboutTerms: '使用條款及細則',
  aboutTermsBody: 'DATA.GOV.HK 的開放資料按政府使用條款使用。',
  aboutVersion: '版本',
  settingsFaq: '常見問題',
  faqFreshnessQ: '到站時間有多新？',
  faqFreshnessA:
    '即時到站時間在來源端約每分鐘更新一次 — 我們不可能比來源更快，並會將過時的數字轉為灰色。',
  faqTimingsQ: '車費與班次是即時的嗎？',
  faqTimingsA: '不是 — 車費、班次頻率及行車時間屬時間表參考資料，按發布內容顯示，並非即時。',
  faqCoverageQ: '涵蓋哪些巴士公司？',
  faqCoverageA:
    '九巴、龍運、城巴（包括前新巴路線）及專線小巴（綠色小巴）。新大嶼山巴士、港鐵巴士及鐵路將陸續加入。',
  faqMergeQ: '為何部分車站會列出兩間公司？',
  faqMergeA:
    '當九巴與城巴停靠同一個車站時，我們會將它們合併為一個車站，讓你一次過看到該站所有路線。',
  faqOfflineQ: 'App 可以離線使用嗎？',
  faqOfflineA:
    '路線及車站搜尋可離線使用（資料已下載至裝置）。即時到站時間則需連接網絡，因為它直接來自巴士公司。',
  faqMapQ: '為何沒有即時巴士地圖？',
  faqMapA:
    '香港的開放資料只提供逐站到站時間估算，並無即時車輛位置或路線圖形，因此我們無法如實在地圖上顯示巴士位置。',
  faqRemarksQ: '「預定班次」和「尾班車」是什麼意思？',
  faqRemarksA:
    '這些是巴士公司的提示。「預定班次」表示該時間根據時間表（準確度低於即時估算）；「尾班車」標示當天最後一班車。',
  routesAtStop: '路線',
  stopsOnRoute: '車站',
  servedBy: '服務公司',
  routesLabel: '條路線',
  moreRoutes: '另外 {n} 條路線',
  openInMaps: '在地圖開啟',
  arrivalsHere: '本站即將到站',
  save: '收藏',
  saved: '已收藏',
  addFavorite: '加入收藏',
  removeFavorite: '移除收藏',
  viewStop: '查看車站',
  reverseDirection: '反方向',
  circularVia: '經{place}循環線',
  favoritesEmpty: '尚未收藏路線',
  favoritesEmptyHelp: '收藏車站的路線後，即可在此快速查看。',
  fareTitle: '車費',
  fareSectionalNote: '車費以分段收費 — 於路線較後位置上車，車費較平。',
  concessionsTitle: '優惠車費（估算）',
  concessionsNote: '優惠車費由政策制定，並非路線資料 — 以下數字僅為估算。',
  fareAdult: '成人',
  fareChild: '小童（3–11 歲）',
  fareChildNote: '約為成人車費的一半。',
  fareElderly: '長者 65+／殘疾人士',
  fareElderlyNote: '$2 計劃，須使用「樂悠咭」或合資格八達通（不適用於現金）。',
  freqTitle: '班次',
  freqNote: '巴士班次頻率 — 為時間表資料，並非即時。',
  hoursTitle: '服務時間',
  firstBus: '首班',
  lastBus: '尾班',
  dayWeekday: '星期一至五',
  daySaturday: '星期六',
  daySunday: '星期日',
  dayDaily: '每日',
  dayOther: '其他日子',
  daysShort: '日,一,二,三,四,五,六',
  overviewTitle: '路線概覽',
  overviewJourney: '全程時間',
  overviewJourneyNote: '全程預計時間 — 為時間表資料，並非即時。',
  overviewDistance: '路程',
  overviewDistanceNote: '按車站位置估算；實際行車距離會稍長。',
}

const zhHans: Messages = {
  appName: '香港巴士',
  tabNearby: '附近',
  tabSearch: '搜索',
  tabFavorites: '收藏',
  tabSettings: '设置',
  searchPlaceholder: '搜索路线号码',
  searchSegRoutes: '路线',
  searchSegStops: '车站',
  searchStopPlaceholder: '搜索车站或地点',
  searchRoutePrompt: '输入路线号码',
  searchStopPrompt: '以车站或地点名称搜索',
  searchNoResults: '没有相符结果',
  searchRecent: '最近',
  searchClearRecent: '清除',
  back: '返回',
  filterNight: '通宵',
  filterAirport: '机场',
  filterExpress: '特快',
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
  settingsAppearance: '外观',
  appearanceAuto: '自动',
  appearanceLight: '浅色',
  appearanceDark: '深色',
  settingsLanguage: '语言',
  languageAuto: '自动',
  settingsAbout: '关于',
  aboutData: '关于数据',
  aboutIntro: '香港巴士完全基于香港开放数据 — 没有抓取网页，也没有私有数据源。',
  aboutSourcesTitle: '数据来源',
  aboutGovHk: 'DATA.GOV.HK',
  aboutGovHkBody: '政府开放数据平台 — 路线、车站及车费，每日更新。',
  aboutKmb: '九巴／龙运',
  aboutKmbBody: '实时到站时间，由运输署提供。',
  aboutCtb: '城巴',
  aboutCtbBody: '实时到站时间（包括前新巴路线）。',
  aboutLicenceTitle: '授权条款',
  aboutTerms: '使用条款及细则',
  aboutTermsBody: 'DATA.GOV.HK 的开放数据按政府使用条款使用。',
  aboutVersion: '版本',
  settingsFaq: '常见问题',
  faqFreshnessQ: '到站时间有多新？',
  faqFreshnessA:
    '实时到站时间在来源端约每分钟更新一次 — 我们不可能比来源更快，并会将过时的数字转为灰色。',
  faqTimingsQ: '车费与班次是实时的吗？',
  faqTimingsA: '不是 — 车费、班次频率及行车时间属时间表参考数据，按发布内容显示，并非实时。',
  faqCoverageQ: '涵盖哪些巴士公司？',
  faqCoverageA:
    '九巴、龙运、城巴（包括前新巴路线）及专线小巴（绿色小巴）。新大屿山巴士、港铁巴士及铁路将陆续加入。',
  faqMergeQ: '为何部分车站会列出两家公司？',
  faqMergeA:
    '当九巴与城巴停靠同一个车站时，我们会将它们合并为一个车站，让你一次过看到该站所有路线。',
  faqOfflineQ: 'App 可以离线使用吗？',
  faqOfflineA:
    '路线及车站搜索可离线使用（数据已下载至设备）。实时到站时间则需连接网络，因为它直接来自巴士公司。',
  faqMapQ: '为何没有实时巴士地图？',
  faqMapA:
    '香港的开放数据只提供逐站到站时间估算，并无实时车辆位置或路线图形，因此我们无法如实在地图上显示巴士位置。',
  faqRemarksQ: '“预定班次”和“尾班车”是什么意思？',
  faqRemarksA:
    '这些是巴士公司的提示。“预定班次”表示该时间根据时间表（准确度低于实时估算）；“尾班车”标示当天最后一班车。',
  routesAtStop: '路线',
  stopsOnRoute: '车站',
  servedBy: '服务公司',
  routesLabel: '条路线',
  moreRoutes: '另外 {n} 条路线',
  openInMaps: '在地图打开',
  arrivalsHere: '本站即将到站',
  save: '收藏',
  saved: '已收藏',
  addFavorite: '加入收藏',
  removeFavorite: '移除收藏',
  viewStop: '查看车站',
  reverseDirection: '反方向',
  circularVia: '经{place}循环线',
  favoritesEmpty: '尚未收藏路线',
  favoritesEmptyHelp: '收藏车站的路线后，即可在此快速查看。',
  fareTitle: '车费',
  fareSectionalNote: '车费以分段收费 — 在路线较后位置上车，车费较便宜。',
  concessionsTitle: '优惠车费（估算）',
  concessionsNote: '优惠车费由政策制定，并非路线数据 — 以下数字仅为估算。',
  fareAdult: '成人',
  fareChild: '小童（3–11 岁）',
  fareChildNote: '约为成人车费的一半。',
  fareElderly: '长者 65+／残疾人士',
  fareElderlyNote: '$2 计划，须使用「乐悠咭」或合资格八达通（不适用于现金）。',
  freqTitle: '班次',
  freqNote: '巴士班次频率 — 为时间表数据，并非实时。',
  hoursTitle: '服务时间',
  firstBus: '首班',
  lastBus: '尾班',
  dayWeekday: '周一至五',
  daySaturday: '周六',
  daySunday: '周日',
  dayDaily: '每日',
  dayOther: '其他日子',
  daysShort: '日,一,二,三,四,五,六',
  overviewTitle: '路线概览',
  overviewJourney: '全程时间',
  overviewJourneyNote: '全程预计时间 — 为时间表数据，并非实时。',
  overviewDistance: '路程',
  overviewDistanceNote: '按车站位置估算；实际行车距离会稍长。',
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
