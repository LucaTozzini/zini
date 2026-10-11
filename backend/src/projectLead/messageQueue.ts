import { randomUUID } from "node:crypto";
import { Op, Transaction } from "sequelize";
import { sequelize } from "../db.js";
import { ProjectLeadQueueMessage, type QueuedMessage } from "../models/ProjectLeadQueueMessage.js";

export async function enqueueMessages(threadIds: string[], message: QueuedMessage, transaction?: Transaction) {
  await ProjectLeadQueueMessage.bulkCreate([...new Set(threadIds)].map((threadId) => ({
    threadId, ...message,
  })), { ignoreDuplicates: true, transaction });
}
// Single backend process: recover claims left by its previous incarnation.
export async function recoverMessageQueue() {
  await ProjectLeadQueueMessage.update({ status: "pending", claimToken: null }, { where: { status: "processing" } });
}
export async function claimMessages(threadId: string) {
  return sequelize.transaction({ type: Transaction.TYPES.IMMEDIATE }, async (transaction) => {
    if (await ProjectLeadQueueMessage.count({ where: { threadId, status: "processing" }, transaction })) return null;
    const messages = await ProjectLeadQueueMessage.findAll({
      where: { threadId, status: "pending" }, order: [["id", "ASC"]], limit: 100, transaction,
    });
    if (!messages.length) return null;
    const claimToken = randomUUID();
    await ProjectLeadQueueMessage.update({ status: "processing", claimToken }, {
      where: { id: { [Op.in]: messages.map((message) => message.id) }, status: "pending" }, transaction,
    });
    return { claimToken, messages };
  });
}
export async function finishClaim(claimToken: string, delivered: boolean) {
  await ProjectLeadQueueMessage.update({ status: delivered ? "delivered" : "pending", claimToken: null }, {
    where: { claimToken, status: "processing" },
  });
}
export async function drainMessageQueue(
  available: (threadId: string) => Promise<boolean>,
  deliver: (threadId: string, messages: QueuedMessage[]) => Promise<boolean>,
  onError: (error: unknown) => void = console.error,
) {
  const pending = await ProjectLeadQueueMessage.findAll({
    attributes: ["threadId"], where: { status: "pending" }, group: ["threadId"],
  });
  for (const { threadId } of pending) {
    let claimToken: string | undefined;
    try {
      if (!await available(threadId)) continue;
      const claim = await claimMessages(threadId);
      if (!claim) continue;
      claimToken = claim.claimToken;
      const messages = claim.messages.map(({ eventId, source, sourceId, eventType, content }) =>
        ({ eventId, source, sourceId, eventType, content }));
      await finishClaim(claimToken, await deliver(threadId, messages));
    } catch (error) {
      if (claimToken) await finishClaim(claimToken, false);
      onError(error);
    }
  }
}
