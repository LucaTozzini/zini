import type { ForgeState } from "shared";
import { checklistVerdict } from "./plan.js";

type WorkspaceStatus = { issueId: string };

// Include watched issues without a workspace so filtering doesn't hide subscriptions.
export async function listForges(
  workspaces: WorkspaceStatus[],
  subscribedIds: string[],
  readForge: (issueId: string) => Promise<ForgeState>,
  subscribedOnly = false,
) {
  const subscribed = new Set(subscribedIds);
  const byIssue = new Map(workspaces.map((workspace) => [workspace.issueId, workspace]));
  const issueIds = subscribedOnly ? [...subscribed] : [...new Set([...byIssue.keys(), ...subscribed])];
  return Promise.all(
    issueIds.map(async (issueId) => {
      const workspace = byIssue.get(issueId);
      const forge = await readForge(issueId);
      return {
        issueId,
        subscribed: subscribed.has(issueId),
        hasWorkspace: Boolean(workspace),
        started: forge.started,
        running: forge.running,
        waiting: forge.waiting,
        finished: forge.finished,
        error: forge.error,
        pausing: forge.pausing ?? false,
        canResume: forge.canResume ?? false,
        qaVerdict: checklistVerdict(forge.plan),
      };
    }),
  );
}
