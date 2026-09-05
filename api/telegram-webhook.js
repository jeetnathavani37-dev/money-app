// Vercel serverless function — Telegram bot, powered by the shared money agent
// (api/_lib/money-agent.js). Handles logging entries, answering questions about
// real data, undoing the last entry, and giving advice — all via real tool use
// instead of asking the model to emit a specific text prefix.

import { loadState, saveChatId } from "./_lib/supabase.js";
import { runMoneyAgent } from "./_lib/money-agent.js";

async function sendTelegramReply(chatId, text) {
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
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
    saveChatId("khata_telegram_chat", chatId); // fire-and-forget, don't block the reply

    if (text === "/start") {
      await sendTelegramReply(chatId, "Money agent ready. Ask me anything about your money — text me things like:\n• 'spent 500 on food' — logs an entry\n• 'kal kitna kharcha hua?' or 'how much did I spend on shipping last month?' — answers from your real data\n• 'undo' — removes the last entry\n• 'what should I do today?' — a tactical money move");
      return res.status(200).json({ ok: true });
    }
    if (!text) {
      await sendTelegramReply(chatId, "Send me something like 'spent 500 on food', ask me anything about your data, or say 'undo'.");
      return res.status(200).json({ ok: true });
    }

    const state = await loadState();
    const { replyText } = await runMoneyAgent({ channel: "telegram", chatKey: chatId, state, userMessage: text });
    await sendTelegramReply(chatId, replyText);

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(200).json({ ok: true, error: err.message });
  }
}
