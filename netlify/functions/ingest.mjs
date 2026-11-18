/* /.netlify/functions/ingest
   Machine-to-machine upload endpoint. No user session needed: the caller
   proves itself with the INGEST_KEY secret instead.

   Built for the Google Drive automation: a Google Apps Script watches the
   "Demo Calls" folder and POSTs every new transcript here within a minute
   of it landing. The call is inserted as "queued" and a decode run is
   kicked off immediately, so a transcript dropped in Drive shows up
   decoded in the Library on its own.

   POST /.netlify/functions/ingest
     headers: { "x-ingest-key": INGEST_KEY }
     body:    { filename, transcript, sourceId?, uploadedBy? }

   Responses:
     200 { ok: true, id, duplicate: false }  inserted and decoding
     200 { ok: true, duplicate: true }       already ingested, skipped
     401 { error }                           bad or missing key
     400 { error }                           bad payload

   Duplicate protection: a call whose filename already exists is skipped,
   so the watcher can re-run safely without creating copies. */

import { json, parseBody, sb } from "../lib/util.mjs";
import { randomUUID } from "node:crypto";

const MAX_TRANSCRIPT_CHARS = 200000;

/* Start a decode run without waiting for it. The fetch below opens a
   separate function invocation that keeps running on its own; we abort
   our end after a moment so this request can answer the watcher fast.
   If the kick fails for any reason, the scheduled run picks the call up
   within two minutes anyway. */
async function kickQueue(event) {
  try {
    const proto = event.headers["x-forwarded-proto"] || "https";
    const host = event.headers.host;
    if (!host) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    await fetch(proto + "://" + host + "/.netlify/functions/process-queue", {
      method: "POST",
      signal: ctrl.signal,
    }).catch(() => {});
    clearTimeout(timer);
  } catch (e) {
    /* the schedule is the fallback, nothing to do here */
  }
}

export const handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only." });

  const expected = process.env.INGEST_KEY;
  if (!expected) {
    return json(500, {
      error: "INGEST_KEY is not set on this site. Add it in Netlify environment variables.",
    });
  }
  const supplied =
    event.headers["x-ingest-key"] ||
    event.headers["X-Ingest-Key"] ||
    (event.queryStringParameters || {}).key ||
    "";
  if (supplied !== expected) return json(401, { error: "Invalid ingest key." });

  const body = parseBody(event);
  const filename = String(body.filename || "").trim().slice(0, 200);
  const transcript = String(body.transcript || "").slice(0, MAX_TRANSCRIPT_CHARS);
  const uploadedBy = String(body.uploadedBy || "google-drive").trim().slice(0, 120);

  if (!filename || !transcript.trim()) {
    return json(400, { error: "filename and transcript are both required." });
  }

  const client = sb();

  /* Skip anything already in the library under the same filename. */
  const { data: existing, error: dupErr } = await client
    .from("calls")
    .select("id")
    .eq("filename", filename)
    .limit(1);
  if (dupErr) return json(500, { error: "Database error: " + dupErr.message });
  if (existing && existing.length) {
    return json(200, { ok: true, duplicate: true, id: existing[0].id });
  }

  const id = randomUUID();
  const { error: insErr } = await client.from("calls").insert({
    id,
    filename,
    transcript,
    status: "queued",
    uploaded_by: uploadedBy,
    uploaded_at: Date.now(),
  });
  if (insErr) return json(500, { error: "Database error: " + insErr.message });

  await kickQueue(event);

  return json(200, { ok: true, duplicate: false, id });
};
