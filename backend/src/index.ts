import express from "express";
import { initDb } from "./db.js";
import { integrations } from "./routes/integrations.js";

const port = Number(process.env.PORT ?? 3000);

const app = express();
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/integrations", integrations);

await initDb();

app.listen(port, () => {
  console.log(`backend listening on http://localhost:${port}`);
});
