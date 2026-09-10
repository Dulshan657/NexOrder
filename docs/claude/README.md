# `docs/claude/` — the detail behind CLAUDE.md

`CLAUDE.md` is loaded into **every** Claude Code session, and the harness refuses it past
**150k chars**. On 2026-09-10 it reached 173k. Rather than delete prose that each records
a bug already paid for once, it was split:

- **`CLAUDE.md` keeps the rule that must hold even if nobody opens the doc** — the
  guardrails, the command reference, the lockdown table, the traps.
- **These files keep the argument behind each rule**, moved verbatim.

So a stub in `CLAUDE.md` naming a file here is not a summary you may act on alone. **Open
the doc before changing that subsystem.**

| File | Covers |
|---|---|
| [`warehouse-engine.md`](warehouse-engine.md) | The pure WIE modules, grid scale, layout publish/readiness, the setup checklist, level roles, replenishment, `?tab=` deep linking |
| [`warehouse-map.md`](warehouse-map.md) | Named areas, floor signs, zone binding, friendly location names, live area painting, location code sweeps |
| [`warehouse-stock-ops.md`](warehouse-stock-ops.md) | Stocktake by location, replenishment min/max, slotting rules & off-home, receiving, pallet break-down, putaway identity, pallet quantities |
| [`warehouse-scanning-labels.md`](warehouse-scanning-labels.md) | Scan identity, handling units, Code 128 label rendering, sizing and printer calibration |
| [`po-inbox.md`](po-inbox.md) | Inbound-PO email triage end to end, plus the Gmail / Google Cloud OAuth setup |
| [`environments.md`](environments.md) | Module flags, `NEXORDER_ENV`, what a tenant ships and what still leaks |
| [`server-lockdown.md`](server-lockdown.md) | Order cancellation, self-gating `verify_jwt = false` functions, storage buckets, per-function rate limits |
| [`overlays.md`](overlays.md) | `components/ui` modals and sheets, scroll containment, the z-index stack |
| [`auth-links.md`](auth-links.md) | The four auth-link shapes, invites, and the recovery-session marker |
| [`releasing.md`](releasing.md) | Why the release-tag gate refuses a tenant deploy |
| [`accessibility.md`](accessibility.md) | The three enforced a11y tiers, measured OKLCH contrast, the public surface, the derived demo roster |
| [`roadmap.md`](roadmap.md) | Pending work in full, and the "recently shipped" notes git history does not carry |

## House rules

1. **New deep detail goes here, not in `CLAUDE.md`.** Leave a one-line rule inline and a
   link. Run `npm run check:claude-md` after either.
2. **These are internal.** `site/` is published by construction and `docs/` is not — that
   separation is why `docs/claude/` lives under `docs/`. Never add a `site/manifest.mjs`
   entry for anything here.
3. **Edit the doc, not the stub**, unless the change is to the rule itself.
