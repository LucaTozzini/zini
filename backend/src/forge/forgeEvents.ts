import type { ForgeLifecycleEvent } from "./events.js";
import { errorMessage } from "../core/errors.js";

// The Forge stream is drained (including tools) before a terminal event is
// emitted. Only lifecycle boundaries invoke this emitter, never token/UI updates.
export async function* forgeEvents<T>(
  source: Promise<AsyncIterable<T>>,
  outcome: () => Promise<ForgeLifecycleEvent | null>,
  emit: (event: ForgeLifecycleEvent) => Promise<void>,
  signal?: AbortSignal,
): AsyncGenerator<T> {
  try {
    yield* await source;
  } catch (error) {
    if (signal?.aborted) await emit({ type: "stopped" });
    else await emit({ type: "failed", error: errorMessage(error) });
    throw error;
  }
  if (signal?.aborted) {
    await emit({ type: "stopped" });
    return;
  }
  const event = await outcome();
  if (event) await emit(event);
}
