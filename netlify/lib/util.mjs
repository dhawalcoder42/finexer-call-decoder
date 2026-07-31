/* Shared helpers for all Netlify Functions.
   Storage: Netlify Blobs (built into Netlify, no external database needed).
   Auth: email + password, scrypt hashes, HMAC-signed session tokens. */

import { getStore } from "@netlify/blobs";
import {
  scryptSync,
  randomBytes,
  timingSafeEqual,
  createHmac,
} from "node:crypto";

export const STORE_NAME = "call-decoder";

// On the real Netlify servers (deployed site), Blobs context is injected
// automatically and this fallback is never used. Locally, some CLI/OS
// combinations fail to auto-inject that context into functions, so we
// fall back to explicit siteID + token from env vars if they're set.
export const store = () => {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_AUTH_TOKEN;
  if (siteID && token) {
    return getStore({ name: STORE_NAME, siteID, token, consistency: "strong" });
  }
  return getStore({ name: STORE_NAME, consistency: "strong" });
};

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

/* ---------------- users ---------------- */

export const ROLES = ["admin", "writer", "viewer"];

export async function getUsers() {
  const s = store();
  let users = (await s.get("users", { type: "json" })) || {};

  // Bootstrap: make sure the ADMIN_EMAIL account always exists as admin.
  const adminEmail = (process.env.ADMIN_EMAIL || "").toLowerCase().trim();
  if (adminEmail && !users[adminEmail]) {
    users[adminEmail] = {
      email: adminEmail,
      name: "Admin",
      role: "admin",
      createdAt: Date.now(),
    };
    await s.setJSON("users", users);
  }
  return users;
}

export async function saveUsers(users) {
  await store().setJSON("users", users);
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
  const users = await getUsers();
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

/* ---------------- calls index ---------------- */

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
    client_name: i.client_name || null,
    company_or_project: i.company_or_project || null,
    one_liner: i.one_liner || null,
  };
}

export async function getIndex() {
  return (await store().get("index", { type: "json" })) || [];
}

export async function saveIndex(index) {
  await store().setJSON("index", index);
}

export async function upsertIndexEntry(call) {
  const index = await getIndex();
  const entry = lightEntry(call);
  const pos = index.findIndex((e) => e.id === call.id);
  if (pos === -1) index.push(entry);
  else index[pos] = entry;
  await saveIndex(index);
}

export async function removeIndexEntry(id) {
  const index = await getIndex();
  await saveIndex(index.filter((e) => e.id !== id));
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
