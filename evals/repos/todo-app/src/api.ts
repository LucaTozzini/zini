import type { Todo } from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/todos${path}`, {
    ...init,
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const fetchTodos = () => request<Todo[]>("");

export const addTodo = (title: string) =>
  request<Todo>("", { method: "POST", body: JSON.stringify({ title }) });

export const setDone = (id: string, done: boolean) =>
  request<Todo>(`/${id}`, { method: "PATCH", body: JSON.stringify({ done }) });

export const deleteTodo = (id: string) => request<void>(`/${id}`, { method: "DELETE" });
