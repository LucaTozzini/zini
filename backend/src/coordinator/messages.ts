import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { CheckpointTuple } from "@langchain/langgraph-checkpoint";
import type { AgentRole, CoordinatorHumanMessage, CoordinatorMessage, PipelineResume, PipelineWaiting } from "shared";
import { randomUUID } from "node:crypto";
import { isSummary, summaryText } from "../compaction.js";

const roles = new Set(["planner", "coder", "setup", "checks", "reviewer", "qa"]);
const documents: [string, AgentRole][] = [["plan", "planner"], ["implementation", "coder"],
  ["environmentPlan", "setup"], ["environmentReport", "setup"],
  ["checksPlan", "checks"], ["checksReport", "checks"], ["review", "reviewer"], ["qaReport", "qa"]];
const submissions = new Set(["submit_plan", "submit_implementation", "submit_environment_setup", "submit_checks", "submit_review", "submit_qa_report"]);

export function humanMessage(content: string, username?: string): CoordinatorHumanMessage {
  return { id: randomUUID(), t: new Date().toISOString(), content, ...(username ? { username } : {}) };
}

export function replyMessage(reply: PipelineResume, waiting: PipelineWaiting | null, username?: string) {
  const content = "answers" in reply ? reply.answers.map((answer, i) =>
    `${waiting?.kind === "questions" ? `${waiting.questions[i]}\n` : ""}${answer}`).join("\n\n") :
    "approve" in reply ? "Approved the plan." :
      reply.decisions.map((decision, i) => {
        const command = waiting?.kind === "approve_commands" ? waiting.commands[i]?.command : undefined;
        return `${decision.type === "approve" ? "Approved" : "Rejected"}${command ? `: ${command}` : " command"}${decision.type === "reject" && decision.message ? `\n${decision.message}` : ""}`;
      }).join("\n\n");
  return humanMessage(content, username);
}

// History is cumulative. Keep first-seen ordering and latest message/results, rather
// than concatenating snapshots (which would repeat entire conversations).
export function checkpointMessages(checkpoints: CheckpointTuple[], live: boolean): CoordinatorMessage[] {
  const ordered = [...checkpoints].sort((a, b) => a.checkpoint.ts.localeCompare(b.checkpoint.ts) || a.checkpoint.id.localeCompare(b.checkpoint.id));
  const items = new Map<string, CoordinatorMessage>();
  const results = new Map<string, ToolMessage>();
  const versions = new Map<string, unknown>();
  const seenMessages = new Set<string>();
  const lastAssistant = new Map<string, string>();
  const toolKeys = new Map<string, { result: string; ns: string; assistant: string }>();
  const selectedCommands = new Map<AgentRole, { id: string; command: string; cwd: string }[]>();
  let activeNamespace = "";
  const put = (item: CoordinatorMessage) => {
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
      for (const human of (values.humanMessages ?? []) as CoordinatorHumanMessage[]) {
        put({ id: `human:${human.id}`, t: human.t, agent: null, kind: "message",
          message: { role: "user", content: human.content, username: human.username } });
      }
      for (const [field, role] of documents) {
        const version = checkpoint.channel_versions[field];
        if (values[field] && versions.get(field) !== version) {
          if (field === "checksPlan" || field === "environmentPlan") {
            if ([...items.values()].at(-1)?.agent !== role)
              put({ id: `stage:${role}:${checkpoint.id}`, t, agent: role, kind: "stage" });
            activeNamespace = `__${role}__`;
            const selection = values[field] as { commands: { command: string; cwd: string }[] };
            const selectedChecks = (selection.commands ?? []).map((entry, i) => ({ ...entry, id: `check:${checkpoint.id}:${i}` }));
            selectedCommands.set(role, selectedChecks);
            for (const entry of selectedChecks) put({ id: entry.id, t, agent: role, kind: "tool", call: {
              role: "tool", name: "run_command", args: { command: entry.command, cwd: entry.cwd }, status: "pending",
            } });
          }
          if (field === "checksReport" || field === "environmentReport") {
            const selectedChecks = selectedCommands.get(role) ?? [];
            const report = values[field] as { results: { command: string; cwd: string; output: string; status: string }[] };
            report.results.forEach((entry, i) => put({ id: selectedChecks.find((selected) => selected.command === entry.command && selected.cwd === entry.cwd)?.id ?? `check:${checkpoint.id}:${i}`, t, agent: role, kind: "tool", call: {
              role: "tool", name: "run_command", args: { command: entry.command, cwd: entry.cwd },
              status: entry.status === "passed" ? "done" : "error", ...(entry.status !== "passed" ? { error: entry.output } : {}),
            }, result: entry.output }));
          }
          if (field !== "checksPlan" && field !== "environmentPlan") put({ id: `doc:${field}:${checkpoint.id}`, t, agent: role, kind: "document" });
        }
        versions.set(field, version);
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
          put({ id: `stage:${key}`, t: messageTime, agent, kind: "stage" });
          activeNamespace = ns;
        }
        seenMessages.add(key);
        if (message.text.trim()) put({ id: key, t: messageTime, agent, kind: "message",
          message: { role: "user", content: message.text, username: "Coordinator" } });
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
