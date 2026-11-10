// Shared AI decode logic for the Finexer Call Decoder.
// Primary: Gemini (free tier). Fallback: Groq (free tier) when Gemini is
// overloaded (503 "high demand") or keeps rate limiting.
// Self-contained on purpose: only needs env vars, no other project imports.

import { createClient } from "@supabase/supabase-js";

const GEMINI_CLIP = 48000; // chars of transcript sent to Gemini
const GROQ_CLIP = 20000; // smaller clip for Groq free tier token limits

export function supa() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set in the environment."
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function buildPrompt(transcript, clip) {
  const t =
    transcript.length > clip
      ? transcript.slice(0, clip) + "\n\n[Transcript clipped for length]"
      : transcript;

  return `You analyse Otter.ai transcripts of Finexer client intro calls. Finexer is a UK FCA-authorised Open Banking platform (AIS data + PIS payments). The "Unknown Speaker" doing the demo and pricing is the Finexer team. The other named speakers are the client.

Return ONLY a single JSON object, no markdown, with exactly these keys:
{
  "client_name": "the client's name, or 'Unknown' if not clear",
  "company_or_project": "their company or what they are building",
  "client_type": "a short label like 'fintech startup', 'accounting firm', 'lender'",
  "one_liner": "one sentence: who they are and what they want, from THEIR point of view",
  "intent": "why they took this call, in 1-2 sentences",
  "use_case": "what they want to build or do with open banking, 2-3 sentences",
  "pain_points": ["up to 5 problems or frustrations they described, in plain words"],
  "questions_they_asked": ["up to 6 questions the client asked, paraphrased"],
  "objections_or_concerns": ["up to 4 doubts, worries or pushbacks the client raised"],
  "buying_signals": ["up to 4 signs they are serious (timelines, asking for sandbox, pricing digging)"],
  "timeline_and_scale": "their launch timeline and user/volume numbers, if mentioned",
  "competitors_mentioned": ["competitor or alternative provider names mentioned, exactly as said"],
  "next_steps": ["up to 4 concrete next steps agreed or implied"],
  "verbatim_quotes": [
    {"quote": "an exact word-for-word quote copied from the transcript", "speaker": "who said it", "signal": "why this quote matters for content/sales"}
  ],
  "content_angles": ["4 blog or content ideas a Finexer writer could build from this call"]
}

Hard rules:
- Everything in English.
- verbatim_quotes: 3 to 5 quotes. Copy them CHARACTER FOR CHARACTER from the transcript. Do not fix grammar, do not shorten with ellipses, do not merge sentences. If you cannot copy it exactly, leave it out.
- Otter mis-hearings: interpret them in your analysis (for example "phoenixer" means Finexer, "making text digital" means Making Tax Digital, "20 5p" means 25p) but NEVER correct them inside verbatim_quotes.
- Write from the client's point of view, not Finexer's.
- If the transcript has no real conversation, set one_liner to "No conversation content was provided in the transcript." and use empty arrays.

TRANSCRIPT:
${t}`;
}

function extractJson(text) {
  if (!text) throw new Error("Empty model response");
  let s = String(text).trim();
  s = s.replace(/^```(json)?/i, "").replace(/```$/g, "").trim();
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a === -1 || b === -1 || b <= a) throw new Error("No JSON object in model response");
  return JSON.parse(s.slice(a, b + 1));
}

const arr = (v, n) =>
  (Array.isArray(v) ? v : v ? [v] : []).map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, n);
const str = (v) => String(v ?? "").trim();

