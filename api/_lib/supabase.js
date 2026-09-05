// Shared Supabase access for the khata_state row — used by every serverless function
// that reads or writes the app's data (web app, Telegram bot, WhatsApp bot).
// Prefixed with an underscore so Vercel doesn't turn this into its own route.

const SUPABASE_URL = "https://qzripzgbstvxkfobzhyv.supabase.co";
const SUPABASE_KEY = "sb_publishable_-EA-q_dacUuWovbrCW5XVw_pPZ2vK_O";
const SUPABASE_HEADERS = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };

// Returns { data, updatedAt } — updatedAt is null when the row doesn't exist yet.
export async function loadState() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/khata_state?id=eq.default&select=data,updated_at`, { headers: SUPABASE_HEADERS });
  const rows = await res.json();
  return Array.isArray(rows) && rows[0] ? { data: rows[0].data, updatedAt: rows[0].updated_at } : { data: null, updatedAt: null };
}

// Only saves if no one else (the web app, the other bot) has written since expectedUpdatedAt
// was read. Returns { ok, updatedAt } — ok:false means a conflicting write happened; the
// caller should reload fresh state and retry rather than blindly overwriting it.
export async function saveState(data, expectedUpdatedAt) {
  const updatedAt = new Date().toISOString();
  if (!expectedUpdatedAt) {
    await fetch(`${SUPABASE_URL}/rest/v1/khata_state`, {
      method: "POST",
      headers: { ...SUPABASE_HEADERS, Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ id: "default", data, updated_at: updatedAt }),
    });
    return { ok: true, updatedAt };
  }
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/khata_state?id=eq.default&updated_at=eq.${encodeURIComponent(expectedUpdatedAt)}`,
    {
      method: "PATCH",
      headers: { ...SUPABASE_HEADERS, Prefer: "return=representation" },
      body: JSON.stringify({ data, updated_at: updatedAt }),
    }
  );
  const rows = await res.json().catch(() => []);
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false };
  return { ok: true, updatedAt };
}

// Retries `mutate` against fresh state whenever another writer saves in between — so
// concurrent messages from Telegram/WhatsApp/the web app never silently clobber each other.
// `mutate(data)` returns either `{ data, meta }` (apply this) or a falsy value (no-op).
export async function saveWithRetry(state, mutate, maxAttempts = 3) {
  let current = state;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const outcome = mutate(current.data);
    if (!outcome) return { applied: false };
    const saved = await saveState(outcome.data, current.updatedAt);
    if (saved.ok) return { applied: true, data: outcome.data, meta: outcome.meta, updatedAt: saved.updatedAt };
    current = await loadState();
  }
  return { applied: false, conflict: true };
}

export async function saveChatId(table, chatId) {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...SUPABASE_HEADERS, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ id: "default", chat_id: chatId, updated_at: new Date().toISOString() }),
  });
}
