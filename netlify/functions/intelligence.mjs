/* /.netlify/functions/intelligence
   The Sales Intelligence report. Replaces the old Switchers report.

   GET -> returns the saved report (no AI call).
   POST { action: "generate" } -> incremental rebuild (admin/writer):
     - Calls already analysed are served from a cache in app_state, so
       regenerating costs ZERO AI calls unless there are NEW decoded calls.
     - New calls (up to 20 per run) go to the AI in ONE request that
       assigns issue themes, industry, product interest, and competitor
       relationships (including why they looked at alternatives and what
       pulled them toward Finexer).
     - The report itself (counts, grouping, status guesses) is assembled
       in plain code from the cache. No AI needed for that.
   POST { action: "set_status", id, status } -> manual deal status on a
     call: open / engaged / converted / lost, or "" to clear (admin/writer).

   Needs one DB column (run once in Supabase SQL editor):
     alter table calls add column if not exists deal_status text; */

import { json, parseBody, requireAuth, sb, lightEntry, rowToCall } from "../lib/util.mjs";
import { generateJson } from "../lib/ai.mjs";

const REPORT_KEY = "intelligence";
const CACHE_KEY = "intel_cache";
const MAX_NEW_PER_RUN = 20;

const INDUSTRIES = [
  "Accounting & ERP",
  "Lawtech",
  "EPOS",
  "Payroll & Invoicing",
  "Proptech & Real Estate",
  "Utility Billing",
  "Fintech app",
  "Lending & Credit",
  "Other",
];
const PRODUCTS = ["Data (AIS)", "Payments (PIS)", "Verification", "Enrichment"];
const RELATIONSHIPS = ["switching from", "currently using", "evaluating", "mentioned"];
export const DEAL_STATUSES = ["open", "engaged", "converted", "lost"];

const deDash = (s) => String(s || "").replace(/—/g, "-").replace(/–/g, "-").trim();

/* ---------------- pure helpers (exported for tests) ---------------- */

export function callLabel(row) {
  const i = row.insights || {};
  return (
    i.client_name ||
    i.company_or_project ||
    String(row.filename || "").replace(/\.txt$/i, "")
  );
}

// Zero-AI status guess from what the client actually said on the call.
// Manual deal_status always wins over this.
export function guessStatus(insights) {
  const i = insights || {};
  const signals = (i.buying_signals || []).length;
  const steps = (i.next_steps || []).length;
  const objections = (i.objections_or_concerns || []).length;
  if (signals >= 2 || steps >= 2) return "engaged";
  if (objections >= 2 && steps === 0) return "at risk";
  return "open";
}

export function normalizeAssignments(raw, validIds, existingThemes) {
  const out = {};
  const list = Array.isArray(raw && raw.calls) ? raw.calls : [];
  const themeLookup = new Map(existingThemes.map((t) => [t.toLowerCase(), t]));
  for (const c of list) {
    if (!c || !validIds.has(c.id)) continue;
    const themes = (Array.isArray(c.themes) ? c.themes : [])
      .map((t) => deDash(t))
      .filter(Boolean)
      .map((t) => themeLookup.get(t.toLowerCase()) || t)
      .slice(0, 3);
    for (const t of themes) {
      if (!themeLookup.has(t.toLowerCase())) themeLookup.set(t.toLowerCase(), t);
    }
    const industry = INDUSTRIES.includes(c.industry) ? c.industry : "Other";
    const products = (Array.isArray(c.products) ? c.products : []).filter((p) =>
      PRODUCTS.includes(p)
    );
    const competitors = (Array.isArray(c.competitors) ? c.competitors : [])
      .filter((x) => x && x.name && !/finexer/i.test(x.name))
      .map((x) => ({
        name: deDash(x.name),
        relationship: RELATIONSHIPS.includes(x.relationship) ? x.relationship : "mentioned",
        why_alternative: deDash(x.why_alternative).slice(0, 180),
        why_finexer: deDash(x.why_finexer).slice(0, 180),
      }))
      .slice(0, 6);
    out[c.id] = { themes, industry, products, competitors };
  }
  return out;
}

