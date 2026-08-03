import type { Locale } from '@nextbus/core'

/**
 * **The one declaration.** Every UI string in the app, in all three locales, authored in the ICU
 * subset documented in `./icu.ts`. Everything else in this package — the `t()` accessor, the
 * `MessageKey` union, the argument types, `packages/i18n/generated/`'s `.strings`/`.stringsdict`/
 * `strings.xml` — is derived from this object. Edit here and nowhere else.
 *
 * It is **key-major** on purpose. Until Wave 3 this file held three 100-line objects, `en` at
 * :186, `zhHant` at :292 and `zhHans` at :398, each annotated `: Messages`. That annotation caught
 * a *missing* key and nothing else: a translator could not see the sibling copy without scrolling
 * 200 lines, and an untranslated English string was invisible to every gate in the repo. Grouping
 * the three renderings of one message together makes the comparison local, and lets
 * `scripts/check-i18n.mts` assert what the type never could — that placeholders match across
 * locales, and that a non-`en` value is not still English.
 *
 * Bus *data* names are not here. They arrive localized from the canonical model as `I18nText`
 * (CLAUDE.md rule 5); this file is UI chrome only.
 */

/**
 * One message in three locales.
 *
 * `untranslated` is the deliberate escape hatch: it declares that the non-`en` renderings are
 * *meant* to be byte-identical to English, and says why. Without it the parity gate treats an
 * identical value as an untranslated string, which is the failure it exists to catch. The gate also
 * fails when `untranslated` is present but the values actually differ, so a stale exemption cannot
 * survive the translation that made it wrong.
 */
export type CatalogueEntry = {
  readonly en: string
  readonly 'zh-Hant': string
  readonly 'zh-Hans': string
  readonly untranslated?: string
}

