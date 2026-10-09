import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import { createMiddleware, summarizationMiddleware } from "langchain";
import { z } from "zod";

// Keeps a long conversation within the model's reach: past COMPACT_AT tokens, the
// older messages are replaced by a summary, keeping the last KEEP_MESSAGES.
const COMPACT_AT = 100_000;
const KEEP_MESSAGES = 20;
// What the summary starts with, before the summary itself (LangChain's default).
const SUMMARY_PREFIX = "Here is a summary of the conversation to date:";

// The summary LangChain's compaction puts in place of the messages it drops.
export const isSummary = (message: BaseMessage) =>
  message.additional_kwargs?.lc_source === "summarization";

// A summary message's text, without its prefix.
export const summaryText = (message: BaseMessage) =>
  message.text.replace(SUMMARY_PREFIX, "").trim();

// Runs LangChain's compaction, and archives the messages it drops in `compacted`, so
// the chat can still show the whole conversation. The model only ever reads `messages`.
export function compactionMiddleware(model: BaseChatModel) {
  const summarization = summarizationMiddleware({
    model,
    trigger: { tokens: COMPACT_AT },
    keep: { messages: KEEP_MESSAGES },
    summaryPrefix: SUMMARY_PREFIX,
  });
  // Its hook is typed loosely (a function or { hook }) but is a function: nothing when
  // it doesn't compact, otherwise the new messages.
  const summarize = summarization.beforeModel as (
    state: unknown,
    runtime: unknown,
  ) => Promise<{ messages: BaseMessage[] } | undefined>;

  return createMiddleware({
    name: "Compaction",
    // Replaced on every write, not appended to: each run of the agent writes every
    // state field back with its saved value, which an appending reducer would double.
    stateSchema: z.object({ compacted: z.array(z.custom<BaseMessage>()).default([]) }),
    beforeModel: async (state, runtime) => {
      const update = await summarize(state, runtime);
      if (!update) return; // Under the threshold: nothing changes.

      // The update is [remove all, summary, ...kept messages]. The summary reuses the
      // first dropped message's ID, so only what follows it counts as kept.
      const keptIds = new Set(update.messages.slice(2).map((message) => message.id));
      const dropped = state.messages.filter((message) => !keptIds.has(message.id));
      return { ...update, compacted: [...state.compacted, ...dropped] };
    },
  });
}
