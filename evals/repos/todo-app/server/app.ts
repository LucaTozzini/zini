import express from "express";
import type { TodoStore } from "./store";

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

// The to-do API, at /api/todos.
export function createApp(store: TodoStore) {
  const app = express();
  app.use(express.json());

  app.get("/api/todos", (_req, res) => {
    res.json(store.list());
  });

  app.post("/api/todos", (req, res) => {
    const { title } = req.body ?? {};
    if (!isNonEmptyString(title)) {
      res.status(400).json({ error: "title is required" });
      return;
    }
    res.status(201).json(store.add(title.trim()));
  });

  app.patch("/api/todos/:id", (req, res) => {
    const { title, done } = req.body ?? {};
    if (title !== undefined && !isNonEmptyString(title)) {
      res.status(400).json({ error: "title must be a non-empty string" });
      return;
    }
    if (done !== undefined && typeof done !== "boolean") {
      res.status(400).json({ error: "done must be true or false" });
      return;
    }
    const todo = store.update(req.params.id, {
      ...(title !== undefined && { title: title.trim() }),
      ...(done !== undefined && { done }),
    });
    if (!todo) {
      res.status(404).json({ error: "No such to-do" });
      return;
    }
    res.json(todo);
  });

  app.delete("/api/todos/:id", (req, res) => {
    if (!store.remove(req.params.id)) {
      res.status(404).json({ error: "No such to-do" });
      return;
    }
    res.status(204).end();
  });

  return app;
}
