# Proposals — what to build next

> Derived from the [research](../research/README.md) (2026-06-09). Two docs:
>
> | Doc | What's in it |
> |---|---|
> | [00 — Fast & Fun Wins](./00-fast-and-fun-wins.md) | High impact / low effort, mostly on **data we already download**. Start here. |
> | [01 — Bigger Bets](./01-bigger-bets.md) | Larger, higher-ceiling work (map, alarms, offline, multimodal, widgets). |

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
