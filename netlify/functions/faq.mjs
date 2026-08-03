/* /.netlify/functions/faq
   GET  -> returns the saved FAQ (no Gemini call, any role)
   POST { action: "generate" } -> rebuilds the FAQ from all decoded calls,
   saves it to the database, returns it. Admin/writer only. */

import { json, parseBody, requireAuth, sb } from "../lib/util.mjs";

const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const MAX_LINES = 400;
const STATE_KEY = "faq";

const deDash = (s) => String(s || "").replace(/\u2014/g, "-").replace(/\u2013/g, "-");

function buildPrompt(questionLines, objectionLines, totalCalls) {
  return `You are building a Sales Call FAQ for new salespeople at Finexer, a UK FCA-authorised open banking infrastructure provider. Below are real questions prospective clients asked on intro calls, and objections they raised. Each line is "CLIENT_LABEL :: text".

Your job:
1. Merge duplicate or near-duplicate questions into one canonical, naturally phrased question.
2. Group questions into 4 to 8 themed categories (for example: Pricing and commercials, Integration and technical, Compliance and regulation, Bank coverage, Product capabilities, Timelines and onboarding). Only use categories that actually fit the data.
3. For each merged question, count how many distinct clients asked it and list their labels.
4. Do the same merge-and-count for objections, as a flat list.

Hard rules:
- Respond with ONLY one valid JSON object. No markdown fences, no commentary.
- English only. Do not use em dashes anywhere.
- Only use the questions and objections provided. Never invent new ones.
- Keep each canonical question under 20 words, phrased the way a client would ask it.
- Sort categories and items by how frequently they come up, most common first.

Return exactly this JSON shape:
{
  "categories": [
    {
      "title": "category name",
      "items": [
        { "question": "canonical question", "count": 3, "asked_by": ["Client A", "Client B"] }
      ]
    }
  ],
  "common_objections": [
    { "objection": "canonical objection", "count": 2, "raised_by": ["Client A"] }
  ]
}

Data is from ${totalCalls} decoded calls.

QUESTIONS:
${questionLines.join("\n")}

OBJECTIONS:
${objectionLines.length ? objectionLines.join("\n") : "(none recorded)"}`;
}

export const handler = async (event) => {
  /* ---------- GET: return saved FAQ, no Gemini call ---------- */
  if (event.httpMethod === "GET") {
    const { error } = await requireAuth(event);
    if (error) return error;
    const client = sb();
    const { data, error: dbErr } = await client
      .from("app_state")
      .select("value")
      .eq("key", STATE_KEY)
      .maybeSingle();
    if (dbErr) return json(500, { error: "Database error: " + dbErr.message });
    return json(200, { faq: data ? data.value : null });
  }

  if (event.httpMethod !== "POST") return json(405, { error: "POST only." });

  /* ---------- POST generate: admin/writer only ---------- */
  const { error } = await requireAuth(event, ["admin", "writer"]);
  if (error) return error;

  const body = parseBody(event);
  if (body.action !== "generate") return json(400, { error: "Unknown action." });

  if (!process.env.GEMINI_API_KEY) {
    return json(500, { error: "GEMINI_API_KEY is not set." });
  }

  const client = sb();
  const { data, error: dbErr } = await client
    .from("calls")
    .select("id, filename, insights")
    .eq("status", "done");
  if (dbErr) return json(500, { error: "Database error: " + dbErr.message });

  const questionLines = [];
  const objectionLines = [];
  let usedCalls = 0;

  for (const row of data || []) {
    const i = row.insights || {};
    const label =
      i.client_name ||
      i.company_or_project ||
      String(row.filename || "").replace(/\.txt$/i, "");
    const qs = Array.isArray(i.questions_they_asked) ? i.questions_they_asked : [];
    const obs = Array.isArray(i.objections_or_concerns) ? i.objections_or_concerns : [];
    if (qs.length || obs.length) usedCalls++;
    for (const q of qs) {
      if (questionLines.length < MAX_LINES) questionLines.push(label + " :: " + q);
    }
    for (const o of obs) {
      if (objectionLines.length < MAX_LINES) objectionLines.push(label + " :: " + o);
    }
  }

  if (!questionLines.length) {
    return json(400, {
      error: "No decoded calls with client questions yet. Decode some calls first.",
    });
  }

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
          contents: [
            {
              parts: [
                { text: buildPrompt(questionLines, objectionLines, usedCalls) },
              ],
            },
          ],
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
    return json(502, { error: "Could not reach the Gemini API. Retry." });
  }

  if (apiRes.status === 429) {
    return json(429, { error: "Gemini rate limit hit. Wait a minute and retry." });
  }

  const out = await apiRes.json().catch(() => null);
  if (!apiRes.ok || !out) {
    const msg =
      out && out.error && out.error.message
        ? "Gemini: " + out.error.message
        : "Gemini API error " + apiRes.status + ".";
    return json(502, { error: msg });
  }

  const candidate = (out.candidates || [])[0] || {};
  const text = (candidate.content?.parts || []).map((p) => p.text || "").join("");

  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("no json");
    const raw = JSON.parse(text.slice(start, end + 1));

    const categories = (Array.isArray(raw.categories) ? raw.categories : [])
      .map((c) => ({
        title: deDash(c.title || "Other"),
        items: (Array.isArray(c.items) ? c.items : [])
          .filter((it) => it && it.question)
          .map((it) => ({
            question: deDash(it.question),
            count: Number(it.count) || 1,
            asked_by: Array.isArray(it.asked_by)
              ? it.asked_by.map((a) => deDash(a)).slice(0, 12)
              : [],
          })),
      }))
      .filter((c) => c.items.length);

    const common_objections = (Array.isArray(raw.common_objections)
      ? raw.common_objections
      : []
    )
      .filter((o) => o && o.objection)
      .map((o) => ({
        objection: deDash(o.objection),
        count: Number(o.count) || 1,
        raised_by: Array.isArray(o.raised_by)
          ? o.raised_by.map((a) => deDash(a)).slice(0, 12)
          : [],
      }));

    const faq = {
      generatedAt: Date.now(),
      totalCalls: usedCalls,
      categories,
      common_objections,
    };

    const { error: saveErr } = await client.from("app_state").upsert({
      key: STATE_KEY,
      value: faq,
      updated_at: Date.now(),
    });
    if (saveErr) {
      return json(500, {
        error:
          "FAQ was generated but could not be saved: " +
          saveErr.message +
          ". Did you run the app_state SQL in Supabase?",
      });
    }

    return json(200, { faq });
  } catch (e) {
    const reason = candidate.finishReason ? " (" + candidate.finishReason + ")" : "";
    return json(502, { error: "Could not parse the FAQ output" + reason + ". Retry." });
  }
};
