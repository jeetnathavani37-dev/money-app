// generateContent with automatic fallback.
// The free tier gives each model its own small daily quota (e.g. 20 requests/day), so when the
// preferred model answers 429 (or is unavailable) we move on to the next usable model instead of
// leaving James and the bots dead for the rest of the day.
//
// Fallback order: GEMINI_FALLBACK_MODELS (comma-separated) if set, otherwise discovered from the
// API's own model list — other "flash" models first (newest first), then "flash-lite", then "pro".

const BASE = "https://generativelanguage.googleapis.com/v1beta";
const SKIP = /image|tts|audio|live|embedding|vision|robotics|computer|native|learnlm|gemma|aqa|imagen|veo/i;

let cachedList = null;
let cachedAt = 0;
const coolingDown = new Map(); // model -> timestamp until which we skip it
let lastGood = null; // the fallback that answered most recently — tried first while the primary is cooling down

const versionOf = (name) => { const m = name.match(/gemini-(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : 0; };
const tierOf = (name) => (/flash-lite/.test(name) ? 1 : /flash/.test(name) ? 0 : /pro/.test(name) ? 2 : 3);

async function discoverModels(apiKey) {
  if (cachedList && Date.now() - cachedAt < 6 * 60 * 60 * 1000) return cachedList;
  try {
    const r = await fetch(`${BASE}/models?pageSize=200&key=${apiKey}`);
    const j = await r.json();
    const names = (j.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m) => String(m.name || "").replace(/^models\//, ""))
      .filter((n) => n.startsWith("gemini-") && !SKIP.test(n));
    names.sort((a, b) => tierOf(a) - tierOf(b) || versionOf(b) - versionOf(a) || a.length - b.length);
    cachedList = names;
    cachedAt = Date.now();
  } catch {
    cachedList = cachedList || [];
  }
  return cachedList;
}

async function candidateModels(apiKey, primary) {
  const fromEnv = (process.env.GEMINI_FALLBACK_MODELS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const rest = fromEnv.length ? fromEnv : await discoverModels(apiKey);
  return [primary, ...rest.filter((m) => m !== primary)].slice(0, 6);
}

async function callOnce(apiKey, model, body) {
  const upstream = await fetch(`${BASE}/models/${model}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await upstream.json().catch(() => null);
  return { ok: upstream.ok, status: upstream.status, json, model };
}

// Returns { ok, status, json, model } for the first model that answers; if none do, the primary's failure.
export async function geminiGenerate(apiKey, primaryModel, body) {
  let first = null;
  const primaryCooling = (coolingDown.get(primaryModel) || 0) > Date.now();
  // while the primary is known to be out of quota, go straight to the fallback that worked last time
  let models = primaryCooling && lastGood && lastGood !== primaryModel ? [lastGood, primaryModel] : [primaryModel];
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    if (i > 0 && (coolingDown.get(model) || 0) > Date.now()) continue;
    let res = await callOnce(apiKey, model, body);
    // some fallback models reject a thinking budget — retry that model once without it
    if (!res.ok && res.status === 400 && model !== primaryModel && body.generationConfig && body.generationConfig.thinkingConfig) {
      const { thinkingConfig, ...gc } = body.generationConfig;
      res = await callOnce(apiKey, model, { ...body, generationConfig: gc });
    }
    if (res.ok) { if (model !== primaryModel) lastGood = model; return res; }
    if (!first) first = res;
    const quotaOrDown = res.status === 429 || res.status === 404 || res.status === 400 || res.status >= 500;
    if (!quotaOrDown) return res; // a real error (bad key, blocked request) — another model will not fix it
    if (res.status === 429) coolingDown.set(model, Date.now() + 10 * 60 * 1000);
    if (i === 0) { // only look for fallbacks once the first choice has failed
      const all = await candidateModels(apiKey, primaryModel);
      models = [model, ...all.filter((m) => m !== model)];
    }
  }
  return first;
}
