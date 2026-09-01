// Vercel serverless function — sends a "how's today going" summary to your
// Telegram bot chat. Meant to be triggered by an EXTERNAL scheduler (Vercel's
// own free-tier cron only allows once/day, this needs every-3-hours) — see
// cron-job.org setup notes below.
//
// Setup:
//   1. Deploy this (ships automatically with the rest of the app)
//   2. Text your bot at least once first (so it has your chat_id saved)
//   3. Go to cron-job.org (free), create an account
//   4. Create a new cron job:
//        URL: https://<your-domain>/api/cron-summary?secret=<pick-any-string>
//        Schedule: every 3 hours
//   5. Set the same string as a Vercel env var: CRON_SECRET

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

async function loadChatId() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/khata_telegram_chat?id=eq.default&select=chat_id`, { headers: SUPABASE_HEADERS });
  const rows = await res.json();
  return rows[0]?.chat_id || null;
}

async function sendTelegramReply(chatId, text) {
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

export default async function handler(req, res) {
  // simple shared-secret check so randoms can't spam-trigger this
  const secret = req.query?.secret;
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }

  try {
    const chatId = await loadChatId();
    if (!chatId) {
      return res.status(200).json({ ok: true, skipped: "no chat_id saved yet — text the bot once first" });
    }

    const data = await loadState();
    if (!data) {
      return res.status(200).json({ ok: true, skipped: "no data yet" });
    }

    const today = todayISO();
    const todayInc = data.income.filter((e) => e.date === today).reduce((s, e) => s + e.amount, 0);
    const todayExp = data.expenses.filter((e) => e.date === today).reduce((s, e) => s + e.amount, 0);
    const todayProfit = todayInc - todayExp;
    const target = data.profitTargets?.daily || 0;
    const remaining = Math.max(0, target - todayProfit);

    let line;
    if (target > 0 && todayProfit >= target) {
      line = `🔥 Target already hit today! ₹${Math.round(todayProfit)} profit so far, target was ₹${target}.`;
    } else if (remaining > 0) {
      line = `₹${Math.round(remaining)} left to hit today's ₹${target} target. In: ₹${Math.round(todayInc)}, Out: ₹${Math.round(todayExp)}.`;
    } else {
      line = `In: ₹${Math.round(todayInc)}, Out: ₹${Math.round(todayExp)}, Profit: ₹${Math.round(todayProfit)}.`;
    }

    await sendTelegramReply(chatId, `📊 Day check-in — ${line}`);
    return res.status(200).json({ ok: true, sent: line });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
