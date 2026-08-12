// Every published component spec, in one array — the gallery's input and the coverage gate's subject.
//
// Written out rather than globbed on purpose: a `import.meta.glob` would make the list invisible to the
// typechecker and to a reader, and the point of the coverage test is that ADDING a spec without adding it
// here is a red build. A silent glob would quietly include a new spec and assert nothing about it.

import aboutData from '@nextbus/contract/ui/about-data.spec.json'
import faq from '@nextbus/contract/ui/faq.spec.json'
import favourites from '@nextbus/contract/ui/favourites.spec.json'
import nearby from '@nextbus/contract/ui/nearby.spec.json'
import placeDetail from '@nextbus/contract/ui/place-detail.spec.json'
import placeRow from '@nextbus/contract/ui/place-row.spec.json'
import routeDetail from '@nextbus/contract/ui/route-detail.spec.json'
import search from '@nextbus/contract/ui/search.spec.json'
import settings from '@nextbus/contract/ui/settings.spec.json'
import stopRow from '@nextbus/contract/ui/stop-row.spec.json'

export interface GallerySpec {
  component: string
  version: number
  doc: string
  slots: readonly unknown[]
  states: Record<string, unknown>
}

const specs = [
  stopRow,
  placeRow,
  nearby,
  placeDetail,
  routeDetail,
  favourites,
  search,
  settings,
  aboutData,
  faq,
] as unknown as GallerySpec[]

export default specs