export function assembleReport(rows, cache) {
  const byCall = cache.byCall || {};
  const themesMap = new Map();
  const compsMap = new Map();
  const indMap = new Map();
  const productCounts = Object.fromEntries(PRODUCTS.map((p) => [p, 0]));
  let notStated = 0;
  const statusCounts = {};
  let analyzed = 0;

  for (const row of rows) {
    const entry = byCall[row.id];
    const i = row.insights || {};
    const manual = row.deal_status && DEAL_STATUSES.includes(row.deal_status) ? row.deal_status : null;
    const status = manual || guessStatus(i);
    statusCounts[status + (manual ? "" : " (guess)")] =
      (statusCounts[status + (manual ? "" : " (guess)")] || 0) + 1;
    if (!entry) continue;
    analyzed++;

    const client = {
      id: row.id,
      label: callLabel(row),
      industry: entry.industry || "Other",
      status,
      manual: Boolean(manual),
    };

    for (const t of entry.themes || []) {
      if (!themesMap.has(t)) themesMap.set(t, { theme: t, count: 0, clients: [], examples: [] });
      const th = themesMap.get(t);
      th.count++;
      th.clients.push(client);
      if (th.examples.length < 2 && Array.isArray(i.pain_points) && i.pain_points[0]) {
        const ex = i.pain_points.find((p) => p && !th.examples.includes(p));
        if (ex) th.examples.push(ex);
      }
    }

    for (const comp of entry.competitors || []) {
      if (!compsMap.has(comp.name)) compsMap.set(comp.name, { name: comp.name, clients: [] });
      compsMap.get(comp.name).clients.push({
        ...client,
        relationship: comp.relationship,
        why_alternative: comp.why_alternative,
        why_finexer: comp.why_finexer,
      });
    }

    const ind = entry.industry || "Other";
    if (!indMap.has(ind)) indMap.set(ind, { name: ind, count: 0, themes: {}, clients: [] });
    const im = indMap.get(ind);
    im.count++;
    im.clients.push(client.label);
    for (const t of entry.themes || []) im.themes[t] = (im.themes[t] || 0) + 1;

    const prods = entry.products || [];
    if (!prods.length) notStated++;
    for (const p of prods) productCounts[p]++;
  }

  const issues = [...themesMap.values()].sort((a, b) => b.count - a.count);
  const weight = (c) =>
    c.clients.filter((x) => x.relationship === "switching from" || x.relationship === "evaluating").length;
  const alternatives = [...compsMap.values()]
    .map((c) => ({ ...c, count: c.clients.length }))
    .sort((a, b) => weight(b) - weight(a) || b.count - a.count);
  const industries = [...indMap.values()]
    .map((im) => ({
      name: im.name,
      count: im.count,
      top_issues: Object.entries(im.themes)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([t, n]) => t + " (" + n + ")"),
      clients: im.clients,
    }))
    .sort((a, b) => b.count - a.count);

  const products = PRODUCTS.map((p) => ({ name: p, count: productCounts[p] })).filter(
    (p) => p.count > 0
  );
  if (notStated) products.push({ name: "Not stated on the call", count: notStated });

  return {
    generatedAt: Date.now(),
    totalCalls: rows.length,
    analyzedCalls: analyzed,
    statusCounts,
    products,
    issues,
    alternatives,
    industries,
  };
}

/* ---------------- AI assignment for NEW calls only ---------------- */

function buildAssignPrompt(blocks, existingThemes) {
  return `You are classifying decoded sales intro calls for Finexer, a UK FCA-authorised open banking infrastructure provider (Data/AIS, Payments/PIS, Verification, data Enrichment). Each CALL block below is one prospective client.

For EVERY call, assign:
1. "themes": 1 to 3 short issue themes capturing the problems this client voiced. REUSE names from EXISTING THEMES verbatim whenever one fits; only create a new theme name (max 6 words) when nothing fits. Themes describe the client's problem, not the solution.
2. "industry": exactly one of ${JSON.stringify(INDUSTRIES)}.
3. "products": which Finexer product areas the call is really about, zero or more of ${JSON.stringify(PRODUCTS)}.
4. "competitors": for each competitor or alternative provider named in the block, an object with:
   - "name": the provider name as given
   - "relationship": exactly one of ${JSON.stringify(RELATIONSHIPS)}
   - "why_alternative": under 20 words, in the client's terms, why they use or looked at that alternative, or what pushed them away from it. "" if the text does not say.
   - "why_finexer": under 20 words, what drew them toward Finexer in this comparison (their words: pricing clarity, coverage, agent licence, sandbox, support). "" if the text does not say. Never invent.

Hard rules:
- Respond with ONLY one valid JSON object. No markdown fences, no commentary.
- English only. No em dashes anywhere.
- Ground everything strictly in the blocks. Never invent competitors, reasons, or themes for a call that has none.
- Exclude Finexer itself from competitors.

Return exactly: {"calls":[{"id":"...","themes":[],"industry":"...","products":[],"competitors":[]}]}

EXISTING THEMES:
${existingThemes.length ? existingThemes.map((t) => "- " + t).join("\n") : "(none yet)"}

CALLS:
${blocks.join("\n\n")}`;
}

