/* /.netlify/functions/analyze
   POST { id } -> loads the stored transcript, runs Gemini, saves insights
   into the shared library. Requires admin or writer role. */

import {
  json,
  parseBody,
  requireAuth,
  store,
  upsertIndexEntry,
  normalizeInsights,
} from "../lib/util.mjs";

const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const PROMPT_TRANSCRIPT_CHARS = 48000; // keep responses fast inside the function time limit

function buildPrompt(transcript) {
  const clipped =
    transcript.length > PROMPT_TRANSCRIPT_CHARS
      ? transcript.slice(0, PROMPT_TRANSCRIPT_CHARS) +
        "\n[Transcript truncated for length]"
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

export const handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only." });
  const { user, error } = await requireAuth(event, ["admin", "writer"]);
  if (error) return error;

  if (!process.env.GEMINI_API_KEY) {
    return json(500, {
      error:
        "GEMINI_API_KEY is not set. Add it to .env locally and to Netlify environment variables.",
    });
  }

  const { id } = parseBody(event);
  const s = store();
  const call = await s.get("call:" + id, { type: "json" });
  if (!call) return json(404, { error: "Call not found." });
  if (!call.transcript) {
    return json(400, { error: "No transcript stored for this call. Re-upload it." });
  }

  // Guard: if another person is already analyzing this call, skip.
  if (
    call.status === "processing" &&
    call.processingAt &&
    Date.now() - call.processingAt < 90000
  ) {
    return json(409, { error: "This call is already being analyzed." });
  }

  call.status = "processing";
  call.processingAt = Date.now();
  call.errorMsg = null;
  await s.setJSON("call:" + id, call);
  await upsertIndexEntry(call);

  const fail = async (statusCode, message, { keepQueued = false } = {}) => {
    call.status = keepQueued ? "queued" : "error";
    call.errorMsg = keepQueued ? null : message;
    call.processingAt = null;
    await s.setJSON("call:" + id, call);
    await upsertIndexEntry(call);
    return json(statusCode, { error: message });
  };

  let apiRes;
  try {
    apiRes = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" +
        MODEL +
        ":generateContent?key=" +
        process.env.GEMINI_API_KEY,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildPrompt(call.transcript) }] }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.2,
            maxOutputTokens: 8192,
            thinkingConfig: { thinkingLevel: "low" },
          },
        }),
      }
    );
  } catch (e) {
    return fail(502, "Could not reach the Gemini API. Retry.");
  }

  if (apiRes.status === 429) {
    // Rate limit: put the call back in the queue so a retry picks it up.
    return fail(429, "Gemini free tier rate limit hit. Retrying shortly.", {
      keepQueued: true,
    });
  }

  const data = await apiRes.json().catch(() => null);
  if (!apiRes.ok || !data) {
    const msg =
      data && data.error && data.error.message
        ? "Gemini: " + data.error.message
        : "Gemini API error " + apiRes.status + ".";
    return fail(502, msg);
  }

  const candidate = (data.candidates || [])[0] || {};
  const text = (candidate.content?.parts || []).map((p) => p.text || "").join("");

  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("no json");
    const insights = normalizeInsights(JSON.parse(text.slice(start, end + 1)));

    call.status = "done";
    call.insights = insights;
    call.processedAt = Date.now();
    call.processingAt = null;
    call.errorMsg = null;
    await s.setJSON("call:" + id, call);
    await upsertIndexEntry(call);
    return json(200, { call });
  } catch (e) {
    const reason = candidate.finishReason ? " (" + candidate.finishReason + ")" : "";
    return fail(502, "Could not parse the model output" + reason + ". Retry this call.");
  }
};
