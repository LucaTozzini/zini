import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TodoStore } from "./store";

const tempFile = () => join(mkdtempSync(join(tmpdir(), "todos-")), "todos.json");

describe("TodoStore", () => {
  it("adds to-dos and keeps them in the file", () => {
    const file = tempFile();
    new TodoStore(file).add("Buy milk");
    expect(new TodoStore(file).list().map((t) => t.title)).toEqual(["Buy milk"]);
  });

  it("marks a to-do done", () => {
    const store = new TodoStore(tempFile());
    const todo = store.add("Write tests");
    expect(store.update(todo.id, { done: true })?.done).toBe(true);
  });

  it("returns null when updating a to-do that doesn't exist", () => {
    expect(new TodoStore(tempFile()).update("missing", { done: true })).toBeNull();
  });

  it("removes a to-do", () => {
    const store = new TodoStore(tempFile());
    const todo = store.add("Old idea");
    expect(store.remove(todo.id)).toBe(true);
    expect(store.list()).toEqual([]);
  });
});