export const CATALOGUE = {
  appName: {
    en: 'NextBus HK',
    'zh-Hant': '香港巴士',
    'zh-Hans': '香港巴士',
  },
  tabNearby: {
    en: 'Nearby',
    'zh-Hant': '附近',
    'zh-Hans': '附近',
  },
  tabSearch: {
    en: 'Search',
    'zh-Hant': '搜尋',
    'zh-Hans': '搜索',
  },
  tabFavorites: {
    en: 'Favourites',
    'zh-Hant': '收藏',
    'zh-Hans': '收藏',
  },
  tabSettings: {
    en: 'Settings',
    'zh-Hant': '設定',
    'zh-Hans': '设置',
  },
  searchPlaceholder: {
    en: 'Search route number',
    'zh-Hant': '搜尋路線號碼',
    'zh-Hans': '搜索路线号码',
  },
  // Search (Routes tab) — segment, prompts, filters
  searchSegRoutes: {
    en: 'Routes',
    'zh-Hant': '路線',
    'zh-Hans': '路线',
  },
  searchSegStops: {
    en: 'Stops',
    'zh-Hant': '車站',
    'zh-Hans': '车站',
  },
  searchStopPlaceholder: {
    en: 'Search stops & places',
    'zh-Hant': '搜尋車站或地點',
    'zh-Hans': '搜索车站或地点',
  },
  searchRoutePrompt: {
    en: 'Tap in a route number',
    'zh-Hant': '輸入路線號碼',
    'zh-Hans': '输入路线号码',
  },
  searchStopPrompt: {
    en: 'Search by stop or place name',
    'zh-Hant': '以車站或地點名稱搜尋',
    'zh-Hans': '以车站或地点名称搜索',
  },
  searchNoResults: {
    en: 'No matches',
    'zh-Hant': '沒有相符結果',
    'zh-Hans': '没有相符结果',
  },
  searchRecent: {
    en: 'Recent',
    'zh-Hant': '最近',
    'zh-Hans': '最近',
  },
  searchClearRecent: {
    en: 'Clear',
    'zh-Hant': '清除',
    'zh-Hans': '清除',
  },
  back: {
    en: 'Back',
    'zh-Hant': '返回',
    'zh-Hans': '返回',
  },
  filterNight: {
    en: 'Night',
    'zh-Hant': '通宵',
    'zh-Hans': '通宵',
  },
  filterAirport: {
    en: 'Airport',
    'zh-Hant': '機場',
    'zh-Hans': '机场',
  },
  filterExpress: {
    en: 'Express',
    'zh-Hant': '特快',
    'zh-Hans': '特快',
  },
  nearbyTitle: {
    en: 'Stops near you',
    'zh-Hant': '附近的車站',
    'zh-Hans': '附近的车站',
  },
  noService: {
    en: 'No scheduled service',
    'zh-Hant': '暫無班次',
    'zh-Hans': '暂无班次',
  },
  /** Template — replace {s} with seconds. */
  updatedAgo: {
    en: 'updated {s}s ago',
    'zh-Hant': '{s} 秒前更新',
    'zh-Hans': '{s} 秒前更新',
  },
  stale: {
    en: 'stale',
    'zh-Hant': '資料過時',
    'zh-Hans': '数据过时',
  },
  retry: {
    en: 'Retry',
    'zh-Hant': '重試',
    'zh-Hans': '重试',
  },
  locating: {
    en: 'Finding stops near you…',
    'zh-Hant': '正在尋找附近車站…',
    'zh-Hans': '正在查找附近车站…',
  },
  /** Shown when the list is built from the last known position, not a live fix. */
  lastKnownLocation: {
    en: 'Last known location',
    'zh-Hant': '最後已知位置',
    'zh-Hans': '最后已知位置',
  },
  locationDenied: {
    en: 'Location access is off',
    'zh-Hant': '未開啟定位權限',
    'zh-Hans': '未开启定位权限',
  },
  locationDeniedHelp: {
    en: 'Turn on location access in your settings, then try again.',
    'zh-Hant': '請在系統設定中開啟定位權限，然後再試一次。',
    'zh-Hans': '请在系统设置中开启定位权限，然后重试。',
  },
  openSettings: {
    en: 'Open settings',
    'zh-Hant': '前往設定',
    'zh-Hans': '前往设置',
  },
  nearbyPrimeTitle: {
    en: 'Buses near you',
    'zh-Hant': '附近的巴士',
    'zh-Hans': '附近的巴士',
  },
  nearbyPrimeBody: {
    en: 'Allow location access to see real-time arrivals at the stops around you.',
    'zh-Hant': '開啟定位權限，即可查看你附近車站的即時到站時間。',
    'zh-Hans': '开启定位权限，即可查看你附近车站的实时到站时间。',
  },
  enableLocation: {
    en: 'Enable location',
    'zh-Hant': '開啟定位',
    'zh-Hans': '开启定位',
  },
  comingSoon: {
    en: 'Coming soon',
    'zh-Hant': '即將推出',
    'zh-Hans': '即将推出',
  },
  // Settings — appearance (the one Ink theme, auto/light/dark)
  settingsAppearance: {
    en: 'Appearance',
    'zh-Hant': '外觀',
    'zh-Hans': '外观',
  },
  appearanceAuto: {
    en: 'Auto',
    'zh-Hant': '自動',
    'zh-Hans': '自动',
  },
  appearanceLight: {
    en: 'Light',
    'zh-Hant': '淺色',
    'zh-Hans': '浅色',
  },
  appearanceDark: {
    en: 'Dark',
    'zh-Hant': '深色',
    'zh-Hans': '深色',
  },
  // Settings — language
  settingsLanguage: {
    en: 'Language',
    'zh-Hant': '語言',
    'zh-Hans': '语言',
  },
  languageAuto: {
    en: 'Automatic',
    'zh-Hant': '自動',
    'zh-Hans': '自动',
  },
  // Settings — about / data attribution (P10, ADR-038)
  settingsAbout: {
    en: 'About',
    'zh-Hant': '關於',
    'zh-Hans': '关于',
  },
  /** Row label in Settings and the title of the dedicated screen. */
  aboutData: {
    en: 'About the data',
    'zh-Hant': '關於資料',
    'zh-Hans': '关于数据',
  },
  aboutIntro: {
    en: 'NextBus HK is built entirely on Hong Kong open data — no scraping, no private feeds.',
    'zh-Hant': '香港巴士完全建基於香港開放資料 — 沒有抓取網頁，亦沒有私有數據源。',
    'zh-Hans': '香港巴士完全基于香港开放数据 — 没有抓取网页，也没有私有数据源。',
  },
  aboutSourcesTitle: {
    en: 'Sources',
    'zh-Hant': '資料來源',
    'zh-Hans': '数据来源',
  },
  // Each source is a link row (opens the portal in a new tab).
  aboutGovHk: {
    en: 'DATA.GOV.HK',
    'zh-Hant': 'DATA.GOV.HK',
    'zh-Hans': 'DATA.GOV.HK',
    untranslated:
      'the portal brands itself in Latin script in every language, including its own zh pages',
  },
  aboutGovHkBody: {
    en: 'The Government open-data portal — routes, stops & fares, refreshed daily.',
    'zh-Hant': '政府開放資料平台 — 路線、車站及車費，每日更新。',
    'zh-Hans': '政府开放数据平台 — 路线、车站及车费，每日更新。',
  },
  aboutKmb: {
    en: 'KMB / LWB (Long Win)',
    'zh-Hant': '九巴／龍運',
    'zh-Hans': '九巴／龙运',
  },
  aboutKmbBody: {
    en: 'Real-time arrivals, via the Transport Department.',
    'zh-Hant': '即時到站時間，由運輸署提供。',
    'zh-Hans': '实时到站时间，由运输署提供。',
  },
  aboutCtb: {
    en: 'Citybus',
    'zh-Hant': '城巴',
    'zh-Hans': '城巴',
  },
  aboutCtbBody: {
    en: 'Real-time arrivals (incl. former NWFB routes).',
    'zh-Hant': '即時到站時間（包括前新巴路線）。',
    'zh-Hans': '实时到站时间（包括前新巴路线）。',
  },
  aboutLicenceTitle: {
    en: 'Licence',
    'zh-Hant': '授權條款',
    'zh-Hans': '授权条款',
  },
  /** Link row to the data.gov.hk terms (opens externally). */
  aboutTerms: {
    en: 'Terms and Conditions of Use',
    'zh-Hant': '使用條款及細則',
    'zh-Hans': '使用条款及细则',
  },
  aboutTermsBody: {
    en: "Open data from DATA.GOV.HK is used under the Government's terms.",
    'zh-Hant': 'DATA.GOV.HK 的開放資料按政府使用條款使用。',
    'zh-Hans': 'DATA.GOV.HK 的开放数据按政府使用条款使用。',
  },
  aboutVersion: {
    en: 'Version',
    'zh-Hant': '版本',
    'zh-Hans': '版本',
  },
  // Settings — FAQ (own screen, accordion; honesty/freshness notes live here)
  settingsFaq: {
    en: 'FAQ',
    'zh-Hant': '常見問題',
    'zh-Hans': '常见问题',
  },
  faqFreshnessQ: {
    en: 'How fresh are the arrival times?',
    'zh-Hant': '到站時間有多新？',
    'zh-Hans': '到站时间有多新？',
  },
  faqFreshnessA: {
    en: 'Live arrival times refresh about once a minute at source — we can never be fresher than that, and we grey out figures that have gone stale.',
    'zh-Hant':
      '即時到站時間在來源端約每分鐘更新一次 — 我們不可能比來源更快，並會將過時的數字轉為灰色。',
    'zh-Hans':
      '实时到站时间在来源端约每分钟更新一次 — 我们不可能比来源更快，并会将过时的数字转为灰色。',
  },
  faqTimingsQ: {
    en: 'Are the fares and timings live?',
    'zh-Hant': '車費與班次是即時的嗎？',
    'zh-Hans': '车费与班次是实时的吗？',
  },
  faqTimingsA: {
    en: 'No — fares, frequencies and journey times are scheduled reference data, shown as published, not live.',
    'zh-Hant': '不是 — 車費、班次頻率及行車時間屬時間表參考資料，按發布內容顯示，並非即時。',
    'zh-Hans': '不是 — 车费、班次频率及行车时间属时间表参考数据，按发布内容显示，并非实时。',
  },
  faqCoverageQ: {
    en: 'Which bus operators are covered?',
    'zh-Hant': '涵蓋哪些巴士公司？',
    'zh-Hans': '涵盖哪些巴士公司？',
  },
  faqCoverageA: {
    en: 'KMB, LWB (Long Win), Citybus — including the former New World First Bus routes — and green minibuses (GMB). New Lantao Bus, MTR Bus and rail are planned.',
    'zh-Hant':
      '九巴、龍運、城巴（包括前新巴路線）及專線小巴（綠色小巴）。新大嶼山巴士、港鐵巴士及鐵路將陸續加入。',
    'zh-Hans':
      '九巴、龙运、城巴（包括前新巴路线）及专线小巴（绿色小巴）。新大屿山巴士、港铁巴士及铁路将陆续加入。',
  },
  faqMergeQ: {
    en: 'Why do some stops list two companies?',
    'zh-Hant': '為何部分車站會列出兩間公司？',
    'zh-Hans': '为何部分车站会列出两家公司？',
  },
  faqMergeA: {
    en: 'When KMB and Citybus serve the same kerb, we merge them into one stop so you see every route arriving there at once.',
    'zh-Hant':
      '當九巴與城巴停靠同一個車站時，我們會將它們合併為一個車站，讓你一次過看到該站所有路線。',
    'zh-Hans':
      '当九巴与城巴停靠同一个车站时，我们会将它们合并为一个车站，让你一次过看到该站所有路线。',
  },
  faqOfflineQ: {
    en: 'Does the app work offline?',
    'zh-Hant': 'App 可以離線使用嗎？',
    'zh-Hans': 'App 可以离线使用吗？',
  },
  faqOfflineA: {
    en: 'Route and stop search work offline from an on-device index. Live arrival times need a connection — they come straight from the operators.',
    'zh-Hant':
      '路線及車站搜尋可離線使用（資料已下載至裝置）。即時到站時間則需連接網絡，因為它直接來自巴士公司。',
    'zh-Hans':
      '路线及车站搜索可离线使用（数据已下载至设备）。实时到站时间则需连接网络，因为它直接来自巴士公司。',
  },
  faqMapQ: {
    en: "Why isn't there a live bus map?",
    'zh-Hant': '為何沒有即時巴士地圖？',
    'zh-Hans': '为何没有实时巴士地图？',
  },
  faqMapA: {
    en: "Hong Kong's open data publishes stop-by-stop arrival estimates, not live vehicle positions or route shapes — so we can't honestly show buses moving on a map.",
    'zh-Hant':
      '香港的開放資料只提供逐站到站時間估算，並無即時車輛位置或路線圖形，因此我們無法如實在地圖上顯示巴士位置。',
    'zh-Hans':
      '香港的开放数据只提供逐站到站时间估算，并无实时车辆位置或路线图形，因此我们无法如实在地图上显示巴士位置。',
  },
  faqRemarksQ: {
    en: 'What do "Scheduled" and "Last bus" mean?',
    'zh-Hant': '「預定班次」和「尾班車」是什麼意思？',
    'zh-Hans': '“预定班次”和“尾班车”是什么意思？',
  },
  faqRemarksA: {
    en: 'They are notes from the operator. "Scheduled" means the time is timetable-based (lower confidence than a live estimate); "Last bus" flags the final departure of the day.',
    'zh-Hant':
      '這些是巴士公司的提示。「預定班次」表示該時間根據時間表（準確度低於即時估算）；「尾班車」標示當天最後一班車。',
    'zh-Hans':
      '这些是巴士公司的提示。“预定班次”表示该时间根据时间表（准确度低于实时估算）；“尾班车”标示当天最后一班车。',
  },
  // Stop / route detail + favorites (Slice 2)
  routesAtStop: {
    en: 'Routes',
    'zh-Hant': '路線',
    'zh-Hans': '路线',
  },
  stopsOnRoute: {
    en: 'Stops',
    'zh-Hant': '車站',
    'zh-Hans': '车站',
  },
  /** Stop detail: "Served by {operators}" lead-in for the summary line. */
  servedBy: {
    en: 'Served by',
    'zh-Hant': '服務公司',
    'zh-Hans': '服务公司',
  },
  // Short operator names for the "served by" line. These were an `OPERATOR_LABEL` map of English
  // literals in `app/stop/[id].tsx`, so a Chinese reader saw "Citybus" in an otherwise Chinese
  // sentence. The operators publish their own Chinese names; these are them.
  operatorKmb: {
    en: 'KMB',
    'zh-Hant': '九巴',
    'zh-Hans': '九巴',
  },
  operatorLwb: {
    en: 'LWB',
    'zh-Hant': '龍運',
    'zh-Hans': '龙运',
  },
  operatorCtb: {
    en: 'Citybus',
    'zh-Hant': '城巴',
    'zh-Hans': '城巴',
  },
  operatorGmb: {
    en: 'GMB',
    'zh-Hant': '專線小巴',
    'zh-Hans': '专线小巴',
  },
  /** Stop detail: the noun for the route count, e.g. "12 routes". */
  routesLabel: {
    en: 'routes',
    'zh-Hant': '條路線',
    'zh-Hans': '条路线',
  },
  /**
   * Route length, e.g. "24 stops" / "24 個站".
   *
   * This replaces `formatStopCount` in `packages/core`, whose `en` output was `"1 stops"` — the
   * repo's last `knownDefect` row. It was a pure label with no rule behind it, so the corpus row's
   * own `why` prescribed this move: the fix is a plural-aware key in the i18n layer, not a
   * per-platform `n === 1` special case that three ports would each have to remember.
   */
  stopCount: {
    en: '{n, plural, one{# stop} other{# stops}}',
    'zh-Hant': '{n, plural, other{# 個站}}',
    'zh-Hans': '{n, plural, other{# 个站}}',
  },
  /** Nearby card: tappable row revealing the routes not shown. `StopRow` shows 6 of N, so the
   *  remainder really can be 1 — the `one` branch is a live case, not a formality. */
  moreRoutes: {
    en: '{n, plural, one{+# more route} other{+# more routes}}',
    'zh-Hant': '{n, plural, other{另外 # 條路線}}',
    'zh-Hans': '{n, plural, other{另外 # 条路线}}',
  },
  /**
   * A compact card whose place had a boarding point that would not answer (ADR-077).
   *
   * **What it does and does not claim.** It says the *times* are missing and that the reason is on our
   * side of the wire — not that the stop is closed, not that no bus is coming, and not how many kerbs
   * refused. That is the most a card can support: it prints no per-kerb heading (see `stopCardView`), so
   * a rider has nothing to attach a kerb to. ADR-056 decision 18 declined to answer the neighbouring
   * question — what to say about a *refused target* — because "this stop has moved or closed" is a claim
   * about the world that a parse failure cannot support. An upstream refusal is the easier case: we know
   * exactly what went wrong and whose fault it is, so the string can say so plainly.
   *
   * No plural and no count, deliberately — see `StopCardView.incomplete` for why the kernel hands over a
   * boolean rather than a number of kerbs.
   */
  etasUnavailable: {
    en: 'Live times unavailable',
    'zh-Hant': '無法取得即時班次',
    'zh-Hans': '无法获取实时班次',
  },
  // The basemap credit (ADR-049). These lived as two ad-hoc `Record<Locale, string>` tables in
  // `apps/mobile/lib/tileSource.ts` — outside this package, so no gate compared them and no
  // translator ever saw them. `localeRecord()` in ./index.ts rebuilds the shape `TileSource` wants.
  mapAttribution: {
    en: 'Map from Lands Department',
    'zh-Hant': '地圖由地政總署提供',
    'zh-Hans': '地图由地政总署提供',
  },
  /** The same credit as a tappable a11y label — it opens the copyright notice and disclaimer. */
  mapAttributionAction: {
    en: 'Map from Lands Department — open the copyright notice and disclaimer',
    'zh-Hant': '地圖由地政總署提供 — 開啟版權公告及免責聲明',
    'zh-Hans': '地图由地政总署提供 — 打开版权公告及免责声明',
  },
  /** Route keypad: the delete key's accessible name (the key itself shows a glyph). */
  keypadBackspace: {
    en: 'Backspace',
    'zh-Hant': '退格',
    'zh-Hans': '退格',
  },
  // Stop detail: the compass side of a pole, appended to its heading where two poles of one place
  // would otherwise print the same thing (WP5-10). `poleSideLabel` in ./index.ts maps the octant
  // `poleSideOctants` (`@nextbus/core`) returns onto these eight keys — `core` owns the rule, `i18n`
  // owns the word (ADR-054).
  //
  // **These are POSITIONS, and they are deliberately not `formatBearing`'s words.** That function
  // renders the same eight octants as *travel* directions — "Northeast-bound" / "東北行" — which is a
  // statement about where the buses are going. Here the octant says where the rider must stand.
  // Reusing the key would put "Northeast-bound" above a group of routes that mostly head the other
  // way, which is worse than the ambiguity it set out to fix. Hence "side" / "面": the north side *of
  // this place*, not a north-going service.
  poleSideNorth: {
    en: 'North side',
    'zh-Hant': '北面',
    'zh-Hans': '北面',
  },
  poleSideNortheast: {
    en: 'Northeast side',
    'zh-Hant': '東北面',
    'zh-Hans': '东北面',
  },
  poleSideEast: {
    en: 'East side',
    'zh-Hant': '東面',
    'zh-Hans': '东面',
  },
  poleSideSoutheast: {
    en: 'Southeast side',
    'zh-Hant': '東南面',
    'zh-Hans': '东南面',
  },
  poleSideSouth: {
    en: 'South side',
    'zh-Hant': '南面',
    'zh-Hans': '南面',
  },
  poleSideSouthwest: {
    en: 'Southwest side',
    'zh-Hant': '西南面',
    'zh-Hans': '西南面',
  },
  poleSideWest: {
    en: 'West side',
    'zh-Hant': '西面',
    'zh-Hans': '西面',
  },
  poleSideNorthwest: {
    en: 'Northwest side',
    'zh-Hant': '西北面',
    'zh-Hans': '西北面',
  },
  /** Stop detail: accessible label for the map tap target. */
  openInMaps: {
    en: 'Open in Maps',
    'zh-Hant': '在地圖開啟',
    'zh-Hans': '在地图打开',
  },
  /** Route detail, when opened from a stop: the route's upcoming arrivals here. */
  arrivalsHere: {
    en: 'Next buses at this stop',
    'zh-Hant': '本站即將到站',
    'zh-Hans': '本站即将到站',
  },
  save: {
    en: 'Save',
    'zh-Hant': '收藏',
    'zh-Hans': '收藏',
  },
  saved: {
    en: 'Saved',
    'zh-Hant': '已收藏',
    'zh-Hans': '已收藏',
  },
  /** Route schematic action sheet: favourite this route at the tapped stop. */
  addFavorite: {
    en: 'Add to favourites',
    'zh-Hant': '加入收藏',
    'zh-Hans': '加入收藏',
  },
  /** Route schematic action sheet: remove the favourite. */
  removeFavorite: {
    en: 'Remove from favourites',
    'zh-Hant': '移除收藏',
    'zh-Hans': '移除收藏',
  },
  /** Route schematic action sheet: open the tapped stop's place detail. */
  viewStop: {
    en: 'View stop',
    'zh-Hant': '查看車站',
    'zh-Hans': '查看车站',
  },
  /** Route header: accessible label for the reverse-direction toggle / FAB (ADR-046). */
  reverseDirection: {
    en: 'Reverse direction',
    'zh-Hant': '反方向',
    'zh-Hans': '反方向',
  },
  /** Circular-route destination line; `{place}` is the loop's turnaround terminus (ADR-046). */
  circularVia: {
    en: 'Circular via {place}',
    'zh-Hant': '經{place}循環線',
    'zh-Hans': '经{place}循环线',
  },
  favoritesEmpty: {
    en: 'No saved routes yet',
    'zh-Hant': '尚未收藏路線',
    'zh-Hans': '尚未收藏路线',
  },
  favoritesEmptyHelp: {
    en: 'Save a route at a stop and it will appear here for quick access.',
    'zh-Hant': '收藏車站的路線後，即可在此快速查看。',
    'zh-Hans': '收藏车站的路线后，即可在此快速查看。',
  },
  // Route detail — tap-to-expand fact sheets (ADR-044)
  fareTitle: {
    en: 'Fares',
    'zh-Hant': '車費',
    'zh-Hans': '车费',
  },
  /** Honesty lead: fares drop boarding further along. */
  fareSectionalNote: {
    en: 'Fares are sectional — you pay less boarding further along the route.',
    'zh-Hant': '車費以分段收費 — 於路線較後位置上車，車費較平。',
    'zh-Hans': '车费以分段收费 — 在路线较后位置上车，车费较便宜。',
  },
  /** Suffix on the holiday fare pill, e.g. "$13.4 hol". Was a `HOLIDAY` table in `RouteMeta.tsx`. */
  holiday: {
    en: 'hol',
    'zh-Hant': '假日',
    'zh-Hans': '假日',
  },
  concessionsTitle: {
    en: 'Estimated concessions',
    'zh-Hant': '優惠車費（估算）',
    'zh-Hans': '优惠车费（估算）',
  },
  /** Honesty note: concessions are policy, shown as estimates. */
  concessionsNote: {
    en: 'Concessions are set by policy, not route data — these figures are estimates.',
    'zh-Hant': '優惠車費由政策制定，並非路線資料 — 以下數字僅為估算。',
    'zh-Hans': '优惠车费由政策制定，并非路线数据 — 以下数字仅为估算。',
  },
  fareAdult: {
    en: 'Adult',
    'zh-Hant': '成人',
    'zh-Hans': '成人',
  },
  fareChild: {
    en: 'Child (3–11)',
    'zh-Hant': '小童（3–11 歲）',
    'zh-Hans': '小童（3–11 岁）',
  },
  /** How the child estimate is derived. */
  fareChildNote: {
    en: 'Roughly half the adult fare.',
    'zh-Hant': '約為成人車費的一半。',
    'zh-Hans': '约为成人车费的一半。',
  },
  fareElderly: {
    en: 'Elderly 65+ / disabled',
    'zh-Hant': '長者 65+／殘疾人士',
    'zh-Hans': '长者 65+／残疾人士',
  },
  /** How the elderly/PwD $2 Scheme is paid. */
  fareElderlyNote: {
    en: '$2 Scheme, via a JoyYou or eligible Octopus (not cash).',
    'zh-Hant': '$2 計劃，須使用「樂悠咭」或合資格八達通（不適用於現金）。',
    'zh-Hans': '$2 计划，须使用「乐悠咭」或合资格八达通（不适用于现金）。',
  },
  freqTitle: {
    en: 'Frequency',
    'zh-Hant': '班次',
    'zh-Hans': '班次',
  },
  /** Honesty lead: frequencies are scheduled, not live. */
  freqNote: {
    en: 'How often buses run — scheduled frequencies, not live.',
    'zh-Hant': '巴士班次頻率 — 為時間表資料，並非即時。',
    'zh-Hans': '巴士班次频率 — 为时间表数据，并非实时。',
  },
  hoursTitle: {
    en: 'Service hours',
    'zh-Hant': '服務時間',
    'zh-Hans': '服务时间',
  },
  firstBus: {
    en: 'First',
    'zh-Hant': '首班',
    'zh-Hans': '首班',
  },
  lastBus: {
    en: 'Last',
    'zh-Hant': '尾班',
    'zh-Hans': '尾班',
  },
  // Day-type labels for frequency/hours patterns.
  dayWeekday: {
    en: 'Mon – Fri',
    'zh-Hant': '星期一至五',
    'zh-Hans': '周一至五',
  },
  daySaturday: {
    en: 'Saturday',
    'zh-Hant': '星期六',
    'zh-Hans': '周六',
  },
  daySunday: {
    en: 'Sunday',
    'zh-Hant': '星期日',
    'zh-Hans': '周日',
  },
  dayDaily: {
    en: 'Daily',
    'zh-Hant': '每日',
    'zh-Hans': '每日',
  },
  dayOther: {
    en: 'Other days',
    'zh-Hant': '其他日子',
    'zh-Hans': '其他日子',
  },
  /** Comma-separated short day names, Sunday-first — split by the UI for `other` day masks. */
  daysShort: {
    en: 'Sun,Mon,Tue,Wed,Thu,Fri,Sat',
    'zh-Hant': '日,一,二,三,四,五,六',
    'zh-Hans': '日,一,二,三,四,五,六',
  },
  // Route overview sheet (behind the stop-count badge — ADR-044)
  overviewTitle: {
    en: 'Route overview',
    'zh-Hant': '路線概覽',
    'zh-Hans': '路线概览',
  },
  overviewJourney: {
    en: 'Full journey',
    'zh-Hant': '全程時間',
    'zh-Hans': '全程时间',
  },
  /** Honesty note: journey time is scheduled/typical, not live. */
  overviewJourneyNote: {
    en: 'Typical end-to-end time — scheduled, not live.',
    'zh-Hant': '全程預計時間 — 為時間表資料，並非即時。',
    'zh-Hans': '全程预计时间 — 为时间表数据，并非实时。',
  },
  overviewDistance: {
    en: 'Distance',
    'zh-Hant': '路程',
    'zh-Hans': '路程',
  },
  /** Honesty note: distance is a straight-line-through-stops estimate. */
  overviewDistanceNote: {
    en: 'Estimated from stop positions; the road distance is a little longer.',
    'zh-Hant': '按車站位置估算；實際行車距離會稍長。',
    'zh-Hans': '按车站位置估算；实际行车距离会稍长。',
  },
} as const satisfies Record<string, CatalogueEntry>

/** Every message key. */
export type MessageKey = keyof typeof CATALOGUE

/** The locales the catalogue is complete in — the generators and the parity gate iterate this. */
export const SUPPORTED_LOCALES = ['en', 'zh-Hant', 'zh-Hans'] as const satisfies readonly Locale[]

/** Traditional Chinese is the primary HK form; apps still auto-detect the device locale. */
export const DEFAULT_LOCALE: Locale = 'zh-Hant'
