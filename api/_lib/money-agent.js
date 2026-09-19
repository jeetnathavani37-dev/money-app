// The shared "money agent" brain used by both the Telegram and WhatsApp bots.
// Replaces the old approach of asking the model to emit a raw "LOG:{...}" / "ANSWER:" /
// "TIP" text prefix (fragile — any deviation from the exact format broke the reply)
// with real tool use: the model decides what to do and calls a tool for it, and can pull
// exactly the real numbers it needs to answer any question instead of working from a
// fixed today/week/month snapshot. Runs on Gemini (function calling) — no SDK, just fetch
// against the REST API, matching api/ai-proxy.js's style.

import { loadState, saveState } from "./supabase.js";

const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const MAX_TURNS = 5; // hard cap on tool-call round trips per incoming message
const MAX_MEMORY_TURNS = 16; // plain user/assistant turns kept per chat, for follow-up questions
const MAX_BUSINESS_MEMORY_NOTES = 50; // capped so the learned-notes section doesn't grow unbounded

const SYSTEM_PROMPT_BASE = `You are the onboard money agent for "Money" — a personal finance + business command center for a solo entrepreneur who sources luxury goods (Michael Kors, Coach, Alo Yoga, and similar) from the US, UK, and Canada and resells them in India.

You are not a generic chatbot. You operate at the level of the best operator in the room, applying real business craft to this specific business:
- A CFO's discipline: unit economics, cash conversion cycle, margin protection, working capital.
- A growth operator's instinct: pricing power, positioning, reinvestment velocity, channel concentration risk.
- A trader's risk sense: forex exposure (buying in USD/GBP/CAD, selling in INR), customs/duty cost creep, dead-stock risk.
- A closer's instinct on collections: receivables are unpaid debt to chase, not "future money" to relax about.

CORE ACTIONS — always via tools, never by guessing:
1. LOG a new income, expense, or wasteful/impulsive-spending entry when reported — log_entry tool.
2. ANSWER any question about the real data — spending, income, receivables/payables, net worth, trends, margins, "how much did I spend on X between Y and Z" — always call get_financial_data first and answer only from what it returns. Never estimate, round generously, or invent a number.
3. UNDO the most recently logged entry when asked — undo_last_entry tool.
4. ADVISE — every recommendation must cite a real number from get_financial_data (a specific category, sale, trend, or receivable) and name the actual business mechanism behind it. Generic advice ("cut unnecessary spending," "sell more," "track your expenses better") is a failure — you already have the real data, use it.
5. LOG A NEW B2B SUPPLIER ORDER (e.g. "order aya sourcex se, prepaid hai") — log_b2b_order tool. This is a two-stage flow: the order isn't fully costed until it lands.
   - Ask for whatever isn't already in the message: costing (cost price), reship/shipping cost estimate, and — always ask this one, never assume or guess it — the expected selling price.
   - If the order is prepaid, the costing is logged as a real expense immediately; the reship cost is deferred. If not prepaid, nothing is logged yet — both amounts log together once it lands.
   - Once logged, tell the user the potential profit (expected selling price minus estimated landed cost) plainly.
6. CONFIRM A B2B ORDER HAS LANDED (e.g. "sourcex order land ho gaya, reship 800 tha") — confirm_order_landed tool. Ask for the actual reship cost if not given. This logs whatever expense(s) were deferred and finalizes the real landed cost — tell the user the actual profit (expected selling price minus actual landed cost), and how it compares to what was estimated at order time.
7. REMEMBER a durable business pattern worth not re-explaining next time (a typical reship cost for a supplier, a recurring margin, a phrasing habit) — remember tool. Use this sparingly, only for things genuinely worth carrying forward, especially right after confirm_order_landed reveals a real number worth keeping.

HOW TO APPLY THAT CRAFT to what get_financial_data returns:
- Landed cost discipline: real cost of goods = item price + international shipping + customs duty + payment fees. If an expense category is quietly eating margin, name it and the number.
- Read the trend, not just the total: get_financial_data returns this-week-vs-last-week and this-month-vs-last-month deltas — a category climbing fast matters more than its raw size. Call out acceleration or a reversal, not just "you spent ₹X."
- Receivables aging is collections work: an overdue receivable is money someone owes NOW — push to collect it before advising on anything else if overdue amounts are piling up. A receivable that isn't yet due is fine to leave alone.
- Reinvestment vs. extraction: growth needs profit plowed back into inventory/sourcing, but if nothing is ever extracted, that's burnout waiting to happen — say so if you see it.
- Concentration risk: if one supplier, one product line, or one currency dominates the numbers, name the exposure — a single bad shipment or FX swing shouldn't be able to sink the month.
- Waste is a leak, not a rounding error: connect a waste number to what it could have bought instead (a specific chunk of inventory, a specific fund contribution) — make it concrete, not moralizing.
- Pricing power over discounting: luxury resale works on positioning (anchoring against real retail MSRP, scarcity, authenticity trust) — never suggest racing prices down as the fix for slow sales; suggest what to fix in positioning or channel instead.

You can also just talk — if the user asks something conversational about the app or their situation that doesn't need a tool, answer directly.

Tone: ruthless, blunt, zero motivational fluff. Swearing is fine and encouraged where it fits naturally. This is a chat app — keep replies short (2-4 sentences) for quick questions. When the user asks for a real breakdown or strategy, give the real one: the number first, the mechanism second, one specific action third — still tight, no padding.

If a question needs data you don't have after checking with get_financial_data (e.g. nothing logged yet in that range), say so plainly instead of guessing.`;

