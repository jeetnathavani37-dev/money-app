// Vercel serverless function — Kite Connect login redirect lands here with
// ?request_token=... in the query string. Exchanges it for an access_token
// (using the API secret, kept server-side only) and stores it in Supabase so
// the Khata app can fetch holdings without ever seeing the secret.
//
// Requires these Vercel environment variables to be set:
//   KITE_API_KEY    — from your Kite Connect app ("My Apps" on developers.kite.trade)
//   KITE_API_SECRET — same page
//
// Set the "Redirect URL" on your Kite Connect app to:
//   https://<your-deployed-domain>/api/kite-callback

import crypto from "crypto";

const SUPABASE_URL = "https://qzripzgbstvxkfobzhyv.supabase.co";
const SUPABASE_KEY = "sb_publishable_-EA-q_dacUuWovbrCW5XVw_pPZ2vK_O";

export default async function handler(req, res) {
  const { request_token, status } = req.query;

  if (status === "cancelled" || !request_token) {
    return res.status(400).send("Login cancelled or missing request_token.");
  }

  const apiKey = process.env.KITE_API_KEY;
  const apiSecret = process.env.KITE_API_SECRET;
  if (!apiKey || !apiSecret) {
    return res.status(500).send("Server missing KITE_API_KEY / KITE_API_SECRET env vars.");
  }

  try {
    // Kite requires checksum = sha256(api_key + request_token + api_secret)
    const checksum = crypto.createHash("sha256").update(apiKey + request_token + apiSecret).digest("hex");

    const tokenRes = await fetch("https://api.kite.trade/session/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Kite-Version": "3" },
      body: new URLSearchParams({ api_key: apiKey, request_token, checksum }),
    });
    const tokenJson = await tokenRes.json();

    if (!tokenRes.ok || !tokenJson.data?.access_token) {
      return res.status(502).send(`Kite token exchange failed: ${JSON.stringify(tokenJson)}`);
    }

    await fetch(`${SUPABASE_URL}/rest/v1/khata_broker_sessions`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({ broker: "kite", access_token: tokenJson.data.access_token, updated_at: new Date().toISOString() }),
    });

    res.setHeader("Content-Type", "text/html");
    return res.status(200).send("<html><body style='font-family:sans-serif;padding:40px;text-align:center'><h2>✅ Kite connected</h2><p>You can close this tab and go back to Khata.</p></body></html>");
  } catch (err) {
    return res.status(500).send(`Error: ${err.message}`);
  }
}
