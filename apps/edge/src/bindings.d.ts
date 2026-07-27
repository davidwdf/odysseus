// The Worker's bindings, declared where every consumer already looks for them.
//
// `Cloudflare.Env` is the namespace `@cloudflare/workers-types` declares empty and `wrangler
// types` normally fills in from wrangler.toml. We write it by hand instead of generating it, for
// one reason worth stating: both bindings are **optional**. Without them the Worker falls back to
// building the static index in-request (`src/dataset.ts`), which is what keeps `pnpm dev:edge`
// working with no remote state — and `/v1/health`'s `datasetBuildsThisIsolate` is what stops that
// fallback quietly becoming production's behaviour again (WP0-1). A generated file would make the
// bindings required and take that away.
//
// Declaring it here also types the `env` that `cloudflare:test` hands a test, so what the specs
// seed and what the Worker reads cannot drift apart.
declare namespace Cloudflare {
  interface Env {
    /** Precomputed dataset shards, content-addressed by build hash (ADR-055). */
    DATASET?: KVNamespace
    /** Bulk build artefacts under `builds/<hash>/` — currently the search index. */
    BUILDS?: R2Bucket
  }
}
