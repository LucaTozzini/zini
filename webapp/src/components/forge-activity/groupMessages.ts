import type { ForgeMessage } from "shared";

type Tool = Extract<ForgeMessage, { kind: "tool" }>;
// The Lead's delegate_coder and delegate_reviewer calls stand alone, to open that
// worker's conversation; other consecutive tool calls are grouped.
export type GroupedMessage =
  | Exclude<ForgeMessage, Tool>
  | { id: string; agent: Tool["agent"]; t: string; kind: "tools"; tools: Tool[] }
  | { id: string; agent: Tool["agent"]; t: string; kind: "delegation"; worker: "coder" | "reviewer"; tool: Tool };

const workers: Record<string, "coder" | "reviewer"> = { delegate_coder: "coder", delegate_reviewer: "reviewer" };

export function groupMessages(items: ForgeMessage[]): GroupedMessage[] {
  const grouped: GroupedMessage[] = [];
  for (const item of items) {
    if (item.kind !== "tool") {
      grouped.push(item);
      continue;
    }
    const worker = workers[item.call.name];
    if (worker) {
      grouped.push({ id: item.id, agent: item.agent, t: item.t, kind: "delegation", worker, tool: item });
      continue;
    }
    const previous = grouped.at(-1);
    if (previous?.kind === "tools" && previous.agent === item.agent) previous.tools.push(item);
    else grouped.push({ id: item.id, agent: item.agent, t: item.t, kind: "tools", tools: [item] });
  }
  return grouped;
}
