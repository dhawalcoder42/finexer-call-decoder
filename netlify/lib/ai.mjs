/* Shared AI decode logic for the Finexer Call Decoder.
   Primary: Gemini (free tier). Fallback: Groq (free tier) when Gemini is
   overloaded (503 "high demand"), rate limited, or its key is missing.
   Used by both analyze.mjs (browser path) and process-queue.mjs (scheduled
   background path), so the prompt and rules stay identical everywhere. */

import { normalizeInsights } from "./util.mjs";

const GEMINI_CLIP = 48000; // transcript chars sent to Gemini
const GROQ_CLIP = 20000; // smaller clip for Groq free tier token limits

export function buildPrompt(transcript, clipChars = GEMINI_CLIP) {
  const clipped =
    transcript.length > clipChars
      ? transcript.slice(0, clipChars) + "\n[Transcript truncated for length]"
      : transcript;

  return `You are decoding a sales intro call transcript for the content team at Finexer, a UK FCA-authorised open banking infrastructure provider (account data via AIS, payments via PIS, plus verification and data enrichment products, near-universal UK bank coverage). One side of the call is the Finexer team, usually Ravi. The other side is a prospective client.

The transcript comes from Otter.ai and contains transcription errors: speaker labels are often "Unknown Speaker", company and product names get garbled (for example "phoenixer" or "finisher" means Finexer, "true layer" means TrueLayer, "zero" often means Xero, "making text digital" means Making Tax Digital / MTD), and numbers can split oddly ("20 5p" likely means 25p). Use fintech knowledge to interpret these intelligently in your analysis fields, but NEVER alter quoted text.

Your job: extract insights that help Finexer's writers understand this client's point of view, problems, and intent.

Hard rules:
1. Respond with ONLY one valid JSON object. No markdown fences, no commentary before or after.
2. All output in English.
3. Extract only what is actually said in the transcript. Use null or [] for anything not covered. Never invent details.
4. verbatim_quotes must be copied EXACTLY, character for character, from the transcript, including grammar mistakes and transcription artifacts. Do not clean them, do not remove words, do not paraphrase. Pick contiguous spans under 45 words each. Prefer the client's side of the call. Choose quotes that reveal pain, motivation, objections, or goals.
5. If the transcript names Finexer's data enrichment partner, do not repeat that partner's name anywhere. Write "enrichment partner" instead and do not select quotes that contain the name.
6. Do not use em dashes anywhere in your output.
7. Keep every array item under 16 words (quotes are exempt).

Return exactly this JSON shape:
{
  "client_name": "string or null, the client's name if said",
  "company_or_project": "string or null",
  "client_type": "short descriptor, e.g. early-stage fintech building an MTD tax app",
  "one_liner": "one sentence: who they are and what they want from this call",
  "intent": "1-2 sentences: why they took the call and the outcome they want",
  "use_case": "2-3 sentences: what they are building, for whom, and how open banking fits",
  "pain_points": ["max 5 real problems they voiced"],
  "questions_they_asked": ["max 6, condensed versions of their actual questions"],
  "objections_or_concerns": ["max 4"],
  "buying_signals": ["max 4, e.g. timeline, volume targets, next-step asks"],
  "timeline_and_scale": "string or null: launch dates, user targets, volumes",
  "competitors_mentioned": ["company or product names referenced"],
  "next_steps": ["max 4 agreed follow-ups"],
  "verbatim_quotes": [
    { "speaker": "best-guess speaker name or role", "quote": "exact text", "signal": "pain | intent | objection | goal | context" }
  ],
  "content_angles": ["max 4 concrete content ideas for Finexer's blog, grounded in this call"]
}
Include 3 to 5 verbatim_quotes.

Transcript:
"""
${clipped}
"""`;
}

function extractJson(text) {
  const s = String(text || "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw Object.assign(new Error("Could not parse the model output. Retry this call."), {
      parse: true,
    });
  }
  return JSON.parse(s.slice(start, end + 1));
}

/* ---------------- Gemini ---------------- */