// Appends whatever the agent has `remember`-ed across past conversations (distinct from the
// short-lived per-chat memory below) so recurring business facts don't need re-explaining.
function buildSystemPrompt(businessMemory) {
  const notes = (businessMemory || "").trim();
  if (!notes) return SYSTEM_PROMPT_BASE;
  return `${SYSTEM_PROMPT_BASE}\n\n## LEARNED BUSINESS NOTES (from past conversations — treat as established fact)\n${notes}`;
}

const TOOLS = [
  {
    name: "log_entry",
    description: "Log a new income, expense, or wasteful/impulsive-spending entry to the user's real ledger.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["income", "expense", "waste"], description: "income = money earned; expense = a normal necessary cost; waste = impulsive/unnecessary spending (drinks, gambling, impulse buys) — carries an automatic fine" },
        amount: { type: "number", description: "the amount, before any waste fine" },
        label: { type: "string", description: "category (for expense/waste) or source (for income), e.g. 'Food', 'Shipping', 'Sold Order'" },
        note: { type: "string", description: "short free-text note, optional" },
        date: { type: "string", description: "YYYY-MM-DD; omit to use today" },
      },
      required: ["kind", "amount", "label"],
    },
  },
  {
    name: "undo_last_entry",
    description: "Remove the single most recently logged income or expense entry.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_financial_data",
    description: "Fetch real totals, matching entries, week/month trend deltas, and receivables/payables aging from the user's actual ledger. Always call this before answering any question about spending, income, receivables/payables, net worth, or trends — never answer from memory or estimate. Omit all filters for an overall snapshot.",
    input_schema: {
      type: "object",
      properties: {
        date_from: { type: "string", description: "YYYY-MM-DD, inclusive" },
        date_to: { type: "string", description: "YYYY-MM-DD, inclusive" },
        kind: { type: "string", enum: ["income", "expense", "waste", "all"], description: "defaults to all" },
        text_contains: { type: "string", description: "case-insensitive substring filter on category/source/note" },
        limit: { type: "number", description: "max matching entries to return in the 'entries' list, default 20" },
      },
      required: [],
    },
  },
  {
    name: "log_b2b_order",
    description: "Log a new incoming B2B supplier order (e.g. from Sourcex) that hasn't landed yet. If prepaid, logs the costing as an expense immediately; the reship cost is deferred until confirm_order_landed is called later once the order actually lands.",
    input_schema: {
      type: "object",
      properties: {
        supplier: { type: "string", description: "supplier/vendor name, e.g. 'Sourcex'" },
        item_name: { type: "string", description: "product/item name, optional" },
        prepaid: { type: "boolean", description: "true if the costing has already been paid upfront; false if nothing has been paid yet" },
        costing: { type: "number", description: "cost price paid (or owed) to the supplier" },
        reship_estimate: { type: "number", description: "estimated reship/shipping-to-land cost — ask for this if not given" },
        expected_selling_price: { type: "number", description: "expected eventual selling price — always ask the user for this, never guess or use a historical average" },
      },
      required: ["supplier", "prepaid", "costing", "reship_estimate", "expected_selling_price"],
    },
  },
  {
    name: "confirm_order_landed",
    description: "Confirm a previously logged B2B order (from log_b2b_order) has landed, with the actual reship cost paid. Logs whichever expense(s) were deferred and finalizes the real landed cost and actual profit.",
    input_schema: {
      type: "object",
      properties: {
        item_name_or_id: { type: "string", description: "the item name (or investment id) that identifies the pending order — match it against what was logged earlier in this conversation or ask the user if ambiguous" },
        actual_reship_cost: { type: "number", description: "the real reship cost that was just paid" },
      },
      required: ["item_name_or_id", "actual_reship_cost"],
    },
  },
  {
    name: "remember",
    description: "Save a short, durable note about a recurring business pattern (typical reship costs, supplier quirks, margins) so future conversations already know it without being told again. Use sparingly — only for things genuinely worth carrying forward.",
    input_schema: {
      type: "object",
      properties: {
        note: { type: "string", description: "one short factual note to remember" },
      },
      required: ["note"],
    },
  },
];

