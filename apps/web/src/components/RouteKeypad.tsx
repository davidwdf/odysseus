import type { SearchKeypad } from '@nextbus/core'
import { t } from '@nextbus/i18n'
import { Delete } from 'lucide-react'
import type { ReactNode } from 'react'
import { useLocale } from '../providers/LocaleProvider'

/**
 * The smart route keypad — the DOM twin of `apps/mobile/components/RouteKeypad.tsx`.
 *
 * **It decides nothing at all** — not even which keys are live. `searchView.keypad` arrives with the ten
 * digits in keyboard order, each already carrying whether pressing it can lead anywhere, and only the letters
 * that continue the current prefix. So a key this draws as live and a row the list can reach are the same
 * question answered once (ADR-091), and a dimmed key is honest rather than decorative: it means no route
 * number in the rider's current filter continues this way. With the `Night` chip on and a `2` typed, the whole
 * pad is dark and the letter row is gone.
 *
 * Splitting the ten digits into two rows of five is the only decision left here, and it is layout.
 */
export function RouteKeypad({
  keypad,
  value,
  onChange,
}: {
  keypad: SearchKeypad
  /** The current prefix — what a key appends to, and what backspace removes from. */
  value: string
  onChange: (next: string) => void
}) {
  const locale = useLocale()
  const append = (ch: string) => onChange(value + ch)
  // Layout, and the only thing this file decides: two rows of five.
  const rows = [keypad.digits.slice(0, 5), keypad.digits.slice(5)]

  return (
    <div className="flex flex-col gap-2">
      {/* Letters — one horizontally scrollable row above the digits, filtered to the valid next letters.
          Edge-to-edge with a 16 px inset either side, which is this app's horizontal-scroll rule. */}
      {keypad.letters.length > 0 ? (
        <div className="flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {keypad.letters.map((letter) => (
            <button
              key={letter.char}
              type="button"
              aria-label={letter.char}
              onClick={() => append(letter.char)}
              className="min-w-[40px] shrink-0 rounded-lg border border-border bg-surface px-3 py-2 text-label font-bold text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus active:opacity-60"
            >
              {letter.char}
            </button>
          ))}
        </div>
      ) : null}

      {/* Digits in keyboard order (1–5 / 6–0), with backspace spanning both rows on the right. */}
      <div className="flex gap-2 px-4">
        <div className="flex flex-[5] flex-col gap-2">
          {rows.map((row) => (
            <div key={row[0]?.char} className="flex gap-2">
              {row.map((digit) => (
                <Key
                  key={digit.char}
                  enabled={digit.enabled}
                  onPress={() => append(digit.char)}
                  label={digit.char}
                >
                  <span className="text-h2 font-bold tabular-nums">{digit.char}</span>
                </Key>
              ))}
            </div>
          ))}
        </div>
        <Key
          tall
          enabled={keypad.backspace}
          onPress={() => onChange(value.slice(0, -1))}
          label={t(locale, 'keypadBackspace')}
        >
          <Delete aria-hidden width={22} height={22} />
        </Key>
      </div>
    </div>
  )
}

/**
 * One key. `enabled: false` renders it **present but inert** rather than hidden, which is the honest
 * treatment: a rider learns that this pad has ten digits and that six of them cannot continue their number,
 * where a shrinking grid would move the keys under their thumb between taps.
 */
function Key({
  enabled,
  onPress,
  label,
  tall,
  children,
}: {
  enabled: boolean
  onPress: () => void
  label: string
  tall?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={!enabled}
      onClick={onPress}
      className={`flex flex-1 items-center justify-center rounded-xl border border-border bg-surface ${
        tall ? 'min-h-[92px]' : 'min-h-[44px]'
      } ${enabled ? 'text-text active:opacity-60' : 'text-muted opacity-40'} focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus`}
    >
      {children}
    </button>
  )
}
