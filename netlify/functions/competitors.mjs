/* /.netlify/functions/competitors
   GET  -> returns the saved competitor-switchers report (no Gemini call)
   POST { action: "generate" } -> rebuilds it from decoded calls that mention
   competitors, saves to app_state, returns it. Admin/writer only. */

import { json, parseBody, requireAuth, sb } from "../lib/util.mjs";

const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const STATE_KEY = "competitors";
const MAX_CALL_BLOCKS = 120;

const deDash = (s) => String(s || "").replace(/\u2014/g, "-").replace(/\u2013/g, "-");

function buildPrompt(callBlocks) {
  return `You are analysing sales intro call insights for Finexer, a UK FCA-authorised open banking infrastructure provider. Below are summaries of calls where the prospective client mentioned one or more of Finexer's competitors (for example TrueLayer, GoCardless, Plaid, Yapily, Stripe, Tink, or any other provider named).

Your job: build a competitor report grouped by competitor, showing which clients are coming FROM each competitor and why.

For every client under a competitor, classify the relationship strictly from the text:
- "switching from": they currently use or used this competitor and want to move away, or are unhappy with it
- "currently using": they use it today with no clear intent to leave
- "evaluating": they are comparing this competitor against Finexer
- "mentioned": the name came up without any of the above

Hard rules:
- Respond with ONLY one valid JSON object. No markdown fences, no commentary.
- English only. Do not use em dashes anywhere.
- Only use the information provided. Never invent clients, competitors, reasons, or pain points.
- "why" must be under 25 words, grounded in what the client actually said.
- pain_points: copy the client's listed pain points that are relevant, up to 4.
- Sort competitors by how many "switching from" plus "evaluating" clients they have, most first.
- Exclude Finexer itself from the competitor list.

Return exactly this JSON shape:
{
  "competitors": [
    {
      "name": "Competitor name",
      "clients": [
        {
          "client": "Client label",
          "relationship": "switching from",
          "why": "short reason in the client's terms",
          "pain_points": ["their voiced pain points"]
        }
      ]
    }
  ]
}

CALLS:
${callBlocks.join("\n\n")}`;
}

export const handler = async (event) => {
  /* ---------- GET: saved report ---------- */
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
    return json(200, { report: data ? data.value : null });
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

  const callBlocks = [];
  let usedCalls = 0;

  for (const row of data || []) {
    const i = row.insights || {};
    const comps = Array.isArray(i.competitors_mentioned)
      ? i.competitors_mentioned.filter(Boolean)
      : [];
    if (!comps.length) continue;
    usedCalls++;
    if (callBlocks.length >= MAX_CALL_BLOCKS) continue;
    const label =
      i.client_name ||
      i.company_or_project ||
      String(row.filename || "").replace(/\.txt$/i, "");
    const parts = ["CLIENT: " + label, "COMPETITORS MENTIONED: " + comps.join(", ")];
    if (i.one_liner) parts.push("SUMMARY: " + i.one_liner);
    if (i.intent) parts.push("INTENT: " + i.intent);
    if (i.use_case) parts.push("USE CASE: " + i.use_case);
    if (Array.isArray(i.pain_points) && i.pain_points.length) {
      parts.push("PAIN POINTS: " + i.pain_points.join(" ; "));
    }
    if (Array.isArray(i.buying_signals) && i.buying_signals.length) {
      parts.push("BUYING SIGNALS: " + i.buying_signals.join(" ; "));
    }
    if (Array.isArray(i.objections_or_concerns) && i.objections_or_concerns.length) {
      parts.push("OBJECTIONS: " + i.objections_or_concerns.join(" ; "));
    }
    callBlocks.push(parts.join("\n"));
  }

  if (!callBlocks.length) {
    return json(400, {
      error: "No decoded calls mention a competitor yet. Decode more calls first.",
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
          contents: [{ parts: [{ text: buildPrompt(callBlocks) }] }],
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

    const RELS = ["switching from", "currently using", "evaluating", "mentioned"];
    const competitors = (Array.isArray(raw.competitors) ? raw.competitors : [])
      .filter((c) => c && c.name)
      .map((c) => ({
        name: deDash(c.name),
        clients: (Array.isArray(c.clients) ? c.clients : [])
          .filter((cl) => cl && cl.client)
          .map((cl) => ({
            client: deDash(cl.client),
            relationship: RELS.includes(cl.relationship) ? cl.relationship : "mentioned",
            why: deDash(cl.why || ""),
            pain_points: Array.isArray(cl.pain_points)
              ? cl.pain_points.map((p) => deDash(p)).slice(0, 4)
              : [],
          })),
      }))
      .filter((c) => c.clients.length);

    const report = {
      generatedAt: Date.now(),
      totalCalls: usedCalls,
      competitors,
    };

    const { error: saveErr } = await client.from("app_state").upsert({
      key: STATE_KEY,
      value: report,
      updated_at: Date.now(),
    });
    if (saveErr) {
      return json(500, {
        error: "Report was generated but could not be saved: " + saveErr.message,
      });
    }

    return json(200, { report });
  } catch (e) {
    const reason = candidate.finishReason ? " (" + candidate.finishReason + ")" : "";
    return json(502, { error: "Could not parse the report output" + reason + ". Retry." });
  }
};
