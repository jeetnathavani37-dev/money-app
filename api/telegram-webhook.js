// Vercel serverless function — Telegram bot with FOUR capabilities:
//   1. LOG    — "spent 500 on food" → creates a new entry
//   2. QUERY  — "kal kitna kharcha hua?" → answers using your real data
//   3. UNDO   — "undo" / "last entry delete karo" → removes the most recent entry
//   4. TIP    — "/tip", "koi advice do", "kya karu aaj" → ruthless tactical money move
//
// One AI call per message decides which mode applies, then acts accordingly.

const SUPABASE_URL = "https://qzripzgbstvxkfobzhyv.supabase.co";
const SUPABASE_KEY = "sb_publishable_-EA-q_dacUuWovbrCW5XVw_pPZ2vK_O";
const SUPABASE_HEADERS = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function isoDaysAgo(n) {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

async function loadState() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/khata_state?id=eq.default&select=data`, { headers: SUPABASE_HEADERS });
  const rows = await res.json();
  return rows[0]?.data;
}

async function saveState(data) {
  await fetch(`${SUPABASE_URL}/rest/v1/khata_state`, {
    method: "POST",
    headers: { ...SUPABASE_HEADERS, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ id: "default", data, updated_at: new Date().toISOString() }),
  });
}

async function callClaude(prompt, maxTokens = 500) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
  });
  const json = await res.json();
  return (json.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
}

function topBreakdown(entries, keyFn) {
  const map = {};
  entries.forEach((e) => { const k = keyFn(e); map[k] = (map[k] || 0) + e.amount; });
  return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}: ₹${Math.round(v)}`).join(", ");
}

function buildQueryContext(data) {
  const today = todayISO();
  const yesterday = isoDaysAgo(1);
  const weekStart = isoDaysAgo(6);
  const monthStart = today.slice(0, 7) + "-01";

  const sum = (arr, start, end) => arr.filter((e) => e.date >= start && e.date <= end).reduce((s, e) => s + e.amount, 0);

  const todayExp = sum(data.expenses, today, today);
  const todayInc = sum(data.income, today, today);
  const yestExp = sum(data.expenses, yesterday, yesterday);
  const yestInc = sum(data.income, yesterday, yesterday);
  const weekExp = sum(data.expenses, weekStart, today);
  const weekInc = sum(data.income, weekStart, today);
  const monthExp = sum(data.expenses, monthStart, today);
  const monthInc = sum(data.income, monthStart, today);

  const recentExpenses = data.expenses.slice(-20).map((e) => `${e.date} -₹${e.amount} (${e.category}${e.unnecessary ? ", waste" : ""})`).join("; ");
  const recentIncome = data.income.slice(-20).map((e) => `${e.date} +₹${e.amount} (${e.source})`).join("; ");

  const totalReceivable = data.receivables.filter((r) => r.status !== "received").reduce((s, r) => s + r.amount, 0);
  const totalPayable = data.payables.filter((p) => p.status !== "paid").reduce((s, p) => s + p.amount, 0);
  const netWorth = data.openingBalance + data.income.reduce((s, e) => s + e.amount, 0) - data.expenses.reduce((s, e) => s + e.amount, 0) + data.investments.reduce((s, i) => s + i.amount, 0) + totalReceivable - totalPayable;

  return [
    `Today (${today}): spent ₹${todayExp}, earned ₹${todayInc}.`,
    `Yesterday (${yesterday}): spent ₹${yestExp}, earned ₹${yestInc}.`,
    `Last 7 days: spent ₹${weekExp}, earned ₹${weekInc}.`,
    `This month so far: spent ₹${monthExp}, earned ₹${monthInc}.`,
    `Net worth right now: ₹${Math.round(netWorth)}.`,
    `Receivable: ₹${totalReceivable}. Payable: ₹${totalPayable}.`,
    `Top income sources: ${topBreakdown(data.income, (e) => e.source) || "none yet"}.`,
    `Top expense categories: ${topBreakdown(data.expenses, (e) => e.category) || "none yet"}.`,
    `Recent expense entries (last 20): ${recentExpenses || "none"}.`,
    `Recent income entries (last 20): ${recentIncome || "none"}.`,
  ].join("\n");
}

function applyFundDelta(data, amount, sign) {
  const fundDelta = {};
  const fundBalances = { ...data.fundBalances };
  data.funds.forEach((f) => {
    const share = Math.round((amount * f.pct) / 100) * sign;
    fundDelta[f.id] = share;
    fundBalances[f.id] = (fundBalances[f.id] || 0) + share;
  });
  return { fundDelta, fundBalances };
}

async function saveChatId(chatId) {
  await fetch(`${SUPABASE_URL}/rest/v1/khata_telegram_chat`, {
    method: "POST",
    headers: { ...SUPABASE_HEADERS, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ id: "default", chat_id: chatId, updated_at: new Date().toISOString() }),
  });
}

