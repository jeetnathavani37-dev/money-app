// Vercel serverless function — Telegram bot webhook. Free forever, no message
// limits, no business verification. Text your bot things like "spent 500 on
// food" and it logs the entry into Khata, replying with a confirmation.
//
// Setup:
//   1. Bot already created via @BotFather — token: (set as TELEGRAM_BOT_TOKEN below)
//   2. Add Vercel env vars: TELEGRAM_BOT_TOKEN, ANTHROPIC_API_KEY
//   3. After deploying, set the webhook by visiting this URL once in any browser:
//      https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook?url=https://<your-domain>/api/telegram-webhook
//   4. Open your bot in Telegram (t.me/Khatajetfinance_bot) and text it.

const SUPABASE_URL = "https://qzripzgbstvxkfobzhyv.supabase.co";
const SUPABASE_KEY = "sb_publishable_-EA-q_dacUuWovbrCW5XVw_pPZ2vK_O";
const SUPABASE_HEADERS = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };

function todayISO() {
  return new Date().toISOString().slice(0, 10);
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

async function parseWithClaude(text) {
  const prompt = `Parse this spoken/texted money entry into JSON. Text: "${text}"\nReturn ONLY valid JSON, no other text, in this exact shape:\n{"type":"income"|"expense"|"waste","amount":number,"label":"category or source name","note":"short note or empty string"}\nGuess sensible category/source names from context. If it sounds like unnecessary/impulsive spending (drinks, smoking, gambling, impulse buy), use type "waste".`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: 300, messages: [{ role: "user", content: prompt }] }),
  });
  const json = await res.json();
  const text2 = (json.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  const match = text2.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : text2);
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

async function sendTelegramReply(chatId, text) {
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("Telegram webhook is live. Set webhook via BotFather token + /setWebhook.");
  }

  try {
    const message = req.body?.message;
    const text = (message?.text || "").trim();
    const chatId = message?.chat?.id;

    if (!chatId) return res.status(200).json({ ok: true });

    if (!text) {
      await sendTelegramReply(chatId, "Send me something like 'spent 500 on food' and I'll log it.");
      return res.status(200).json({ ok: true });
    }

    if (text === "/start") {
      await sendTelegramReply(chatId, "Khata bot ready. Text me entries like 'spent 500 on food' or '3000 profit from sale'.");
      return res.status(200).json({ ok: true });
    }

    const parsed = await parseWithClaude(text);
    const amt = parseFloat(parsed.amount);
    if (!amt || amt <= 0) {
      await sendTelegramReply(chatId, "Couldn't find an amount in that — try something like 'spent 500 on food'.");
      return res.status(200).json({ ok: true });
    }

    const data = await loadState();
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
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(200).json({ ok: true, error: err.message });
  }
}
