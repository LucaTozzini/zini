import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import test from "node:test";
import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import express from "express";

test("chat identity comes from a revocable user session", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "zini-user-session-"));
  process.env.DB_PATH = join(directory, "users.sqlite");
  const { sequelize } = await import("../db.js");
  const { User } = await import("../models/User.js");
  const { ProjectLeadThread } = await import("../models/ProjectLeadThread.js");
  const { checkpointer } = await import("../agents/agents.js");
  const { requireUser, requireApiUser } = await import("./session.js");
  const { usersRouter } = await import("../routes/users.js");
  const { projectLead } = await import("../routes/projectLead.js");
  const { forge } = await import("../routes/forge.js");

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api", requireApiUser);
  for (const route of ["health", "events", "settings", "integrations", "workspaces", "evals", "chatgpt"]) {
    app.get(`/api/${route}`, (req, res) => res.json(req.user));
  }
  app.use("/api/users", usersRouter);
  app.use("/api/project-lead", projectLead);
  app.use("/api/forge", forge);
  app.post("/identity", requireUser, (req, res) => res.json(req.user));
  const server = app.listen(0, "127.0.0.1");

  try {
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    await User.sync();
    await ProjectLeadThread.sync();
    const user = await User.create({
      username: "session-user",
      password_hash: await bcrypt.hash("test-password", 4),
      access_token: "saved-token",
      authority: 0,
    });
    const identity = { username: "session-user", authority: 0 };

    await t.test("missing, unknown, and legacy username cookies cannot open chats", async () => {
      for (const cookie of ["", "username=forged-user", "access_token=unknown-token"]) {
        for (const route of [
          "/api/users/me",
          "/api/project-lead/threads",
          "/api/forge/approvals",
          "/api/health",
          "/api/events",
          "/api/settings",
          "/api/integrations",
          "/api/workspaces",
          "/api/evals",
          "/api/chatgpt",
        ]) {
          const response = await fetch(base + route, { headers: { cookie } });
          assert.equal(response.status, 401, `${route}: ${cookie}`);
        }
      }
    });

    await t.test("only POST login bypasses the central gate", async () => {
      for (const [route, method] of [
        ["/api/users/login", "GET"],
        ["/api/users/logout", "POST"],
        ["/api/users/login/extra", "POST"],
      ]) {
        const response = await fetch(base + route, { method });
        assert.equal(response.status, 401);
      }
    });

    await t.test("a saved token restores identity, preserves authority zero, and exposes no secrets", async () => {
      const response = await fetch(base + "/api/users/me", { headers: { cookie: "access_token=saved-token" } });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), identity);
    });

    await t.test("username cookies and request bodies cannot override the authenticated author", async () => {
      const response = await fetch(base + "/identity", {
        method: "POST",
        headers: { cookie: "access_token=saved-token; username=forged-user", "content-type": "application/json" },
        body: JSON.stringify({ username: "another-forged-user", authority: 99 }),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), identity);
    });

    await t.test("authenticated sessions reach the Project Lead and Forge routes", async () => {
      const headers = { cookie: "access_token=saved-token" };
      const threads = await fetch(base + "/api/project-lead/threads", { headers });
      assert.equal(threads.status, 200);
      assert.deepEqual(await threads.json(), []);
      const settings = await fetch(base + "/api/settings", { headers });
      assert.equal(settings.status, 200);
      assert.deepEqual(await settings.json(), identity);
      const response = await fetch(base + "/api/forge/invalid-issue-id", { headers });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: "Expected a Linear issue id" });
    });

    let sessionCookie = "";
    await t.test("login issues an HttpOnly cookie and invalidates the previous token", async () => {
      const response = await fetch(base + "/api/users/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "session-user", password: "test-password" }),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), identity);
      const cookie = response.headers.get("set-cookie");
      assert.ok(cookie);
      assert.match(cookie, /HttpOnly/);
      assert.match(cookie, /Path=\/api/);
      sessionCookie = cookie.split(";")[0]!;
      const old = await fetch(base + "/api/users/me", { headers: { cookie: "access_token=saved-token" } });
      assert.equal(old.status, 401);
      const current = await fetch(base + "/api/users/me", { headers: { cookie: sessionCookie } });
      assert.equal(current.status, 200);
      assert.deepEqual(await current.json(), identity);
    });

    await t.test("logout clears the API cookie and revoked tokens can no longer access chats", async () => {
      const response = await fetch(base + "/api/users/logout", { method: "POST", headers: { cookie: sessionCookie } });
      assert.equal(response.status, 200);
      assert.match(response.headers.get("set-cookie") ?? "", /access_token=; Path=\/api;/);
      await user.reload();
      assert.equal(user.access_token, null);
      for (const route of ["/api/users/me", "/api/project-lead/threads", "/api/forge/approvals"]) {
        const response = await fetch(base + route, { headers: { cookie: sessionCookie } });
        assert.equal(response.status, 401);
      }
      const repeated = await fetch(base + "/api/users/logout", { method: "POST" });
      assert.equal(repeated.status, 401);
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    checkpointer.db.close();
    await sequelize.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
