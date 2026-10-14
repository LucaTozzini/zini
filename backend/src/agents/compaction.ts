import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import { ReducedValue, StateSchema } from "@langchain/langgraph";
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

// The archive merges by message ID: each run of the agent writes the saved archive back,
// or an empty default at its start, and neither may double or wipe it.
const archive = (current: BaseMessage[], next: BaseMessage[]) => {
  const ids = new Set(current.map((message) => message.id));
  return [...current, ...next.filter((message) => !ids.has(message.id))];
};

// Runs LangChain's compaction, and archives the messages it drops in `compacted`, so
// the chat can still show the whole conversation. The model only ever reads `messages`.
// Tests compact smaller conversations.
export function compactionMiddleware(model: BaseChatModel, { compactAt = COMPACT_AT, keepMessages = KEEP_MESSAGES } = {}) {
  const summarization = summarizationMiddleware({
    model,
    trigger: { tokens: compactAt },
    keep: { messages: keepMessages },
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
    stateSchema: new StateSchema({
      compacted: new ReducedValue(z.array(z.custom<BaseMessage>()).default([]), { reducer: archive }),
    }),
    beforeModel: async (state, runtime) => {
      const update = await summarize(state, runtime);
      if (!update) return; // Under the threshold: nothing changes.

      // The update is [remove all, summary, ...kept messages]. The summary reuses the
      // first dropped message's ID, so only what follows it counts as kept.
      const keptIds = new Set(update.messages.slice(2).map((message) => message.id));
      const dropped = state.messages.filter((message) => !keptIds.has(message.id));
      return { ...update, compacted: dropped };
    },
  });
}
