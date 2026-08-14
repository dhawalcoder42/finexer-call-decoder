import React, { useState, useEffect, useRef } from "react";
import {
  ArrowLeft, FileText, Trash2, Search, RefreshCw, Copy, Check,
  AlertTriangle, Loader2, Quote, Lightbulb, HelpCircle, TrendingUp, Clock,
  X, Inbox, Target, ShieldAlert, ListChecks, FileUp, Users, KeyRound,
  LogOut, Plus, BookOpen, Download, Repeat
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Finexer design tokens (#3057C3 / #004AAD brand pair)                */
/* ------------------------------------------------------------------ */

const C = {
  bg: "#F5F7FB",
  surface: "#FFFFFF",
  ink: "#101B33",
  muted: "#56617A",
  faint: "#8A93A8",
  line: "#E2E6EF",
  accent: "#3057C3",
  accentDark: "#004AAD",
  accentSoft: "#E9EEFB",
  accentLine: "#C9D5F1",
  quoteBg: "#F1F5FD",
  amber: "#96610F",
  amberSoft: "#FAF1DD",
  red: "#B02A1C",
  redSoft: "#FBEDEA",
};

const GRAD = "linear-gradient(135deg, #3057C3, #004AAD)";

const F = {
  display: "'Space Grotesk', 'Inter', system-ui, sans-serif",
  body: "'Inter', system-ui, -apple-system, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
};

const APP_CSS = `
* { box-sizing: border-box; }
body { margin: 0; }
::selection { background: ${C.accentLine}; }
.fcd-row:focus-visible, .fcd-btn:focus-visible, .fcd-input:focus-visible { outline: 2px solid ${C.accent}; outline-offset: 2px; }
.fcd-row { transition: border-color 140ms ease, box-shadow 140ms ease; }
.fcd-row:hover { border-color: ${C.accentLine} !important; box-shadow: 0 1px 6px rgba(16,27,51,0.07); }
.fcd-input { border: 1px solid ${C.line}; border-radius: 8px; padding: 9px 12px; font-size: 13.5px; font-family: 'Inter', system-ui, sans-serif; color: ${C.ink}; background: #fff; width: 100%; outline: none; }
.fcd-input:focus { border-color: ${C.accent}; }
`;

const QUEUE_DELAY_MS = 6500;
const AUTH_KEY = "fcd-auth-v1";

const btnPrimary = {
  background: GRAD,
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "9px 16px",
  fontSize: 13.5,
  fontWeight: 600,
  cursor: "pointer",
};
const btnGhost = {
  background: C.surface,
  color: C.ink,
  border: "1px solid " + C.line,
  borderRadius: 8,
  padding: "8px 13px",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};

/* ------------------------------------------------------------------ */
/* Small utils                                                         */
/* ------------------------------------------------------------------ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fmtDate = (ts) => {
  try {
    return new Date(ts).toLocaleString("en-GB", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (e) {
    return "";
  }
};

function loadAuth() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    /* fall through */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch (e) {
    return false;
  }
}

function buildCopyText(call) {
  const i = call.insights;
  if (!i) return "";
  const lines = [];
  const head = [i.client_name, i.company_or_project].filter(Boolean).join(" | ");
  lines.push("CALL INSIGHTS: " + (head || call.filename));
  lines.push("File: " + call.filename);
  lines.push("");
  if (i.client_type || i.one_liner) {
    lines.push("WHO THEY ARE");
    if (i.client_type) lines.push(i.client_type);
    if (i.one_liner) lines.push(i.one_liner);
    lines.push("");
  }
  if (i.intent) { lines.push("INTENT"); lines.push(i.intent); lines.push(""); }
  if (i.use_case) { lines.push("USE CASE"); lines.push(i.use_case); lines.push(""); }
  const block = (title, arr) => {
    if (arr && arr.length) {
      lines.push(title);
      arr.forEach((x) => lines.push("- " + x));
      lines.push("");
    }
  };
  block("PAIN POINTS", i.pain_points);
  if (i.verbatim_quotes && i.verbatim_quotes.length) {
    lines.push("WHAT THEY SAID (VERBATIM)");
    i.verbatim_quotes.forEach((q) =>
      lines.push('"' + q.quote + '" - ' + q.speaker + " [" + q.signal + "]")
    );
    lines.push("");
  }
  block("QUESTIONS THEY ASKED", i.questions_they_asked);
  block("OBJECTIONS AND CONCERNS", i.objections_or_concerns);
  block("BUYING SIGNALS", i.buying_signals);
  if (i.timeline_and_scale) {
    lines.push("Timeline and scale: " + i.timeline_and_scale);
    lines.push("");
  }
  if (i.competitors_mentioned && i.competitors_mentioned.length) {
    lines.push("COMPETITORS MENTIONED");
    lines.push(i.competitors_mentioned.join(", "));
    lines.push("");
  }
  block("CONTENT ANGLES", i.content_angles);
  block("NEXT STEPS", i.next_steps);
  return lines.join("\n").trim();
}

/* ------------------------------------------------------------------ */
/* Brand mark                                                          */
/* ------------------------------------------------------------------ */

function FMark({ size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="4" y="3" width="7" height="26" rx="2.5" fill="#3057C3" />
      <rect x="4" y="3" width="24" height="7" rx="2.5" fill="#3057C3" />
      <rect x="4" y="14" width="17" height="6.5" rx="2.5" fill="#004AAD" />
    </svg>
  );
}

function Logo({ size = 30 }) {
  const [imgOk, setImgOk] = useState(true);
  if (imgOk) {
    return (
      <img
        src="/logo.png"
        alt="Finexer"
        style={{ height: size, display: "block" }}
        onError={() => setImgOk(false)}
      />
    );
  }
  return <FMark size={size} />;
}

/* ------------------------------------------------------------------ */
/* Presentational bits                                                 */
/* ------------------------------------------------------------------ */

function StatusChip({ status }) {
  const base = {
    fontFamily: F.mono,
    fontSize: 11,
    fontWeight: 500,
    padding: "3px 8px",
    borderRadius: 999,
    whiteSpace: "nowrap",
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
  };
  if (status === "done")
    return (
      <span style={{ ...base, background: C.accentSoft, color: C.accent }}>
        <Check size={11} /> decoded
      </span>
    );
  if (status === "processing")
    return (
      <span style={{ ...base, background: C.amberSoft, color: C.amber }}>
        <Loader2 size={11} className="animate-spin" /> analyzing
      </span>
    );
  if (status === "error")
    return (
      <span style={{ ...base, background: C.redSoft, color: C.red }}>
        <AlertTriangle size={11} /> failed
      </span>
    );
  return (
    <span style={{ ...base, background: "#ECEFF5", color: C.muted }}>
      queued
    </span>
  );
}

function RoleBadge({ role }) {
  const map = {
    admin: { bg: C.accentSoft, fg: C.accent },
    writer: { bg: "#EAF6EE", fg: "#1E7A45" },
    viewer: { bg: "#ECEFF5", fg: C.muted },
  };
  const s = map[role] || map.viewer;
  return (
    <span
      style={{
        fontFamily: F.mono,
        fontSize: 10.5,
        fontWeight: 500,
        color: s.fg,
        background: s.bg,
        borderRadius: 999,
        padding: "2px 8px",
      }}
    >
      {role}
    </span>
  );
}

function SectionCard({ icon: Icon, title, children, tone }) {
  const accent = tone === "accent";
  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: accent ? C.accentSoft : C.surface,
        border: "1px solid " + (accent ? C.accentLine : C.line),
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        <Icon size={15} style={{ color: C.accent }} />
        <h3
          style={{
            fontFamily: F.display,
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: C.ink,
            margin: 0,
          }}
        >
          {title}
        </h3>
      </div>
      {children}
    </div>
  );
}

function Bullets({ items }) {
  return (
    <ul className="m-0 p-0" style={{ listStyle: "none" }}>
      {items.map((x, i) => (
        <li
          key={i}
          className="flex gap-2"
          style={{ fontSize: 14, lineHeight: 1.55, color: C.ink, padding: "3px 0" }}
        >
          <span style={{ color: C.accent, flexShrink: 0 }}>&#8226;</span>
          <span>{x}</span>
        </li>
      ))}
    </ul>
  );
}

const SIGNAL_STYLE = {
  pain: { bg: C.redSoft, fg: C.red },
  objection: { bg: C.amberSoft, fg: C.amber },
  intent: { bg: C.accentSoft, fg: C.accent },
  goal: { bg: C.accentSoft, fg: C.accent },
  context: { bg: "#ECEFF5", fg: C.muted },
};

