import type { BaseMessage } from "@langchain/core/messages";
import type { CheckpointTuple } from "@langchain/langgraph-checkpoint";
import type { AgentRole, ChatEntry, ForgeMessage } from "shared";
import { toChatEntries } from "../agents/agents.js";

// The workers' doc tools: their calls show as "Report submitted." rather than a tool call.
const submissions = new Set(["submit_work", "submit_review"]);

// The activity feed, from the latest checkpoint of the Lead's conversation and each
// worker's: every message and tool call (with its result), in time order. running is
// the agent working now: its last reply's calls without a result are still pending.
// Ids are prefixed with the agent, so each thread's messages stay distinct.
export function forgeMessages(
  threads: { agent: AgentRole; checkpoint?: CheckpointTuple }[],
  running: AgentRole | null,
): ForgeMessage[] {
  const items: ForgeMessage[] = [];
  for (const { agent, checkpoint } of threads) {
    if (!checkpoint) continue;
    const values = checkpoint.checkpoint.channel_values;
    // Successful tool writes can be durable before the next full checkpoint, especially
    // when a stop interrupts another tool in the same step.
    const pending = (checkpoint.pendingWrites ?? []).flatMap(([, channel, value]) =>
      channel === "messages" && Array.isArray(value) ? (value as BaseMessage[]) : [],
    );
    const messages = [...((values.compacted ?? []) as BaseMessage[]), ...((values.messages ?? []) as BaseMessage[]), ...pending];
    // While a worker runs, the Lead's delegation is still going too.
    const live = running === agent || (running !== null && agent === "lead");
    let previous: ChatEntry | undefined;
    for (const entry of toChatEntries(messages, live)) {
      const submission = (shown?: ChatEntry) => shown?.role === "tool" && submissions.has(shown.name);
      const receipt =
        entry.role === "assistant" && submission(previous) && entry.content.startsWith("Returning structured response: ");
      previous = entry;
      if (!entry.t || submission(entry)) continue;
      const shown: ChatEntry = receipt
        ? { ...entry, content: "Report submitted." }
        : entry.role === "user" && !entry.username
          ? { ...entry, username: "Forge" }
          : entry;
      items.push({ ...shown, id: `${agent}:${entry.id}`, t: entry.t, agent });
    }
  }
  return items.sort((a, b) => a.t.localeCompare(b.t));
}
