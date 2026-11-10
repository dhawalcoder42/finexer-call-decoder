/* Scheduled background processor for the Finexer Call Decoder.
   Netlify runs this every 10 minutes (schedule set in netlify.toml).
   It picks the oldest queued call (requeuing anything stuck in
   "processing" for 10+ minutes first), decodes it with the shared
   Gemini + Groq logic, and saves the result. Queued calls therefore
   get decoded even when nobody has the app open, and the regular hit
   also keeps the free Supabase project from pausing.

   It processes ONE call per run on purpose: Netlify function time
   limits are tight, and one decode fits comfortably. Six calls an
   hour clears a normal day's uploads in the background. */

import { sb } from "../lib/util.mjs";
import { decodeTranscript } from "../lib/ai.mjs";

const STUCK_MS = 10 * 60 * 1000;

export const handler = async () => {
  const client = sb();
  const now = Date.now();

  // 1) Requeue anything stuck in "processing" for 10+ minutes.
  await client
    .from("calls")
    .update({ status: "queued", processing_at: null })
    .eq("status", "processing")
    .lt("processing_at", now - STUCK_MS);

  // 2) Pick the oldest queued call.
  const { data: rows, error: pickErr } = await client
    .from("calls")
    .select("id, filename, transcript")
    .eq("status", "queued")
    .order("uploaded_at", { ascending: true })
    .limit(1);

  if (pickErr) {
    console.error("process-queue: pick failed:", pickErr.message);
    return { statusCode: 500, body: "pick failed" };
  }
  if (!rows || rows.length === 0) {
    return { statusCode: 200, body: "queue empty" };
  }

  const call = rows[0];

  if (!call.transcript) {
    await client
      .from("calls")
      .update({
        status: "error",
        error_msg: "No transcript stored for this call. Re-upload it.",
        processing_at: null,
      })
      .eq("id", call.id);
    return { statusCode: 200, body: "no transcript" };
  }

  // 3) Claim it (only if still queued, so we do not race a browser session).
  const { data: claimed } = await client
    .from("calls")
    .update({ status: "processing", processing_at: now, error_msg: null })
    .eq("id", call.id)
    .eq("status", "queued")
    .select("id");

  if (!claimed || claimed.length === 0) {
    return { statusCode: 200, body: "call already claimed" };
  }

  // 4) Decode and save.
  try {
    const insights = await decodeTranscript(call.transcript);
    await client
      .from("calls")
      .update({
        status: "done",
        insights,
        error_msg: null,
        processed_at: Date.now(),
        processing_at: null,
      })
      .eq("id", call.id);
    console.log(
      'process-queue: decoded "' + call.filename + '" via ' + insights.decoded_by
    );
    return { statusCode: 200, body: "decoded " + call.id };
  } catch (e) {
    const retryable = Boolean(e.retryable);
    await client
      .from("calls")
      .update({
        status: retryable ? "queued" : "error",
        error_msg: String(e.message || e).slice(0, 500),
        processing_at: null,
      })
      .eq("id", call.id);
    console.error('process-queue: failed "' + call.filename + '":', e.message);
    return { statusCode: 200, body: "failed " + call.id + ": " + e.message };
  }
};
