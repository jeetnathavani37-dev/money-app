// Thin server-side proxy to the Gemini API (keeps GEMINI_API_KEY off the client).
// Speaks the same request/response shape the frontend already sends/expects
// (modeled on Claude's Messages API) and translates to/from Gemini's
// generateContent format, so src/App.jsx needed no changes when we switched
// providers — free tier, unlike Anthropic's pay-as-you-go billing.

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

function toGeminiContents(messages) {
  return (messages || []).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }],
  }));
}

// The frontend's FX-rate lookup asks for Claude's web_search tool; Gemini's equivalent
// is Search grounding, which returns a synthesized answer directly (no tool-result loop).
function wantsWebSearch(tools) {
  return Array.isArray(tools) && tools.some((t) => typeof t.type === "string" && t.type.startsWith("web_search"));
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: { message: "method not allowed" } });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: { message: "Server missing GEMINI_API_KEY env var." } });
    }

    const body = req.body || {};
    const geminiBody = {
      contents: toGeminiContents(body.messages),
      generationConfig: {
        maxOutputTokens: body.max_tokens || 4096,
        // Bounded, not dynamic (-1) — unbounded thinking on these single-shot report/tip
        // prompts risks running past Vercel's 60s function timeout (vercel.json), which
        // surfaces as a stuck spinner (a 504 retried 3x) rather than a fast error.
        ...(body.thinking ? { thinkingConfig: { thinkingBudget: 1024 } } : {}),
      },
      ...(wantsWebSearch(body.tools) ? { tools: [{ google_search: {} }] } : {}),
    };

    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(geminiBody),
      }
    );

    const upstreamJson = await upstream.json().catch(() => null);

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: { message: upstreamJson?.error?.message || `Gemini API error ${upstream.status}` } });
    }

    const candidate = upstreamJson?.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const text = parts.filter((p) => typeof p.text === "string").map((p) => p.text).join("\n");

    if (!text && candidate?.finishReason && candidate.finishReason !== "STOP") {
      return res.status(502).json({ error: { message: `Gemini stopped early: ${candidate.finishReason}` } });
    }

    // Reshaped into the Claude-Messages-style body the frontend already parses
    // (json.content.filter(c => c.type === "text")) — see src/App.jsx.
    return res.status(200).json({ content: [{ type: "text", text }] });
  } catch (err) {
    return res.status(500).json({ error: { message: err.message || "unknown error" } });
  }
}
