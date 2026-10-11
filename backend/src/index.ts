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
import { forge } from "./routes/forge.js";
import { integrations } from "./routes/integrations.js";
import { projectLead } from "./routes/projectLead.js";
import { evals } from "./routes/evals.js";
import { chatgpt } from "./routes/chatgpt.js";
import { usersRouter } from "./routes/users.js";
import { settings } from "./routes/settings.js";
import { workspaces } from "./routes/workspaces.js";
import cookieParser from "cookie-parser";
import { startProjectLeadMessageWorker } from "./projectLead/messageWorker.js";
import { recoverMessageQueue } from "./projectLead/messageQueue.js";
import { requireApiUser } from "./auth/session.js";
import { Workspace } from "./models/Workspace.js";

const port = Number(process.env.PORT ?? 3000);

const app = express();
app.use(workspacePreview(workspaceApps));
app.use("/api/project-lead", express.json({ limit: "30mb" }));
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

app.use("/api/forge", forge);
app.use("/api/integrations", integrations);
app.use("/api/project-lead", projectLead);
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
await recoverMessageQueue();
let recovering: Promise<void> | null = null;
function recoverPreviews() {
  recovering ??= refreshPreviews().finally(() => { recovering = null; });
  return recovering;
}
async function refreshPreviews() {
  for (const workspace of await Workspace.findAll()) {
    await workspaceApps.refresh(workspace.issueId).catch(error => console.error(`Workspace preview recovery [${workspace.issueId}]:`, error));
  }
}
await recoverPreviews();
setInterval(() => { void recoverPreviews(); }, 5000).unref();
startProjectLeadMessageWorker();

const server = createServer(app);
workspacePreviewUpgrades(server, workspaceApps);
server.listen(port, () => {
  console.log(`backend listening on http://localhost:${port}`);
});