export function normalizeInsights(raw, decodedBy) {
  const r = raw && typeof raw === "object" ? raw : {};
  const quotes = (Array.isArray(r.verbatim_quotes) ? r.verbatim_quotes : [])
    .map((q) =>
      typeof q === "string"
        ? { quote: q.trim(), speaker: "Unknown", signal: "" }
        : { quote: str(q?.quote), speaker: str(q?.speaker) || "Unknown", signal: str(q?.signal) }
    )
    .filter((q) => q.quote)
    .slice(0, 5);

  return {
    client_name: str(r.client_name) || "Unknown",
    company_or_project: str(r.company_or_project),
    client_type: str(r.client_type),
    one_liner: str(r.one_liner),
    intent: str(r.intent),
    use_case: str(r.use_case),
    pain_points: arr(r.pain_points, 5),
    questions_they_asked: arr(r.questions_they_asked, 6),
    objections_or_concerns: arr(r.objections_or_concerns, 4),
    buying_signals: arr(r.buying_signals, 4),
    timeline_and_scale: str(r.timeline_and_scale),
    competitors_mentioned: arr(r.competitors_mentioned, 8),
    next_steps: arr(r.next_steps, 4),
    verbatim_quotes: quotes,
    content_angles: arr(r.content_angles, 4),
    decoded_by: decodedBy,
  };
}

// ---------- Gemini ----------

async function callGemini(transcript) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw Object.assign(new Error("GEMINI_API_KEY is not set."), { fatal: true });
  const model = process.env.GEMINI_MODEL || "gemini-flash-latest";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const prompt = buildPrompt(transcript, GEMINI_CLIP);

  const body = (withThinking) => ({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
      ...(withThinking ? { thinkingConfig: { thinkingLevel: "low" } } : {}),
    },
  });

  let res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body(true)),
  });

  // Some models reject thinkingConfig with a 400; retry once without it.
  if (res.status === 400) {
    const txt = await res.text();
    if (/think/i.test(txt)) {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body(false)),
      });
    } else {
      throw Object.assign(new Error(geminiErrMsg(txt, 400)), { fatal: true });
    }
  }

  if (!res.ok) {
    const txt = await res.text();
    const msg = geminiErrMsg(txt, res.status);
    const retryable = res.status === 503 || res.status === 429 || res.status >= 500;
    throw Object.assign(new Error(msg), { retryable, overloaded: res.status === 503 || /high demand|overloaded/i.test(msg) });
  }

  const data = await res.json();
  const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
  return extractJson(text);
}

function geminiErrMsg(txt, status) {
  try {
    const j = JSON.parse(txt);
    return "Gemini: " + (j?.error?.message || `HTTP ${status}`);
  } catch {
    return `Gemini: HTTP ${status}`;
  }
}

// ---------- Groq ----------

async function callGroq(transcript) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw Object.assign(new Error("GROQ_API_KEY is not set."), { fatal: true });
  const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
  const prompt = buildPrompt(transcript, GROQ_CLIP);

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 4096,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    let msg = `Groq: HTTP ${res.status}`;
    try {
      msg = "Groq: " + (JSON.parse(txt)?.error?.message || `HTTP ${res.status}`);
    } catch {}
    const retryable = res.status === 429 || res.status >= 500;
    throw Object.assign(new Error(msg), { retryable });
  }

  const data = await res.json();
  return extractJson(data?.choices?.[0]?.message?.content || "");
}

// ---------- Combined decode with fallback ----------

// Tries Gemini first (2 attempts), then Groq if Gemini is overloaded or
// still rate limited and a GROQ_API_KEY exists.
// Returns normalized insights. Throws { retryable: true } errors when the
// call should go back to "queued", otherwise the call becomes "error".
export async function decodeTranscript(transcript) {
  let geminiErr = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await callGemini(transcript);
      return normalizeInsights(raw, "gemini");
    } catch (e) {
      geminiErr = e;
      if (e.fatal) break; // bad key, bad request: no point retrying
      if (attempt === 0 && e.retryable) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      break;
    }
  }

  // Gemini failed. Fall back to Groq when it is a capacity problem
  // (503 high demand, 429, 5xx) and a Groq key is configured.
  const canFallback = process.env.GROQ_API_KEY && geminiErr && (geminiErr.retryable || geminiErr.overloaded);
  if (canFallback) {
    try {
      const raw = await callGroq(transcript);
      return normalizeInsights(raw, "groq");
    } catch (groqErr) {
      const msg = `${geminiErr.message} | Fallback ${groqErr.message}`;
      throw Object.assign(new Error(msg), { retryable: !!(groqErr.retryable || geminiErr.retryable) });
    }
  }

  throw geminiErr || new Error("Decode failed");
}