function callBlock(row) {
  const i = row.insights || {};
  const parts = ["CALL id=" + row.id, "CLIENT: " + callLabel(row)];
  if (i.client_type) parts.push("TYPE: " + i.client_type);
  if (i.one_liner) parts.push("SUMMARY: " + i.one_liner);
  if (i.intent) parts.push("INTENT: " + i.intent);
  if (i.use_case) parts.push("USE CASE: " + String(i.use_case).slice(0, 300));
  const j = (a) => (Array.isArray(a) && a.length ? a.join(" ; ") : "");
  if (j(i.pain_points)) parts.push("PAIN POINTS: " + j(i.pain_points));
  if (j(i.objections_or_concerns)) parts.push("OBJECTIONS: " + j(i.objections_or_concerns));
  if (j(i.buying_signals)) parts.push("BUYING SIGNALS: " + j(i.buying_signals));
  if (j(i.competitors_mentioned)) parts.push("COMPETITORS MENTIONED: " + j(i.competitors_mentioned));
  return parts.join("\n");
}

/* ---------------- handler ---------------- */

export const handler = async (event) => {
  if (event.httpMethod === "GET") {
    const { error } = await requireAuth(event);
    if (error) return error;
    const client = sb();
    const { data, error: dbErr } = await client
      .from("app_state")
      .select("value")
      .eq("key", REPORT_KEY)
      .maybeSingle();
    if (dbErr) return json(500, { error: "Database error: " + dbErr.message });
    return json(200, { report: data ? data.value : null });
  }

  if (event.httpMethod !== "POST") return json(405, { error: "POST only." });
  const { error } = await requireAuth(event, ["admin", "writer"]);
  if (error) return error;

  const body = parseBody(event);
  const client = sb();

  /* ----- manual deal status ----- */
  if (body.action === "set_status") {
    const status = body.status === "" || body.status == null ? null : String(body.status);
    if (status !== null && !DEAL_STATUSES.includes(status)) {
      return json(400, { error: "Unknown status." });
    }
    const { data: rows, error: updErr } = await client
      .from("calls")
      .update({ deal_status: status })
      .eq("id", body.id)
      .select("*");
    if (updErr) {
      const hint = /deal_status/.test(updErr.message)
        ? " Run the one-line SQL in supabase-setup.sql to add the deal_status column."
        : "";
      return json(500, { error: "Database error: " + updErr.message + hint });
    }
    if (!rows || !rows.length) return json(404, { error: "Call not found." });
    return json(200, { call: lightEntry(rowToCall(rows[0])) });
  }

  if (body.action !== "generate") return json(400, { error: "Unknown action." });

  /* ----- incremental generate ----- */
  const { data: rows, error: dbErr } = await client
    .from("calls")
    .select("id, filename, insights, deal_status")
    .eq("status", "done");
  if (dbErr) return json(500, { error: "Database error: " + dbErr.message });

  const done = rows || [];
  if (!done.length) {
    return json(400, { error: "No decoded calls yet. Decode some calls first." });
  }

  const { data: cacheRow, error: cacheErr } = await client
    .from("app_state")
    .select("value")
    .eq("key", CACHE_KEY)
    .maybeSingle();
  if (cacheErr) return json(500, { error: "Database error: " + cacheErr.message });
  const cache = (cacheRow && cacheRow.value) || { byCall: {} };
  cache.byCall = cache.byCall || {};

  // Drop cache entries for deleted calls.
  const liveIds = new Set(done.map((r) => r.id));
  for (const id of Object.keys(cache.byCall)) {
    if (!liveIds.has(id)) delete cache.byCall[id];
  }

  const existingThemes = [
    ...new Set(Object.values(cache.byCall).flatMap((e) => e.themes || [])),
  ];
  const newRows = done.filter((r) => !cache.byCall[r.id]);
  const batch = newRows.slice(0, MAX_NEW_PER_RUN);
  let analyzedNow = 0;
  let provider = null;

  if (batch.length) {
    const prompt = buildAssignPrompt(batch.map(callBlock), existingThemes);
    let result;
    try {
      result = await generateJson(prompt, { maxOutputTokens: 6000 });
    } catch (e) {
      return json(e.retryable ? 503 : 502, { error: String(e.message || "Generation failed.") });
    }
    provider = result.provider;
    const assigned = normalizeAssignments(
      result.raw,
      new Set(batch.map((r) => r.id)),
      existingThemes
    );
    analyzedNow = Object.keys(assigned).length;
    Object.assign(cache.byCall, assigned);

    const { error: saveCacheErr } = await client.from("app_state").upsert({
      key: CACHE_KEY,
      value: cache,
      updated_at: Date.now(),
    });
    if (saveCacheErr) {
      return json(500, { error: "Could not save the analysis cache: " + saveCacheErr.message });
    }
  }

  const report = assembleReport(done, cache);
  report.analyzedNow = analyzedNow;
  report.fromCache = report.analyzedCalls - analyzedNow;
  report.pendingNew = Math.max(0, newRows.length - batch.length);
  if (provider) report.provider = provider;

  const { error: saveErr } = await client.from("app_state").upsert({
    key: REPORT_KEY,
    value: report,
    updated_at: Date.now(),
  });
  if (saveErr) {
    return json(500, { error: "Report built but could not be saved: " + saveErr.message });
  }

  return json(200, { report });
};
