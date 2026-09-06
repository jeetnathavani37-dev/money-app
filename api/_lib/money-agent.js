// The shared "money agent" brain used by both the Telegram and WhatsApp bots.
// Replaces the old approach of asking Claude to emit a raw "LOG:{...}" / "ANSWER:" /
// "TIP" text prefix (fragile — any deviation from the exact format broke the reply)
// with real tool use: Claude decides what to do and calls a tool for it, and can pull
// exactly the real numbers it needs to answer any question instead of working from a
// fixed today/week/month snapshot.

import Anthropic from "@anthropic-ai/sdk";
import { loadState, saveState } from "./supabase.js";

const MODEL = "claude-opus-5";
const MAX_TURNS = 5; // hard cap on tool-call round trips per incoming message
const MAX_MEMORY_TURNS = 16; // plain user/assistant turns kept per chat, for follow-up questions

const SYSTEM_PROMPT = `You are the onboard money agent for "Money" — a personal finance + business command center for a solo entrepreneur who sources luxury goods (Michael Kors, Coach, Alo Yoga, and similar) from the US, UK, and Canada and resells them in India.

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
];

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
  if (err instanceof Anthropic.RateLimitError) return "The AI is rate-limited right now — give it a few seconds and try again.";
  if (err instanceof Anthropic.AuthenticationError) return "AI is misconfigured server-side (bad/missing API key) — this needs a human to fix ANTHROPIC_API_KEY.";
  if (err instanceof Anthropic.APIError) return `AI service error (${err.status || "?"}) — try again in a moment.`;
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
  if (!process.env.ANTHROPIC_API_KEY) {
    return { replyText: "Server missing ANTHROPIC_API_KEY env var — this needs a human to set it in Vercel." };
  }
  const client = new Anthropic();
  let data = state.data;
  let updatedAt = state.updatedAt;

  const priorTurns = getMemory(data, channel, chatKey);
  const messages = [...priorTurns, { role: "user", content: userMessage }];

  let replyText = null;

  try {
    for (let turn = 0; turn < MAX_TURNS && replyText === null; turn++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        thinking: { type: "adaptive" },
        output_config: { effort: "xhigh" }, // deeper reasoning for real strategic/financial advice, not just quick lookups
        tools: TOOLS,
        messages,
      });

      const toolUses = response.content.filter((b) => b.type === "tool_use");
      const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();

      if (toolUses.length === 0) {
        replyText = text || "Didn't quite catch that — try rephrasing.";
        break;
      }

      messages.push({ role: "assistant", content: response.content });

      const toolResults = [];
      for (const tu of toolUses) {
        if (tu.name === "get_financial_data") {
          const result = computeFinancialData(data, tu.input || {});
          toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(result) });
        } else if (tu.name === "log_entry") {
          const outcome = computeLog(data, tu.input || {}, userMessage);
          if (!outcome) {
            toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: "Invalid amount — couldn't log that.", is_error: true });
            continue;
          }
          const saved = await saveState(outcome.data, updatedAt);
          if (saved.ok) {
            data = outcome.data;
            updatedAt = saved.updatedAt;
            toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: outcome.meta });
          } else {
            const fresh = await loadState();
            data = fresh.data;
            updatedAt = fresh.updatedAt;
            toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: "Save conflicted with another concurrent write — state reloaded, please retry the log.", is_error: true });
          }
        } else if (tu.name === "undo_last_entry") {
          const outcome = computeUndo(data);
          if (!outcome) {
            toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: "Nothing to undo — no entries logged yet." });
            continue;
          }
          const saved = await saveState(outcome.data, updatedAt);
          if (saved.ok) {
            data = outcome.data;
            updatedAt = saved.updatedAt;
            toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: outcome.meta });
          } else {
            const fresh = await loadState();
            data = fresh.data;
            updatedAt = fresh.updatedAt;
            toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: "Undo conflicted with another concurrent write — state reloaded, please retry.", is_error: true });
          }
        } else {
          toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: `Unknown tool ${tu.name}`, is_error: true });
        }
      }
      messages.push({ role: "user", content: toolResults });
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
