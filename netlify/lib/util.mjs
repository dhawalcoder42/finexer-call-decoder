/* Shared helpers for all Netlify Functions.
   Storage: Supabase (Postgres), accessed with the service role key.
   Auth: email + password, scrypt hashes, HMAC-signed session tokens. */

import { createClient } from "@supabase/supabase-js";
import {
  scryptSync,
  randomBytes,
  timingSafeEqual,
  createHmac,
} from "node:crypto";

let _client = null;

export function sb() {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY is not set. Add both to .env locally and to Netlify environment variables."
    );
  }
  _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}

export const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export function parseBody(event) {
  try {
    return JSON.parse(event.body || "{}");
  } catch (e) {
    return {};
  }
}

/* ---------------- passwords ---------------- */

export function hashPassword(password) {
  const passSalt = randomBytes(16).toString("hex");
  const passHash = scryptSync(password, passSalt, 64).toString("hex");
  return { passSalt, passHash };
}

export function verifyPassword(password, passSalt, passHash) {
  try {
    const h = scryptSync(password, passSalt, 64).toString("hex");
    const a = Buffer.from(h, "hex");
    const b = Buffer.from(passHash, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch (e) {
    return false;
  }
}

/* ---------------- session tokens ---------------- */

const b64u = (s) => Buffer.from(s).toString("base64url");
const unb64u = (s) => Buffer.from(s, "base64url").toString();

export function signToken(payload, secret) {
  const p = b64u(JSON.stringify(payload));
  const sig = createHmac("sha256", secret).update(p).digest("base64url");
  return p + "." + sig;
}

export function verifyToken(token, secret) {
  try {
    const [p, sig] = String(token || "").split(".");
    if (!p || !sig) return null;
    const expect = createHmac("sha256", secret).update(p).digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expect);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(unb64u(p));
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

/* ---------------- users (Supabase table: users) ---------------- */

export const ROLES = ["admin", "writer", "viewer"];

function rowToUser(row) {
  return {
    email: row.email,
    name: row.name || "",
    role: row.role,
    passSalt: row.pass_salt || null,
    passHash: row.pass_hash || null,
    createdAt: row.created_at || null,
    addedBy: row.added_by || null,
  };
}

export async function getUsers() {
  const client = sb();
  const { data, error } = await client.from("users").select("*");
  if (error) throw new Error("Database error: " + error.message);

  const map = {};
  for (const row of data || []) map[row.email] = rowToUser(row);

  // Bootstrap: make sure the ADMIN_EMAIL account always exists as admin.
  const adminEmail = (process.env.ADMIN_EMAIL || "").toLowerCase().trim();
  if (adminEmail && !map[adminEmail]) {
    const rec = {
      email: adminEmail,
      name: "Admin",
      role: "admin",
      createdAt: Date.now(),
    };
    const { error: insErr } = await client.from("users").insert({
      email: rec.email,
      name: rec.name,
      role: rec.role,
      created_at: rec.createdAt,
    });
    if (!insErr) map[adminEmail] = rec;
  }
  return map;
}

export async function saveUser(user) {
  const client = sb();
  const { error } = await client.from("users").upsert({
    email: user.email,
    name: user.name || "",
    role: user.role,
    pass_salt: user.passSalt || null,
    pass_hash: user.passHash || null,
    created_at: user.createdAt || Date.now(),
    added_by: user.addedBy || null,
  });
  if (error) throw new Error("Database error: " + error.message);
}

export async function deleteUser(email) {
  const client = sb();
  const { error } = await client.from("users").delete().eq("email", email);
  if (error) throw new Error("Database error: " + error.message);
}

export function publicUser(u) {
  return {
    email: u.email,
    name: u.name || "",
    role: u.role,
    createdAt: u.createdAt || null,
    hasPassword: Boolean(u.passHash),
  };
}

/* ---------------- auth middleware ---------------- */

export async function requireAuth(event, roles) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    return {
      error: json(500, {
        error:
          "SESSION_SECRET is not set. Add it to .env locally and to Netlify environment variables.",
      }),
    };
  }
  const header =
    event.headers.authorization || event.headers.Authorization || "";
  const token = header.replace(/^Bearer\s+/i, "");
  const payload = verifyToken(token, secret);
  if (!payload) {
    return { error: json(401, { error: "Not signed in or session expired." }) };
  }
  let users;
  try {
    users = await getUsers();
  } catch (e) {
    return { error: json(500, { error: e.message }) };
  }
  const record = users[payload.email];
  if (!record) {
    return {
      error: json(401, { error: "This account no longer has access." }),
    };
  }
  if (roles && !roles.includes(record.role)) {
    return {
      error: json(403, { error: "Your role does not allow this action." }),
    };
  }
  return {
    user: { email: record.email, role: record.role, name: record.name || "" },
  };
}

/* ---------------- calls (Supabase table: calls) ---------------- */

export function rowToCall(row) {
  return {
    id: row.id,
    filename: row.filename,
    transcript: row.transcript || "",
    status: row.status,
    insights: row.insights || null,
    errorMsg: row.error_msg || null,
    uploadedBy: row.uploaded_by || "",
    uploadedAt: row.uploaded_at || null,
    processedAt: row.processed_at || null,
    processingAt: row.processing_at || null,
    dealStatus: row.deal_status || null,
  };
}

export function callToRow(call) {
  return {
    id: call.id,
    filename: call.filename,
    transcript: call.transcript || "",
    status: call.status,
    insights: call.insights || null,
    error_msg: call.errorMsg || null,
    uploaded_by: call.uploadedBy || "",
    uploaded_at: call.uploadedAt || null,
    processed_at: call.processedAt || null,
    processing_at: call.processingAt || null,
    deal_status: call.dealStatus || null,
  };
}

export function lightEntry(call) {
  const i = call.insights || {};
  return {
    id: call.id,
    filename: call.filename,
    status: call.status,
    uploadedBy: call.uploadedBy || "",
    uploadedAt: call.uploadedAt || null,
    processedAt: call.processedAt || null,
    errorMsg: call.errorMsg || null,
    dealStatus: call.dealStatus || null,
    client_name: i.client_name || null,
    company_or_project: i.company_or_project || null,
    one_liner: i.one_liner || null,
  };
}

/* ---------------- insights normalizer ---------------- */

const deDash = (s) => s.replace(/\u2014/g, "-").replace(/\u2013/g, "-");

export function normalizeInsights(raw) {
  const str = (v) =>
    typeof v === "string" && v.trim() ? deDash(v.trim()) : null;
  const list = (v, n) =>
    Array.isArray(v)
      ? v
          .filter((x) => typeof x === "string" && x.trim())
          .map((x) => deDash(x.trim()))
          .slice(0, n)
      : [];
  const signals = ["pain", "intent", "objection", "goal", "context"];
  const quotes = Array.isArray(raw.verbatim_quotes)
    ? raw.verbatim_quotes
        .filter((q) => q && typeof q.quote === "string" && q.quote.trim())
        .map((q) => ({
          speaker:
            typeof q.speaker === "string" && q.speaker.trim()
              ? deDash(q.speaker.trim())
              : "Speaker",
          quote: q.quote.trim(),
          signal: signals.includes(q.signal) ? q.signal : "context",
        }))
        .slice(0, 5)
    : [];

  return {
    client_name: str(raw.client_name),
    company_or_project: str(raw.company_or_project),
    client_type: str(raw.client_type),
    one_liner: str(raw.one_liner),
    intent: str(raw.intent),
    use_case: str(raw.use_case),
    pain_points: list(raw.pain_points, 5),
    questions_they_asked: list(raw.questions_they_asked, 6),
    objections_or_concerns: list(raw.objections_or_concerns, 4),
    buying_signals: list(raw.buying_signals, 4),
    timeline_and_scale: str(raw.timeline_and_scale),
    competitors_mentioned: list(raw.competitors_mentioned, 6),
    next_steps: list(raw.next_steps, 4),
    verbatim_quotes: quotes,
    content_angles: list(raw.content_angles, 4),
  };
}
