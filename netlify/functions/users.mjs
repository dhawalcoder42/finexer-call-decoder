/* /.netlify/functions/users  (admin only)
   GET  -> list users
   POST { action: "add" | "update_role" | "set_password" | "remove" } */

import {
  json,
  parseBody,
  requireAuth,
  getUsers,
  saveUsers,
  hashPassword,
  publicUser,
  ROLES,
} from "../lib/util.mjs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const handler = async (event) => {
  const { user, error } = await requireAuth(event, ["admin"]);
  if (error) return error;

  if (event.httpMethod === "GET") {
    const users = await getUsers();
    const list = Object.values(users)
      .map(publicUser)
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    return json(200, { users: list });
  }

  if (event.httpMethod !== "POST") return json(405, { error: "POST only." });
  const body = parseBody(event);
  const action = body.action;
  const users = await getUsers();

  if (action === "add") {
    const email = String(body.email || "").toLowerCase().trim();
    const name = String(body.name || "").trim().slice(0, 60);
    const role = String(body.role || "writer");
    const password = String(body.password || "");
    if (!EMAIL_RE.test(email)) return json(400, { error: "Enter a valid email." });
    if (!ROLES.includes(role)) return json(400, { error: "Invalid role." });
    if (password.length < 8) {
      return json(400, { error: "Password must be at least 8 characters." });
    }
    if (users[email]) return json(400, { error: "This email is already added." });

    const { passSalt, passHash } = hashPassword(password);
    users[email] = {
      email,
      name,
      role,
      passSalt,
      passHash,
      createdAt: Date.now(),
      addedBy: user.email,
    };
    await saveUsers(users);
    return json(200, { user: publicUser(users[email]) });
  }

  if (action === "update_role") {
    const email = String(body.email || "").toLowerCase().trim();
    const role = String(body.role || "");
    if (!users[email]) return json(404, { error: "User not found." });
    if (!ROLES.includes(role)) return json(400, { error: "Invalid role." });
    if (email === user.email) {
      return json(400, { error: "You cannot change your own role." });
    }
    users[email].role = role;
    await saveUsers(users);
    return json(200, { user: publicUser(users[email]) });
  }

  if (action === "set_password") {
    const email = String(body.email || "").toLowerCase().trim();
    const password = String(body.password || "");
    if (!users[email]) return json(404, { error: "User not found." });
    if (password.length < 8) {
      return json(400, { error: "Password must be at least 8 characters." });
    }
    const { passSalt, passHash } = hashPassword(password);
    users[email].passSalt = passSalt;
    users[email].passHash = passHash;
    await saveUsers(users);
    return json(200, { ok: true });
  }

  if (action === "remove") {
    const email = String(body.email || "").toLowerCase().trim();
    if (!users[email]) return json(404, { error: "User not found." });
    if (email === user.email) {
      return json(400, { error: "You cannot remove your own account." });
    }
    delete users[email];
    await saveUsers(users);
    return json(200, { ok: true });
  }

  return json(400, { error: "Unknown action." });
};
