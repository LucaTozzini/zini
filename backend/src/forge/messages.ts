import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { CheckpointTuple } from "@langchain/langgraph-checkpoint";
import type { AgentRole, ForgeHumanMessage, ForgeMessage, PipelineResume, PipelineWaiting } from "shared";
import { randomUUID } from "node:crypto";
import { isSummary, summaryText } from "../agents/compaction.js";
import type { TimelineEvent } from "./graphState.js";

const roles = new Set(["planner", "coder", "reviewer", "qa"]);
const documents: [string, AgentRole][] = [["plan", "planner"], ["implementation", "coder"],
  ["review", "reviewer"], ["qaReport", "qa"]];
const submissions = new Set(["submit_plan", "submit_implementation", "submit_review", "submit_qa_report"]);

// The timeline events of a pipeline node that started at started and returned result:
// its stage, if it's an agent's, and each document it submitted.
export function timelineEvents(role: AgentRole | undefined, started: string, result: object): TimelineEvent[] {
  const t = new Date().toISOString();
  return [...(role ? [{ kind: "stage" as const, agent: role, t: started }] : []),
    ...documents.flatMap(([field, agent]) =>
      (result as Record<string, unknown>)[field] ? [{ kind: "document" as const, agent, t }] : [])];
}

export function humanMessage(content: string, username?: string): ForgeHumanMessage {
  return { id: randomUUID(), t: new Date().toISOString(), content, ...(username ? { username } : {}) };
}

export function replyMessage(reply: PipelineResume, waiting: PipelineWaiting | null, username?: string) {
  const content = "answers" in reply ? reply.answers.map((answer, i) =>
    `${waiting?.kind === "questions" ? `${waiting.questions[i]}\n` : ""}${answer}`).join("\n\n") :
    "Approved the plan.";
  return humanMessage(content, username);
}

// From the latest checkpoint of each namespace: the pipeline's (its timeline and your
// messages) and each agent conversation's. Keep first-seen ordering and latest
// message/results, rather than concatenating snapshots (which would repeat entire
// conversations).
export function checkpointMessages(checkpoints: CheckpointTuple[], live: boolean): ForgeMessage[] {
  const ordered = [...checkpoints].sort((a, b) => a.checkpoint.ts.localeCompare(b.checkpoint.ts) || a.checkpoint.id.localeCompare(b.checkpoint.id));
  const items = new Map<string, ForgeMessage>();
  const results = new Map<string, ToolMessage>();
  const seenMessages = new Set<string>();
  const lastAssistant = new Map<string, string>();
  const toolKeys = new Map<string, { result: string; ns: string; assistant: string }>();
  let activeNamespace = "";
  const put = (item: ForgeMessage) => {
    const old = items.get(item.id);
    items.set(item.id, old ? { ...item, t: old.t } : item);
  };
  for (const tuple of ordered) {
    const { checkpoint } = tuple;
    const ns = String(tuple.config.configurable?.checkpoint_ns ?? "");
    const values = checkpoint.channel_values;
    const agent = ns.split("|")[0]?.split(":")[0] as AgentRole;
    const t = checkpoint.ts;
    if (!ns) {
      for (const human of (values.humanMessages ?? []) as ForgeHumanMessage[]) {
        put({ id: `human:${human.id}`, t: human.t, agent: null, kind: "message",
          message: { role: "user", content: human.content, username: human.username } });
      }
      const timeline = (values.timeline ?? []) as TimelineEvent[];
      for (const [i, event] of timeline.entries()) put({ id: `timeline:${i}`, t: event.t, agent: event.agent, kind: event.kind });
      // A stage is recorded when it finishes; the one about to run, or running, is
      // still a pending route in the checkpoint. Its id is the event it will become.
      for (const channel of Object.keys(values)) {
        if (!channel.startsWith("branch:to:")) continue;
        const role = channel.slice("branch:to:".length) as AgentRole;
        if (roles.has(role)) put({ id: `timeline:${timeline.length}`, t, agent: role, kind: "stage" });
      }
      continue;
    }
    if (!roles.has(agent)) continue;
    // Successful task writes can be durable before the next full checkpoint,
    // especially when cancellation interrupts another tool in the same step.
    const pending = (tuple.pendingWrites ?? []).flatMap(([, channel, value]) =>
      channel === "messages" && Array.isArray(value) ? value as BaseMessage[] : []);
    const messages = [...((values.compacted ?? []) as BaseMessage[]), ...((values.messages ?? []) as BaseMessage[]), ...pending];
    for (const [index, message] of messages.entries()) {
      let key = `${ns}:${message.id ?? index}`;
      if (ToolMessage.isInstance(message)) { results.set(`${ns}:${message.tool_call_id}`, message); continue; }
      const messageTime = message.additional_kwargs?.createdAt;
      if (typeof messageTime !== "string") continue;
      if (isSummary(message)) {
        put({ id: `summary:${key}`, t: messageTime, agent, kind: "message", message: { role: "compaction", summary: summaryText(message) } });
        continue;
      }
      if (message.type === "human") {
        if (!seenMessages.has(key)) {
          activeNamespace = ns;
        }
        seenMessages.add(key);
        if (message.text.trim()) put({ id: key, t: messageTime, agent, kind: "message",
          message: { role: "user", content: message.text, username: "Forge" } });
        continue;
      }
      if (!AIMessage.isInstance(message)) continue;
      const previous = messages[index - 1];
      const documentReceipt = !message.tool_calls?.length && message.text.startsWith("Returning structured response: ") &&
        ToolMessage.isInstance(previous) && submissions.has(previous.name ?? "");
      if (documentReceipt) key = `${ns}:document-receipt:${previous.tool_call_id}`;
      if (!seenMessages.has(key)) { activeNamespace = ns; lastAssistant.set(ns, key); }
      seenMessages.add(key);
      if (message.text.trim()) put({ id: key, t: messageTime, agent, kind: "message", message: { role: "assistant", content: documentReceipt ? "Document submitted." : message.text } });
      for (const [i, call] of (message.tool_calls ?? []).entries()) {
        if (submissions.has(call.name)) continue;
        const id = `${key}:tool:${call.id ?? i}`;
        put({ id, t: messageTime, agent, kind: "tool", call: { role: "tool", name: call.name, args: call.args, status: "pending" } });
        // Keep storage correlation private; process results after all namespaces.
        toolKeys.set(id, { result: `${ns}:${call.id}`, ns, assistant: key });
      }
    }
  }
  for (const item of items.values()) {
    if (item.kind !== "tool") continue;
    const key = toolKeys.get(item.id);
    if (!key) {
      if (item.call.status === "pending" && !(live && activeNamespace === `__${item.agent}__`)) {
        item.call.status = "error";
        item.call.error = "No result was recorded. This check may have been interrupted.";
      }
      continue;
    }
    const result = results.get(key.result);
    const pending = live && key.ns === activeNamespace && key.assistant === lastAssistant.get(key.ns);
    item.call.status = result ? result.status === "error" ? "error" : "done" : pending ? "pending" : "error";
    if (result) { item.result = result.text; if (result.status === "error") item.call.error = result.text; }
    else if (!pending) item.call.error = "No result was recorded. This call may have been interrupted.";
  }
  return [...items.values()].sort((a, b) => a.t.localeCompare(b.t));
}
