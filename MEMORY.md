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

**Current design (Nov 2026):** one model call per turn (`think()` in `JamesButton`) sees the whole
conversation, the real OPEN DUES and orders waiting to land, and re-decides the intent every turn —
the intent is no longer locked after the first message. `settle_due` is only valid for a party with
an open due; "X ko diya" with no open due is either `add_due` (receivable) or a `quick_entry`
expense, and James asks "Udhaar diya ya kharcha tha?" only when the words don't make it clear. A
failed save is fed back to the model once (`saveError`) so it re-thinks instead of repeating the
error. Optional fields (`scope`, `note`, `purpose`) are inferred and never block saving. The two
paragraphs below describe the earlier two-call version and are kept for history.

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

## Business vs personal scope (Biz tab)

Income/expense entries may carry `scope: "business" | "personal"`. Older entries have none, so
`entryIsBusiness()` in `src/App.jsx` falls back to the source/category: business income sources are
`Sourcex Payout`, `KicksMachine`, `Direct Client`, `Other Business`; business expense categories are
`Sourcing/Business`, `Shipping/Logistics`, `Packaging`, `Business Tools/Software` (waste is never business).
The Biz tab (`BusinessTab`) reads only business entries and its quick-add always writes `scope: "business"`.
The bots' `log_entry` tool takes an optional `scope` and normalises free-text labels onto the canonical
ones above (`normalizeBizLabel` in `api/_lib/money-agent.js`), so Telegram/WhatsApp entries group correctly.

## Global ALL / PERSONAL / BUSINESS view

`ScopeBar` (top of every tab) sets `scopeMode`. In a scoped mode the tabs receive `viewData` =
`scopeView(data, mode)` (income, expenses, receivables, payables, investments filtered by scope) and
`scopedPersist`, which runs `scopeMerge()` to put the hidden rows back before saving and stamps new
rows with the active scope. Never pass a filtered `data` together with the raw `persist` — that would
delete the hidden rows. `BusinessTab`, James, voice and the calculator always get the full data.
Fund balances, accounts, goals and net worth are shared and not split by scope.

## Sales tracker (`data.sales`) and per-mode tabs

`SalesTab` tracks every business sale as a record: `{ id, date, party, channel, item, saleValue, cost,
dueDate, payments: [{ id, date, amount, incomeId }], note }`. `channel` is one of `B2B`, `Reseller`,
`B2C`, `Client`. Balance, status (paid / partial / pending / overdue) and days overdue are always
derived (`saleBalance`, `saleStatus`), never stored.

Money rule: a sale by itself moves no money. Each payment (`applySalePayment`) creates a business
income entry linked by `saleId` and updates the fund split; `removeSalePayment` reverses both. Deleting a
sale keeps the income already received. Always go through `createSale` / `applySalePayment` — the Sales
tab and James share them.

James: `sale_order` now creates a sale record (replacing the old "profit now + receivable" booking),
`sale_payment` applies money to a buyer's oldest open sale, and `question` answers from the open sales /
dues / month numbers given in the prompt without logging anything. The old `+ SOLD ORDER` quick action
and the Telegram/WhatsApp `log_sale_order` tool still use the earlier profit-based booking.

Tabs per view (`NAV_BY_MODE`): PERSONAL and BUSINESS each have their own tab set; ALL shows every tab.
Sales are business-only (`SCOPED_KEYS.sales`).

## James never saves silently, and remembers (Nov 2026)

- **Confirm before save:** once every required field is known, `think()` sets `pending` and the UI shows
  a "YE SAVE KARU?" card built by `describe()` (deterministic, not model text) — nothing is written until
  the user taps confirm. Fields the model filled in without being told come back in `assumed` and are
  shown on the card. Typing instead of confirming is treated as a correction.
- **No assumed material facts:** the prompt forbids guessing the kind of transaction, amount, party,
  received-vs-due, udhaar-vs-kharcha, or business-vs-personal; it must ask one short question instead.
- **One brain, shared with the bots:** durable facts the user teaches go to `businessMemory` (the same
  notes the Telegram/WhatsApp agent reads and writes via `remember`). Every James save also appends to
  `jamesLog` (`{ date, said, did, intent }`, last 200), written in the same save via `jPersist`.
- **Context each turn (`buildBrain`)**: learned notes, people in the books, habits (label, scope, usual
  amount), recent James log, open sales/dues, monthly totals, accounts, funds, last 40 entries.
- **AI quota:** `api/_lib/gemini.js` falls back to other Gemini models when the main model's free-tier
  quota (20 requests/day) is exhausted. James shows a RETRY button when a call fails; nothing is saved.

## Per-entry settlement in Dues and Sales

Every due and every sale is its own entry and is settled on its own, fully or partly.
- Dues: `applyDueSettlement(data, kind, entryId, amt, date, account)` reduces that entry's `amount`
  (always the outstanding balance), keeps the original in `total`, appends to `payments`
  (`{ id, date, amount, ledgerId, ledgerKind }`) and writes the linked ledger row (`dueId`): income
  for a receivable, expense for a payable, with scope from the due's `purpose`. `removeDuePayment`
  undoes one payment. The tick still marks an entry done/reopened without logging money, and is only
  offered while the entry has no payments.
- The party card shows open/total entries and settled-of-original; "ENTRIES ME BAANTO" opens
  `AllocEditor`, which splits one amount across that party's open entries (oldest first, editable).
- Sales has the same party-wise view (default) plus the flat list; split payments go through
  `applySalePayment` per sale. James's `settle_due` uses `applyDueSettlement`, rolling over a party's
  entries oldest first. Use `nextId()` for rows created in the same tick.

## Sign-in and data safety (Nov 2026)

- The web app can sign in with Supabase Auth (the same owner account as the Luxella portal):
  `signInOwner`, session in `localStorage.money_auth`, `sbHeaders()` adds the user's token to every
  request and refreshes it. Owner-only RLS policies exist (`lx_is_owner()`); the old anon policies are
  still in place until the owner has signed in on his devices and the bots have a server-side key.
- The app never starts from empty data any more: if the row cannot be loaded it shows `AuthScreen`
  (login / no access / retry) instead, because saving empty data would overwrite the real books.
- `khata_touch_auth()` records that a signed-in device loaded successfully (`khata_auth_log`).

## Business features built around how Luxella actually works

- **Deal tab** (`DealTab`, `computeDeal`): landed cost and margin for a sourcing deal/bid —
  store price $ → coupon → sales tax → ₹/$ → reshipper bill (per-kg rate, minimum and rounding per
  reshipper, with a "shared box" switch that drops minimum/rounding) → India courier. Shows the lowest
  price for the minimum and good margins (profit ÷ landed cost, rounded up to ₹100), a verdict, and
  flags margins above 60% as worth re-checking. "SALE BANAO" creates the sale (cost = landed) and can
  optionally log the item cost as an expense and the reship bill as a payable to the reshipper.
  Rates live in `data.bizSettings` (defaults in `DEFAULT_BIZ_SETTINGS`), editable under "MERE RATES".
- **Sales**: advance chips (0 / 50% / 100%) with the usual terms shown per buyer type (`SALE_TERMS`,
  `SALE_TERM_HINT` — suggestions only), a REMINDER button that copies a Luxella-voiced payment
  reminder, and per-party pay speed (average days to clear) and profit.
- **Biz tab cash-flow**: open business sales/receivables bucketed by when they are due (overdue, this
  week, next week, later, no date) against business payables.
