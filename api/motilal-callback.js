// Vercel serverless function — Motilal Oswal (Rise) OpenAPI login redirect
// lands here with ?authtoken=... in the query string. Stores it in Supabase
// so the Khata app can fetch holdings.
//
// Note: unlike Kite, Motilal's authtoken comes back directly in the redirect
// (no secret-exchange step needed here), but it still expires daily at 6am
// per exchange compliance rules — you'll need to reconnect once a day.
//
// Set the "Redirect URL" on your Motilal Oswal API app to:
//   https://<your-deployed-domain>/api/motilal-callback

const SUPABASE_URL = "https://qzripzgbstvxkfobzhyv.supabase.co";
const SUPABASE_KEY = "sb_publishable_-EA-q_dacUuWovbrCW5XVw_pPZ2vK_O";

export default async function handler(req, res) {
  const { authtoken } = req.query;

  if (!authtoken) {
    return res.status(400).send("Missing authtoken in redirect.");
  }

  try {
    await fetch(`${SUPABASE_URL}/rest/v1/khata_broker_sessions`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({ broker: "motilal", access_token: authtoken, updated_at: new Date().toISOString() }),
    });

    res.setHeader("Content-Type", "text/html");
    return res.status(200).send("<html><body style='font-family:sans-serif;padding:40px;text-align:center'><h2>✅ Rise (Motilal Oswal) connected</h2><p>You can close this tab and go back to Khata.</p></body></html>");
  } catch (err) {
    return res.status(500).send(`Error: ${err.message}`);
  }
}
