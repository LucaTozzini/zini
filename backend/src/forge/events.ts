import { randomUUID } from "node:crypto";
import type { AgentRole, PipelineWaiting, QaDocument } from "shared";
import { sequelize } from "../db.js";
import { ForgeSubscription } from "../models/ForgeSubscription.js";
import { enqueueMessages } from "../projectLead/messageQueue.js";

export type ForgeLifecycleEvent =
  | { type: "stage_started"; role: AgentRole }
  | { type: "waiting"; waiting: PipelineWaiting }
  | { type: "completed"; qa: QaDocument | null }
  | { type: "failed"; error: string }
  | { type: "stopped" };
export function forgeEventContent(event: ForgeLifecycleEvent): string {
  switch (event.type) {
    case "stage_started": return `${event.role === "qa" ? "QA" : event.role} started.`;
    case "waiting": {
      const waiting = event.waiting;
      return waiting.kind === "questions" ? `${waiting.from} needs answers:\n${waiting.questions.join("\n")}`
        : waiting.kind === "approve_plan" ? "The plan is ready for your approval."
        : `Commands need your approval:\n${waiting.commands.map((command) => command.command).join("\n")}`;
    }
    case "completed": return `Forge completed. QA verdict: ${event.qa?.verdict ?? "unavailable"}.`
      + (event.qa?.failures.length ? `\nFailures:\n${event.qa.failures.join("\n")}` : "")
      + (event.qa?.couldNotTest.length ? `\nNot verified:\n${event.qa.couldNotTest.join("\n")}` : "");
    case "failed": return `Forge failed: ${event.error}`;
    case "stopped": return "Forge stopped with unfinished work. It can be resumed.";
  }
}
// Only explicit lifecycle events enter this durable fan-out path.
export async function emitForgeEvent(issueId: string, event: ForgeLifecycleEvent, eventId: string = randomUUID()) {
  await sequelize.transaction(async (transaction) => {
    const subscribers = await ForgeSubscription.findAll({ where: { issueId }, transaction });
    await enqueueMessages(subscribers.map((row) => row.threadId), {
      eventId, source: "forge", sourceId: issueId, eventType: event.type, content: forgeEventContent(event),
    }, transaction);
  });
}
