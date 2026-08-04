// The component-spec format and its conformance walker (WP6-1, ADR-075 decision 3 / ADR-083).
//
// **This package carries no NextBus vocabulary** — no stop, no route, no ETA — and two mechanisms hold
// that line rather than one: `layers.json` gives the `uiSpec` layer `use: []`, so it cannot import the
// contract or the kernel, and `scripts/check-no-domain-vocabulary.mjs` scans the source *and* the emitted
// declarations for the words, because an import graph cannot see a type named after a bus. It is the
// first thing a second app would copy (ADR-075 decision 7), and it is deliberately **not** extracted into
// a shared home yet: the rule of two says extract when a second consumer actually needs it.
export * from './conform'
export * from './project'
export * from './schema'
