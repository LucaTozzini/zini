import type { Todo } from "../types";

type Props = {
  todos: Todo[];
  onToggle: (todo: Todo) => void;
  onDelete: (todo: Todo) => void;
};

export function TodoList({ todos, onToggle, onDelete }: Props) {
  if (todos.length === 0) return <p className="empty">Nothing here.</p>;
  return (
    <ul className="todo-list">
      {todos.map((todo) => (
        <li key={todo.id} className={todo.done ? "done" : undefined}>
          <label>
            <input type="checkbox" checked={todo.done} onChange={() => onToggle(todo)} />
            {todo.title}
          </label>
          <button type="button" aria-label={`Delete ${todo.title}`} onClick={() => onDelete(todo)}>
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}
