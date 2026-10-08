import type { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import type { CheckpointTuple } from "@langchain/langgraph-checkpoint";

export async function loadCoordinatorHistory(saver: SqliteSaver, threadId: string) {
  const configurable = { thread_id: threadId, checkpoint_ns: "" };
  // Initialize the saver on a fresh database before querying its tables.
  await saver.getTuple({ configurable });
  const latest = saver.db.prepare(`
    SELECT checkpoint_ns, MAX(checkpoint_id) AS checkpoint_id
    FROM checkpoints WHERE thread_id = ? AND checkpoint_ns <> ''
    GROUP BY checkpoint_ns
  `).all(threadId) as { checkpoint_ns: string; checkpoint_id: string }[];
  const checkpoints: CheckpointTuple[] = [];
  // Root snapshots contain document versions and command execution events, rather
  // than agent chat. Retain them to preserve the stage/document timeline.
  for await (const tuple of saver.list({ configurable })) checkpoints.push(tuple);
  for (const row of latest) {
    const tuple = await saver.getTuple({ configurable: { thread_id: threadId, ...row } });
    if (tuple) checkpoints.push(tuple);
  }
  return { checkpoints };
}
