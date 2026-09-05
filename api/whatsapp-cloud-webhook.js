// Vercel serverless function — Meta's official WhatsApp Cloud API webhook, powered by
// the same shared money agent as the other bots (api/_lib/money-agent.js). Official
// and free (well beyond personal-use volume), unlike the Twilio sandbox or a
// self-hosted unofficial bot — no ban risk, no persistent process to host.
//
// Setup (~10 minutes):
//   1. Create a Meta developer account at developers.facebook.com, then
//      My Apps → Create App → type "Business" → add the "WhatsApp" product.
//   2. Under WhatsApp → API Setup you get, for free, immediately:
//        - a test phone number + Phone Number ID
//        - a temporary access token (24h — generate a permanent one later
//          under System Users if you want it to keep working long-term)
//   3. Under WhatsApp → Configuration → Webhook, set:
//        Callback URL: https://<your-deployed-domain>/api/whatsapp-cloud-webhook
//        Verify token: any string you pick — must match WHATSAPP_VERIFY_TOKEN below
//      Click "Verify and save" (Meta calls this URL once to confirm you own it —
//      handled by the GET branch below).
//   4. Under Webhook fields, subscribe to "messages".
//   5. In WhatsApp → API Setup, add your own phone number as a test recipient
//      (required for test numbers) and verify it via the code Meta texts you.
//   6. That's it — text your test number things like "spent 500 on food" or
//      "how much did I spend on shipping last month?"
//
// Requires these Vercel environment variables:
//   ANTHROPIC_API_KEY          — same as the other bots
//   WHATSAPP_CLOUD_TOKEN       — the access token from step 2
//   WHATSAPP_PHONE_NUMBER_ID   — the Phone Number ID from step 2
//   WHATSAPP_VERIFY_TOKEN      — the verify token you picked in step 3

import { loadState } from "./_lib/supabase.js";
import { runMoneyAgent } from "./_lib/money-agent.js";

const GRAPH_VERSION = "v21.0";

async function sendWhatsAppReply(to, text) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_CLOUD_TOKEN;
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text } }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("WhatsApp send failed:", res.status, detail);
  }
}

export default async function handler(req, res) {
  // Meta's one-time webhook ownership check when you click "Verify and save" —
  // echo back hub.challenge if the verify token matches what you configured.
  if (req.method === "GET") {
    const mode = req.query?.["hub.mode"];
    const token = req.query?.["hub.verify_token"];
    const challenge = req.query?.["hub.challenge"];
    if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send("Verification failed");
  }

  if (req.method !== "POST") {
    return res.status(405).send("method not allowed");
  }

  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];

    // Meta also posts delivery/read status updates to this same webhook — ignore those.
    if (!message) return res.status(200).json({ ok: true });

    const from = message.from; // sender's phone number, no "+"
    const text = (message.text?.body || "").trim();

    if (!text) {
      await sendWhatsAppReply(from, "Send me something like 'spent 500 on food', or ask me anything about your money.");
      return res.status(200).json({ ok: true });
    }

    const state = await loadState();
    const { replyText } = await runMoneyAgent({ channel: "whatsapp-cloud", chatKey: from, state, userMessage: text });
    await sendWhatsAppReply(from, replyText);

    return res.status(200).json({ ok: true });
  } catch (err) {
    // Meta expects a fast 200 regardless — logging the error is the best we can do here.
    console.error("whatsapp-cloud-webhook error:", err);
    return res.status(200).json({ ok: true, error: err.message });
  }
}