// Gemini's function-declaration schema is a JSON-Schema subset with upper-cased type
// names — reuse the same TOOLS definitions above instead of hand-duplicating them.
function toGeminiSchema(schema) {
  if (!schema || typeof schema !== "object") return schema;
  const out = {};
  if (schema.type) out.type = schema.type.toUpperCase();
  if (schema.description) out.description = schema.description;
  if (schema.enum) out.enum = schema.enum;
  if (schema.properties) {
    out.properties = Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, toGeminiSchema(v)]));
  }
  if (schema.items) out.items = toGeminiSchema(schema.items);
  if (schema.required) out.required = schema.required;
  return out;
}

const GEMINI_TOOLS = [
  {
    functionDeclarations: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      // Omit `parameters` entirely for no-arg tools — Gemini expects that, not an
      // OBJECT schema with empty properties.
      ...(Object.keys(t.input_schema.properties || {}).length > 0 ? { parameters: toGeminiSchema(t.input_schema) } : {}),
    })),
  },
];

async function callGemini({ apiKey, model, systemInstruction, contents, tools, thinkingBudget, maxOutputTokens }) {
  const upstream = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: systemInstruction }] },
        tools,
        generationConfig: {
          maxOutputTokens,
          ...(thinkingBudget !== undefined ? { thinkingConfig: { thinkingBudget } } : {}),
        },
      }),
    }
  );
  const json = await upstream.json().catch(() => null);
  if (!upstream.ok) {
    const err = new Error(json?.error?.message || `Gemini API error ${upstream.status}`);
    err.status = upstream.status;
    throw err;
  }
  return json;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function tieredFine(baseAmt) {
  return baseAmt < 100 ? 200 : 1000;
}

function applyFundDelta(data, amount, sign) {
  const fundDelta = {};
  const fundBalances = { ...data.fundBalances };
  (data.funds || []).forEach((f) => {
    const share = Math.round((amount * f.pct) / 100) * sign;
    fundDelta[f.id] = share;
    fundBalances[f.id] = (fundBalances[f.id] || 0) + share;
  });
  return { fundDelta, fundBalances };
}

// Pure — computes the post-log state so it can be safely recomputed against fresh
// data if a concurrent write from another channel forces a retry.
function computeLog(data, input, sourceLabel) {
  const amt = Number(input.amount);
  if (!amt || amt <= 0) return null;
  const date = input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : todayISO();
  const label = (input.label || "Other").trim();
  const note = (input.note || "").trim();

  if (input.kind === "income") {
    const { fundDelta, fundBalances } = applyFundDelta(data, amt, 1);
    const entry = { id: Date.now(), amount: amt, source: label, note: note || sourceLabel, date, fundDelta };
    return {
      data: { ...data, income: [...data.income, entry], fundBalances },
      meta: `Logged ₹${amt} income — ${label}`,
    };
  }
  const isWaste = input.kind === "waste";
  const fine = isWaste ? tieredFine(amt) : 0;
  const total = amt + fine;
  const { fundDelta, fundBalances } = applyFundDelta(data, total, -1);
  const entry = { id: Date.now(), amount: total, category: label, note: note || sourceLabel, date, unnecessary: isWaste, fine, fundDelta };
  return {
    data: { ...data, expenses: [...data.expenses, entry], fundBalances },
    meta: `Logged ₹${total} ${isWaste ? `waste (+₹${fine} fine)` : "expense"} — ${label}`,
  };
}