function QuoteCard({ q }) {
  const s = SIGNAL_STYLE[q.signal] || SIGNAL_STYLE.context;
  return (
    <div
      className="rounded-lg p-4"
      style={{ background: C.quoteBg, borderLeft: "3px solid " + C.accent }}
    >
      <div className="flex items-center gap-2 mb-2" style={{ flexWrap: "wrap" }}>
        <span
          style={{
            fontFamily: F.mono,
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: "0.08em",
            color: C.accent,
            background: C.surface,
            border: "1px solid " + C.accentLine,
            borderRadius: 4,
            padding: "2px 6px",
          }}
        >
          VERBATIM
        </span>
        <span
          style={{
            fontFamily: F.mono,
            fontSize: 10,
            fontWeight: 500,
            color: s.fg,
            background: s.bg,
            borderRadius: 4,
            padding: "2px 6px",
          }}
        >
          {q.signal}
        </span>
        <span style={{ fontSize: 12, color: C.muted }}>{q.speaker}</span>
      </div>
      <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: C.ink }}>
        &ldquo;{q.quote}&rdquo;
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Login screen                                                        */
/* ------------------------------------------------------------------ */

function LoginScreen({ onLogin, busy, error }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const submit = () => {
    if (!busy) onLogin(email, password);
  };
  return (
    <div
      className="min-h-screen flex items-center justify-center px-5"
      style={{ background: C.bg, fontFamily: F.body }}
    >
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div
          className="rounded-xl"
          style={{
            background: C.surface,
            border: "1px solid " + C.line,
            overflow: "hidden",
            boxShadow: "0 8px 30px rgba(16,27,51,0.08)",
          }}
        >
          <div style={{ height: 5, background: GRAD }} />
          <div style={{ padding: "30px 28px 28px" }}>
            <div className="flex items-center gap-3 mb-5">
              <Logo size={34} />
              <div>
                <div
                  style={{
                    fontFamily: F.mono,
                    fontSize: 10,
                    letterSpacing: "0.14em",
                    color: C.accent,
                    fontWeight: 500,
                  }}
                >
                  FINEXER &#183; INTERNAL
                </div>
                <div
                  style={{
                    fontFamily: F.display,
                    fontSize: 21,
                    fontWeight: 700,
                    color: C.ink,
                    lineHeight: 1.15,
                  }}
                >
                  Call Decoder
                </div>
              </div>
            </div>

            <label style={{ fontSize: 12.5, fontWeight: 600, color: C.muted, display: "block", marginBottom: 5 }}>
              Email
            </label>
            <input
              className="fcd-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@finexer.com"
              style={{ marginBottom: 14 }}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
            <label style={{ fontSize: 12.5, fontWeight: 600, color: C.muted, display: "block", marginBottom: 5 }}>
              Password
            </label>
            <input
              className="fcd-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
              style={{ marginBottom: 16 }}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
            {error && (
              <div
                className="rounded-lg flex items-center gap-2"
                style={{
                  background: C.redSoft,
                  color: C.red,
                  fontSize: 12.5,
                  padding: "9px 12px",
                  marginBottom: 14,
                }}
              >
                <AlertTriangle size={13} style={{ flexShrink: 0 }} /> {error}
              </div>
            )}
            <button
              className="fcd-btn w-full flex items-center justify-center gap-2"
              onClick={submit}
              disabled={busy}
              style={{ ...btnPrimary, width: "100%", padding: "11px 16px", opacity: busy ? 0.75 : 1 }}
            >
              {busy && <Loader2 size={14} className="animate-spin" />} Sign in
            </button>
            <p style={{ fontSize: 11.5, color: C.faint, margin: "14px 0 0", lineHeight: 1.5 }}>
              Access is managed by the admin. If you do not have a login, ask them to add your email.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Admin panel                                                         */
/* ------------------------------------------------------------------ */

function AdminPanel({ api, me, showNotice }) {
  const [users, setUsers] = useState(null);
  const [form, setForm] = useState({ email: "", name: "", role: "writer", password: "" });
  const [busy, setBusy] = useState(false);
  const [resetFor, setResetFor] = useState(null);
  const [resetPass, setResetPass] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(null);

  const load = async () => {
    try {
      const d = await api("/.netlify/functions/users");
      setUsers(d.users);
    } catch (e) {
      showNotice(e.message);
      setUsers([]);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const addUser = async () => {
    setBusy(true);
    try {
      await api("/.netlify/functions/users", {
        method: "POST",
        body: { action: "add", ...form },
      });
      setForm({ email: "", name: "", role: "writer", password: "" });
      showNotice("User added. Share the password with them directly.");
      await load();
    } catch (e) {
      showNotice(e.message);
    }
    setBusy(false);
  };

  const changeRole = async (email, role) => {
    try {
      await api("/.netlify/functions/users", {
        method: "POST",
        body: { action: "update_role", email, role },
      });
      await load();
    } catch (e) {
      showNotice(e.message);
      await load();
    }
  };

  const savePassword = async () => {
    try {
      await api("/.netlify/functions/users", {
        method: "POST",
        body: { action: "set_password", email: resetFor, password: resetPass },
      });
      showNotice("Password updated for " + resetFor + ".");
      setResetFor(null);
      setResetPass("");
    } catch (e) {
      showNotice(e.message);
    }
  };

  const removeUser = async (email) => {
    try {
      await api("/.netlify/functions/users", {
        method: "POST",
        body: { action: "remove", email },
      });
      showNotice("Removed " + email + ".");
      setConfirmRemove(null);
      await load();
    } catch (e) {
      showNotice(e.message);
    }
  };

  return (
    <div>
      <h2 style={{ fontFamily: F.display, fontSize: 22, fontWeight: 700, margin: "0 0 4px" }}>
        Team access
      </h2>
      <p style={{ fontSize: 13.5, color: C.muted, margin: "0 0 20px", lineHeight: 1.55 }}>
        Add teammates by email, set their password, and choose a role. Admin manages
        everything, writers upload and decode calls, viewers can only read.
      </p>

      {/* add user */}
      <div
        className="rounded-xl p-5 mb-5"
        style={{ background: C.surface, border: "1px solid " + C.line }}
      >
        <div className="flex items-center gap-2 mb-4">
          <Plus size={15} style={{ color: C.accent }} />
          <h3
            style={{
              fontFamily: F.display, fontSize: 13, fontWeight: 600,
              letterSpacing: "0.04em", textTransform: "uppercase", margin: 0,
            }}
          >
            Add a teammate
          </h3>
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          <input className="fcd-input" placeholder="Email" type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input className="fcd-input" placeholder="Name (optional)"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select className="fcd-input" value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="writer">Writer, can upload and decode</option>
            <option value="viewer">Viewer, read only</option>
            <option value="admin">Admin, full control</option>
          </select>
          <input className="fcd-input" placeholder="Password for them (min 8 chars)" type="text"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </div>
        <button
          className="fcd-btn mt-4 flex items-center gap-2"
          style={{ ...btnPrimary, opacity: busy ? 0.75 : 1 }}
          disabled={busy}
          onClick={addUser}
        >
          {busy && <Loader2 size={13} className="animate-spin" />} Add user
        </button>
      </div>

      {/* user list */}
      {users === null ? (
        <div className="flex items-center gap-2" style={{ color: C.muted, fontSize: 13.5 }}>
          <Loader2 size={14} className="animate-spin" /> Loading team
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {users.map((u) => (
            <div
              key={u.email}
              className="rounded-xl"
              style={{ background: C.surface, border: "1px solid " + C.line, padding: "13px 16px" }}
            >
              <div className="flex items-center gap-3" style={{ flexWrap: "wrap" }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {u.name || u.email}
                    {u.email === me.email && (
                      <span style={{ color: C.faint, fontWeight: 400, fontSize: 12 }}> (you)</span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: C.muted, fontFamily: F.mono }}>{u.email}</div>
                </div>
                <RoleBadge role={u.role} />
                {u.email !== me.email && (
                  <>
                    <select
                      className="fcd-input"
                      style={{ width: "auto", padding: "6px 8px", fontSize: 12.5 }}
                      value={u.role}
                      onChange={(e) => changeRole(u.email, e.target.value)}
                    >
                      <option value="admin">admin</option>
                      <option value="writer">writer</option>
                      <option value="viewer">viewer</option>
                    </select>
                    <button
                      className="fcd-btn flex items-center gap-1"
                      style={{ ...btnGhost, padding: "6px 10px", fontSize: 12.5 }}
                      onClick={() => { setResetFor(resetFor === u.email ? null : u.email); setResetPass(""); }}
                    >
                      <KeyRound size={12} /> Reset password
                    </button>
                    {confirmRemove === u.email ? (
                      <button
                        className="fcd-btn"
                        style={{ ...btnGhost, background: C.red, color: "#fff", border: "none", padding: "6px 10px", fontSize: 12.5 }}
                        onClick={() => removeUser(u.email)}
                      >
                        Confirm remove
                      </button>
                    ) : (
                      <button
                        className="fcd-btn"
                        title="Remove user"
                        style={{ background: "none", border: "none", color: C.faint, cursor: "pointer", padding: 4 }}
                        onClick={() => {
                          setConfirmRemove(u.email);
                          setTimeout(() => setConfirmRemove(null), 3000);
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </>
                )}
              </div>
              {resetFor === u.email && (
                <div className="flex items-center gap-2 mt-3">
                  <input
                    className="fcd-input"
                    style={{ maxWidth: 280 }}
                    placeholder="New password (min 8 chars)"
                    value={resetPass}
                    onChange={(e) => setResetPass(e.target.value)}
                  />
                  <button className="fcd-btn" style={btnPrimary} onClick={savePassword}>
                    Save
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Change password panel                                               */
/* ------------------------------------------------------------------ */

function PasswordPanel({ api, showNotice, onClose }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api("/.netlify/functions/auth", {
        method: "POST",
        body: { action: "change_password", currentPassword: current, newPassword: next },
      });
      showNotice("Password changed.");
      onClose();
    } catch (e) {
      showNotice(e.message);
    }
    setBusy(false);
  };
  return (
    <div
      className="rounded-xl p-5 mb-5"
      style={{ background: C.surface, border: "1px solid " + C.line }}
    >
      <div className="flex items-center gap-2 mb-4">
        <KeyRound size={15} style={{ color: C.accent }} />
        <h3 style={{ fontFamily: F.display, fontSize: 13, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", margin: 0 }}>
          Change your password
        </h3>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        <input className="fcd-input" type="password" placeholder="Current password"
          value={current} onChange={(e) => setCurrent(e.target.value)} />
        <input className="fcd-input" type="password" placeholder="New password (min 8 chars)"
          value={next} onChange={(e) => setNext(e.target.value)} />
      </div>
      <div className="flex items-center gap-2 mt-4">
        <button className="fcd-btn" style={{ ...btnPrimary, opacity: busy ? 0.75 : 1 }} disabled={busy} onClick={save}>
          Save password
        </button>
        <button className="fcd-btn" style={btnGhost} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shared download helper                                              */
/* ------------------------------------------------------------------ */

function downloadBlob(content, mime, filename) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ------------------------------------------------------------------ */
/* Sales Call FAQ panel                                                */
/* ------------------------------------------------------------------ */

function faqToText(faq) {
  const lines = [];
  lines.push("FINEXER SALES CALL FAQ");
  lines.push(
    "Built from " + faq.totalCalls + " decoded client intro calls. Counts show how many clients asked each question."
  );
  lines.push("");
  for (const cat of faq.categories) {
    lines.push(cat.title.toUpperCase());
    for (const it of cat.items) {
      lines.push(
        "- " + it.question + " (asked by " + it.count +
        (it.asked_by.length ? ": " + it.asked_by.join(", ") : "") + ")"
      );
    }
    lines.push("");
  }
  if (faq.pain_points && faq.pain_points.length) {
    lines.push("PAIN POINTS AND HOW FINEXER ANSWERS THEM");
    for (const p of faq.pain_points) {
      lines.push(
        "- " + p.pain + " (raised by " + p.count +
        (p.raised_by.length ? ": " + p.raised_by.join(", ") : "") + ")"
      );
      if (p.solution) lines.push("  Finexer angle: " + p.solution);
    }
    lines.push("");
  }
  if (faq.common_objections && faq.common_objections.length) {
    lines.push("COMMON OBJECTIONS AND CONCERNS");
    for (const o of faq.common_objections) {
      lines.push(
        "- " + o.objection + " (raised by " + o.count +
        (o.raised_by.length ? ": " + o.raised_by.join(", ") : "") + ")"
      );
    }
  }
  return lines.join("\n").trim();
}

function faqToWordHtml(faq) {
  const esc = (s) =>
    String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let html =
    "<html><head><meta charset='utf-8'><title>Finexer Sales Call FAQ</title></head>" +
    "<body style='font-family:Calibri,Arial,sans-serif;color:#101B33;'>" +
    "<h1 style='color:#004AAD;'>Finexer Sales Call FAQ</h1>" +
    "<p>Built from " + faq.totalCalls +
    " decoded client intro calls. Counts show how many clients asked each question.</p>";
  for (const cat of faq.categories) {
    html += "<h2 style='color:#3057C3;'>" + esc(cat.title) + "</h2><ul>";
    for (const it of cat.items) {
      html +=
        "<li><b>" + esc(it.question) + "</b> <span style='color:#56617A;'>(asked by " +
        it.count + (it.asked_by.length ? ": " + esc(it.asked_by.join(", ")) : "") +
        ")</span></li>";
    }
    html += "</ul>";
  }
  if (faq.pain_points && faq.pain_points.length) {
    html += "<h2 style='color:#3057C3;'>Pain points and how Finexer answers them</h2><ul>";
    for (const p of faq.pain_points) {
      html +=
        "<li><b>" + esc(p.pain) + "</b> <span style='color:#56617A;'>(raised by " +
        p.count + (p.raised_by.length ? ": " + esc(p.raised_by.join(", ")) : "") +
        ")</span>" +
        (p.solution
          ? "<br/><span style='color:#004AAD;'>Finexer angle: " + esc(p.solution) + "</span>"
          : "") +
        "</li>";
    }
    html += "</ul>";
  }
  if (faq.common_objections && faq.common_objections.length) {
    html += "<h2 style='color:#3057C3;'>Common objections and concerns</h2><ul>";
    for (const o of faq.common_objections) {
      html +=
        "<li><b>" + esc(o.objection) + "</b> <span style='color:#56617A;'>(raised by " +
        o.count + (o.raised_by.length ? ": " + esc(o.raised_by.join(", ")) : "") +
        ")</span></li>";
    }
    html += "</ul>";
  }
  html += "</body></html>";
  return html;
}

function faqToCsv(faq) {
  const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
  const rows = [["Section", "Category", "Question / objection / pain point", "Times raised", "Raised by", "Finexer answer"]];
  for (const cat of faq.categories) {
    for (const it of cat.items) {
      rows.push(["Question", cat.title, it.question, it.count, it.asked_by.join("; "), ""]);
    }
  }
  for (const p of faq.pain_points || []) {
    rows.push(["Pain point", "Pain points", p.pain, p.count, (p.raised_by || []).join("; "), p.solution || ""]);
  }
  for (const o of faq.common_objections || []) {
    rows.push(["Objection", "Objections", o.objection, o.count, (o.raised_by || []).join("; "), ""]);
  }
  return rows.map((r) => r.map(q).join(",")).join("\r\n");
}

function FaqPanel({ api, showNotice, canEdit }) {
  const [faq, setFaq] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copiedFaq, setCopiedFaq] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const d = await api("/.netlify/functions/faq");
        if (d && d.faq) setFaq(d.faq);
      } catch (e) {
        if (e.status !== 401) showNotice(e.message);
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const generate = async () => {
    setBusy(true);
    try {
      const d = await api("/.netlify/functions/faq", {
        method: "POST",
        body: { action: "generate" },
      });
      setFaq(d.faq);
      showNotice("FAQ generated and saved. The whole team now sees this version.");
    } catch (e) {
      showNotice(e.message);
    }
    setBusy(false);
  };

  return (
    <div>
      <h2 style={{ fontFamily: F.display, fontSize: 22, fontWeight: 700, margin: "0 0 4px" }}>
        Sales Call FAQ
      </h2>
      <p style={{ fontSize: 13.5, color: C.muted, margin: "0 0 16px", lineHeight: 1.55 }}>
        Every question clients asked across all decoded calls, merged and grouped
        by theme with counts. The FAQ is generated once, saved, and shared with
        the whole team. Regenerate only after new calls are decoded.
      </p>

      <div className="flex items-center gap-2 mb-5" style={{ flexWrap: "wrap" }}>
        {canEdit && (
          <button
            className="fcd-btn flex items-center gap-2"
            style={{ ...btnPrimary, opacity: busy ? 0.75 : 1 }}
            disabled={busy}
            onClick={generate}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <BookOpen size={14} />}
            {faq ? "Regenerate FAQ" : "Generate FAQ"}
          </button>
        )}
        {faq && (
          <>
            <button
              className="fcd-btn flex items-center gap-2"
              style={btnGhost}
              onClick={() =>
                downloadBlob(
                  faqToWordHtml(faq),
                  "application/msword",
                  "Finexer-Sales-Call-FAQ.doc"
                )
              }
            >
              <Download size={13} /> Word
            </button>
            <button
              className="fcd-btn flex items-center gap-2"
              style={btnGhost}
              onClick={() =>
                downloadBlob(faqToCsv(faq), "text/csv;charset=utf-8", "Finexer-Sales-Call-FAQ.csv")
              }
            >
              <Download size={13} /> Excel (CSV)
            </button>
            <button
              className="fcd-btn flex items-center gap-2"
              style={btnGhost}
              onClick={async () => {
                const ok = await copyToClipboard(faqToText(faq));
                if (ok) { setCopiedFaq(true); setTimeout(() => setCopiedFaq(false), 2000); }
                else showNotice("Copy failed in this browser.");
              }}
            >
              {copiedFaq ? <Check size={13} /> : <Copy size={13} />}
              {copiedFaq ? "Copied" : "Copy"}
            </button>
          </>
        )}
      </div>

      {(loading || (busy && !faq)) && (
        <div className="flex items-center gap-2" style={{ color: C.muted, fontSize: 13.5 }}>
          <Loader2 size={14} className="animate-spin" />
          {loading
            ? "Loading the saved FAQ"
            : "Reading every decoded call and grouping the questions, this takes a few seconds"}
        </div>
      )}

      {!loading && !busy && !faq && (
        <div className="rounded-xl text-center"
          style={{ border: "1px dashed #C3CBDC", background: C.surface, padding: "36px 24px" }}>
          <BookOpen size={24} style={{ color: C.faint, margin: "0 auto 10px", display: "block" }} />
          <p style={{ margin: 0, fontSize: 13.5, color: C.muted, lineHeight: 1.6 }}>
            {canEdit
              ? "No FAQ generated yet. Click Generate FAQ once, it will be saved for the whole team."
              : "No FAQ generated yet. Ask a writer or admin to generate it."}
          </p>
        </div>
      )}

      {faq && (
        <div className="flex flex-col gap-4">
          <div style={{ fontFamily: F.mono, fontSize: 11.5, color: C.faint }}>
            Built from {faq.totalCalls} decoded calls &#183; generated {fmtDate(faq.generatedAt)}
          </div>
          {faq.categories.map((cat, ci) => (
            <SectionCard key={ci} icon={HelpCircle} title={cat.title}>
              <ul className="m-0 p-0" style={{ listStyle: "none" }}>
                {cat.items.map((it, ii) => (
                  <li key={ii} style={{ padding: "7px 0", borderTop: ii ? "1px solid " + C.line : "none" }}>
                    <div className="flex items-start gap-2">
                      <span style={{ color: C.accent, flexShrink: 0, lineHeight: 1.55 }}>&#8226;</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 14, lineHeight: 1.55, color: C.ink, fontWeight: 500 }}>
                          {it.question}
                        </div>
                        <div style={{ fontFamily: F.mono, fontSize: 11, color: C.faint, marginTop: 2 }}>
                          asked by {it.count}
                          {it.asked_by.length ? ": " + it.asked_by.join(", ") : ""}
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </SectionCard>
          ))}
          {faq.pain_points && faq.pain_points.length > 0 && (
            <SectionCard icon={AlertTriangle} title="Pain points and how Finexer answers them">
              <ul className="m-0 p-0" style={{ listStyle: "none" }}>
                {faq.pain_points.map((p, pi) => (
                  <li key={pi} style={{ padding: "9px 0", borderTop: pi ? "1px solid " + C.line : "none" }}>
                    <div className="flex items-start gap-2">
                      <span style={{ color: C.accent, flexShrink: 0, lineHeight: 1.55 }}>&#8226;</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 14, lineHeight: 1.55, color: C.ink, fontWeight: 500 }}>
                          {p.pain}
                        </div>
                        <div style={{ fontFamily: F.mono, fontSize: 11, color: C.faint, marginTop: 2 }}>
                          raised by {p.count}
                          {p.raised_by.length ? ": " + p.raised_by.join(", ") : ""}
                        </div>
                        {p.solution && (
                          <div
                            className="rounded-lg"
                            style={{
                              background: C.accentSoft,
                              border: "1px solid " + C.accentLine,
                              padding: "8px 11px",
                              marginTop: 7,
                              fontSize: 13,
                              lineHeight: 1.55,
                              color: C.ink,
                            }}
                          >
                            <span style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: "0.08em", color: C.accent, display: "block", marginBottom: 2 }}>
                              FINEXER ANGLE
                            </span>
                            {p.solution}
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              <p style={{ margin: "10px 0 0", fontSize: 11.5, color: C.faint }}>
                Angles are based on Finexer's positioning and what was said on
                calls. Verify specifics like pricing before quoting them to a client.
              </p>
            </SectionCard>
          )}
          {faq.common_objections && faq.common_objections.length > 0 && (
            <SectionCard icon={ShieldAlert} title="Common objections and concerns" tone="accent">
              <ul className="m-0 p-0" style={{ listStyle: "none" }}>
                {faq.common_objections.map((o, oi) => (
                  <li key={oi} style={{ padding: "7px 0", borderTop: oi ? "1px solid " + C.accentLine : "none" }}>
                    <div className="flex items-start gap-2">
                      <span style={{ color: C.accent, flexShrink: 0, lineHeight: 1.55 }}>&#8226;</span>
                      <div>
                        <div style={{ fontSize: 14, lineHeight: 1.55, color: C.ink, fontWeight: 500 }}>
                          {o.objection}
                        </div>
                        <div style={{ fontFamily: F.mono, fontSize: 11, color: C.faint, marginTop: 2 }}>
                          raised by {o.count}
                          {o.raised_by && o.raised_by.length ? ": " + o.raised_by.join(", ") : ""}
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Competitor switchers panel                                          */
/* ------------------------------------------------------------------ */

const REL_STYLE = {
  "switching from": { bg: "#EAF6EE", fg: "#1E7A45" },
  evaluating: { bg: "#FAF1DD", fg: "#96610F" },
  "currently using": { bg: "#E9EEFB", fg: "#3057C3" },
  mentioned: { bg: "#ECEFF5", fg: "#56617A" },
};

function compToText(report) {
  const lines = [];
  lines.push("FINEXER COMPETITOR SWITCHERS REPORT");
  lines.push("Built from " + report.totalCalls + " decoded calls that mention a competitor.");
  lines.push("");
  for (const comp of report.competitors) {
    lines.push(comp.name.toUpperCase() + " (" + comp.clients.length + " clients)");
    for (const cl of comp.clients) {
      lines.push("- " + cl.client + " [" + cl.relationship + "]" + (cl.why ? ": " + cl.why : ""));
      for (const p of cl.pain_points || []) {
        lines.push("    Pain: " + p);
      }
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

function compToWordHtml(report) {
  const esc = (s) =>
    String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let html =
    "<html><head><meta charset='utf-8'><title>Finexer Competitor Switchers Report</title></head>" +
    "<body style='font-family:Calibri,Arial,sans-serif;color:#101B33;'>" +
    "<h1 style='color:#004AAD;'>Finexer Competitor Switchers Report</h1>" +
    "<p>Built from " + report.totalCalls + " decoded calls that mention a competitor.</p>";
  for (const comp of report.competitors) {
    html += "<h2 style='color:#3057C3;'>" + esc(comp.name) + " (" + comp.clients.length + " clients)</h2>";
    for (const cl of comp.clients) {
      html +=
        "<p style='margin-bottom:2px;'><b>" + esc(cl.client) + "</b> <span style='color:#56617A;'>[" +
        esc(cl.relationship) + "]</span>" + (cl.why ? "<br/>" + esc(cl.why) : "") + "</p>";
      if (cl.pain_points && cl.pain_points.length) {
        html += "<ul style='margin-top:2px;'>";
        for (const p of cl.pain_points) html += "<li>" + esc(p) + "</li>";
        html += "</ul>";
      }
    }
  }
  html += "</body></html>";
  return html;
}

function compToCsv(report) {
  const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
  const rows = [["Competitor", "Client", "Relationship", "Why", "Pain points"]];
  for (const comp of report.competitors) {
    for (const cl of comp.clients) {
      rows.push([comp.name, cl.client, cl.relationship, cl.why || "", (cl.pain_points || []).join("; ")]);
    }
  }
  return rows.map((r) => r.map(q).join(",")).join("\r\n");
}

function CompetitorsPanel({ api, showNotice, canEdit }) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copiedComp, setCopiedComp] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const d = await api("/.netlify/functions/competitors");
        if (d && d.report) setReport(d.report);
      } catch (e) {
        if (e.status !== 401) showNotice(e.message);
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const generate = async () => {
    setBusy(true);
    try {
      const d = await api("/.netlify/functions/competitors", {
        method: "POST",
        body: { action: "generate" },
      });
      setReport(d.report);
      showNotice("Report generated and saved. The whole team now sees this version.");
    } catch (e) {
      showNotice(e.message);
    }
    setBusy(false);
  };

  return (
    <div>
      <h2 style={{ fontFamily: F.display, fontSize: 22, fontWeight: 700, margin: "0 0 4px" }}>
        Competitor switchers
      </h2>
      <p style={{ fontSize: 13.5, color: C.muted, margin: "0 0 16px", lineHeight: 1.55 }}>
        Clients from decoded calls who mentioned a competitor, grouped by
        competitor, with whether they are switching from it, evaluating it, or
        just using it, plus their reasons and pain points. Generated once, saved,
        and shared with the whole team.
      </p>

      <div className="flex items-center gap-2 mb-5" style={{ flexWrap: "wrap" }}>
        {canEdit && (
          <button
            className="fcd-btn flex items-center gap-2"
            style={{ ...btnPrimary, opacity: busy ? 0.75 : 1 }}
            disabled={busy}
            onClick={generate}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Repeat size={14} />}
            {report ? "Regenerate report" : "Generate report"}
          </button>
        )}
        {report && (
          <>
            <button
              className="fcd-btn flex items-center gap-2"
              style={btnGhost}
              onClick={() =>
                downloadBlob(
                  compToWordHtml(report),
                  "application/msword",
                  "Finexer-Competitor-Switchers.doc"
                )
              }
            >
              <Download size={13} /> Word
            </button>
            <button
              className="fcd-btn flex items-center gap-2"
              style={btnGhost}
              onClick={() =>
                downloadBlob(compToCsv(report), "text/csv;charset=utf-8", "Finexer-Competitor-Switchers.csv")
              }
            >
              <Download size={13} /> Excel (CSV)
            </button>
            <button
              className="fcd-btn flex items-center gap-2"
              style={btnGhost}
              onClick={async () => {
                const ok = await copyToClipboard(compToText(report));
                if (ok) { setCopiedComp(true); setTimeout(() => setCopiedComp(false), 2000); }
                else showNotice("Copy failed in this browser.");
              }}
            >
              {copiedComp ? <Check size={13} /> : <Copy size={13} />}
              {copiedComp ? "Copied" : "Copy"}
            </button>
          </>
        )}
      </div>

      {(loading || (busy && !report)) && (
        <div className="flex items-center gap-2" style={{ color: C.muted, fontSize: 13.5 }}>
          <Loader2 size={14} className="animate-spin" />
          {loading
            ? "Loading the saved report"
            : "Reading competitor mentions across all decoded calls, this takes a few seconds"}
        </div>
      )}

      {!loading && !busy && !report && (
        <div className="rounded-xl text-center"
          style={{ border: "1px dashed #C3CBDC", background: C.surface, padding: "36px 24px" }}>
          <Repeat size={24} style={{ color: C.faint, margin: "0 auto 10px", display: "block" }} />
          <p style={{ margin: 0, fontSize: 13.5, color: C.muted, lineHeight: 1.6 }}>
            {canEdit
              ? "No report generated yet. Click Generate report once, it will be saved for the whole team."
              : "No report generated yet. Ask a writer or admin to generate it."}
          </p>
        </div>
      )}

      {report && (
        <div className="flex flex-col gap-4">
          <div style={{ fontFamily: F.mono, fontSize: 11.5, color: C.faint }}>
            Built from {report.totalCalls} calls mentioning a competitor &#183; generated {fmtDate(report.generatedAt)}
          </div>
          {report.competitors.length === 0 && (
            <p style={{ fontSize: 13.5, color: C.muted }}>
              No competitor relationships found in the decoded calls yet.
            </p>
          )}
          {report.competitors.map((comp, ci) => (
            <SectionCard key={ci} icon={Repeat} title={comp.name + " (" + comp.clients.length + ")"}>
              <div className="flex flex-col">
                {comp.clients.map((cl, li) => {
                  const rs = REL_STYLE[cl.relationship] || REL_STYLE.mentioned;
                  return (
                    <div key={li} style={{ padding: "10px 0", borderTop: li ? "1px solid " + C.line : "none" }}>
                      <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>{cl.client}</span>
                        <span style={{
                          fontFamily: F.mono, fontSize: 10.5, fontWeight: 500,
                          color: rs.fg, background: rs.bg, borderRadius: 999, padding: "2px 8px",
                        }}>
                          {cl.relationship}
                        </span>
                      </div>
                      {cl.why && (
                        <p style={{ margin: "4px 0 0", fontSize: 13.5, lineHeight: 1.55, color: C.ink }}>
                          {cl.why}
                        </p>
                      )}
                      {cl.pain_points && cl.pain_points.length > 0 && (
                        <ul className="m-0 p-0" style={{ listStyle: "none", marginTop: 5 }}>
                          {cl.pain_points.map((p, pi) => (
                            <li key={pi} className="flex gap-2" style={{ fontSize: 12.5, lineHeight: 1.5, color: C.muted, padding: "1px 0" }}>
                              <span style={{ color: C.accent, flexShrink: 0 }}>&#8226;</span>
                              <span>{p}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main app                                                            */
/* ------------------------------------------------------------------ */

export default function App() {
  const [auth, setAuth] = useState(loadAuth);
  const [authChecked, setAuthChecked] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState(null);

  const [calls, setCalls] = useState([]);
  const [listLoaded, setListLoaded] = useState(false);
  const [detailCache, setDetailCache] = useState({});
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const [faqOpen, setFaqOpen] = useState(false);
  const [compOpen, setCompOpen] = useState(false);
  const [passOpen, setPassOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [notice, setNotice] = useState(null);
  const [confirmingId, setConfirmingId] = useState(null);
  const [copied, setCopied] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);

  const fileInputRef = useRef(null);
  const authRef = useRef(auth);
  authRef.current = auth;
  const callsRef = useRef(calls);
  callsRef.current = calls;
  const processingRef = useRef(false);
  const noticeTimer = useRef(null);
  const confirmTimer = useRef(null);

  const me = auth ? auth.user : null;
  const canEdit = me && (me.role === "admin" || me.role === "writer");

  /* ---------------- notices ---------------- */
  const showNotice = (msg) => {
    setNotice(msg);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 6000);
  };

  /* ---------------- api ---------------- */
  const doLogout = (message) => {
    setAuth(null);
    try { localStorage.removeItem(AUTH_KEY); } catch (e) { /* ignore */ }
    setCalls([]);
    setDetailCache({});
    setSelectedId(null);
    setAdminOpen(false);
    setListLoaded(false);
    if (message) setLoginError(message);
  };

  const api = async (url, opts = {}) => {
    const t = authRef.current ? authRef.current.token : null;
    const res = await fetch(url, {
      method: opts.method || "GET",
      headers: {
        "Content-Type": "application/json",
        ...(t ? { Authorization: "Bearer " + t } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      doLogout(data.error || "Session expired. Sign in again.");
      const e = new Error(data.error || "Session expired.");
      e.status = 401;
      throw e;
    }
    if (!res.ok) {
      const e = new Error(data.error || "Request failed (" + res.status + ").");
      e.status = res.status;
      throw e;
    }
    return data;
  };

  /* ---------------- auth flows ---------------- */
  const doLogin = async (email, password) => {
    setLoginBusy(true);
    setLoginError(null);
    try {
      const res = await fetch("/.netlify/functions/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Login failed.");
      const next = { token: data.token, user: data.user };
      setAuth(next);
      try { localStorage.setItem(AUTH_KEY, JSON.stringify(next)); } catch (e) { /* ignore */ }
    } catch (e) {
      setLoginError(e.message);
    }
    setLoginBusy(false);
  };

  // Validate saved session once on load.
  useEffect(() => {
    (async () => {
      if (!authRef.current) { setAuthChecked(true); return; }
      try {
        const d = await api("/.netlify/functions/auth", {
          method: "POST",
          body: { action: "me" },
        });
        setAuth((a) => (a ? { ...a, user: d.user } : a));
      } catch (e) { /* doLogout already handled 401 */ }
      setAuthChecked(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- calls: list + queue ---------------- */
  const updateLocal = (id, patch) =>
    setCalls((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const applyFullCall = (call) => {
    const i = call.insights || {};
    updateLocal(call.id, {
      status: call.status,
      errorMsg: call.errorMsg || null,
      processedAt: call.processedAt || null,
      client_name: i.client_name || null,
      company_or_project: i.company_or_project || null,
      one_liner: i.one_liner || null,
    });
    setDetailCache((prev) => ({ ...prev, [call.id]: call }));
  };

  const fetchCalls = async () => {
    try {
      const d = await api("/.netlify/functions/calls");
      setCalls(d.calls || []);
      setListLoaded(true);
    } catch (e) {
      if (e.status !== 401) showNotice(e.message);
      setListLoaded(true);
    }
  };

  useEffect(() => {
    if (auth && authChecked) fetchCalls();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth ? auth.token : null, authChecked]);

  const analyzeCall = async (id) => {
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        return await api("/.netlify/functions/analyze", { method: "POST", body: { id } });
      } catch (e) {
        if (e.status === 409) { e.skip = true; throw e; }
        if (e.status === 401) throw e;
        const retriable = e.status === 429 || (e.status >= 500 && e.status < 600);
        if (attempt < 5 && retriable) {
          await sleep(e.status === 429 ? 21000 : Math.min(6000 * attempt, 25000));
          continue;
        }
        throw e;
      }
    }
  };

  const runQueue = async () => {
    if (processingRef.current || !canEdit) return;
    processingRef.current = true;
    const handled = new Set();
    let touched = false;
    while (true) {
      const next = callsRef.current.find(
        (c) => c.status === "queued" && !handled.has(c.id)
      );
      if (!next) break;
      handled.add(next.id);
      touched = true;
      updateLocal(next.id, { status: "processing", errorMsg: null });
      try {
        const d = await analyzeCall(next.id);
        if (d && d.call) applyFullCall(d.call);
      } catch (e) {
        if (e.status === 401) break;
        if (e.skip) {
          /* someone else is analyzing it, leave as processing */
        } else {
          updateLocal(next.id, { status: "error", errorMsg: e.message });
        }
      }
      await sleep(QUEUE_DELAY_MS);
    }
    processingRef.current = false;
    if (touched && authRef.current) fetchCalls();
  };

  useEffect(() => {
    if (!listLoaded) return;
    if (calls.some((c) => c.status === "queued")) runQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calls, listLoaded]);

  /* ---------------- uploads ---------------- */
  const handleFiles = async (fileList) => {
    if (!canEdit) {
      showNotice("Your role is view only. Ask the admin for writer access to upload.");
      return;
    }
    const all = Array.from(fileList || []);
    const txt = all.filter(
      (f) => f.name.toLowerCase().endsWith(".txt") || f.type === "text/plain"
    );
    const skippedType = all.length - txt.length;
    const existing = new Set(callsRef.current.map((c) => c.filename));
    let dupes = 0;
    let added = 0;

    for (const f of txt) {
      if (existing.has(f.name)) { dupes++; continue; }
      try {
        const text = await f.text();
        if (!text.trim()) continue;
        const d = await api("/.netlify/functions/calls", {
          method: "POST",
          body: { action: "create", filename: f.name, transcript: text.slice(0, 200000) },
        });
        setCalls((prev) => [...prev, d.call]);
        existing.add(f.name);
        added++;
      } catch (e) {
        if (e.status === 401) return;
        showNotice("Could not upload " + f.name + ": " + e.message);
      }
    }

    const notes = [];
    if (added) notes.push(added + " transcript" + (added > 1 ? "s" : "") + " added to the shared library.");
    if (dupes) notes.push(dupes + " skipped, already in the library.");
    if (skippedType) notes.push(skippedType + " skipped, only .txt files are supported.");
    if (notes.length) showNotice(notes.join(" "));
  };

  /* ---------------- delete / retry ---------------- */
  const askDelete = (id) => {
    setConfirmingId(id);
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    confirmTimer.current = setTimeout(() => setConfirmingId(null), 3000);
  };

  const doDelete = async (id) => {
    setConfirmingId(null);
    try {
      await api("/.netlify/functions/calls", { method: "POST", body: { action: "delete", id } });
      setCalls((prev) => prev.filter((c) => c.id !== id));
      setDetailCache((prev) => { const n = { ...prev }; delete n[id]; return n; });
      if (selectedId === id) setSelectedId(null);
    } catch (e) {
      if (e.status !== 401) showNotice(e.message);
    }
  };

  const retryCall = async (id) => {
    try {
      const d = await api("/.netlify/functions/calls", { method: "POST", body: { action: "requeue", id } });
      updateLocal(id, { status: "queued", errorMsg: null });
      if (d && d.call) updateLocal(id, d.call);
    } catch (e) {
      if (e.status !== 401) showNotice(e.message);
    }
  };

  const canDeleteCall = (c) =>
    me && (me.role === "admin" || (me.role === "writer" && c.uploadedBy === me.email));

  /* ---------------- derived ---------------- */
  const doneCount = calls.filter((c) => c.status === "done").length;
  const pendingCount = calls.filter(
    (c) => c.status === "queued" || c.status === "processing"
  ).length;
  const current = calls.find((c) => c.status === "processing");
  const progress = calls.length > 0 ? (calls.length - pendingCount) / calls.length : 0;

  const q = query.trim().toLowerCase();
  const visible = q
    ? calls.filter((c) =>
        [c.filename, c.client_name, c.company_or_project, c.one_liner]
          .filter(Boolean)
          .some((s) => s.toLowerCase().includes(q))
      )
    : calls;

  const selectedLight = calls.find((c) => c.id === selectedId) || null;
  const selectedFull = selectedId ? detailCache[selectedId] : null;
  const selectedIndex = selectedLight ? calls.indexOf(selectedLight) : -1;

  useEffect(() => {
    setShowTranscript(false);
    setCopied(false);
    if (!selectedId) return;
    if (detailCache[selectedId]) return;
    (async () => {
      setDetailLoading(true);
      try {
        const d = await api("/.netlify/functions/calls?id=" + encodeURIComponent(selectedId));
        setDetailCache((prev) => ({ ...prev, [selectedId]: d.call }));
      } catch (e) {
        if (e.status !== 401) showNotice(e.message);
      }
      setDetailLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  /* ---------------- render ---------------- */
  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center"
        style={{ background: C.bg, fontFamily: F.body, color: C.muted }}>
        <style>{APP_CSS}</style>
        <div className="flex items-center gap-2" style={{ fontSize: 14 }}>
          <Loader2 size={16} className="animate-spin" /> Loading
        </div>
      </div>
    );
  }

  if (!auth) {
    return (
      <>
        <style>{APP_CSS}</style>
        <LoginScreen onLogin={doLogin} busy={loginBusy} error={loginError} />
      </>
    );
  }

  const insights = selectedFull ? selectedFull.insights : null;

  return (
    <div className="min-h-screen" style={{ background: C.bg, fontFamily: F.body, color: C.ink }}>
      <style>{APP_CSS}</style>

      {/* top bar */}
      <div style={{ background: C.surface, borderBottom: "1px solid " + C.line }}>
        <div className="max-w-3xl mx-auto px-5 flex items-center gap-3" style={{ height: 60 }}>
          <button
            className="fcd-btn flex items-center gap-2"
            onClick={() => { setSelectedId(null); setAdminOpen(false); setFaqOpen(false); setCompOpen(false); }}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
          >
            <Logo size={26} />
            <span style={{ fontFamily: F.display, fontSize: 16.5, fontWeight: 700, color: C.ink }}>
              Call Decoder
            </span>
          </button>
          <div style={{ flex: 1 }} />
          <span className="hidden md:inline" style={{ fontFamily: F.mono, fontSize: 11.5, color: C.muted }}>
            {me.name || me.email}
          </span>
          <RoleBadge role={me.role} />
          <button
            className="fcd-btn flex items-center gap-1"
            style={{ ...btnGhost, padding: "6px 10px", fontSize: 12.5, ...(faqOpen ? { borderColor: C.accent, color: C.accent } : {}) }}
            onClick={() => { setFaqOpen((v) => !v); setCompOpen(false); setAdminOpen(false); setSelectedId(null); }}
          >
            <BookOpen size={13} /> FAQ
          </button>
          <button
            className="fcd-btn flex items-center gap-1"
            style={{ ...btnGhost, padding: "6px 10px", fontSize: 12.5, ...(compOpen ? { borderColor: C.accent, color: C.accent } : {}) }}
            onClick={() => { setCompOpen((v) => !v); setFaqOpen(false); setAdminOpen(false); setSelectedId(null); }}
          >
            <Repeat size={13} /> Switchers
          </button>
          {me.role === "admin" && (
            <button
              className="fcd-btn flex items-center gap-1"
              style={{ ...btnGhost, padding: "6px 10px", fontSize: 12.5, ...(adminOpen ? { borderColor: C.accent, color: C.accent } : {}) }}
              onClick={() => { setAdminOpen((v) => !v); setFaqOpen(false); setCompOpen(false); setSelectedId(null); }}
            >
              <Users size={13} /> Team
            </button>
          )}
          <button
            className="fcd-btn"
            title="Change password"
            style={{ ...btnGhost, padding: "6px 9px" }}
            onClick={() => setPassOpen((v) => !v)}
          >
            <KeyRound size={13} />
          </button>
          <button
            className="fcd-btn"
            title="Sign out"
            style={{ ...btnGhost, padding: "6px 9px" }}
            onClick={() => doLogout()}
          >
            <LogOut size={13} />
          </button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-5 py-8">
        {passOpen && (
          <PasswordPanel api={api} showNotice={showNotice} onClose={() => setPassOpen(false)} />
        )}

        {adminOpen ? (
          <AdminPanel api={api} me={me} showNotice={showNotice} />
        ) : faqOpen ? (
          <FaqPanel api={api} showNotice={showNotice} canEdit={canEdit} />
        ) : compOpen ? (
          <CompetitorsPanel api={api} showNotice={showNotice} canEdit={canEdit} />
        ) : selectedLight ? (
          /* ======================= DETAIL VIEW ======================= */
          <div>
            <button
              className="fcd-btn flex items-center gap-2 mb-6"
              onClick={() => setSelectedId(null)}
              style={{ background: "none", border: "none", cursor: "pointer", color: C.muted, fontFamily: F.mono, fontSize: 12, padding: 0 }}
            >
              <ArrowLeft size={14} /> Back to library
            </button>

            {/* header card */}
            <div className="rounded-xl p-6 mb-4" style={{ background: C.surface, border: "1px solid " + C.line }}>
              <div className="flex items-center gap-2 mb-2"
                style={{ fontFamily: F.mono, fontSize: 11, color: C.faint, flexWrap: "wrap" }}>
                <span>Call {String(selectedIndex + 1).padStart(2, "0")}</span>
                <span>&#183;</span>
                <span style={{ wordBreak: "break-all" }}>{selectedLight.filename}</span>
                {selectedLight.uploadedBy && (
                  <>
                    <span>&#183;</span>
                    <span>by {selectedLight.uploadedBy}</span>
                  </>
                )}
                {selectedLight.processedAt && (
                  <>
                    <span>&#183;</span>
                    <span>decoded {fmtDate(selectedLight.processedAt)}</span>
                  </>
                )}
              </div>
              <h1 style={{ fontFamily: F.display, fontSize: 26, fontWeight: 700, margin: "0 0 4px", lineHeight: 1.2 }}>
                {selectedLight.client_name || selectedLight.filename.replace(/\.txt$/i, "")}
              </h1>
              {selectedLight.company_or_project && (
                <div style={{ fontSize: 14, color: C.muted, marginBottom: 6 }}>
                  {selectedLight.company_or_project}
                </div>
              )}
              {insights && insights.client_type && (
                <span style={{
                  display: "inline-block", fontFamily: F.mono, fontSize: 11,
                  color: C.accent, background: C.accentSoft,
                  border: "1px solid " + C.accentLine, borderRadius: 999, padding: "3px 10px",
                }}>
                  {insights.client_type}
                </span>
              )}

              {/* actions */}
              <div className="flex items-center gap-2 mt-5" style={{ flexWrap: "wrap" }}>
                {insights && (
                  <button
                    className="fcd-btn flex items-center gap-2"
                    onClick={async () => {
                      const ok = await copyToClipboard(buildCopyText(selectedFull));
                      if (ok) { setCopied(true); setTimeout(() => setCopied(false), 2000); }
                      else showNotice("Copy failed in this browser. Select the text manually.");
                    }}
                    style={btnPrimary}
                  >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? "Copied" : "Copy insights"}
                  </button>
                )}
                <button
                  className="fcd-btn flex items-center gap-2"
                  onClick={() => setShowTranscript((v) => !v)}
                  style={btnGhost}
                >
                  <FileText size={14} />
                  {showTranscript ? "Hide raw transcript" : "View raw transcript"}
                </button>
                {canDeleteCall(selectedLight) && (
                  confirmingId === selectedLight.id ? (
                    <button
                      className="fcd-btn flex items-center gap-2"
                      onClick={() => doDelete(selectedLight.id)}
                      style={{ ...btnPrimary, background: C.red }}
                    >
                      <Trash2 size={14} /> Confirm delete
                    </button>
                  ) : (
                    <button
                      className="fcd-btn flex items-center gap-2"
                      onClick={() => askDelete(selectedLight.id)}
                      style={{ ...btnGhost, color: C.red }}
                    >
                      <Trash2 size={14} /> Delete
                    </button>
                  )
                )}
              </div>
            </div>

            {/* status states */}
            {selectedLight.status === "processing" && (
              <div className="rounded-xl p-5 flex items-center gap-3 mb-4"
                style={{ background: C.amberSoft, border: "1px solid #EAD9B8", color: C.amber, fontSize: 14 }}>
                <Loader2 size={16} className="animate-spin" />
                Analyzing this call. Insights will appear here shortly.
              </div>
            )}
            {selectedLight.status === "queued" && (
              <div className="rounded-xl p-5 mb-4"
                style={{ background: C.surface, border: "1px solid " + C.line, color: C.muted, fontSize: 14 }}>
                Waiting in the queue.
              </div>
            )}
            {selectedLight.status === "error" && (
              <div className="rounded-xl p-5 mb-4"
                style={{ background: C.redSoft, border: "1px solid #EFC7C0", color: C.red, fontSize: 14 }}>
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle size={16} />
                  {selectedLight.errorMsg || "Analysis failed."}
                </div>
                {canEdit && (
                  <button
                    className="fcd-btn flex items-center gap-2"
                    onClick={() => retryCall(selectedLight.id)}
                    style={{ ...btnPrimary, background: C.red, padding: "7px 12px", fontSize: 13 }}
                  >
                    <RefreshCw size={13} /> Retry analysis
                  </button>
                )}
              </div>
            )}
            {detailLoading && !selectedFull && (
              <div className="flex items-center gap-2" style={{ color: C.muted, fontSize: 13.5 }}>
                <Loader2 size={14} className="animate-spin" /> Loading insights
              </div>
            )}

            {/* insights */}
            {insights && (
              <div className="flex flex-col gap-4">
                {(insights.one_liner || insights.intent || insights.use_case) && (
                  <SectionCard icon={Target} title="Who they are and what they want">
                    {insights.one_liner && (
                      <p style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 600, lineHeight: 1.5 }}>
                        {insights.one_liner}
                      </p>
                    )}
                    {insights.intent && (
                      <p style={{ margin: "0 0 10px", fontSize: 14, lineHeight: 1.6, color: C.ink }}>
                        <span style={{ fontFamily: F.mono, fontSize: 11, color: C.faint, display: "block", marginBottom: 2 }}>INTENT</span>
                        {insights.intent}
                      </p>
                    )}
                    {insights.use_case && (
                      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: C.ink }}>
                        <span style={{ fontFamily: F.mono, fontSize: 11, color: C.faint, display: "block", marginBottom: 2 }}>USE CASE</span>
                        {insights.use_case}
                      </p>
                    )}
                  </SectionCard>
                )}

                {insights.pain_points.length > 0 && (
                  <SectionCard icon={AlertTriangle} title="Pain points">
                    <Bullets items={insights.pain_points} />
                  </SectionCard>
                )}

                {insights.verbatim_quotes.length > 0 && (
                  <SectionCard icon={Quote} title="In their own words">
                    <div className="flex flex-col gap-3">
                      {insights.verbatim_quotes.map((qt, i) => (
                        <QuoteCard key={i} q={qt} />
                      ))}
                    </div>
                    <p style={{ margin: "10px 0 0", fontSize: 11.5, color: C.faint }}>
                      Copied exactly as transcribed, including Otter errors. Nothing is reworded.
                    </p>
                  </SectionCard>
                )}

                {insights.content_angles.length > 0 && (
                  <SectionCard icon={Lightbulb} title="Content angles" tone="accent">
                    <Bullets items={insights.content_angles} />
                  </SectionCard>
                )}

                <div className="grid md:grid-cols-2 gap-4">
                  {insights.questions_they_asked.length > 0 && (
                    <SectionCard icon={HelpCircle} title="Questions they asked">
                      <Bullets items={insights.questions_they_asked} />
                    </SectionCard>
                  )}
                  {insights.objections_or_concerns.length > 0 && (
                    <SectionCard icon={ShieldAlert} title="Objections and concerns">
                      <Bullets items={insights.objections_or_concerns} />
                    </SectionCard>
                  )}
                </div>

                {(insights.buying_signals.length > 0 ||
                  insights.timeline_and_scale ||
                  insights.competitors_mentioned.length > 0) && (
                  <SectionCard icon={TrendingUp} title="Deal signals">
                    {insights.buying_signals.length > 0 && <Bullets items={insights.buying_signals} />}
                    {insights.timeline_and_scale && (
                      <p className="flex items-start gap-2" style={{ margin: "10px 0 0", fontSize: 13.5, color: C.ink }}>
                        <Clock size={14} style={{ color: C.accent, marginTop: 2, flexShrink: 0 }} />
                        <span>{insights.timeline_and_scale}</span>
                      </p>
                    )}
                    {insights.competitors_mentioned.length > 0 && (
                      <div className="flex gap-2 mt-3" style={{ flexWrap: "wrap" }}>
                        {insights.competitors_mentioned.map((cm, i) => (
                          <span key={i} style={{
                            fontFamily: F.mono, fontSize: 11, color: C.muted,
                            background: "#ECEFF5", borderRadius: 4, padding: "3px 8px",
                          }}>
                            {cm}
                          </span>
                        ))}
                      </div>
                    )}
                  </SectionCard>
                )}

                {insights.next_steps.length > 0 && (
                  <SectionCard icon={ListChecks} title="Next steps">
                    <Bullets items={insights.next_steps} />
                  </SectionCard>
                )}
              </div>
            )}

            {/* raw transcript */}
            {showTranscript && (
              <div className="rounded-xl p-5 mt-4" style={{ background: C.surface, border: "1px solid " + C.line }}>
                <div className="flex items-center gap-2 mb-3">
                  <FileText size={15} style={{ color: C.accent }} />
                  <h3 style={{ fontFamily: F.display, fontSize: 13, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", margin: 0 }}>
                    Raw transcript
                  </h3>
                </div>
                <pre style={{
                  fontFamily: F.mono, fontSize: 12, lineHeight: 1.65, color: C.muted,
                  whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 420, overflowY: "auto", margin: 0,
                }}>
                  {selectedFull
                    ? selectedFull.transcript || "Transcript not stored for this call."
                    : "Loading transcript..."}
                </pre>
              </div>
            )}
          </div>
        ) : (
          /* ======================= LIBRARY VIEW ======================= */
          <div>
            <div className="mb-7">
              <div style={{ fontFamily: F.mono, fontSize: 11, letterSpacing: "0.14em", color: C.accent, fontWeight: 500, marginBottom: 6 }}>
                FINEXER &#183; INTERNAL
              </div>
              <h1 style={{ fontFamily: F.display, fontSize: 30, fontWeight: 700, margin: "0 0 6px", lineHeight: 1.1 }}>
                Shared call library
              </h1>
              <p style={{ margin: 0, fontSize: 14.5, color: C.muted, lineHeight: 1.55 }}>
                Every decoded call is visible to the whole team: intent, pain points,
                exact quotes, and content angles.
              </p>
              <div className="flex items-center gap-3" style={{ marginTop: 10 }}>
                {calls.length > 0 && (
                  <span style={{ fontFamily: F.mono, fontSize: 12, color: C.faint }}>
                    {doneCount} decoded
                    {pendingCount > 0 ? " \u00B7 " + pendingCount + " in queue" : ""}
                  </span>
                )}
                <button
                  className="fcd-btn flex items-center gap-1"
                  title="Refresh library"
                  onClick={fetchCalls}
                  style={{ background: "none", border: "none", cursor: "pointer", color: C.faint, fontFamily: F.mono, fontSize: 11.5, padding: 0 }}
                >
                  <RefreshCw size={11} /> refresh
                </button>
              </div>
            </div>

            {/* dropzone */}
            {canEdit && (
              <div
                role="button"
                tabIndex={0}
                className="fcd-row rounded-xl mb-4"
                onClick={() => fileInputRef.current && fileInputRef.current.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    fileInputRef.current && fileInputRef.current.click();
                  }
                }}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
                style={{
                  border: "1.5px dashed " + (dragOver ? C.accent : "#C3CBDC"),
                  background: dragOver ? C.accentSoft : C.surface,
                  padding: "26px 20px",
                  textAlign: "center",
                  cursor: "pointer",
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,text/plain"
                  multiple
                  style={{ display: "none" }}
                  onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
                />
                <FileUp size={22} style={{ color: C.accent, margin: "0 auto 8px", display: "block" }} />
                <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 3 }}>
                  Drop .txt transcripts here, or click to browse
                </div>
                <div style={{ fontSize: 12.5, color: C.faint }}>
                  Batches of 20 to 25 files work fine. Calls are decoded one by one, in
                  order, and saved for the whole team.
                </div>
              </div>
            )}

            {/* progress strip */}
            {pendingCount > 0 && (
              <div className="rounded-xl p-4 mb-4" style={{ background: C.surface, border: "1px solid " + C.line }}>
                <div className="flex items-center gap-2 mb-2" style={{ fontSize: 13, color: C.ink }}>
                  <Loader2 size={14} className="animate-spin" style={{ color: C.amber }} />
                  <span style={{ fontWeight: 600 }}>
                    {current ? "Analyzing " + current.filename : "Queue pending"}
                  </span>
                  <span style={{ color: C.faint, fontFamily: F.mono, fontSize: 11.5 }}>
                    {pendingCount} remaining
                    {pendingCount >= 3
                      ? " \u00B7 about " + Math.max(1, Math.ceil((pendingCount * 18) / 60)) + " min"
                      : ""}
                  </span>
                </div>
                <div style={{ height: 4, borderRadius: 999, background: "#E8ECF4", overflow: "hidden" }}>
                  <div style={{
                    height: "100%", width: Math.round(progress * 100) + "%",
                    background: GRAD, borderRadius: 999, transition: "width 400ms ease",
                  }} />
                </div>
              </div>
            )}

            {/* search */}
            {calls.length > 5 && (
              <div className="flex items-center gap-2 rounded-lg mb-3"
                style={{ background: C.surface, border: "1px solid " + C.line, padding: "8px 12px" }}>
                <Search size={14} style={{ color: C.faint }} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by client, company, or filename"
                  style={{
                    border: "none", outline: "none", background: "transparent",
                    fontSize: 13.5, width: "100%", color: C.ink, fontFamily: F.body,
                  }}
                />
              </div>
            )}

            {/* list */}
            {!listLoaded ? (
              <div className="flex items-center gap-2" style={{ color: C.muted, fontSize: 13.5, padding: "18px 4px" }}>
                <Loader2 size={14} className="animate-spin" /> Loading the shared library
              </div>
            ) : calls.length === 0 ? (
              <div className="rounded-xl text-center"
                style={{ border: "1px solid " + C.line, background: C.surface, padding: "44px 24px" }}>
                <Inbox size={26} style={{ color: C.faint, margin: "0 auto 10px", display: "block" }} />
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
                  No calls decoded yet
                </div>
                <p style={{ margin: 0, fontSize: 13.5, color: C.muted, lineHeight: 1.6 }}>
                  {canEdit
                    ? "Upload Otter transcripts above. Each call becomes a card with the client's intent, pain points, verbatim quotes, and content angles, visible to the whole team."
                    : "Nothing here yet. A writer or admin will add calls soon."}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {visible.length === 0 && (
                  <div style={{ fontSize: 13.5, color: C.muted, padding: "14px 4px" }}>
                    No calls match &ldquo;{query}&rdquo;.
                  </div>
                )}
                {visible.map((c) => {
                  const idx = calls.indexOf(c);
                  return (
                    <div
                      key={c.id}
                      role="button"
                      tabIndex={0}
                      className="fcd-row rounded-xl flex items-center gap-3"
                      title={c.uploadedBy ? "Uploaded by " + c.uploadedBy : undefined}
                      onClick={() => setSelectedId(c.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedId(c.id);
                        }
                      }}
                      style={{
                        background: C.surface,
                        border: "1px solid " + C.line,
                        padding: "14px 16px",
                        cursor: "pointer",
                      }}
                    >
                      <span style={{
                        fontFamily: F.mono, fontSize: 12,
                        color: c.status === "done" ? C.accent : C.faint,
                        fontWeight: 500, flexShrink: 0, width: 26,
                      }}>
                        {String(idx + 1).padStart(2, "0")}
                      </span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{
                          fontSize: 14.5, fontWeight: 600,
                          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        }}>
                          {c.client_name || c.company_or_project || c.filename}
                        </div>
                        <div style={{
                          fontSize: 12.5, color: C.muted,
                          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 2,
                        }}>
                          {c.one_liner
                            ? c.one_liner
                            : c.status === "error"
                            ? c.errorMsg || "Analysis failed"
                            : c.filename}
                        </div>
                      </div>
                      <StatusChip status={c.status} />
                      {c.status === "error" && canEdit && (
                        <button
                          className="fcd-btn"
                          title="Retry analysis"
                          onClick={(e) => { e.stopPropagation(); retryCall(c.id); }}
                          style={{
                            background: "none", border: "1px solid " + C.line,
                            borderRadius: 6, color: C.muted, cursor: "pointer", padding: 5, flexShrink: 0,
                          }}
                        >
                          <RefreshCw size={13} />
                        </button>
                      )}
                      {canDeleteCall(c) && (
                        confirmingId === c.id ? (
                          <button
                            className="fcd-btn"
                            title="Confirm delete"
                            onClick={(e) => { e.stopPropagation(); doDelete(c.id); }}
                            style={{
                              background: C.red, border: "none", borderRadius: 6,
                              color: "#fff", cursor: "pointer", padding: 5, flexShrink: 0,
                            }}
                          >
                            <Check size={13} />
                          </button>
                        ) : (
                          <button
                            className="fcd-btn"
                            title="Delete this call"
                            onClick={(e) => { e.stopPropagation(); askDelete(c.id); }}
                            style={{ background: "none", border: "none", color: C.faint, cursor: "pointer", padding: 5, flexShrink: 0 }}
                          >
                            <Trash2 size={14} />
                          </button>
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <p style={{ fontSize: 11.5, color: C.faint, marginTop: 24, lineHeight: 1.6 }}>
              Insights are AI-generated from the transcript, in English. Quotes are
              copied verbatim and never reworded. The library is shared: everyone with
              access sees the same calls.
            </p>
          </div>
        )}
      </div>

      {/* toast */}
      {notice && (
        <div
          className="rounded-lg flex items-center gap-3"
          style={{
            position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)",
            maxWidth: 520, width: "calc(100% - 32px)", background: C.ink, color: "#F3F6FC",
            fontSize: 13, padding: "11px 14px", boxShadow: "0 6px 20px rgba(16,27,51,0.28)", zIndex: 50,
          }}
        >
          <span style={{ flex: 1 }}>{notice}</span>
          <button
            className="fcd-btn"
            onClick={() => setNotice(null)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "#9FACC6", padding: 2, flexShrink: 0 }}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
