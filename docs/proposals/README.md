# Proposals — what to build next

> Derived from the [research](../research/README.md) (2026-06-09), plus later sourcing research:
>
> | Doc | What's in it |
> |---|---|
> | [00 — Fast & Fun Wins](./00-fast-and-fun-wins.md) | High impact / low effort, mostly on **data we already download**. Start here. |
> | [01 — Bigger Bets](./01-bigger-bets.md) | Larger, higher-ceiling work (map, alarms, offline, multimodal, widgets). |
> | [02 — Basemap & street imagery](./02-basemap-and-street-imagery.md) | Where map tiles and stop photos should come from — **HK Lands Department** vs Protomaps vs Google — with costs, licence terms and the bonus HK-gov APIs that come with it (2026-07-26). Includes two compliance fixes to make now. |
> | [03 — Clean separation, native readiness & Phase 2](./03-clean-separation-and-phase2-plan.md) | The **work plan** for segmenting the codebase behind generated contracts so hand-written iOS/Android clients can't diverge — plus launch blockers, mechanical boundary enforcement, and where Durable Objects + WebSockets slot in with a costed model (2026-07-26). **Waves 0–5 are done.** |
> | [04 — Platform-idiomatic renderers](./04-platform-idiomatic-renderers.md) | **Wave 6.** Web moves from Expo/`react-native-web` to **plain React**; iOS and Android become hand-written and platform-idiomatic; all three are held to **one executable spec**, so "no drift" becomes a test rather than three screenshots. Defines the spec format, the invariant/idiom line, and the screen-by-screen order — and is the agenda for a component-by-component walkthrough (2026-08-03, [ADR-075](../08-decision-log.md#adr-075--three-renderers-one-executable-spec-and-drift-defined-on-the-spec-rather-than-the-pixels)). |
> | [05 — Live times on a route nobody asks about](./05-live-times-on-a-route-nobody-asks-about.md) | **Proposal, not built.** Citybus and GMB publish no bulk route-eta feed, so a route screen shows no times at all while those operators' *per-pole* boards answer fine. Fan the route's poles out on the edge, deliver over the existing live socket, and give a route watch **its own Durable Object named for the route** so every rider on it shares one round. Measured — and re-measured after the first attempt was wrong by 5×: a 41-pole Citybus round is **~0.5 s** against a 45 s cadence, where a shared shard at its cap is 39 s. Every Cloudflare limit it quotes is checked against their docs (2026-08-10). Follows [ADR-114](../08-decision-log.md) and [ADR-115](../08-decision-log.md). |
## How these are scored
- **Impact** ⭐–⭐⭐⭐⭐⭐ — value to a daily rider / how visible.
- **Effort** S (hours) · M (a day or few) · L (a slice/sprint).
- **Data** — what it needs, and crucially whether we **already have it in hand** (the cheapest wins parse data we currently discard — see [research 03 §11](../research/03-app-feature-inventory.md)).
- **Fun** 🎉 — a delighter, not just utility (the user asked for *fun* wins too).

## The one-paragraph thesis
The single highest-leverage fact from the research: **we already fetch fares, frequency, and
journey-time daily and throw them away.** Several "wow" features are therefore **UI + a few lines
of parsing**, not new infrastructure. Pair those with the **missing basics** (search, freshness,
remarks) and a couple of **pure-delight** touches (clock toggle, split-flap on data change,
departure board), and the app jumps a tier without any new data source or native build.
