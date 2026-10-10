import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import { createServer } from "node:http";
import {
  workspacePreview,
  workspacePreviewUpgrades,
} from "./workspaces/workspacePreview.js";
import { workspaceApps } from "./workspaces/workspaceAppSessions.js";
import { initDb } from "./db.js";
import { subscribe } from "./core/events.js";
import { coordinator } from "./routes/coordinator.js";
import { integrations } from "./routes/integrations.js";
import { productManager } from "./routes/productManager.js";
import { evals } from "./routes/evals.js";
import { chatgpt } from "./routes/chatgpt.js";
import { usersRouter } from "./routes/users.js";
import { settings } from "./routes/settings.js";
import { workspaces } from "./routes/workspaces.js";
import cookieParser from "cookie-parser";
import { startPmCoordinatorUpdates } from "./productManager/pmCoordinatorUpdates.js";
import { requireApiUser } from "./auth/session.js";

const port = Number(process.env.PORT ?? 3000);

const app = express();
app.use(workspacePreview(workspaceApps));
app.use(express.json());
app.use(cookieParser());
app.use("/api", requireApiUser);

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
app.use("/api/evals", evals);
app.use("/api/chatgpt", chatgpt);
app.use("/api/users", usersRouter);

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
startPmCoordinatorUpdates();

const server = createServer(app);
workspacePreviewUpgrades(server, workspaceApps);
server.listen(port, () => {
  console.log(`backend listening on http://localhost:${port}`);
});
