// Vercel serverless function — Twilio WhatsApp Sandbox webhook.
// No Meta Business verification needed at all — Twilio's sandbox handles that
// layer for you. Setup (takes ~5 minutes):
//
//   1. Sign up at twilio.com (free trial, includes 100 WhatsApp messages)
//   2. Console → Messaging → Try it out → Send a WhatsApp message → activate Sandbox
//   3. On your OWN phone, WhatsApp the given code (e.g. "join happy-tiger") to
//      the Twilio sandbox number (+1 415 523 8886) — this opts your number in
//   4. In the Sandbox settings, set "WHEN A MESSAGE COMES IN" to:
//        https://<your-deployed-domain>/api/whatsapp-webhook
//      Method: POST
//   5. That's it — text the sandbox number things like "spent 500 on food"
//
// Note: sandbox sessions expire after 3 days of inactivity — just resend the
// "join <code>" message to reactivate. Fine for personal single-user use.
//
// Requires this Vercel environment variable:
//   ANTHROPIC_API_KEY — from console.anthropic.com

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

function twiml(message) {
  const escaped = message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("method not allowed");
  }

  res.setHeader("Content-Type", "text/xml");

  try {
    // Twilio sends application/x-www-form-urlencoded — Vercel parses this into req.body automatically
    const text = (req.body?.Body || "").trim();

    if (!text) {
      return res.status(200).send(twiml("Send me something like 'spent 500 on food' and I'll log it."));
    }

    const parsed = await parseWithClaude(text);
    const amt = parseFloat(parsed.amount);
    if (!amt || amt <= 0) {
      return res.status(200).send(twiml("Couldn't find an amount in that — try something like 'spent 500 on food'."));
    }

    const data = await loadState();
    const today = todayISO();

    let reply;
    if (parsed.type === "income") {
      const { fundDelta, fundBalances } = applyFundDelta(data, amt, 1);
      data.income.push({ id: Date.now(), amount: amt, source: parsed.label || "WhatsApp Log", note: parsed.note || text, date: today, fundDelta });
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
    return res.status(200).send(twiml(reply));
  } catch (err) {
    return res.status(200).send(twiml(`Something went wrong: ${err.message}`));
  }
}
