// Vercel serverless function — receives forwarded bank SMS from an SMS-forwarding
// app (Forward SMS / SMS Forwarder / AutoForwardText etc — payload field names vary
// slightly between apps, so this accepts several common aliases) and stages a
// best-effort parsed transaction in Supabase for review inside the Khata app.

const SUPABASE_URL = "https://qzripzgbstvxkfobzhyv.supabase.co";
const SUPABASE_KEY = "sb_publishable_-EA-q_dacUuWovbrCW5XVw_pPZ2vK_O";

function parseBankSms(text) {
  if (!text) return { amount: null, type: null, merchant: null };

  // amount: "Rs.1,234.50" / "INR 500" / "Rs 500.00"
  const amountMatch = text.match(/(?:rs\.?|inr)\s*\.?\s*([\d,]+(?:\.\d{1,2})?)/i);
  const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, "")) : null;

  // direction
  let type = null;
  if (/\b(debited|spent|paid|withdrawn|purchase)\b/i.test(text)) type = "debit";
  else if (/\b(credited|received|deposited)\b/i.test(text)) type = "credit";

  // merchant/info — text after "at", "to", "on", "Info:", "for" (best-effort, common bank phrasing)
  let merchant = null;
  const merchantMatch = text.match(/(?:at|to|towards|info:?)\s+([A-Za-z0-9 &._-]{3,30}?)(?:\.|,|\s+on\s|\s+avl\b|\s+ref\b|$)/i);
  if (merchantMatch) merchant = merchantMatch[1].trim();

  return { amount, type, merchant };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method not allowed" });
  }

  try {
    const body = req.body || {};
    // accept several common field-name variants used by different SMS-forwarding apps
    const rawMessage = body.content || body.message || body.text || body.body || "";
    const sender = body.sender || body.from || body.contact || null;

    if (!rawMessage) {
      return res.status(400).json({ error: "no message content in payload" });
    }

    const { amount, type, merchant } = parseBankSms(rawMessage);

    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/khata_sms_inbox`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        raw_message: rawMessage,
        sender,
        parsed_amount: amount,
        parsed_type: type,
        parsed_merchant: merchant,
        status: "pending",
      }),
    });

    if (!insertRes.ok) {
      const errText = await insertRes.text();
      return res.status(502).json({ error: "failed to store message", detail: errText });
    }

    return res.status(200).json({ success: true, parsed: { amount, type, merchant } });
  } catch (err) {
    return res.status(500).json({ error: err.message || "unknown error" });
  }
}
