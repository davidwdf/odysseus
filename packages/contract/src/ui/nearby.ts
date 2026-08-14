import type { ComponentSpec } from '@nextbus/ui-spec'
import { FEED_NOTICE } from './feed-notice'

/**
 * **The first screen spec** (WP6-2) — Nearby: the stops around the rider, and the eight states it can be in.
 *
 * ## Why a screen needed two things a component did not
 *
 * `StopRow`'s spec (WP6-1) is a projection of one view model, and every one of its states is a field of
 * that model. A screen is not. Nearby's states are **branches over an async status** — no fix yet,
 * permission refused, a fix that is remembered rather than live, the first fetch in flight, the fetch
 * failed — and no view model carries any of that. So two things were added to the format (ADR-084):
 * a state may declare **its own projection** (`enforcement.shows`) and the driver is asked to put the
 * renderer into it; and a slot may **reference another component's spec** (`component`), so "this screen
 * is a list of these cards" is a checked claim rather than a comment. A slot added to `StopRow` turns up
 * in this screen's expected text with no edit here.
 *
 * ## `slots` is what every state shows; each state adds its own
 *
 * Only the title survives every branch. **The subtitle does not** — and that is the interesting part
 * rather than an inconvenience: the difference between the ordinary content state and the `stale` one *is*
 * the subtitle, because ADR-008's honesty rule applies to the rider's position and not only to the
 * arrival times. Declaring the subtitle per state is what makes "say so when the fix is remembered" an
 * assertion instead of a sentence.
 *
 * ## The branch order is identity, and both renderers already agree on it
 *
 * Location `undetermined` → `denied` → `error`, then `loading`, then the fetch's own failure, then the
 * list. That order is why a rider who has not been asked yet sees the prompt rather than an empty list,
 * and it is the same in `apps/mobile/app/(tabs)/index.tsx` and `apps/web/src/screens/Nearby.tsx`. The
 * spec declares the states; the conformance suites drive each one, which is what holds the order in place.
 */
