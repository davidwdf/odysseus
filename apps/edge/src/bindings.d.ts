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
    /**
     * The `/v1/live` shards (WP5-3). **Optional for the same reason the two above are**: a Worker with
     * no Durable Object binding must still run, or `pnpm dev:edge` stops working for anyone who has not
     * provisioned one. Absent, `/v1/live` answers with the taxonomy and every client keeps working on
     * the poll transport, which is the default engine — ADR-055's degrade-to-slow promise, one
     * capability over.
     *
     * Generic in the class so the stub is typed: `env.ETA_HUB.getByName(name)` gives a
     * `DurableObjectStub<EtaHub>`, which is also what makes `runInDurableObject` type its callback in
     * the specs. The import is type-only and therefore erases, so this declaration adds nothing to the
     * bundle.
     */
    ETA_HUB?: DurableObjectNamespace<import('./eta-hub').EtaHub>
    /**
     * Comma-separated browser origins allowed to open `/v1/live`, or unset for no filtering at all.
     *
     * A `[vars]` entry rather than a constant because there is no production origin to name until WP0-5
     * creates one, and hard-coding a domain we do not own would be claiming a deployment that does not
     * exist. Read `originAllowed` in `src/live.ts` before setting it: a WebSocket upgrade does not
     * honour CORS, a missing `Origin` is always allowed because that is what every native client sends,
     * and this is therefore an advisory anti-CSWSH measure for browsers and **never** authorisation.
     */
    LIVE_ALLOWED_ORIGINS?: string
  }
}
