// Vercel serverless function — Twilio WhatsApp Sandbox webhook, powered by the same
// shared money agent as the Telegram bot (api/_lib/money-agent.js). Full parity with
// Telegram: logging, undo, and open-ended Q&A/advice about the real data — not just
// logging like before.
//
// Setup (takes ~5 minutes):
//   1. Sign up at twilio.com (free trial, includes 100 WhatsApp messages)
//   2. Console → Messaging → Try it out → Send a WhatsApp message → activate Sandbox
//   3. On your OWN phone, WhatsApp the given code (e.g. "join happy-tiger") to
//      the Twilio sandbox number (+1 415 523 8886) — this opts your number in
//   4. In the Sandbox settings, set "WHEN A MESSAGE COMES IN" to:
//        https://<your-deployed-domain>/api/whatsapp-webhook
//      Method: POST
//   5. That's it — text the sandbox number things like "spent 500 on food" or
//      "how much did I spend on shipping last month?"
//
// Note: sandbox sessions expire after 3 days of inactivity — just resend the
// "join <code>" message to reactivate. Fine for personal single-user use.
//
// Requires this Vercel environment variable:
//   ANTHROPIC_API_KEY — from console.anthropic.com

import { loadState } from "./_lib/supabase.js";
import { runMoneyAgent } from "./_lib/money-agent.js";

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
    const from = req.body?.From || "unknown";

    if (!text) {
      return res.status(200).send(twiml("Send me something like 'spent 500 on food', or ask me anything about your money."));
    }

    const state = await loadState();
    const { replyText } = await runMoneyAgent({ channel: "whatsapp", chatKey: from, state, userMessage: text });

    return res.status(200).send(twiml(replyText));
  } catch (err) {
    return res.status(200).send(twiml(`Something went wrong: ${err.message}`));
  }
}
