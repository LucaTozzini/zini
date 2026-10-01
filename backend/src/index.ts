import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import { initDb } from "./db.js";
import { subscribe } from "./events.js";
import { failInterruptedSetups } from "./workspaceSetup.js";
import { coordinator } from "./routes/coordinator.js";
import { integrations } from "./routes/integrations.js";
import { productManager } from "./routes/productManager.js";
import { settings } from "./routes/settings.js";
import { workspaces } from "./routes/workspaces.js";

const port = Number(process.env.PORT ?? 3000);

const app = express();
app.use(express.json());

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
