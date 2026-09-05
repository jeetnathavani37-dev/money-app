# money-app (Khata)

A personal expense-tracking app. React/Vite frontend, plus a set of Vercel
serverless functions (`api/`) that let you log expenses via Telegram,
WhatsApp, or forwarded bank SMS, and pull holdings from a couple of Indian
brokers.

## Local development

```bash
npm install
npm run dev      # start the Vite dev server
npm run build    # production build
npm run preview  # preview the production build
```

## Environment variables

Copy `.env.example` to `.env` for local dev, and set the same values in your
Vercel project's environment variables for deployment:

| Variable | Used by | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | `api/ai-proxy.js`, `api/_lib/money-agent.js` (Telegram + WhatsApp) | Calls to the Claude API |
| `TELEGRAM_BOT_TOKEN` | `api/telegram-webhook.js`, `api/cron-summary.js` | Telegram Bot API access |
| `CRON_SECRET` | `api/cron-summary.js` | Shared secret so only your scheduler can trigger the summary endpoint |
| `KITE_API_KEY` / `KITE_API_SECRET` | `api/kite-callback.js` | Kite Connect login token exchange |

## API routes

- **`api/ai-proxy.js`** — thin server-side proxy to the Claude API (keeps
  `ANTHROPIC_API_KEY` off the client); used by the web app's AI features
  (health score reports, daily tips, the AI council, voice/typed-entry parsing).
- **`api/_lib/money-agent.js`** — the shared "money agent" both bots run on: a
  specialized financial-controller persona for this specific D2C
  sourcing/resale business, backed by real tool use (`log_entry`,
  `undo_last_entry`, `get_financial_data`) instead of asking Claude to emit a
  specific text format. `get_financial_data` lets it answer *any* question
  about the real ledger (arbitrary date ranges, categories, keywords) rather
  than being limited to fixed today/week/month snapshots, and each chat keeps
  a short rolling memory so follow-up questions work. Runs on Claude Opus 5.
- **`api/telegram-webhook.js`** — Telegram bot on the money agent: log
  entries, ask anything about your real data, undo the last entry, get
  tactical advice — all in one open-ended chat.
- **`api/whatsapp-webhook.js`** — the same money agent over Twilio's WhatsApp
  Sandbox webhook, at full feature parity with Telegram. See the comment at
  the top of the file for the ~5 minute Twilio setup.
- **`api/sms-webhook.js`** — receives forwarded bank SMS (from an SMS-forwarding
  app on your phone) and stages a best-effort parsed transaction for review.
- **`api/cron-summary.js`** — sends a periodic spending summary to your
  Telegram chat; meant to be triggered by an external scheduler (e.g.
  cron-job.org) hitting `/api/cron-summary?secret=<CRON_SECRET>`.
- **`api/kite-callback.js`** — OAuth-style redirect target for Kite Connect
  broker login; exchanges the request token for an access token server-side.
- **`api/motilal-callback.js`** — redirect target for Motilal Oswal broker
  login; the auth token expires daily and needs reconnecting.

All routes persist to a shared Supabase project.

## Notes

- These functions deploy as Vercel serverless functions automatically
  alongside the frontend — no separate deploy step.
- Broker credentials (Kite/Motilal) are exchanged and stored server-side only;
  the client never sees them.
- `vercel.json` raises `maxDuration` to 60s for the AI-backed routes — a
  multi-step tool-calling reply from the money agent can take longer than
  Vercel's short default timeout. Twilio's own webhook timeout (~15s) is a
  separate, harder constraint: an unusually long multi-tool-call WhatsApp
  reply can still time out on Twilio's side even though the function itself
  keeps running — Telegram has no such constraint.