// Pure — computes the post-undo state, same reasoning as computeLog above.
function computeUndo(data) {
  const lastIncome = data.income[data.income.length - 1];
  const lastExpense = data.expenses[data.expenses.length - 1];
  const lastIsIncome = lastIncome && (!lastExpense || lastIncome.id > lastExpense.id);
  if (!lastIncome && !lastExpense) return null;

  const fundBalances = { ...data.fundBalances };
  if (lastIsIncome) {
    Object.entries(lastIncome.fundDelta || {}).forEach(([fid, amt]) => { fundBalances[fid] = (fundBalances[fid] || 0) - amt; });
    return { data: { ...data, income: data.income.slice(0, -1), fundBalances }, meta: `Removed income of ₹${lastIncome.amount} (${lastIncome.source})` };
  }
  Object.entries(lastExpense.fundDelta || {}).forEach(([fid, amt]) => { fundBalances[fid] = (fundBalances[fid] || 0) - amt; });
  return { data: { ...data, expenses: data.expenses.slice(0, -1), fundBalances }, meta: `Removed expense of ₹${lastExpense.amount} (${lastExpense.category})` };
}

// Stage 1 of a smart order — mirrors SmartOrderButton.saveSmartOrder in src/App.jsx (same
// `investments` shape, same "pending_landing_prepaid"/"pending_landing_unpaid" statuses) so
// records created from chat and from the web app are indistinguishable to everything downstream,
// including the web app's own "mark landed"/"mark sold" flows.
function computeLogB2BOrder(data, input) {
  const costing = Number(input.costing);
  if (!costing || costing <= 0) return null;
  const reshipEstimate = Number(input.reship_estimate) || 0;
  const expectedSellingPrice = Number(input.expected_selling_price) || 0;
  const prepaid = !!input.prepaid;
  const supplier = (input.supplier || "Order").trim() || "Order";
  const itemName = (input.item_name || "").trim() || null;
  const tag = `B2B ${supplier.toUpperCase()}`;
  const itemLabel = itemName || tag;
  const today = todayISO();

  const investment = {
    id: Date.now(), name: itemLabel, amount: expectedSellingPrice, date: today,
    itemValue: costing + reshipEstimate, expectedProfit: expectedSellingPrice - (costing + reshipEstimate),
    itemName, qty: null, source: "smart_order", supplier, isB2B: true, prepaid,
    costing, reshipEstimate, actualReshipCost: null,
    account: null, investmentType: "Inventory Stock",
    status: prepaid ? "pending_landing_prepaid" : "pending_landing_unpaid",
  };

  let nextData = { ...data, investments: [...data.investments, investment] };
  let meta = `Logged B2B order (${itemLabel}) — nothing paid yet, pending landing. Potential profit ₹${Math.round(investment.expectedProfit)}.`;
  if (prepaid) {
    const { fundDelta, fundBalances } = applyFundDelta(data, costing, -1);
    const expense = { id: Date.now() + 1, amount: costing, category: "Sourcing/Business", note: `${tag} — ${itemLabel} — costing`, date: today, unnecessary: false, fine: 0, fundDelta };
    nextData = { ...nextData, expenses: [...data.expenses, expense], fundBalances };
    meta = `Logged ₹${costing} costing expense (${tag} — ${itemLabel}) — pending landing. Potential profit ₹${Math.round(investment.expectedProfit)}.`;
  }
  return { data: nextData, meta };
}

