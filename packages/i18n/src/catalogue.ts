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
  /**
   * The screen-level freshness notice (ADR-133). Three sentences for three states a rider can act on
   * differently — and deliberately **no fourth** for an upstream board refusing, which `etasUnavailable`
   * already says per card and per row (ADR-073/077/114). A second sentence for that could disagree with the
   * first, because a live round asks each pole separately.
   *
   * **Wording accepted as the default by the owner (2026-08-12)**, to be reviewed with the app's other error
   * and placeholder texts as a set rather than one at a time — that review is a `docs/07` row, not a block.
   * `{time}` is Hong Kong wall-clock from `formatClock`: absolute rather
   * than relative, because "2 minutes ago" ages while nothing re-renders, which is the dishonesty ADR-008
   * rules out for arrival times and for the same reason.
   */
  feedLastUpdated: {
    en: 'Last updated {time}',
    'zh-Hant': '最後更新 {time}',
    'zh-Hans': '最后更新 {time}',
  },
  /** The rider's network is gone — their problem to fix, and it explains any staleness underneath it. */
  feedOffline: {
    en: 'You’re offline — showing the last times we had',
    'zh-Hant': '你目前離線，顯示最後取得的時間',
    'zh-Hans': '你目前离线，显示最后取得的时间',
  },
  /** Our own edge is unreachable or erroring — our problem, and we are still retrying. */
  feedUnreachable: {
    en: 'Can’t reach NextBus — retrying',
    'zh-Hant': '無法連線至 NextBus，正在重試',
    'zh-Hans': '无法连线至 NextBus，正在重试',
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
  // "no scraping, no private feeds" was true of us and glossed that the static tier reaches us through a
  // third party's crawl of the official APIs. That source is credited below now, so the claim can be the
  // stronger and simpler one: every source is public, and every one of them is named on this screen.
  aboutIntro: {
    en: 'NextBus HK is built entirely on Hong Kong open data. Every source it uses is public, and every one of them is credited below.',
    'zh-Hant': '香港巴士完全建基於香港開放資料。所用的每個資料來源都是公開的，並全部列於下方。',
    'zh-Hans': '香港巴士完全基于香港开放数据。所用的每个数据来源都是公开的，并全部列于下方。',
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
    en: 'The Government open-data portal the operators publish through, and whose terms this app uses their data under.',
    'zh-Hant': '巴士公司發布資料的政府開放資料平台，本 App 亦按其條款使用這些資料。',
    'zh-Hans': '巴士公司发布数据的政府开放数据平台，本 App 也按其条款使用这些数据。',
  },
  aboutKmb: {
    en: 'KMB / LWB (Long Win)',
    'zh-Hant': '九巴／龍運',
    'zh-Hans': '九巴／龙运',
  },
  aboutKmbBody: {
    en: "Real-time arrivals, from KMB's own open-data service.",
    'zh-Hant': '即時到站時間，來自九巴的開放資料服務。',
    'zh-Hans': '实时到站时间，来自九巴的开放数据服务。',
  },
  aboutCtb: {
    en: 'Citybus',
    'zh-Hant': '城巴',
    'zh-Hans': '城巴',
  },
  aboutCtbBody: {
    en: "Real-time arrivals (incl. former NWFB routes), via the Government's real-time data gateway.",
    'zh-Hant': '即時到站時間（包括前新巴路線），經政府即時資料閘道提供。',
    'zh-Hans': '实时到站时间（包括前新巴路线），经政府实时数据网关提供。',
  },
  // Green minibus shipped as a v1 operator with its own feed (ADR-047) and `faqCoverageA` names it, but
  // the Sources list had three rows and none of them was GMB until WP6-7 — so the app's own coverage
  // answer and its own attribution page disagreed about which operators it uses.
  aboutGmb: {
    en: 'Green Minibus (GMB)',
    'zh-Hant': '專線小巴',
    'zh-Hans': '专线小巴',
  },
  aboutGmbBody: {
    en: 'Real-time arrivals for green minibuses.',
    'zh-Hant': '綠色專線小巴的即時到站時間。',
    'zh-Hans': '绿色专线小巴的实时到站时间。',
  },
  // The basemap. ADR-049 decision 5 ends "This extends the ADR-038 'About the data' sources list" and it
  // never did — the binding credit is the one on the map face, which has always shipped; this is the
  // second half, and the CSDI grant conditions on naming the portal as well as the department.
  aboutLandsd: {
    en: 'Lands Department (CSDI Portal)',
    'zh-Hant': '地政總署（空間數據共享平台）',
    'zh-Hans': '地政总署（空间数据共享平台）',
  },
  aboutLandsdBody: {
    en: 'Map tiles and place labels, cached by us and credited on every map.',
    'zh-Hant': '地圖圖磚及地名標籤，由我們自行快取，並在每幅地圖上標示來源。',
    'zh-Hans': '地图图块及地名标签，由我们自行缓存，并在每幅地图上标示来源。',
  },
  // Where the static tier actually comes from. ADR-021's decision says to attribute the consolidation and
  // ADR-038's follow-up list repeats it; neither was actioned until WP6-7.
  aboutHkbus: {
    en: 'hkbus / hk-bus-crawling',
    'zh-Hant': 'hkbus / hk-bus-crawling',
    'zh-Hans': 'hkbus / hk-bus-crawling',
    untranslated:
      'a project name, written the same way in every language — as DATA.GOV.HK is above',
  },
  aboutHkbusBody: {
    en: 'The consolidated open-data crawl our routes, stops and fares are built from.',
    'zh-Hant': '我們的路線、車站及車費資料，建基於這個開放資料整合專案。',
    'zh-Hans': '我们的路线、车站及车费数据，基于这个开放数据整合项目。',
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
    en: "Routes, stops, fares and arrival times from DATA.GOV.HK, used under the Government's terms.",
    'zh-Hant': '路線、車站、車費及到站時間來自 DATA.GOV.HK，按政府使用條款使用。',
    'zh-Hans': '路线、车站、车费及到站时间来自 DATA.GOV.HK，按政府使用条款使用。',
  },
  // A second licence row, because the basemap arrived a wave after ADR-038 built this section for exactly
  // one — leaving `aboutTermsBody` as the app's only licence statement while a different set of terms was
  // silently in force on every map.
  aboutCsdiTerms: {
    en: 'CSDI Portal Terms and Conditions',
    'zh-Hant': '空間數據共享平台使用條款',
    'zh-Hans': '空间数据共享平台使用条款',
  },
  aboutCsdiTermsBody: {
    en: 'The map tiles and place labels are used under the CSDI Portal’s own terms.',
    'zh-Hant': '地圖圖磚及地名標籤按空間數據共享平台的使用條款使用。',
    'zh-Hans': '地图图块及地名标签按空间数据共享平台的使用条款使用。',
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
  // "grey out" over-described the shipped cue: the whole stale treatment is `opacity.etaStale`, and the
  // urgency colour is retained, so a stale figure fades rather than turning grey. ADR-008's "updated Ns
  // ago" chip has never been built (`updatedAgo` is in this catalogue and no renderer calls it), so this
  // answer describes what ships rather than what was promised.
  faqFreshnessA: {
    en: 'Live arrival times refresh about once a minute at source — we can never be fresher than that, and a figure we think has gone stale is faded rather than shown as current.',
    'zh-Hant':
      '即時到站時間在來源端約每分鐘更新一次 — 我們不可能比來源更快；當某個數字可能已過時，我們會將它調淡，而不會當作最新資料顯示。',
    'zh-Hans':
      '实时到站时间在来源端约每分钟更新一次 — 我们不可能比来源更快；当某个数字可能已过时，我们会将它调淡，而不会当作最新数据显示。',
  },
  faqTimingsQ: {
    en: 'Are the fares and timings live?',
    'zh-Hant': '車費與班次是即時的嗎？',
    'zh-Hans': '车费与班次是实时的吗？',
  },
  // "shown as published" was false for two figures the app draws prominently: child and elderly fares are
  // not published anywhere, so we work them out from the fare policy and mark each with a `~` (ADR-095
  // decision 1 makes that mark kernel-composed content precisely so no renderer can drop it). Leaving the
  // old wording was the one case in the audit where the FAQ contradicted an on-screen honesty label.
  faqTimingsA: {
    en: 'No — fares, frequencies and journey times are scheduled reference data, shown as published, not live. Child and elderly fares are the exception: those are not published at all, so we work them out from the fare policy and mark every one with a ~.',
    'zh-Hant':
      '不是 — 車費、班次頻率及行車時間屬時間表參考資料，按發布內容顯示，並非即時。小童及長者車費則屬例外：這些數字並無公開發布，我們按車費政策推算，並在每個數字前加上 ~ 標示。',
    'zh-Hans':
      '不是 — 车费、班次频率及行车时间属时间表参考数据，按发布内容显示，并非实时。小童及长者车费则属例外：这些数字并无公开发布，我们按车费政策推算，并在每个数字前加上 ~ 标示。',
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
  // This pair described ADR-022's superseded cross-operator *pair* merge and survived three ADRs that
  // changed every clause of it. ADR-042 replaced the "one KMB + one CTB within 30 m" rule with
  // direction-aware N-member clustering that explicitly permits same-operator members; the merged thing is
  // a *place* of several kerbs rather than "one stop"; and ADR-072 reversed "listed once", so a line
  // boarding at two kerbs of one place now keeps a row at each. The question is widened with it, because
  // two companies at one stop is now the minority reason a place has several kerbs.
  faqMergeQ: {
    en: 'Why is one stop sometimes several kerbs?',
    'zh-Hant': '為何一個車站有時會有多支站柱？',
    'zh-Hans': '为何一个车站有时会有多支站柱？',
  },
  faqMergeA: {
    en: 'Because nearby stop poles that face the same way are grouped into one place — whichever companies run them. The place is one entry in the list, and inside it each route is listed under the kerb you board it from.',
    'zh-Hant':
      '因為我們會把方向相同的鄰近站柱合併為一個地點 — 不論由哪些公司營運。該地點在列表中只佔一項；進入地點後，每條路線會列在你上車的那支站柱之下。',
    'zh-Hans':
      '因为我们会把方向相同的邻近站柱合并为一个地点 — 不论由哪些公司运营。该地点在列表中只占一项；进入地点后，每条路线会列在你上车的那支站柱之下。',
  },
  faqOfflineQ: {
    en: 'Does the app work offline?',
    'zh-Hant': 'App 可以離線使用嗎？',
    'zh-Hans': 'App 可以离线使用吗？',
  },
  // **WP6-7's named acceptance.** Three things were wrong. It understated offline by two ADRs — since
  // ADR-058/082 the app *opens* offline and previously-seen arrivals replay from the persisted cache,
  // aged; "an on-device index" is true only after a first online session, since the index is fetched and
  // then persisted rather than bundled (the zh strings already said so, and were the more accurate pair);
  // and "straight from the operators" was wrong about the path, because every live reading goes through
  // our own Worker, which coalesces per pole (ADR-057).
  faqOfflineA: {
    en: 'Partly. The app opens offline, and route and stop search keeps working from the index saved on your device the first time you used it. Arrivals you have already seen come back from the cache, faded rather than shown as current — a new reading always needs a connection.',
    'zh-Hant':
      '部分可以。App 可離線開啟，路線及車站搜尋亦可繼續使用（索引在首次使用時已下載至裝置）。之前看過的到站時間會從快取重現，並以淡色顯示，不會當作最新資料 — 要取得新的讀數則必須連接網絡。',
    'zh-Hans':
      '部分可以。App 可离线打开，路线及车站搜索也可继续使用（索引在首次使用时已下载至设备）。之前看过的到站时间会从缓存重现，并以淡色显示，不会当作最新数据 — 要取得新的读数则必须连接网络。',
  },
  faqMapQ: {
    en: "Why isn't there a live bus map?",
    'zh-Hant': '為何沒有即時巴士地圖？',
    'zh-Hans': '为何没有实时巴士地图？',
  },
  // **Half of this answer was false and had to be rewritten** (2026-08-26, ADR-151/155). It said HK open data
  // publishes no "route shapes", which was our own record repeating itself: the Transport Department has
  // surveyed and published bus-route lines on CSDI since 2021, ~97% of route-directions resolve, and since
  // M4 we draw them. A rider looking at a route line while being told there is no route line is the worst
  // kind of dishonesty for an app whose whole pitch is not overclaiming.
  //
  // The half that IS still true is the one that matters: there are no live **vehicle positions**. So the
  // answer now separates the two — the line is surveyed and real, where the bus is on it is inferred from
  // arrival times and is drawn on the stop list rather than the map. A stop list is not a map, and an
  // inference is not a position; that distinction is the point of the question.
  faqMapA: {
    en: "The route's own line is real — the Transport Department surveys and publishes it, and that is what you see drawn on the map. What Hong Kong's open data does not publish is live vehicle positions: the feeds give stop-by-stop arrival estimates, so we can't honestly show a bus moving along that line. What we can do is place it on the route's stop list, between the two stops its own arrival times put it between.",
    'zh-Hant':
      '路線本身的走線是真實的 — 由運輸署實地測繪並公開發布，地圖上畫的就是它。香港的開放資料沒有提供的，是即時車輛位置：資料只有逐站到站時間估算，因此我們無法如實顯示巴士在走線上移動。我們能做的，是根據各站的到站時間，把巴士標示在路線的車站列表上、它應在的兩站之間。',
    'zh-Hans':
      '路线本身的走线是真实的 — 由运输署实地测绘并公开发布，地图上画的就是它。香港的开放数据没有提供的，是实时车辆位置：数据只有逐站到站时间估算，因此我们无法如实显示巴士在走线上移动。我们能做的，是根据各站的到站时间，把巴士标示在路线的车站列表上、它应在的两站之间。',
  },
  faqRemarksQ: {
    en: 'What do "Scheduled" and "Last bus" mean?',
    'zh-Hant': '「預定班次」和「尾班車」是什麼意思？',
    'zh-Hans': '“预定班次”和“尾班车”是什么意思？',
  },
  // `RemarkTag` prints the operator's own wording verbatim for the active locale, and `classifyRemark`
  // matches on stems — so the quoted pair is a *family* of wordings ("Scheduled departure", 原定班次,
  // 未開出, 尾班車已開出) rather than two labels the app draws, and there is a third class, `info`, for
  // anything unmatched. The answer now says so, and the zh drafts quote the stems the classifier actually
  // matches rather than a phrasing the feeds rarely send.
  faqRemarksA: {
    en: 'They are notes from the operator, shown in its own words, so the exact wording varies. Anything about a schedule — "Scheduled", say — means the time is timetable-based, i.e. lower confidence than a live estimate; a last-bus note flags the final departure of the day. Other notes are passed through as the operator wrote them.',
    'zh-Hant':
      '這些是巴士公司的提示，按對方原文顯示，因此措辭並不固定。凡提到「原定」「預定」或「未開出」，即表示該時間根據時間表（準確度低於即時估算）；「尾班車」則標示當天最後一班車。其他提示會照原文顯示。',
    'zh-Hans':
      '这些是巴士公司的提示，按对方原文显示，因此措辞并不固定。凡提到“原定”“预定”或“未开出”，即表示该时间根据时间表（准确度低于实时估算）；“尾班车”则标示当天最后一班车。其他提示会照原文显示。',
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
  /**
   * Said once, under the map, when the route has no surveyed line and the drawn line is the stops
   * joined in order (ADR-152, `docs/proposals/06 §5`). The dashes carry the same meaning visually;
   * this is the half a rider can read. Deliberately says what it IS rather than what is missing —
   * "approximate" is a fact about the line, where "no route data" would be a fact about us.
   */
  routePathApproximate: {
    en: 'Approximate path — stops shown in order',
    'zh-Hant': '約略路線 — 依次顯示各站',
    'zh-Hans': '约略路线 — 依次显示各站',
  },
  /**
   * The map strip's accessible name on Route detail. A `<figure>` with no name is announced as an
   * unlabelled group, and its only child is a canvas — so without this the whole map is silent.
   */
  routePathLabel: {
    en: 'Route on a map',
    'zh-Hant': '路線地圖',
    'zh-Hans': '路线地图',
  },
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
  /**
   * Stop detail: two poles of one place that nothing in the data can tell apart (WP5-12, ADR-080).
   *
   * **What it claims, and it is the whole of what it claims:** there is more than one boarding point
   * here, they are closer together than the app's own direction floor, and we cannot say which is which.
   * All three are true. It is vaguer than the data, which ADR-008 permits — over-precision is what that
   * rule forbids — and it is the acceptance's own second branch: *"the app states plainly that there is
   * nothing to choose between."*
   *
   * **What it deliberately does not say.** No count, on `StopCardView.incomplete`'s reasoning (ADR-077):
   * a rider cannot act on the difference between two and three. No ordinal — `poleSideOctants` already
   * refuses "1 of 2", because a number manufactures a distinction between poles that are, on the ground,
   * one pole. No distance: `formatDistance` rounds to the nearest 10 m under ADR-008, so printing "3 m
   * apart" would assert precision the same repo refuses one function away. And not *"either stop will
   * do"* — that is advice we cannot support, since one may be a shelter and the other a flag.
   *
   * "Check the sign" is the one actionable thing left, and it is honest: the operator's own flag carries
   * a code that the app has just told the rider it does not have.
   */
  poleTooCloseToTell: {
    en: 'Another stop a few steps away — check the sign',
    'zh-Hant': '數步之內另有站柱 — 請看站牌',
    'zh-Hans': '数步之内另有站柱 — 请看站牌',
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
  /**
   * The accessible name of a bus token riding the route schematic, approaching `{stop}`.
   *
   * **The screen's signature graphic had no name at all until WP6-6.** `BusToken` is a disc with a
   * double-decker glyph in it and `pointerEvents: 'none'`, so a screen reader was told nothing about the
   * one element on the schematic that carries live information — and ADR-075 puts *"every element's role
   * and its label content"* squarely on the identity side of the invariant line. It surfaced from the spec
   * format rather than from the screen: a component spec's vocabulary is **text**, so the conformance
   * walker could not see the tokens, and the honest fix was to give them a name rather than to exempt them.
   *
   * It says *approaching*, not a distance and not a fraction of a segment: the token sits at the midpoint
   * of a segment because that is the only position the data supports (ADR-030 — a surveyed line exists
   * since ADR-151, but knowing the ROAD is not knowing where on it a bus is),
   * so a label claiming "halfway to X" would assert precision the pixel does not have (ADR-008).
   */
  busApproaching: {
    en: 'Bus approaching {stop}',
    'zh-Hant': '巴士即將到達{stop}',
    'zh-Hans': '巴士即将到达{stop}',
  },
  /**
   * …and the same token where the bus is **at** `{stop}` — a different fact and a different sentence.
   *
   * Two keys rather than one with a branch, because the two are not degrees of the same thing: a bus at a
   * stop is one a rider standing there can board, and a bus approaching one is not. It is also the label a
   * token on the *origin* node gets, which is the only token on the rail a rider can act on immediately.
   */
  /**
   * A stop's marker on the route map. `{stop}` is the stop's display name.
   *
   * The marker is a **graphic with no text**, so this is the whole of what a screen reader gets — and
   * without it the map is a row of unlabelled buttons, which is how `react-native-web` silently lost
   * six control states in WP6-7. Says "stop" rather than naming the shape: a rider cannot act on
   * "hexagon", and the shape's meaning (terminus, interchange) is carried by `routeStopTerminus` and
   * `routeStopInterchange` where it is true.
   */
  routeStopMarker: {
    en: 'Stop: {stop}',
    'zh-Hant': '車站：{stop}',
    'zh-Hans': '车站：{stop}',
  },
  /** Appended to a terminus marker's name — the end of the line, which a shape alone cannot say. */
  routeStopTerminus: {
    en: 'Terminus',
    'zh-Hant': '總站',
    'zh-Hans': '总站',
  },
  /** Appended to an interchange marker's name. `BBI` is the operators' own abbreviation. */
  routeStopInterchange: {
    en: 'Interchange',
    'zh-Hant': '轉乘站',
    'zh-Hans': '转乘站',
  },
  busAtStop: {
    en: 'Bus at {stop}',
    'zh-Hant': '巴士在{stop}',
    'zh-Hans': '巴士在{stop}',
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
