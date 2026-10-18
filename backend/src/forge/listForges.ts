import type { PipelineState } from "shared";
import { checklistVerdict } from "./plan.js";

type WorkspaceStatus = { issueId: string };

// Include watched issues without a workspace so filtering doesn't hide subscriptions.
export async function listForges(
  workspaces: WorkspaceStatus[],
  subscribedIds: string[],
  readPipeline: (issueId: string) => Promise<PipelineState>,
  subscribedOnly = false,
) {
  const subscribed = new Set(subscribedIds);
  const byIssue = new Map(workspaces.map((workspace) => [workspace.issueId, workspace]));
  const issueIds = subscribedOnly ? [...subscribed] : [...new Set([...byIssue.keys(), ...subscribed])];
  return Promise.all(
    issueIds.map(async (issueId) => {
      const workspace = byIssue.get(issueId);
      const pipeline = await readPipeline(issueId);
      return {
        issueId,
        subscribed: subscribed.has(issueId),
        hasWorkspace: Boolean(workspace),
        started: pipeline.started,
        running: pipeline.running,
        waiting: pipeline.waiting,
        finished: pipeline.finished,
        error: pipeline.error,
        pausing: pipeline.pausing ?? false,
        canResume: pipeline.canResume ?? false,
        qaVerdict: checklistVerdict(pipeline.plan),
      };
    }),
  );
}