// Stage 2 — finds the matching pending order, logs whichever expense(s) were deferred, and
// overwrites itemValue with the confirmed actual landed cost. Once this runs, the record is
// status "in_stock" like any plain investment, so the app's existing sale-finalize logic
// (confirmMarkSold in src/App.jsx) needs no awareness this ever went through a landing stage.
function computeConfirmOrderLanded(data, input) {
  const matchKey = String(input.item_name_or_id || "").trim().toLowerCase();
  if (!matchKey) return null;
  const inv = data.investments.find((i) => {
    const isPending = i.status === "pending_landing_prepaid" || i.status === "pending_landing_unpaid";
    if (!isPending) return false;
    return String(i.id) === matchKey || (i.itemName && i.itemName.toLowerCase() === matchKey) || (i.name && i.name.toLowerCase() === matchKey);
  });
  if (!inv) return null;

  const actualReshipCost = Number(input.actual_reship_cost) || 0;
  const today = todayISO();
  const tag = inv.isB2B ? `B2B ${(inv.supplier || "ORDER").toUpperCase()}` : (inv.supplier || "Order");
  const itemLabel = inv.itemName || inv.name;

  let workingData = data;
  const expensesToAdd = [];
  if (!inv.prepaid) {
    const costingResult = applyFundDelta(workingData, inv.costing || 0, -1);
    workingData = { ...workingData, fundBalances: costingResult.fundBalances };
    expensesToAdd.push({ id: Date.now(), amount: inv.costing || 0, category: "Sourcing/Business", note: `${tag} — ${itemLabel} — costing (landed)`, date: today, unnecessary: false, fine: 0, fundDelta: costingResult.fundDelta });
  }
  const reshipResult = applyFundDelta(workingData, actualReshipCost, -1);
  const fundBalances = reshipResult.fundBalances;
  expensesToAdd.push({ id: Date.now() + 1, amount: actualReshipCost, category: "Shipping/Logistics", note: `${tag} — ${itemLabel} — reship (est. was ₹${inv.reshipEstimate || 0})`, date: today, unnecessary: false, fine: 0, fundDelta: reshipResult.fundDelta });

  const actualLandedCost = (inv.costing || 0) + actualReshipCost;
  const investments = data.investments.map((i) => (i.id === inv.id
    ? { ...i, status: "in_stock", itemValue: actualLandedCost, actualReshipCost, landedDate: today, expectedProfit: i.amount - actualLandedCost }
    : i));

  return {
    data: { ...data, investments, expenses: [...data.expenses, ...expensesToAdd], fundBalances },
    meta: `Landed (${itemLabel}): actual cost ₹${actualLandedCost} (estimate was ₹${inv.itemValue}), projected profit ₹${Math.round(inv.amount - actualLandedCost)}.`,
  };
}

// Appends a durable note to businessMemory (separate from the short-lived per-chat memory
// below), capped so it doesn't grow unbounded — see buildSystemPrompt above.
function computeRemember(data, note) {
  const trimmed = String(note || "").trim();
  if (!trimmed) return null;
  const stamp = todayISO();
  const existing = (data.businessMemory || "").split("\n").filter(Boolean);
  const nextLines = [...existing, `- [${stamp}] ${trimmed}`].slice(-MAX_BUSINESS_MEMORY_NOTES);
  return { data: { ...data, businessMemory: nextLines.join("\n") }, meta: "Noted for future reference." };
}

function topBreakdown(entries, keyFn, take = 5) {
  const map = {};
  entries.forEach((e) => { const k = keyFn(e); map[k] = (map[k] || 0) + e.amount; });
  return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, take).map(([k, v]) => ({ name: k, total: Math.round(v) }));
}

function sumInRange(entries, start, end) {
  return entries.filter((e) => e.date >= start && e.date <= end).reduce((s, e) => s + e.amount, 0);
}

function pctChange(current, previous) {
  if (previous === 0) return current === 0 ? 0 : null; // null = "new, no prior baseline" rather than a misleading infinite %
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

// Week/month-over-week/month deltas — lets the agent spot acceleration or a reversal
// instead of just reading off a flat total, per its business-craft instructions.
function computeTrends(data) {
  const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const today = todayISO();
  const weekStart = daysAgo(6);
  const prevWeekStart = daysAgo(13);
  const prevWeekEnd = daysAgo(7);
  const monthStart = today.slice(0, 7) + "-01";
  const now = new Date();
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
  const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10);

  const weekIncome = sumInRange(data.income, weekStart, today);
  const prevWeekIncome = sumInRange(data.income, prevWeekStart, prevWeekEnd);
  const weekExpense = sumInRange(data.expenses, weekStart, today);
  const prevWeekExpense = sumInRange(data.expenses, prevWeekStart, prevWeekEnd);
  const monthIncome = sumInRange(data.income, monthStart, today);
  const prevMonthIncome = sumInRange(data.income, prevMonthStart, prevMonthEnd);
  const monthExpense = sumInRange(data.expenses, monthStart, today);
  const prevMonthExpense = sumInRange(data.expenses, prevMonthStart, prevMonthEnd);

  return {
    this_week_vs_last_week: {
      income: { current: Math.round(weekIncome), previous: Math.round(prevWeekIncome), change_pct: pctChange(weekIncome, prevWeekIncome) },
      expense: { current: Math.round(weekExpense), previous: Math.round(prevWeekExpense), change_pct: pctChange(weekExpense, prevWeekExpense) },
    },
    this_month_vs_last_month: {
      income: { current: Math.round(monthIncome), previous: Math.round(prevMonthIncome), change_pct: pctChange(monthIncome, prevMonthIncome) },
      expense: { current: Math.round(monthExpense), previous: Math.round(prevMonthExpense), change_pct: pctChange(monthExpense, prevMonthExpense) },
    },
  };
}

