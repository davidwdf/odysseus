import { faqView } from '@nextbus/core'
import { type PlainMessageKey, t } from '@nextbus/i18n'
import { ChevronDown } from 'lucide-react'
import { useId, useState } from 'react'
import { useLocale } from '../providers/LocaleProvider'
import { BackButton } from '../shell/BackButton'

/**
 * The FAQ, rendered by React DOM from the identical kernel function the RN screen uses (WP6-7).
 *
 * ## Why this is not a `<details>`, which is the DOM-idiomatic answer and is wrong here
 *
 * `<details>/<summary>` is what a browser gives you for a disclosure, and WP6-6c's fact sheets already
 * reach for `<dialog>` on exactly that reasoning. It cannot be used here, for two independent reasons that
 * both came out of writing the spec:
 *
 *  1. **A collapsed `<details>` still contains its answer.** Every conformance driver in this repo reads
 *     text with `createTreeWalker(host, NodeFilter.SHOW_TEXT)`, which consults the DOM and never CSS — so
 *     a closed `<details>`, a `hidden` node and a `display: none` node are all fully visible to it. The
 *     collapsed state would therefore project as seven questions *and seven answers*, diverging from the
 *     RN screen and, worse, making the state a rider actually arrives in unprojectable. It is the mirror
 *     of ADR-093's finding: there the walker could not see a graphic; here it sees what a rider cannot.
 *  2. **`<summary>` is not an interactive element** by the drivers' own selector
 *     (`button, a[href], [role="button"]`), so the whole page would report zero tap targets and the
 *     sibling-not-nested check would be looking at nothing.
 *
 * Both point the same way, and so does accessibility: a hidden answer is still read by a screen reader and
 * still found by a page search. So the row is a `<button aria-expanded>` with the answer rendered only when
 * open — and `faqView` models a collapsed answer as **absent rather than empty**, so the rule lives in the
 * kernel rather than in two renderers' habits.
 */
export function Faq() {
  const locale = useLocale()
  // Collapsed by default, and several may be open at once — `faqView`'s decision, not this component's:
  // seven independent questions rather than a wizard. A `Set` rather than an array so the toggle is a
  // membership change and not a `.filter` over what a rider sees.
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set())
  const view = faqView([...open], (key) => t(locale, key as PlainMessageKey))

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <main className="min-h-dvh bg-bg pb-8">
      <header className="flex items-center gap-3 px-4 pb-1 pt-4">
        <BackButton />
        <h1 className="m-0 min-w-0 flex-1 text-h2 font-bold text-text">
          {t(locale, 'settingsFaq')}
        </h1>
      </header>

      <div className="px-4 pt-2">
        {view.items.map((item) => (
          <FaqItem
            key={item.id}
            question={item.question}
            answer={item.answer}
            open={item.expanded}
            onToggle={() => toggle(item.id)}
          />
        ))}
      </div>
    </main>
  )
}

function FaqItem({
  question,
  answer,
  open,
  onToggle,
}: {
  question: string
  /** Present only when open — see the note at the top of this file. */
  answer?: string
  open: boolean
  onToggle: () => void
}) {
  const answerId = useId()
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={answerId}
        onClick={onToggle}
        className="flex w-full items-center gap-3 border-0 bg-transparent px-0 py-3.5 text-left text-body font-semibold text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
      >
        <span className="flex-1">{question}</span>
        {/* Chevron points down when collapsed, flips up when open. Idiom: the RN screen animates the
            layout on expand and this one does not — the web curve is chosen, not inherited (ADR-094). */}
        <ChevronDown
          aria-hidden
          width={20}
          height={20}
          className={`shrink-0 text-muted ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {answer === undefined ? null : (
        <p id={answerId} className="m-0 pb-4 text-body text-muted">
          {answer}
        </p>
      )}
    </div>
  )
}
