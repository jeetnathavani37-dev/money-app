# Business memory — Smart Order / B2B supplier flow

This documents the rules behind the "Smart Order" feature so anyone (human or AI) working
on this code later doesn't have to re-derive them. It's static documentation — the app also
keeps its own *runtime* memory (see "Runtime memory" below), which is different.

## The problem this solves

A B2B supplier order (e.g. "order aya sourcex se, prepaid hai") isn't fully costed the moment
it's placed — the cost price is usually known and often paid upfront, but the reship/landing
cost is only known and paid once the order actually lands. Forcing a single-shot form at order
time would mean guessing a number that's about to change. So the flow has two stages instead.

## Stage 1 — order placed

Entry points: `SmartOrderButton` (web app, `src/App.jsx`) and the `log_b2b_order` tool
(Telegram/WhatsApp, `api/_lib/money-agent.js`) — both produce the identical `investments`
record shape below, so it doesn't matter which surface created an order; every later step
treats them the same.

- Ask for: costing (cost price), reship cost estimate, expected selling price. Expected
  selling price is **always asked**, never auto-filled from historical averages — this was an
  explicit product decision, not an oversight. Don't "improve" this by wiring in
  `computeAvgSaleValue`.
- `prepaid: true` → the costing amount is logged as a real expense immediately (category
  `Sourcing/Business`). The reship cost is **not** logged yet.
- `prepaid: false` → nothing is logged yet. Both amounts log together at Stage 2.
- Either way, a new `investments` entry is created:
  - `itemValue` = costing + reshipEstimate (the current best cost-basis guess)
  - `amount` = expected selling price
  - `expectedProfit` = amount − itemValue (shown as "potential profit")
  - `status` = `"pending_landing_prepaid"` or `"pending_landing_unpaid"`
  - `costing`, `reshipEstimate`, `actualReshipCost: null` kept as raw audit fields alongside
    `itemValue` (which is the one field everything downstream actually reads as "the cost")

## Stage 2 — order lands

Entry points: "Mark Landed" button in `InvestmentsTab` (web app) and the
`confirm_order_landed` tool (bots).

- If `prepaid`: log the reship expense only (category `Shipping/Logistics`).
- If not `prepaid`: log both the costing (`Sourcing/Business`) and reship
  (`Shipping/Logistics`) expenses now, since this is the first time either was paid.
- Recompute `actualLandedCost = costing + actualReshipCost`, overwrite `itemValue` with it,
  set `actualReshipCost`, recompute `expectedProfit` (now "actual profit"), and flip
  `status` to `"in_stock"` — **the same status the plain Cashout flow already uses** for
  "landed, awaiting sale."

That last point is the whole design: once landed, a smart order is indistinguishable from a
normal Cashout investment. `confirmMarkSold` (the eventual-sale finalizer) reads `itemValue`
as the cost basis and needs zero awareness that this record ever went through a landing
stage. Don't add a third status for "sold" — the existing `"sold"` status still applies.

`Sourcing/Business` and `Shipping/Logistics` are deliberately the two categories already in
`COGS_CATEGORIES` (`src/App.jsx`), so cost-of-goods reporting elsewhere keeps working without
changes.

## Supplier tagging

`supplier` is free text, never validated against a fixed list — "Sourcex" is just the example
the user gave first. If a different supplier name comes up, it's used as-is (`B2B <NAME>`,
falling back to `B2B ORDER` if none is given). Don't turn this into a rigid enum.

## Runtime memory (distinct from this file)

`data.businessMemory` (a plain string field on the shared Supabase state) is the agent's own
*learned* notes — typical reship costs, recurring supplier quirks, margin patterns — appended
via the `remember` tool and injected into the system prompt on every request
(`buildSystemPrompt` in `api/_lib/money-agent.js`). It grows over time from real
conversations; this file does not update itself and is not read by the agent.