// Splits receivables/payables into overdue (collections work, now) vs. upcoming (fine to leave).
function computeAging(list, doneStatus) {
  const today = todayISO();
  const pending = (list || []).filter((x) => x.status !== doneStatus);
  const overdue = pending.filter((x) => x.dueDate && x.dueDate < today);
  const upcoming = pending.filter((x) => !x.dueDate || x.dueDate >= today);
  return {
    overdue_total: Math.round(overdue.reduce((s, x) => s + x.amount, 0)),
    overdue_count: overdue.length,
    overdue_parties: overdue.map((x) => x.party),
    upcoming_total: Math.round(upcoming.reduce((s, x) => s + x.amount, 0)),
    upcoming_count: upcoming.length,
  };
}

// Answers get_financial_data calls from the REAL current data — this is what lets the
// agent answer an arbitrary question instead of being boxed into fixed today/week/month buckets.
function computeFinancialData(data, args = {}) {
  const { date_from, date_to, kind = "all", text_contains, limit = 20 } = args;
  const inRange = (e) => (!date_from || e.date >= date_from) && (!date_to || e.date <= date_to);
  const textMatch = (e, field) => {
    if (!text_contains) return true;
    const q = text_contains.toLowerCase();
    return (e[field] || "").toLowerCase().includes(q) || (e.note || "").toLowerCase().includes(q);
  };

  const wantIncome = kind === "all" || kind === "income";
  const wantExpense = kind === "all" || kind === "expense";
  const wantWaste = kind === "all" || kind === "waste";

  const incomeMatches = wantIncome ? data.income.filter((e) => inRange(e) && textMatch(e, "source")) : [];
  const expenseMatches = (wantExpense || wantWaste)
    ? data.expenses.filter((e) => inRange(e) && textMatch(e, "category") && (kind === "all" ? true : kind === "waste" ? e.unnecessary : !e.unnecessary))
    : [];

  const entries = [
    ...incomeMatches.map((e) => ({ type: "income", date: e.date, amount: e.amount, label: e.source, note: e.note || "" })),
    ...expenseMatches.map((e) => ({ type: e.unnecessary ? "waste" : "expense", date: e.date, amount: e.amount, label: e.category, note: e.note || "" })),
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, Math.max(1, Math.min(100, limit)));

  const totalReceivable = (data.receivables || []).filter((r) => r.status !== "received").reduce((s, r) => s + r.amount, 0);
  const totalPayable = (data.payables || []).filter((p) => p.status !== "paid").reduce((s, p) => s + p.amount, 0);
  const netWorth = (data.openingBalance || 0)
    + data.income.reduce((s, e) => s + e.amount, 0)
    - data.expenses.reduce((s, e) => s + e.amount, 0)
    + (data.investments || []).reduce((s, i) => s + i.amount, 0)
    + totalReceivable - totalPayable;

  return {
    filters_applied: { date_from: date_from || null, date_to: date_to || null, kind, text_contains: text_contains || null },
    totals: {
      income: Math.round(incomeMatches.reduce((s, e) => s + e.amount, 0)),
      expense: Math.round(expenseMatches.filter((e) => !e.unnecessary).reduce((s, e) => s + e.amount, 0)),
      waste: Math.round(expenseMatches.filter((e) => e.unnecessary).reduce((s, e) => s + e.amount, 0)),
      entry_count: incomeMatches.length + expenseMatches.length,
    },
    top_income_sources: topBreakdown(incomeMatches, (e) => e.source),
    top_expense_categories: topBreakdown(expenseMatches, (e) => e.category),
    matching_entries: entries,
    account_snapshot: {
      net_worth: Math.round(netWorth),
      total_receivable: Math.round(totalReceivable),
      total_payable: Math.round(totalPayable),
      fund_balances: data.fundBalances || {},
    },
    trend: computeTrends(data),
    receivables_aging: computeAging(data.receivables, "received"),
    payables_aging: computeAging(data.payables, "paid"),
  };
}

