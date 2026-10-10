import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { createMiddleware } from "langchain";

// A subagent hands in its work by calling its submit tool. A model reply without any
// tool call would end its turn without it: instead it goes back to the model, with
// its tools and conversation, to submit; a third time ends the run.
export function requireSubmission(submit: string, onNudge?: (attempt: number) => Promise<void>) {
  let nudges = 0;
  return createMiddleware({
    name: "RequireSubmission",
    afterModel: {
      canJumpTo: ["model"],
      hook: async (state) => {
        // A submission also ends with a reply without tool calls, after the document.
        const last = state.messages.at(-1);
        if ("structuredResponse" in state && state.structuredResponse) return;
        if (!AIMessage.isInstance(last) || last.tool_calls?.length) return;
        if (++nudges > 2) throw new Error(`The subagent ended its turn three times without calling ${submit}`);
        await onNudge?.(nudges);
        return {
          messages: [new HumanMessage(`Your turn ended without your document. Call ${submit} to hand it in.`)],
          jumpTo: "model" as const,
        };
      },
    },
  });
}
