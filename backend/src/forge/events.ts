import { randomUUID } from "node:crypto";
import { Transaction } from "sequelize";
import type { AgentRole, ForgePlan, PipelineWaiting } from "shared";
import { sequelize } from "../db.js";
import { ForgeSubscription } from "../models/ForgeSubscription.js";
import { enqueueMessages } from "../projectLead/messageQueue.js";

export type ForgeLifecycleEvent =
  | { type: "stage_started"; role: AgentRole }
  | { type: "waiting"; waiting: PipelineWaiting }
  | { type: "completed"; plan: ForgePlan | null }
  | { type: "failed"; error: string }
  | { type: "stopped" };
export function forgeEventContent(event: ForgeLifecycleEvent): string {
  switch (event.type) {
    case "stage_started":
      return `The Lead delegated to the ${event.role}.`;
    case "waiting": {
      const waiting = event.waiting;
      return waiting.kind === "questions"
        ? `The Lead needs answers:\n${waiting.questions.join("\n")}`
        : "The plan is ready for your approval.";
    }
    case "completed": {
      const checks = event.plan?.qaChecklist ?? [];
      return `Forge finished.${
        checks.length
          ? `\nQA checklist:\n${checks
              .map((check) => `- ${check.status}: ${check.condition}${check.note ? ` (${check.note})` : ""}`)
              .join("\n")}`
          : ""
      }`;
    }
    case "failed":
      return `Forge failed: ${event.error}`;
    case "stopped":
      return "Forge stopped with unfinished work. It can be resumed.";
  }
}
// Only explicit lifecycle events enter this durable fan-out path.
export async function emitForgeEvent(issueId: string, event: ForgeLifecycleEvent, eventId: string = randomUUID()) {
  // Reserve the write lock before reading subscribers; a deferred read-to-write
  // upgrade can deadlock against the queue worker's concurrent transaction.
  await sequelize.transaction({ type: Transaction.TYPES.IMMEDIATE }, async (transaction) => {
    const subscribers = await ForgeSubscription.findAll({ where: { issueId }, transaction });
    await enqueueMessages(
      subscribers.map((row) => row.threadId),
      {
        eventId,
        source: "forge",
        sourceId: issueId,
        eventType: event.type,
        content: forgeEventContent(event),
      },
      transaction,
    );
  });
}