function getMemory(data, channel, chatKey) {
  return data.agentMemory?.[channel]?.[String(chatKey)] || [];
}

function withMemory(data, channel, chatKey, turns) {
  const trimmed = turns.slice(-MAX_MEMORY_TURNS);
  const agentMemory = { ...(data.agentMemory || {}) };
  agentMemory[channel] = { ...(agentMemory[channel] || {}), [String(chatKey)]: trimmed };
  return { ...data, agentMemory };
}

function friendlyErrorReply(err) {
  if (err.status === 429) return "The AI is rate-limited right now — give it a few seconds and try again.";
  if (err.status === 401 || err.status === 403) return "AI is misconfigured server-side (bad/missing API key) — this needs a human to fix GEMINI_API_KEY.";
  if (err.status >= 500) return `AI service error (${err.status}) — try again in a moment.`;
  return "Something broke talking to the AI — try again in a moment.";
}

/**
 * Runs the money agent for one incoming message. Handles its own persistence
 * (log/undo tools go through saveState with optimistic-concurrency retry) and its
 * own short conversation memory per channel+chat, so follow-up questions work.
 *
 * @param {"telegram"|"whatsapp"} channel
 * @param {string|number} chatKey — chat id (Telegram) or sender number (WhatsApp)
 * @param {{data: object, updatedAt: string|null}} state — from loadState()
 * @param {string} userMessage
 * @returns {Promise<{replyText: string}>}
 */
