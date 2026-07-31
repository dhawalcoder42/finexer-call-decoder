/* /.netlify/functions/auth
   POST { action: "login" | "me" | "change_password" } */

import {
  json,
  parseBody,
  getUsers,
  saveUsers,
  hashPassword,
  verifyPassword,
  signToken,
  requireAuth,
} from "../lib/util.mjs";

const SESSION_DAYS = 7;

export const handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only." });
  const body = parseBody(event);
  const action = body.action;

  if (action === "login") {
    const secret = process.env.SESSION_SECRET;
    if (!secret) {
      return json(500, {
        error:
          "SESSION_SECRET is not set. Add it to .env locally and to Netlify environment variables.",
      });
    }
    const email = String(body.email || "").toLowerCase().trim();
    const password = String(body.password || "");
    if (!email || !password) {
      return json(400, { error: "Enter both email and password." });
    }

    const users = await getUsers();
    const user = users[email];
    if (!user) {
      return json(401, {
        error: "This email does not have access. Ask the admin to add you.",
      });
    }

    let ok = false;
    if (user.passHash) {
      ok = verifyPassword(password, user.passSalt, user.passHash);
    } else if (
      user.role === "admin" &&
      process.env.ADMIN_PASSWORD &&
      password === process.env.ADMIN_PASSWORD
    ) {
      // First admin login: store a proper hash of the env password.
      const { passSalt, passHash } = hashPassword(password);
      user.passSalt = passSalt;
      user.passHash = passHash;
      users[user.email] = user;
      await saveUsers(users);
      ok = true;
    } else if (!user.passHash) {
      return json(401, {
        error: "No password set for this account. Ask the admin to set one.",
      });
    }

    if (!ok) return json(401, { error: "Wrong email or password." });

    const token = signToken(
      { email: user.email, exp: Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000 },
      secret
    );
    return json(200, {
      token,
      user: { email: user.email, role: user.role, name: user.name || "" },
    });
  }

  if (action === "me") {
    const { user, error } = await requireAuth(event);
    if (error) return error;
    return json(200, { user });
  }

  if (action === "change_password") {
    const { user, error } = await requireAuth(event);
    if (error) return error;
    const current = String(body.currentPassword || "");
    const next = String(body.newPassword || "");
    if (next.length < 8) {
      return json(400, { error: "New password must be at least 8 characters." });
    }
    const users = await getUsers();
    const record = users[user.email];
    let ok = false;
    if (record.passHash) {
      ok = verifyPassword(current, record.passSalt, record.passHash);
    } else if (
      record.role === "admin" &&
      process.env.ADMIN_PASSWORD &&
      current === process.env.ADMIN_PASSWORD
    ) {
      ok = true;
    }
    if (!ok) return json(401, { error: "Current password is wrong." });

    const { passSalt, passHash } = hashPassword(next);
    record.passSalt = passSalt;
    record.passHash = passHash;
    users[user.email] = record;
    await saveUsers(users);
    return json(200, { ok: true });
  }

  return json(400, { error: "Unknown action." });
};
