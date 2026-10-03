import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import { initDb } from "./db.js";
import { subscribe } from "./events.js";
import { failInterruptedSetups } from "./workspaceSetup.js";
import { coordinator } from "./routes/coordinator.js";
import { integrations } from "./routes/integrations.js";
import { productManager } from "./routes/productManager.js";
import { evals } from "./routes/evals.js";
import { profileRouter } from "./routes/profile.js";
import { settings } from "./routes/settings.js";
import { workspaces } from "./routes/workspaces.js";
import cookieParser from "cookie-parser";
import { generateUsername } from "unique-username-generator";

const port = Number(process.env.PORT ?? 3000);

const app = express();
app.use(express.json());
app.use(cookieParser());

app.use("/api", (req, res, next) => {
  // if call going to set the username cookie, don't overwrite it
  if (req.path === "/profile" && req.method === "POST") {
    return next();
  }

  // check if username cookie is set, if not set it to a random name
  if (!req.cookies?.username) {
    const newUsername = generateUsername();
    req.cookies.username = newUsername;
    res.cookie("username", newUsername, { httpOnly: true, sameSite: "strict", maxAge: 1000 * 60 * 60 * 24 * 365 });
  }
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

// Server-sent "this changed" events for the webapp (see events.ts).
app.get("/api/events", (_req, res) => {
  subscribe(res);
});

app.use("/api/coordinator", coordinator);
app.use("/api/integrations", integrations);
app.use("/api/product-manager", productManager);
app.use("/api/settings", settings);
app.use("/api/workspaces", workspaces);
app.use("/api/profile", profileRouter);
app.use("/api/evals", evals);

// The built webapp (npm run build), so one server runs the whole app. Any other GET
// gets its index.html, so the webapp's own routes work on reload. In development the
// webapp is served by Vite instead, which sends /api here.
const webapp = fileURLToPath(new URL("../../webapp/dist", import.meta.url));
if (existsSync(webapp)) {
  app.use(express.static(webapp));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
    res.sendFile("index.html", { root: webapp });
  });
}

await initDb();
await failInterruptedSetups();

app.listen(port, () => {
  console.log(`backend listening on http://localhost:${port}`);
});
