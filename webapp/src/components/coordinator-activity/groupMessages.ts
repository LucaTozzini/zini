import type { CoordinatorMessage } from "shared";

type Tool = Extract<CoordinatorMessage, { kind: "tool" }>;
export type GroupedMessage = Exclude<CoordinatorMessage, Tool> | {
  id: string; agent: Tool["agent"]; t: string; kind: "tools"; tools: Tool[];
};

export function groupMessages(items: CoordinatorMessage[]): GroupedMessage[] {
  const grouped: GroupedMessage[] = [];
  for (const item of items) {
    if (item.kind !== "tool") { grouped.push(item); continue; }
    const previous = grouped.at(-1);
    if (previous?.kind === "tools" && previous.agent === item.agent) previous.tools.push(item);
    else grouped.push({ id: item.id, agent: item.agent, t: item.t, kind: "tools", tools: [item] });
  }
  return grouped;
}
