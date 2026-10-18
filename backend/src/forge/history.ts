import type { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import type { CheckpointTuple } from "@langchain/langgraph-checkpoint";

// The latest checkpoint of each namespace on the thread: the Forge's, and each
// agent conversation's.
export async function loadForgeHistory(saver: SqliteSaver, threadId: string) {
  // Initialize the saver on a fresh database before querying its tables.
  await saver.getTuple({ configurable: { thread_id: threadId, checkpoint_ns: "" } });
  const latest = saver.db
    .prepare(
      `
    SELECT checkpoint_ns, MAX(checkpoint_id) AS checkpoint_id
    FROM checkpoints WHERE thread_id = ?
    GROUP BY checkpoint_ns
  `,
    )
    .all(threadId) as { checkpoint_ns: string; checkpoint_id: string }[];
  const checkpoints: CheckpointTuple[] = [];
  for (const row of latest) {
    const tuple = await saver.getTuple({ configurable: { thread_id: threadId, ...row } });
    if (tuple) checkpoints.push(tuple);
  }
  return { checkpoints };
}
