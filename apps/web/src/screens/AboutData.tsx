import { aboutView } from '@nextbus/core'
import { type PlainMessageKey, t } from '@nextbus/i18n'
import { ExternalLink } from 'lucide-react'
import { useLocale } from '../providers/LocaleProvider'
import { BackButton } from '../shell/BackButton'

/**
 * About the data, rendered by React DOM from the identical kernel function the RN screen uses (WP6-7).
 *
 * `packages/contract/ui/about-data.spec.json` declares what it must show in each of six states — and the
 * interesting one is `loading`, which is a **full projection**: the first frame of this page is the
 * finished page, and `test/about-data-states.test.tsx` proves it by rendering with no query client and no
 * `DataSource` in scope at all. If this screen ever grows a fetch, that driver stops working rather than
 * the assertion quietly weakening.
 *
 * **The links are real anchors, and that is the one place this renderer deliberately diverges.** The RN
 * screen hands off through `openExternal`, because a `Pressable` has no href to give; here the row *is* a
 * link, which is what the RN screen's own `accessibilityRole="link"` has always claimed. An anchor buys
 * middle-click, open-in-new-tab, copy-link-address, a screen reader's link list, and a visible target in
 * the status bar for a rider deciding whether to leave the app for a government portal — and
 * `rel="noopener noreferrer"` satisfies the one constraint `packages/ports`' `LinkOpener` calls
 * non-negotiable. `linkOpener` keeps its other consumers (the basemap credit, the map hand-off), so
 * `ls packages/ports/src` is still the honest porting checklist. The spec names the divergence in `idiom`.
 */
export function AboutData() {
  const locale = useLocale()
  const view = aboutView(locale, {
    text: (key) => t(locale, key as PlainMessageKey),
    // Substituted by vite's `define` from this package's own `version` — see `src/globals.d.ts` for why a
    // build-time global rather than a `VITE_*` env var.
    version: __APP_VERSION__,
  })

  return (
    <main className="min-h-dvh bg-bg px-0 pb-8">
      <BackButton />
      <header className="pushed-header flex items-center px-4 pb-1">
        <h1 className="m-0 min-w-0 flex-1 text-h2 font-bold text-text">{t(locale, 'aboutData')}</h1>
      </header>

      <p className="m-0 px-4 pb-2 pt-2 text-body text-muted">{view.intro}</p>

      <Section title={t(locale, 'aboutSourcesTitle')}>
        {view.sources.map((row) => (
          <LinkRow key={row.id} title={row.title} body={row.body} url={row.url} />
        ))}
      </Section>

      {/* One row per licence actually in force. Two since WP6-7: the basemap arrived a wave after ADR-038
          built this section for exactly one, under a different set of terms. */}
      <Section title={t(locale, 'aboutLicenceTitle')}>
        {view.licences.map((row) => (
          <LinkRow key={row.id} title={row.title} body={row.body} url={row.url} />
        ))}
      </Section>

      {/* Two text nodes, not one composed string — the kernel keeps the label and the number apart so a
          projection can pin their order rather than a renderer's spacing (ADR-092). */}
      <p className="m-0 px-4 pt-4 text-caption text-subtle">
        {view.version.label} {view.version.value}
      </p>
    </main>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="pt-6">
      <h2 className="mb-1 mt-0 px-4 text-label font-normal text-subtle">{title}</h2>
      {/* Rows separated by whitespace — no dividers, no cards, as on native. */}
      <div className="flex flex-col gap-1">{children}</div>
    </section>
  )
}

function LinkRow({ title, body, url }: { title: string; body: string; url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 rounded-xl px-4 py-2.5 no-underline hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-body font-semibold text-accent">{title}</span>
        <span className="text-body text-muted">{body}</span>
      </span>
      <ExternalLink aria-hidden width={18} height={18} className="shrink-0 text-accent" />
    </a>
  )
}