export const NEARBY_SPEC: ComponentSpec = {
  component: 'Nearby',
  version: 1,
  doc: 'The stops around the rider — a list of StopRow, and the eight states around it.',
  viewModel: {
    module: 'stop-card',
    type: 'StopCardView[]',
    corpus: 'stop-card.spec.json',
    group: 'nearbyView',
  },

  // Everything else is per state, including the subtitle. See the note above.
  slots: [
    {
      name: 'title',
      text: { message: 'nearbyTitle' },
      invariant:
        'Present in every state, including the ones with nothing to list — a screen that has lost its heading has lost the rider’s place in the app.',
    },
  ],

  states: {
    /**
     * The ordinary state, and not one of the canonical five — a screen needs a name for "it worked".
     */
    content: {
      must: 'The stops in order, each rendered as a StopRow, under a subtitle naming the app.',
      mustNot:
        'A reordering of its own — the order is `nearbyView`’s and the wire promises no sequence.',
      enforcement: {
        shows: [
          { name: 'subtitle', text: { message: 'appName' } },
          FEED_NOTICE,
          {
            name: 'cards',
            each: 'cards',
            of: [{ name: 'card', component: 'StopRow' }],
            invariant:
              'One StopRow per place, in the kernel’s order, capped by the served `maxRows` inside each card rather than by this screen.',
          },
        ],
      },
    },

    loading: {
      must: 'The word "locating", and a skeleton in the shape of the list beneath it.',
      mustNot: 'A blank screen, or a spinner with no indication of what is being waited for.',
      why: 'Two waits share this state — the GPS fix and the first fetch — and a rider cannot tell them apart, so neither can the copy.',
      enforcement: {
        shows: [
          { name: 'subtitle', text: { message: 'appName' } },
          { name: 'locating', text: { message: 'locating' } },
        ],
      },
    },

    empty: {
      must: 'An explicit "no service" line.',
      mustNot:
        'A heading with nothing under it, which cannot be told from a screen that failed to load.',
      why: 'Genuinely nothing due within the radius — rare in Hong Kong, and it must not read as a bug.',
      enforcement: {
        shows: [
          { name: 'subtitle', text: { message: 'appName' } },
          FEED_NOTICE,
          { name: 'noService', text: { message: 'noService' } },
        ],
      },
    },

    failed: {
      must: 'The reason the list could not be fetched, verbatim.',
      mustNot:
        'An empty list, or a silent absence — the two states ADR-073 spent a wave separating.',
      why: 'Recovery is automatic rather than a control: the query’s `refetchInterval` fires **only** on error (ADR-079), which is what closed the permanently-dead screen a lost network race used to cause. So the state owes the rider an explanation, not a button.',
      enforcement: {
        shows: [
          { name: 'subtitle', text: { message: 'appName' } },
          {
            name: 'fetchError',
            text: { field: 'error' },
            invariant:
              'The error’s own message, not a catalogue string: it names which request failed, and inventing a friendlier sentence would discard the only diagnostic a rider could read out.',
          },
        ],
      },
    },

    stale: {
      must: 'The stops, under a subtitle saying the position is the last known one.',
      mustNot: 'The same subtitle as a live fix — a remembered position presented as current.',
      why: 'ADR-008’s honesty rule applies to the *position*, not only to the times. This is the state a cold start or a tunnel produces, and the only thing that distinguishes it on screen is that sentence.',
      enforcement: {
        shows: [
          { name: 'subtitle', text: { message: 'lastKnownLocation' } },
          FEED_NOTICE,
          { name: 'cards', each: 'cards', of: [{ name: 'card', component: 'StopRow' }] },
        ],
      },
    },

    offline: {
      must: 'The last known stops and readings, on the remembered position, under the line that says the rider’s own network is gone.',
      mustNot:
        'A blank list, a fresh-looking arrival time, or the *position*’s sentence standing in for the network’s. This screen is the one place both can be true at once, and they are two lines: the subtitle says where the list is anchored, the notice says when it was last fed.',
      why: 'ADR-058: a persisted query cache plus a remembered fix. What is restored is a *labelled old reading*, never a new one — each arrives with its original `observedAt`, so the ETA helpers age it. **This state was `unenforced` until ADR-150** on the ground that it was textually identical to `stale`; that was true, and it was a statement about the gap rather than the design — the screen had no sentence for *why* it had stopped being fed. Now it has one.',
      enforcement: {
        shows: [
          { name: 'subtitle', text: { message: 'lastKnownLocation' } },
          FEED_NOTICE,
          { name: 'cards', each: 'cards', of: [{ name: 'card', component: 'StopRow' }] },
        ],
      },
    },

    /** Location has not been asked for yet. Not one of the five, and the most common first launch. */
    undetermined: {
      must: 'What the app wants location for, and a control that asks for it.',
      mustNot: 'An empty list, or a prompt fired without the rider having asked for one.',
      why: 'The permission sequence is `createLocationController`’s and shared by both renderers (ADR-069): prompting unasked is the thing the `LocationProvider` port exists to prevent.',
      enforcement: {
        shows: [
          { name: 'subtitle', text: { message: 'appName' } },
          { name: 'primeTitle', text: { message: 'nearbyPrimeTitle' } },
          { name: 'primeBody', text: { message: 'nearbyPrimeBody' } },
          { name: 'enableLocation', text: { message: 'enableLocation' } },
        ],
      },
    },

    /** Location was refused. */
    denied: {
      must: 'That location is off, what that costs, and a way to try again.',
      mustNot:
        'Telling the rider they refused something they did not — a timeout is not an answer.',
      why: 'The port reports `canAskAgain: false` on the web, because a browser has no settings screen to deep-link and no second prompt; a native build offers "open Settings" instead of "retry" in exactly that case.',
      enforcement: {
        shows: [
          { name: 'subtitle', text: { message: 'appName' } },
          { name: 'locationDenied', text: { message: 'locationDenied' } },
          { name: 'locationDeniedHelp', text: { message: 'locationDeniedHelp' } },
          {
            name: 'retry',
            text: { message: 'retry' },
            invariant:
              'The **native** variant of this control reads `openSettings` when the OS will not prompt again, and neither suite can observe it: both run under `react-native-web` or the DOM, so `Platform.OS` is `web` in each. Declared here so the divergence is visible rather than discovered — the first suite that could assert it is WP6-9’s.',
          },
        ],
      },
    },

    /** The device has location switched on, and asking for a fix failed anyway. */
    locationError: {
      must: 'The reason the fix could not be obtained.',
      mustNot: 'Reading as a refusal — the rider may well have granted permission.',
      why: 'A timeout or a position-unavailable error is not a permission answer, which is why the adapter reports `undetermined` for it and this state exists separately from `denied`.',
      enforcement: {
        shows: [
          { name: 'subtitle', text: { message: 'appName' } },
          { name: 'locationErrorMessage', text: { field: 'error' } },
        ],
      },
    },
  },

  interactions: [
    { target: 'enableLocation', goes: 'the platform’s own permission prompt' },
    {
      target: 'retry',
      goes: 'a fresh permission request (or the platform settings app, on native)',
    },
    {
      target: 'cards',
      goes: 'StopRow’s own targets — place detail from the heading, route-at-this-stop from a row',
      note: 'Declared once, in StopRow’s spec. A screen that listed the same destinations again would be a second declaration of them.',
    },
  ],

  a11y: {
    role: 'list of list items, one per place',
    name: { fromSlot: 'title' },
    reducedMotion:
      'No entrance cascade for the list; the content is identical either way. The RN app staggers rows on the route screen and deliberately not here.',
  },

  idiom: [
    'material and elevation of the list surface, and the divider between rows',
    'the skeleton’s shape and whether it shimmers',
    'how a refresh is offered — **pull-to-refresh on native, nothing on the web**, and that asymmetry is deliberate: since WP5-7 the arrivals arrive by subscription at the served cadence, so a manual refresh is reassurance rather than the way a rider gets fresh data. The platform with a natural gesture for it offers it',
    'whether the heading collapses on scroll',
    'the icon on the enable-location control',
    'motion: the RN app cross-fades between tabs, the web app cuts',
  ],
}