async function sendTelegramReply(chatId, text) {
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

async function undoLastEntry(data) {
  const lastIncome = data.income[data.income.length - 1];
  const lastExpense = data.expenses[data.expenses.length - 1];
  const lastIsIncome = lastIncome && (!lastExpense || lastIncome.id > lastExpense.id);

  if (!lastIncome && !lastExpense) return { removed: null, data };

  const fundBalances = { ...data.fundBalances };
  if (lastIsIncome) {
    Object.entries(lastIncome.fundDelta || {}).forEach(([fid, amt]) => { fundBalances[fid] = (fundBalances[fid] || 0) - amt; });
    return { removed: `income of ₹${lastIncome.amount} (${lastIncome.source})`, data: { ...data, income: data.income.slice(0, -1), fundBalances } };
  } else {
    Object.entries(lastExpense.fundDelta || {}).forEach(([fid, amt]) => { fundBalances[fid] = (fundBalances[fid] || 0) - amt; });
    return { removed: `expense of ₹${lastExpense.amount} (${lastExpense.category})`, data: { ...data, expenses: data.expenses.slice(0, -1), fundBalances } };
  }
}

async function giveTip(data, chatId) {
  const context = buildQueryContext(data);
  const prompt = `Act as a ruthless hustle coach for a solo D2C sourcing founder (imports luxury goods from US/UK/Canada, resells in India). ${context}\nGive me ONE specific, tactical "money move" for right now — either a way to make money (what to sell, to whom, via which channel, using my actual top sources/categories above) or a way to save money (a concrete cut based on my actual waste/spend patterns above). Reference real numbers/categories from my data. Ruthless and blunt, swearing allowed and encouraged (fuck, shit etc). 2-3 punchy sentences MAX, no preamble.`;
  const tip = await callClaude(prompt, 300);
  await sendTelegramReply(chatId, `💡 ${tip}`);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("Telegram webhook is live.");
  }

  try {
    const message = req.body?.message;
    const text = (message?.text || "").trim();
    const chatId = message?.chat?.id;
    if (!chatId) return res.status(200).json({ ok: true });
    saveChatId(chatId); // fire-and-forget, don't block the reply

    if (text === "/start") {
      await sendTelegramReply(chatId, "Khata bot ready. Text me:\n• 'spent 500 on food' — logs an entry\n• 'kal kitna kharcha hua?' — answers from your data\n• 'undo' — removes the last entry\n• '/tip' or 'koi advice do' — a ruthless money move for right now");
      return res.status(200).json({ ok: true });
    }
    if (!text) {
      await sendTelegramReply(chatId, "Send me something like 'spent 500 on food', ask me a question, say 'undo', or ask for a tip.");
      return res.status(200).json({ ok: true });
    }

    const data = await loadState();

    // fast-path undo — no AI call needed
    if (/^(undo|delete last|remove last|last (entry )?(delete|hatao|hata do))/i.test(text)) {
      const { removed, data: nextData } = await undoLastEntry(data);
      if (!removed) {
        await sendTelegramReply(chatId, "Nothing to undo — no entries logged yet.");
      } else {
        await saveState(nextData);
        await sendTelegramReply(chatId, `✅ Removed: ${removed}`);
      }
      return res.status(200).json({ ok: true });
    }

    // fast-path tip command
    if (/^\/tip$/i.test(text)) {
      await giveTip(data, chatId);
      return res.status(200).json({ ok: true });
    }

    const context = buildQueryContext(data);
    const prompt = `You are a financial assistant for a Khata (money tracking) app. Here is the user's real recent data:\n${context}\n\nUser's message: "${text}"\n\nDecide what this message wants, and respond with EXACTLY ONE of these three formats — nothing else, no preamble:\n\n1. If it's asking to LOG a new income/expense/waste entry, respond with:\nLOG:{"type":"income"|"expense"|"waste","amount":number,"label":"category or source name","note":"short note or empty string"}\n\n2. If it's a QUESTION about their spending/income/data (in any language — Hindi, Hinglish, English), respond with:\nANSWER:<short direct answer using the real numbers above, same language style as their question, no more than 2-3 sentences>\n\n3. If they're asking for advice, a tip, a recommendation, or "what should I do" (e.g. "koi advice do", "kya karu", "suggest something"), respond with:\nTIP\n(just the word TIP, nothing else — a separate call will generate the actual tip)\n\nIf you can't find enough data to answer a question, say so honestly in the ANSWER format.`;

    const raw = await callClaude(prompt);

    if (raw.startsWith("LOG:")) {
      let parsed;
      try {
        parsed = JSON.parse(raw.slice(4).trim());
      } catch {
        await sendTelegramReply(chatId, "Couldn't parse that as a log entry — try rephrasing.");
        return res.status(200).json({ ok: true });
      }
      const amt = parseFloat(parsed.amount);
      if (!amt || amt <= 0) {
        await sendTelegramReply(chatId, "Couldn't find an amount — try something like 'spent 500 on food'.");
        return res.status(200).json({ ok: true });
      }
      const today = todayISO();
      let reply;
      if (parsed.type === "income") {
        const { fundDelta, fundBalances } = applyFundDelta(data, amt, 1);
        data.income.push({ id: Date.now(), amount: amt, source: parsed.label || "Telegram Log", note: parsed.note || text, date: today, fundDelta });
        data.fundBalances = fundBalances;
        reply = `✅ Logged ₹${amt} income — ${parsed.label || "uncategorized"}`;
      } else {
        const isWaste = parsed.type === "waste";
        const fine = isWaste ? (amt < 100 ? 200 : 1000) : 0;
        const total = amt + fine;
        const { fundDelta, fundBalances } = applyFundDelta(data, total, -1);
        data.expenses.push({ id: Date.now(), amount: total, category: parsed.label || "Other", note: parsed.note || text, date: today, unnecessary: isWaste, fine, fundDelta });
        data.fundBalances = fundBalances;
        reply = `✅ Logged ₹${total} ${isWaste ? "waste (+fine)" : "expense"} — ${parsed.label || "uncategorized"}`;
      }
      await saveState(data);
      await sendTelegramReply(chatId, reply);
    } else if (raw.startsWith("ANSWER:")) {
      await sendTelegramReply(chatId, raw.slice(7).trim());
    } else if (raw.trim() === "TIP") {
      await giveTip(data, chatId);
    } else {
      await sendTelegramReply(chatId, raw || "Didn't quite get that — try again.");
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(200).json({ ok: true, error: err.message });
  }
}
