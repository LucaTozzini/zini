import express from "express";
import { initDb } from "./db.js";
import { integrations } from "./routes/integrations.js";
import { productManager } from "./routes/productManager.js";
import { settings } from "./routes/settings.js";

const port = Number(process.env.PORT ?? 3000);

const app = express();
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/integrations", integrations);
app.use("/api/product-manager", productManager);
app.use("/api/settings", settings);

await initDb();

app.listen(port, () => {
  console.log(`backend listening on http://localhost:${port}`);
});
