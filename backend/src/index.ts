import express from "express";
import { initDb } from "./db.js";
import { subscribe } from "./events.js";
import { failInterruptedSetups } from "./workspaceSetup.js";
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

app.use("/api/integrations", integrations);
app.use("/api/product-manager", productManager);
app.use("/api/settings", settings);
app.use("/api/workspaces", workspaces);

await initDb();
await failInterruptedSetups();

app.listen(port, () => {
  console.log(`backend listening on http://localhost:${port}`);
});
