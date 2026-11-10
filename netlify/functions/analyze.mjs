/* /.netlify/functions/analyze
   POST { id } -> loads the stored transcript, decodes it (Gemini first,
   Groq fallback when Gemini is overloaded), saves insights into the shared
   library (Supabase). Requires admin or writer role. */

import { json, parseBody, requireAuth, sb } from "../lib/util.mjs";
import { decodeTranscript } from "../lib/ai.mjs";

export const handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only." });
  const { user, error } = await requireAuth(event, ["admin", "writer"]);
  if (error) return error;

  if (!process.env.GEMINI_API_KEY && !process.env.GROQ_API_KEY) {
    return json(500, {
      error:
        "GEMINI_API_KEY is not set. Add it to .env locally and to Netlify environment variables.",
    });
  }

  const { id } = parseBody(event);
  const client = sb();
  const { data: row, error: fetchErr } = await client
    .from("calls")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) return json(500, { error: "Database error: " + fetchErr.message });
  if (!row) return json(404, { error: "Call not found." });
  if (!row.transcript) {
    return json(400, { error: "No transcript stored for this call. Re-upload it." });
  }

  // Guard: if another person is already analyzing this call, skip.
  if (
    row.status === "processing" &&
    row.processing_at &&
    Date.now() - row.processing_at < 90000
  ) {
    return json(409, { error: "This call is already being analyzed." });
  }

  const now = Date.now();
  await client
    .from("calls")
    .update({ status: "processing", processing_at: now, error_msg: null })
    .eq("id", id);

  const fail = async (statusCode, message, { keepQueued = false } = {}) => {
    await client
      .from("calls")
      .update({
        status: keepQueued ? "queued" : "error",
        error_msg: keepQueued ? null : message,
        processing_at: null,
      })
      .eq("id", id);
    return json(statusCode, { error: message });
  };

  let insights;
  try {
    insights = await decodeTranscript(row.transcript);
  } catch (e) {
    const message = String(e.message || "Decode failed.");
    if (e.retryable) {
      // Both providers busy or rate limited: put the call back in the queue.
      // The browser retries, and process-queue also picks it up within 10 min.
      return fail(503, message + " The call stays queued and will retry.", {
        keepQueued: true,
      });
    }
    return fail(502, message);
  }

  const processedAt = Date.now();
  const { error: updErr } = await client
    .from("calls")
    .update({
      status: "done",
      insights,
      processed_at: processedAt,
      processing_at: null,
      error_msg: null,
    })
    .eq("id", id);
  if (updErr) return json(500, { error: "Database error: " + updErr.message });

  return json(200, {
    call: {
      id: row.id,
      filename: row.filename,
      transcript: row.transcript,
      status: "done",
      insights,
      errorMsg: null,
      uploadedBy: row.uploaded_by,
      uploadedAt: row.uploaded_at,
      processedAt,
      processingAt: null,
    },
  });
};
