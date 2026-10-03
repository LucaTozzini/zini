import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Todo } from "../src/types";

// The to-dos, kept in a JSON file so they survive a restart.
export class TodoStore {
  private todos: Todo[];

  constructor(private file: string) {
    this.todos = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Todo[]) : [];
  }

  list() {
    return this.todos;
  }

  add(title: string) {
    const todo: Todo = { id: randomUUID(), title, done: false, createdAt: new Date().toISOString() };
    this.todos.push(todo);
    this.save();
    return todo;
  }

  update(id: string, changes: Partial<Pick<Todo, "title" | "done">>) {
    const todo = this.todos.find((t) => t.id === id);
    if (!todo) return null;
    Object.assign(todo, changes);
    this.save();
    return todo;
  }

  remove(id: string) {
    const before = this.todos.length;
    this.todos = this.todos.filter((t) => t.id !== id);
    if (this.todos.length === before) return false;
    this.save();
    return true;
  }

  private save() {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.todos, null, 2));
  }
}