async function callGemini(prompt, maxOutputTokens = 8192) {
  const model = process.env.GEMINI_MODEL || "gemini-flash-latest";
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    model +
    ":generateContent?key=" +
    process.env.GEMINI_API_KEY;

  const makeBody = (withThinking) =>
    JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2,
        maxOutputTokens,
        ...(withThinking ? { thinkingConfig: { thinkingLevel: "low" } } : {}),
      },
    });

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: makeBody(true),
    });
    // Some models reject thinkingConfig with a 400. Retry once without it.
    if (res.status === 400) {
      const txt = await res.text();
      if (/think/i.test(txt)) {
        res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: makeBody(false),
        });
      } else {
        throw Object.assign(new Error(geminiMsg(txt, 400)), { retryable: false });
      }
    }
  } catch (e) {
    if (e.retryable === false) throw e;
    throw Object.assign(new Error("Could not reach the Gemini API. Retry."), {
      retryable: true,
    });
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    const msg = geminiMsg(txt, res.status);
    throw Object.assign(new Error(msg), {
      retryable: res.status === 429 || res.status >= 500,
      overloaded:
        res.status === 503 || /high demand|overloaded|unavailable/i.test(msg),
    });
  }

  const data = await res.json().catch(() => null);
  const candidate = ((data && data.candidates) || [])[0] || {};
  const text = (candidate.content?.parts || []).map((p) => p.text || "").join("");
  try {
    return extractJson(text);
  } catch (e) {
    const reason = candidate.finishReason ? " (" + candidate.finishReason + ")" : "";
    throw Object.assign(
      new Error("Could not parse the model output" + reason + ". Retry this call."),
      { retryable: true }
    );
  }
}

function geminiMsg(txt, status) {
  try {
    const j = JSON.parse(txt);
    if (j && j.error && j.error.message) return "Gemini: " + j.error.message;
  } catch (e) {}
  return "Gemini API error " + status + ".";
}

/* ---------------- Groq ---------------- */

async function callGroq(prompt, maxTokens = 4000) {
  const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
  let res;
  try {
    res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + process.env.GROQ_API_KEY,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
      }),
    });
  } catch (e) {
    throw Object.assign(new Error("Could not reach the Groq API. Retry."), {
      retryable: true,
    });
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    let msg = "Groq API error " + res.status + ".";
    try {
      const j = JSON.parse(txt);
      if (j && j.error && j.error.message) msg = "Groq: " + j.error.message;
    } catch (e) {}
    throw Object.assign(new Error(msg), {
      retryable: res.status === 429 || res.status >= 500,
    });
  }

  const data = await res.json().catch(() => null);
  const text = data?.choices?.[0]?.message?.content || "";
  return extractJson(text);
}

/* ---------------- Generic JSON generation with fallback ----------------
   Tries Gemini first (2 attempts). Falls back to Groq when Gemini is
   overloaded / rate limited / unreachable, or when GEMINI_API_KEY is
   missing but GROQ_API_KEY exists.
   Returns { raw, provider }. Throws errors carrying { retryable } so
   callers can requeue or tell the user to retry. groqPrompt lets callers
   pass a shorter prompt for Groq's tighter free tier token limits. */

export async function generateJson(prompt, { maxOutputTokens = 8192, groqPrompt = null } = {}) {
  const hasGemini = Boolean(process.env.GEMINI_API_KEY);
  const hasGroq = Boolean(process.env.GROQ_API_KEY);

  if (!hasGemini && !hasGroq) {
    throw Object.assign(
      new Error(
        "GEMINI_API_KEY is not set. Add it (and optionally GROQ_API_KEY) to .env locally and to Netlify environment variables."
      ),
      { retryable: false }
    );
  }

  let geminiErr = null;
  if (hasGemini) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const raw = await callGemini(prompt, maxOutputTokens);
        return { raw, provider: "gemini" };
      } catch (e) {
        geminiErr = e;
        if (!e.retryable && !e.overloaded) break;
        if (attempt === 0) await new Promise((r) => setTimeout(r, 1500));
      }
    }
  }

  const shouldFallback =
    hasGroq && (!hasGemini || (geminiErr && (geminiErr.retryable || geminiErr.overloaded)));

  if (shouldFallback) {
    try {
      const raw = await callGroq(groqPrompt || prompt, Math.min(maxOutputTokens, 4000));
      return { raw, provider: "groq" };
    } catch (groqErr) {
      const msg = geminiErr
        ? geminiErr.message + " Fallback failed too. " + groqErr.message
        : groqErr.message;
      throw Object.assign(new Error(msg), {
        retryable: Boolean(groqErr.retryable || (geminiErr && geminiErr.retryable)),
      });
    }
  }

  throw geminiErr || Object.assign(new Error("Generation failed."), { retryable: true });
}

/* ---------------- Transcript decode ----------------
   Returns normalized insights with a decoded_by field ("gemini"/"groq"). */

export async function decodeTranscript(transcript) {
  const { raw, provider } = await generateJson(buildPrompt(transcript, GEMINI_CLIP), {
    maxOutputTokens: 8192,
    groqPrompt: buildPrompt(transcript, GROQ_CLIP),
  });
  const insights = normalizeInsights(raw);
  insights.decoded_by = provider;
  return insights;
}
