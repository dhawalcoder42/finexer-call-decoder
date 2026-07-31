/* /.netlify/functions/calls
   GET            -> list all calls (light entries, shared library)
   GET ?id=...    -> full call (insights + transcript)
   POST { action: "create" | "delete" | "requeue" } */

import {
  json,
  parseBody,
  requireAuth,
  sb,
  rowToCall,
  lightEntry,
} from "../lib/util.mjs";
import { randomUUID } from "node:crypto";

const MAX_TRANSCRIPT_CHARS = 200000;

export const handler = async (event) => {
  const { user, error } = await requireAuth(event);
  if (error) return error;
  const canEdit = user.role === "admin" || user.role === "writer";
  const client = sb();

  /* ---------- GET ---------- */
  if (event.httpMethod === "GET") {
    const id = (event.queryStringParameters || {}).id;

    if (id) {
      const { data, error: dbErr } = await client
        .from("calls")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (dbErr) return json(500, { error: "Database error: " + dbErr.message });
      if (!data) return json(404, { error: "Call not found." });
      return json(200, { call: rowToCall(data) });
    }

    // Exclude transcript from the list query, it's the heavy column.
    const { data, error: dbErr } = await client
      .from("calls")
      .select(
        "id, filename, status, insights, error_msg, uploaded_by, uploaded_at, processed_at"
      )
      .order("uploaded_at", { ascending: true });
    if (dbErr) return json(500, { error: "Database error: " + dbErr.message });

    const calls = (data || []).map((row) =>
      lightEntry({
        id: row.id,
        filename: row.filename,
        status: row.status,
        insights: row.insights,
        errorMsg: row.error_msg,
        uploadedBy: row.uploaded_by,
        uploadedAt: row.uploaded_at,
        processedAt: row.processed_at,
      })
    );
    return json(200, { calls });
  }

  /* ---------- POST ---------- */
  if (event.httpMethod !== "POST") return json(405, { error: "POST only." });
  const body = parseBody(event);
  const action = body.action;

  if (action === "create") {
    if (!canEdit) return json(403, { error: "Viewers cannot upload calls." });
    const filename = String(body.filename || "").trim().slice(0, 200);
    const transcript = String(body.transcript || "").slice(0, MAX_TRANSCRIPT_CHARS);
    if (!filename || !transcript.trim()) {
      return json(400, { error: "Filename and transcript are required." });
    }
    const call = {
      id: randomUUID(),
      filename,
      transcript,
      status: "queued",
      insights: null,
      errorMsg: null,
      uploadedBy: user.email,
      uploadedAt: Date.now(),
      processedAt: null,
      processingAt: null,
    };
    const { error: dbErr } = await client.from("calls").insert({
      id: call.id,
      filename: call.filename,
      transcript: call.transcript,
      status: call.status,
      uploaded_by: call.uploadedBy,
      uploaded_at: call.uploadedAt,
    });
    if (dbErr) return json(500, { error: "Database error: " + dbErr.message });
    return json(200, { call: lightEntry(call) });
  }

  if (action === "delete") {
    const id = String(body.id || "");
    const { data: row, error: fetchErr } = await client
      .from("calls")
      .select("uploaded_by")
      .eq("id", id)
      .maybeSingle();
    if (fetchErr) return json(500, { error: "Database error: " + fetchErr.message });
    if (!row) return json(404, { error: "Call not found." });
    const allowed =
      user.role === "admin" ||
      (user.role === "writer" && row.uploaded_by === user.email);
    if (!allowed) {
      return json(403, { error: "You can only delete calls you uploaded." });
    }
    const { error: delErr } = await client.from("calls").delete().eq("id", id);
    if (delErr) return json(500, { error: "Database error: " + delErr.message });
    return json(200, { ok: true });
  }

  if (action === "requeue") {
    if (!canEdit) return json(403, { error: "Viewers cannot requeue calls." });
    const id = String(body.id || "");
    const { data: row, error: fetchErr } = await client
      .from("calls")
      .select("transcript")
      .eq("id", id)
      .maybeSingle();
    if (fetchErr) return json(500, { error: "Database error: " + fetchErr.message });
    if (!row) return json(404, { error: "Call not found." });
    if (!row.transcript) {
      return json(400, { error: "No transcript stored for this call. Re-upload it." });
    }
    const { error: updErr } = await client
      .from("calls")
      .update({ status: "queued", error_msg: null, processing_at: null })
      .eq("id", id);
    if (updErr) return json(500, { error: "Database error: " + updErr.message });
    return json(200, { call: { id, status: "queued" } });
  }

  return json(400, { error: "Unknown action." });
};