export async function runMoneyAgent({ channel, chatKey, state, userMessage }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { replyText: "Server missing GEMINI_API_KEY env var — this needs a human to set it in Vercel." };
  }
  let data = state.data;
  let updatedAt = state.updatedAt;

  const priorTurns = getMemory(data, channel, chatKey);
  const contents = [
    ...priorTurns.map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.content }] })),
    { role: "user", parts: [{ text: userMessage }] },
  ];

  let replyText = null;

  try {
    for (let turn = 0; turn < MAX_TURNS && replyText === null; turn++) {
      const json = await callGemini({
        apiKey,
        model: MODEL,
        systemInstruction: buildSystemPrompt(data.businessMemory),
        contents,
        tools: GEMINI_TOOLS,
        // Bounded, not dynamic (-1) — unbounded thinking risks running past this function's
        // 60s timeout (vercel.json) and, worse, Twilio/Meta's own webhook timeouts (~15-20s).
        thinkingBudget: 1024,
        maxOutputTokens: 4096,
      });

      const candidate = json.candidates?.[0];
      const parts = candidate?.content?.parts || [];
      const functionCalls = parts.filter((p) => p.functionCall).map((p) => p.functionCall);
      const text = parts.filter((p) => typeof p.text === "string").map((p) => p.text).join("\n").trim();

      if (functionCalls.length === 0) {
        replyText = text || "Didn't quite catch that — try rephrasing.";
        break;
      }

      contents.push({ role: "model", parts });

      const functionResponseParts = [];
      for (const fc of functionCalls) {
        const args = fc.args || {};
        if (fc.name === "get_financial_data") {
          const result = computeFinancialData(data, args);
          functionResponseParts.push({ functionResponse: { name: fc.name, response: { result } } });
        } else if (fc.name === "log_entry") {
          const outcome = computeLog(data, args, userMessage);
          if (!outcome) {
            functionResponseParts.push({ functionResponse: { name: fc.name, response: { error: "Invalid amount — couldn't log that." } } });
            continue;
          }
          const saved = await saveState(outcome.data, updatedAt);
          if (saved.ok) {
            data = outcome.data;
            updatedAt = saved.updatedAt;
            functionResponseParts.push({ functionResponse: { name: fc.name, response: { result: outcome.meta } } });
          } else {
            const fresh = await loadState();
            data = fresh.data;
            updatedAt = fresh.updatedAt;
            functionResponseParts.push({ functionResponse: { name: fc.name, response: { error: "Save conflicted with another concurrent write — state reloaded, please retry the log." } } });
          }
        } else if (fc.name === "undo_last_entry") {
          const outcome = computeUndo(data);
          if (!outcome) {
            functionResponseParts.push({ functionResponse: { name: fc.name, response: { result: "Nothing to undo — no entries logged yet." } } });
            continue;
          }
          const saved = await saveState(outcome.data, updatedAt);
          if (saved.ok) {
            data = outcome.data;
            updatedAt = saved.updatedAt;
            functionResponseParts.push({ functionResponse: { name: fc.name, response: { result: outcome.meta } } });
          } else {
            const fresh = await loadState();
            data = fresh.data;
            updatedAt = fresh.updatedAt;
            functionResponseParts.push({ functionResponse: { name: fc.name, response: { error: "Undo conflicted with another concurrent write — state reloaded, please retry." } } });
          }
        } else if (fc.name === "log_b2b_order") {
          const outcome = computeLogB2BOrder(data, args);
          if (!outcome) {
            functionResponseParts.push({ functionResponse: { name: fc.name, response: { error: "Invalid costing — couldn't log that order." } } });
            continue;
          }
          const saved = await saveState(outcome.data, updatedAt);
          if (saved.ok) {
            data = outcome.data;
            updatedAt = saved.updatedAt;
            functionResponseParts.push({ functionResponse: { name: fc.name, response: { result: outcome.meta } } });
          } else {
            const fresh = await loadState();
            data = fresh.data;
            updatedAt = fresh.updatedAt;
            functionResponseParts.push({ functionResponse: { name: fc.name, response: { error: "Save conflicted with another concurrent write — state reloaded, please retry." } } });
          }
        } else if (fc.name === "confirm_order_landed") {
          const outcome = computeConfirmOrderLanded(data, args);
          if (!outcome) {
            functionResponseParts.push({ functionResponse: { name: fc.name, response: { error: "Couldn't find a matching pending order — ask the user to clarify which one, or check the item name." } } });
            continue;
          }
          const saved = await saveState(outcome.data, updatedAt);
          if (saved.ok) {
            data = outcome.data;
            updatedAt = saved.updatedAt;
            functionResponseParts.push({ functionResponse: { name: fc.name, response: { result: outcome.meta } } });
          } else {
            const fresh = await loadState();
            data = fresh.data;
            updatedAt = fresh.updatedAt;
            functionResponseParts.push({ functionResponse: { name: fc.name, response: { error: "Save conflicted with another concurrent write — state reloaded, please retry." } } });
          }
        } else if (fc.name === "remember") {
          const outcome = computeRemember(data, args.note);
          if (!outcome) {
            functionResponseParts.push({ functionResponse: { name: fc.name, response: { error: "Empty note — nothing to remember." } } });
            continue;
          }
          const saved = await saveState(outcome.data, updatedAt);
          if (saved.ok) {
            data = outcome.data;
            updatedAt = saved.updatedAt;
            functionResponseParts.push({ functionResponse: { name: fc.name, response: { result: outcome.meta } } });
          } else {
            const fresh = await loadState();
            data = fresh.data;
            updatedAt = fresh.updatedAt;
            functionResponseParts.push({ functionResponse: { name: fc.name, response: { error: "Save conflicted with another concurrent write — state reloaded, please retry." } } });
          }
        } else {
          functionResponseParts.push({ functionResponse: { name: fc.name, response: { error: `Unknown tool ${fc.name}` } } });
        }
      }
      contents.push({ role: "function", parts: functionResponseParts });
    }
  } catch (err) {
    return { replyText: friendlyErrorReply(err) };
  }

  if (replyText === null) replyText = "That took more steps than expected — try asking again, maybe more specifically.";

  // Persist a plain-text memory trail (not the tool-call scaffolding) so follow-ups work.
  const nextMemory = [...priorTurns, { role: "user", content: userMessage }, { role: "assistant", content: replyText }];
  const dataWithMemory = withMemory(data, channel, chatKey, nextMemory);
  await saveState(dataWithMemory, updatedAt); // best-effort — losing a memory turn on rare conflict isn't worth blocking the reply

  return { replyText };
}
