import { sequelize } from "../db.js";
import { ForgeSubscription } from "../models/ForgeSubscription.js";
import { ProjectLeadQueueMessage } from "../models/ProjectLeadQueueMessage.js";
import type { ProjectLeadSubscriptions } from "shared";
import { sendEvent } from "../core/events.js";

export const forgeSubscriptions = {
  async subscribe(threadId: string, issueId: string) {
    await ForgeSubscription.findOrCreate({ where: { threadId, issueId } });
    sendEvent({ type: "thread.updated", threadId });
  },
  async unsubscribe(threadId: string, issueId: string) {
    await sequelize.transaction(async (transaction) => {
      await ForgeSubscription.destroy({ where: { threadId, issueId }, transaction });
      await ProjectLeadQueueMessage.destroy({
        where: { threadId, source: "forge", sourceId: issueId, status: "pending" }, transaction,
      });
    });
    sendEvent({ type: "thread.updated", threadId });
  },
  async list(threadId: string) {
    return (await ForgeSubscription.findAll({ where: { threadId }, order: [["createdAt", "ASC"], ["issueId", "ASC"]] }))
      .map((row) => row.issueId);
  },
  async listAll(): Promise<ProjectLeadSubscriptions[]> {
    const rows = await ForgeSubscription.findAll({ order: [["threadId", "ASC"], ["createdAt", "ASC"], ["issueId", "ASC"]] });
    const result: ProjectLeadSubscriptions[] = [];
    for (const row of rows) {
      let entry = result.at(-1);
      if (entry?.threadId !== row.threadId) { entry = { threadId: row.threadId, forgeIds: [] }; result.push(entry); }
      entry.forgeIds.push(row.issueId);
    }
    return result;
  },
};
