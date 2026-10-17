import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { CheckpointTuple } from "@langchain/langgraph-checkpoint";
import type { AgentRole, ForgeMessage } from "shared";
import { isSummary, summaryText } from "../agents/compaction.js";

// The workers' doc tools: their calls show as "Report submitted." rather than a tool call.
const submissions = new Set(["submit_work", "submit_review"]);

// The activity feed, from the latest checkpoint of the Lead's conversation and each
// worker's: every message and tool call (with its result), in time order. running is
// the agent working now: its last reply's calls without a result are still pending.
// Messages are told apart per agent by id, so each thread's messages stay distinct.
// Any other call without a result never got one (e.g. the run was stopped).
export function forgeMessages(threads: { agent: AgentRole; checkpoint?: CheckpointTuple }[], running: AgentRole | null): ForgeMessage[] {
  const items: ForgeMessage[] = [];
  for (const { agent, checkpoint } of threads) {
    if (!checkpoint) continue;
    const values = checkpoint.checkpoint.channel_values;
    // Successful tool writes can be durable before the next full checkpoint, especially
    // when a stop interrupts another tool in the same step.
    const pending = (checkpoint.pendingWrites ?? []).flatMap(([, channel, value]) =>
      channel === "messages" && Array.isArray(value) ? value as BaseMessage[] : []);
    const messages = [...((values.compacted ?? []) as BaseMessage[]), ...((values.messages ?? []) as BaseMessage[]), ...pending];
    const results = new Map(messages.filter(ToolMessage.isInstance).map((m) => [m.tool_call_id, m]));
    const lastReply = messages.findLast(AIMessage.isInstance);
    const seen = new Set<string>();
    for (const [index, message] of messages.entries()) {
      // A summary reuses the id of the first message it replaced.
      const key = `${isSummary(message) ? "summary:" : ""}${agent}:${message.id ?? index}`;
      const t = message.additional_kwargs?.createdAt;
      if (seen.has(key) || ToolMessage.isInstance(message) || typeof t !== "string") continue;
      seen.add(key);
      if (isSummary(message)) {
        items.push({ id: key, t, agent, kind: "message", message: { role: "compaction", summary: summaryText(message) } });
        continue;
      }
      if (message.type === "human") {
        const username = message.additional_kwargs.username;
        if (message.text.trim()) items.push({ id: key, t, agent, kind: "message", message: { role: "user", content: message.text,
          username: typeof username === "string" ? username : "Forge" } });
        continue;
      }
      if (!AIMessage.isInstance(message)) continue;
      const previous = messages[index - 1];
      const receipt = !message.tool_calls?.length && message.text.startsWith("Returning structured response: ") &&
        ToolMessage.isInstance(previous) && submissions.has(previous.name ?? "");
      if (message.text.trim()) items.push({ id: key, t, agent, kind: "message",
        message: { role: "assistant", content: receipt ? "Report submitted." : message.text } });
      for (const [i, call] of (message.tool_calls ?? []).entries()) {
        if (submissions.has(call.name)) continue;
        const result = call.id ? results.get(call.id) : undefined;
        const base = { id: `${key}:tool:${call.id ?? i}`, t, agent, kind: "tool" as const, ...(call.id ? { callId: call.id } : {}) };
        const callBase = { role: "tool" as const, name: call.name, args: call.args };
        if (result) items.push({ ...base, result: result.text, call: { ...callBase, status: result.status === "error" ? "error" : "done",
          ...(result.status === "error" ? { error: result.text } : {}) } });
        // While a worker runs, the Lead's delegation is still going too.
        else if ((running === agent || (running && agent === "lead")) && message === lastReply) items.push({ ...base, call: { ...callBase, status: "pending" } });
        else items.push({ ...base, call: { ...callBase, status: "never_ran" } });
      }
    }
  }
  return items.sort((a, b) => a.t.localeCompare(b.t));
}
