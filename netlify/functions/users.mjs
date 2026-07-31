/* /.netlify/functions/users  (admin only)
   GET  -> list users
   POST { action: "add" | "update_role" | "set_password" | "remove" } */

import {
  json,
  parseBody,
  requireAuth,
  getUsers,
  saveUser,
  deleteUser,
  hashPassword,
  publicUser,
  ROLES,
} from "../lib/util.mjs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const handler = async (event) => {
  const { user, error } = await requireAuth(event, ["admin"]);
  if (error) return error;

  let users;
  try {
    users = await getUsers();
  } catch (e) {
    return json(500, { error: e.message });
  }

  if (event.httpMethod === "GET") {
    const list = Object.values(users)
      .map(publicUser)
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    return json(200, { users: list });
  }

  if (event.httpMethod !== "POST") return json(405, { error: "POST only." });
  const body = parseBody(event);
  const action = body.action;

  try {
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
      const record = {
        email,
        name,
        role,
        passSalt,
        passHash,
        createdAt: Date.now(),
        addedBy: user.email,
      };
      await saveUser(record);
      return json(200, { user: publicUser(record) });
    }

    if (action === "update_role") {
      const email = String(body.email || "").toLowerCase().trim();
      const role = String(body.role || "");
      if (!users[email]) return json(404, { error: "User not found." });
      if (!ROLES.includes(role)) return json(400, { error: "Invalid role." });
      if (email === user.email) {
        return json(400, { error: "You cannot change your own role." });
      }
      const record = { ...users[email], role };
      await saveUser(record);
      return json(200, { user: publicUser(record) });
    }

    if (action === "set_password") {
      const email = String(body.email || "").toLowerCase().trim();
      const password = String(body.password || "");
      if (!users[email]) return json(404, { error: "User not found." });
      if (password.length < 8) {
        return json(400, { error: "Password must be at least 8 characters." });
      }
      const { passSalt, passHash } = hashPassword(password);
      const record = { ...users[email], passSalt, passHash };
      await saveUser(record);
      return json(200, { ok: true });
    }

    if (action === "remove") {
      const email = String(body.email || "").toLowerCase().trim();
      if (!users[email]) return json(404, { error: "User not found." });
      if (email === user.email) {
        return json(400, { error: "You cannot remove your own account." });
      }
      await deleteUser(email);
      return json(200, { ok: true });
    }
  } catch (e) {
    return json(500, { error: e.message });
  }

  return json(400, { error: "Unknown action." });
};
