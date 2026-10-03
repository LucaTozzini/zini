import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Check } from "../../../harness/types.js";

// A deleted to-do stays deleted after the server restarts, and the others stay.
const check: Check = async ({ startApp }) => {
  const dataFile = join(mkdtempSync(join(tmpdir(), "eval-data-")), "todos.json");
  const post = (url: string, title: string) =>
    fetch(`${url}/api/todos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }).then((res) => res.json() as Promise<{ id: string }>);

  const first = await startApp({ dataFile });
  let gone: { id: string };
  let kept: { id: string };
  try {
    gone = await post(first.url, "Delete me");
    kept = await post(first.url, "Keep me");
    const deleted = await fetch(`${first.url}/api/todos/${gone.id}`, { method: "DELETE" });
    if (deleted.status !== 204) return { passed: false, details: `DELETE answered ${deleted.status}` };
  } finally {
    await first.stop();
  }

  const second = await startApp({ dataFile });
  try {
    const ids = ((await (await fetch(`${second.url}/api/todos`)).json()) as { id: string }[]).map((t) => t.id);
    if (ids.includes(gone.id)) return { passed: false, details: "The deleted to-do is back after a restart" };
    if (!ids.includes(kept.id)) return { passed: false, details: "The other to-do is gone after a restart" };
    return { passed: true, details: "A deleted to-do stays deleted after a restart." };
  } finally {
    await second.stop();
  }
};

export default check;
