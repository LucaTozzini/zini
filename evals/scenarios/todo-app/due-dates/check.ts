import type { Check } from "../../../harness/types.js";

// The API accepts, returns and clears a YYYY-MM-DD dueDate, and rejects anything else.
const check: Check = async ({ startApp }) => {
  const app = await startApp();
  const api = `${app.url}/api/todos`;
  const send = (method: string, url: string, body: unknown) =>
    fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const failures: string[] = [];
  try {
    const created = await send("POST", api, { title: "File taxes", dueDate: "2030-01-15" });
    const todo = (await created.json().catch(() => ({}))) as { id?: string; dueDate?: unknown };
    if (created.status !== 201 || todo.dueDate !== "2030-01-15") {
      failures.push(`POST with dueDate "2030-01-15": ${created.status}, dueDate ${JSON.stringify(todo.dueDate)}`);
    }

    const bad = await send("POST", api, { title: "Someday", dueDate: "next tuesday" });
    if (bad.status !== 400) failures.push(`POST with dueDate "next tuesday": ${bad.status}, expected 400`);

    const listed = (await (await fetch(api)).json()) as { id: string; dueDate?: unknown }[];
    if (listed.find((t) => t.id === todo.id)?.dueDate !== "2030-01-15") {
      failures.push("GET doesn't return the to-do's dueDate");
    }

    const plain = (await (await send("POST", api, { title: "No date" })).json()) as { dueDate?: unknown };
    if (plain.dueDate !== null) failures.push(`A to-do without a due date has dueDate ${JSON.stringify(plain.dueDate)}, expected null`);

    if (todo.id) {
      const cleared = await send("PATCH", `${api}/${todo.id}`, { dueDate: null });
      const after = (await cleared.json().catch(() => ({}))) as { dueDate?: unknown };
      if (cleared.status !== 200 || after.dueDate !== null) {
        failures.push(`PATCH with dueDate null: ${cleared.status}, dueDate ${JSON.stringify(after.dueDate)}`);
      }
    }
  } finally {
    await app.stop();
  }
  return failures.length
    ? { passed: false, details: failures.join("\n") }
    : { passed: true, details: "dueDate is validated, returned and cleared as the issue asks." };
};

export default check;
