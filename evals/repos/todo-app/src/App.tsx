import { useEffect, useState } from "react";
import { addTodo, deleteTodo, fetchTodos, setDone } from "./api";
import { FilterBar, type Filter } from "./components/FilterBar";
import { TodoForm } from "./components/TodoForm";
import { TodoList } from "./components/TodoList";
import type { Todo } from "./types";

export function App() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTodos().then(setTodos, (err: Error) => setError(err.message));
  }, []);

  // Runs a change against the API, then shows the to-dos as they are now.
  async function change(action: () => Promise<unknown>) {
    try {
      await action();
      setTodos(await fetchTodos());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const shown = todos.filter((todo) =>
    filter === "all" ? true : filter === "done" ? todo.done : !todo.done,
  );

  return (
    <main>
      <h1>To-dos</h1>
      <TodoForm onAdd={(title) => change(() => addTodo(title))} />
      <FilterBar filter={filter} onChange={setFilter} />
      {error && <p role="alert">{error}</p>}
      <TodoList
        todos={shown}
        onToggle={(todo) => change(() => setDone(todo.id, !todo.done))}
        onDelete={(todo) => change(() => deleteTodo(todo.id))}
      />
    </main>
  );
}
