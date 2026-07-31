/* /.netlify/functions/calls
   GET            -> list all calls (light entries, shared library)
   GET ?id=...    -> full call (insights + transcript)
   POST { action: "create" | "delete" | "requeue" } */

import {
  json,
  parseBody,
  requireAuth,
  store,
  getIndex,
  saveIndex,
  lightEntry,
  upsertIndexEntry,
  removeIndexEntry,
} from "../lib/util.mjs";
import { randomUUID } from "node:crypto";

const MAX_TRANSCRIPT_CHARS = 200000;

export const handler = async (event) => {
  const { user, error } = await requireAuth(event);
  if (error) return error;
  const canEdit = user.role === "admin" || user.role === "writer";
  const s = store();

  /* ---------- GET ---------- */
  if (event.httpMethod === "GET") {
    const id = (event.queryStringParameters || {}).id;

    if (id) {
      const call = await s.get("call:" + id, { type: "json" });
      if (!call) return json(404, { error: "Call not found." });
      return json(200, { call });
    }

    let index = await getIndex();

    // Self-heal: pick up any call blobs missing from the index.
    try {
      const listed = await s.list({ prefix: "call:" });
      const known = new Set(index.map((e) => e.id));
      let changed = false;
      for (const b of listed.blobs || []) {
        const blobId = b.key.slice("call:".length);
        if (!known.has(blobId)) {
          const call = await s.get(b.key, { type: "json" });
          if (call) {
            index.push(lightEntry(call));
            changed = true;
          }
        }
      }
      if (changed) {
        index.sort((a, b) => (a.uploadedAt || 0) - (b.uploadedAt || 0));
        await saveIndex(index);
      }
    } catch (e) {
      /* listing unavailable, index alone is fine */
    }

    index.sort((a, b) => (a.uploadedAt || 0) - (b.uploadedAt || 0));
    return json(200, { calls: index });
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
    await s.setJSON("call:" + call.id, call);
    await upsertIndexEntry(call);
    return json(200, { call: lightEntry(call) });
  }

  if (action === "delete") {
    const id = String(body.id || "");
    const call = await s.get("call:" + id, { type: "json" });
    if (!call) return json(404, { error: "Call not found." });
    const allowed =
      user.role === "admin" ||
      (user.role === "writer" && call.uploadedBy === user.email);
    if (!allowed) {
      return json(403, { error: "You can only delete calls you uploaded." });
    }
    await s.delete("call:" + id);
    await removeIndexEntry(id);
    return json(200, { ok: true });
  }

  if (action === "requeue") {
    if (!canEdit) return json(403, { error: "Viewers cannot requeue calls." });
    const id = String(body.id || "");
    const call = await s.get("call:" + id, { type: "json" });
    if (!call) return json(404, { error: "Call not found." });
    if (!call.transcript) {
      return json(400, { error: "No transcript stored for this call. Re-upload it." });
    }
    call.status = "queued";
    call.errorMsg = null;
    call.processingAt = null;
    await s.setJSON("call:" + id, call);
    await upsertIndexEntry(call);
    return json(200, { call: lightEntry(call) });
  }

  return json(400, { error: "Unknown action." });
};
