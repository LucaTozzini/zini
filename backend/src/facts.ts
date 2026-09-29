import { Command } from "@langchain/langgraph";
import { createMiddleware, tool, ToolMessage } from "langchain";
import { z } from "zod";

// Key facts the agent records as the conversation goes: decisions, constraints, IDs.
// They're kept in the thread's state and put in the system prompt on every call, so
// they survive compaction word for word, where the summary may lose them.

const FACTS_PROMPT = `## Key facts

Record what must not be forgotten with write_facts: decisions the user made, constraints
they stated, names and identifiers (issues, files, packages) the work depends on. Older
messages are eventually replaced by a summary that may lose details, but these facts
stay in this prompt. Keep them short, and drop facts that are no longer true.`;

const writeFacts = tool(
  ({ facts }, config) =>
    new Command({
      update: {
        facts,
        messages: [
          new ToolMessage({
            content: `Recorded ${facts.length} facts`,
            tool_call_id: config.toolCall?.id ?? "",
            name: "write_facts",
          }),
        ],
      },
    }),
  {
    name: "write_facts",
    description:
      "Replace the list of key facts with facts: pass every fact to keep, not just new ones.",
    schema: z.object({ facts: z.array(z.string()) }),
  },
);

export const factsMiddleware = createMiddleware({
  name: "Facts",
  stateSchema: z.object({ facts: z.array(z.string()).default([]) }),
  tools: [writeFacts],
  wrapModelCall: (request, handler) => {
    const facts = request.state.facts ?? [];
    const list = facts.length ? facts.map((fact) => `- ${fact}`).join("\n") : "None yet.";
    return handler({
      ...request,
      systemMessage: request.systemMessage.concat(`\n\n${FACTS_PROMPT}\n\n${list}`),
    });
  },
});
