import { resolve } from "node:path";
import express from "express";
import { createApp } from "./app";
import { TodoStore } from "./store";

// One server for the API and the app: in development, Vite serves the app (with hot
// reload); with --prod, the built app in dist/ (npm run build first).
const port = Number(process.env.PORT ?? 3000);
const store = new TodoStore(process.env.DATA_FILE ?? "data/todos.json");
const app = createApp(store);

if (process.argv.includes("--prod")) {
  const dist = resolve("dist");
  app.use(express.static(dist));
  app.get("/{*path}", (_req, res) => res.sendFile(resolve(dist, "index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({ server: { middlewareMode: true }, appType: "spa" });
  app.use(vite.middlewares);
}

app.listen(port, () => {
  console.log(`Listening on http://localhost:${port}`);
});
