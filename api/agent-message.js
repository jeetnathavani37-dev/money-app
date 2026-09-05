// Vercel serverless function — a generic bridge into the shared money agent for any
// external bot transport that can't run on Vercel itself (e.g. a Baileys-based
// WhatsApp bot, which needs a persistent process, unlike api/whatsapp-webhook.js's
// Twilio webhook). POST { userMessage, chatKey, channel? } and get back { replyText }.
//
// Requires these Vercel environment variables:
//   ANTHROPIC_API_KEY — same as the other bots
//   AGENT_BRIDGE_SECRET — shared secret; the caller must send it as
//                         Authorization: Bearer <secret>

import { loadState } from "./_lib/supabase.js";
import { runMoneyAgent } from "./_lib/money-agent.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method not allowed" });
  }

  const secret = process.env.AGENT_BRIDGE_SECRET;
  const auth = req.headers.authorization || "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!secret || provided !== secret) {
    return res.status(401).json({ error: "unauthorized" });
  }

  try {
    const { userMessage, chatKey, channel } = req.body || {};
    if (!userMessage || !chatKey) {
      return res.status(400).json({ error: "userMessage and chatKey are required" });
    }

    const state = await loadState();
    const { replyText } = await runMoneyAgent({
      channel: channel || "external",
      chatKey: String(chatKey),
      state,
      userMessage: String(userMessage),
    });

    return res.status(200).json({ replyText });
  } catch (err) {
    return res.status(500).json({ error: err.message || "unknown error" });
  }
}
