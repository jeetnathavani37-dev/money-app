# Business memory — James (the one lightning-bolt entry point)

This documents the rules behind "James" — `JamesButton` in the web app (the ⚡ FAB), and its
tool equivalents in `api/_lib/money-agent.js` for Telegram/WhatsApp — so anyone (human or AI)
working on this code later doesn't have to re-derive them. It's static documentation — the
app also keeps its own *runtime* memory (see "Runtime memory" below), which is different.

One box, six intents, all AI-classified from one free-text line:
- `b2b_order` — a new incoming supplier order (two-stage, see below)
- `sale_order` — a new client sale (profit now, cash sometimes later)
- `quick_entry` — a plain income/expense/waste with nothing else attached
- `cashout` — inventory bought now to resell later (mirrors "+ CASHOUT")
- `add_due` — a brand-new amount owed to/by someone, nothing paid yet (mirrors Dues tab's
  manual add)
- `settle_due` — money that just moved against something already pending

The common thread across the staged ones (`b2b_order`, `sale_order`'s due amount, `add_due`):
**a pending balance never moves cash or logs new income/expense on its own — only
`settle_due` / `confirm_order_landed` actually do that**, whenever the deferred amount is
finally confirmed. `quick_entry` and `cashout` have no staging; they're one-shot, matching the
manual forms they mirror.

## The conversation engine (web app)

`JamesButton` is a real back-and-forth, not a form. Turn 1 classifies intent only
(`startConversation`). Every turn after that — `advanceConversation` — sends Gemini the
**entire conversation so far** plus `JAMES_FIELD_FLOWS[intent]` (the field list + one-line
descriptions) and gets back `{ fields, nextQuestion, readyToSave }` in one call: the model
decides what's still missing and phrases the next question itself, matching the user's own
tone — there's no scripted question order or hand-rolled reply parsing. Once `readyToSave` is
true, the matching `doSave*` function (mirroring the manual flow it replaces) runs immediately
and posts its result back into the thread as James's final message. A failed save (e.g.
`settle_due` finding no matching pending entry) posts the reason and leaves the conversation
open rather than closing it, so the user can correct something and let the next reply retrigger
a save attempt.

Don't reintroduce a static review form here — that was the previous iteration and is exactly
what this conversational rebuild replaced, per explicit user feedback ("AI questions puche
mujhse" — the AI should ask *me* questions).

The bots (`api/_lib/money-agent.js`) never needed this change: Telegram/WhatsApp are already
real chat surfaces, and the system prompt already tells the agent to ask for whatever's
missing in plain text before calling a tool.

## The problem this solves

A B2B supplier order (e.g. "order aya sourcex se, prepaid hai") isn't fully costed the moment
it's placed — the cost price is usually known and often paid upfront, but the reship/landing
cost is only known and paid once the order actually lands. Forcing a single-shot form at order
time would mean guessing a number that's about to change. So the flow has two stages instead.

## Stage 1 — order placed

Entry points: `JamesButton` (web app, `src/App.jsx`) and the `log_b2b_order` tool
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

## Sale orders and settling receivables/payables

A client sale (`sale_order`) books its profit as income **immediately**, regardless of how
much cash is actually in hand — this mirrors the pre-existing "+ SOLD ORDER" quick action and
is deliberate: profit is accrual-style, cash is tracked separately. Whatever isn't received
right away becomes a `receivables` entry tagged `fromSoldOrder: true`.

That flag matters because of `settle_due`, the one function that actually moves money for a
pending receivable or payable (this also applies to a `log_b2b_order` order that eventually
lands unpaid, and to any plain receivable/payable added by hand in the Dues tab):

- **Receivable with `fromSoldOrder: true`** → the profit was already booked at sale time.
  Settling it only moves cash into an account; it must never log income again.
- **Receivable without that flag** (a plain "someone owes me money" entry, e.g. "Sourcex owes
  me 1 lakh") → nothing was pre-booked. Settling it **does** log income, in addition to
  moving cash.
- **Payables** never have anything pre-booked (no accrual-expense concept for payables
  anywhere in this app) → settling one **always** logs an expense.

`settle_due` matches an existing pending entry by a case-insensitive substring match on
`party` (checked both directions, so "Sourcex" matches a stored "Sourcex Pvt Ltd" and vice
versa) — never invents a new receivable/payable itself, and supports **partial** settlement:
whatever's left after the amount just paid/received stays `pending` with its `amount`
decremented; only a full payoff flips `status` to `"received"`/`"paid"`.

Before this feature, `DuesTab`'s plain "mark received/paid" checkbox toggle (`toggleStatus`
in `src/App.jsx`) only ever flipped `status` — it never moved money into an account or logged
income/expense. That toggle is unchanged and still has that limitation; `settle_due` (via the
⚡ button or the bots) is the path that actually moves money correctly.

## quick_entry and cashout

These two are deliberately unstaged one-shots — they mirror `VoiceLogButton.saveParsed` and
`QuickActionsBar`'s Cashout branch respectively, byte-for-byte in logic (same fund-delta math,
same fields). If either manual form's logic ever changes, check whether James's copy needs
the same change — there's no shared helper between them (matching this codebase's existing
pattern of small, duplicated inline logic across quick-add surfaces rather than a central
`addIncome`/`addExpense` utility).

## add_due

Creates a plain `receivables`/`payables` entry exactly like `DuesTab.addEntry` — `status:
"pending"`, nothing logged to income/expense/accounts. It exists so a brand-new due can be
recorded by typing a line instead of opening the Dues tab; `settle_due` is what later resolves
it, using the exact matching and money-movement rules described above.

## Runtime memory (distinct from this file)

`data.businessMemory` (a plain string field on the shared Supabase state) is the agent's own
*learned* notes — typical reship costs, recurring supplier quirks, margin patterns — appended
via the `remember` tool and injected into the system prompt on every request
(`buildSystemPrompt` in `api/_lib/money-agent.js`). It grows over time from real
conversations; this file does not update itself and is not read by the agent.
