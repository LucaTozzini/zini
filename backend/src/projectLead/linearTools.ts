import type { LinearClient } from "@linear/sdk";
import { tool } from "langchain";
import { STATUS_TYPES } from "shared";
import { z } from "zod";
import {
  createLinearIssue,
  fetchLinearIssue,
  fetchLinearIssues,
  fetchLinearTeams,
  searchLinearIssues,
  setLinearBlocker,
  updateLinearIssue,
} from "../integrations/linear.js";
import { isIssueId } from "../workspaces/workspaces.js";

// Names rather than ids, so the approval card shows what will be set.
const STATUS = z.string().describe('A status name from the issue\'s team, e.g. "In Progress"');
const ASSIGNEE = z.string().describe("Email of a member of the issue's team");

// Reading and changing the Linear workspace's issues.
export function linearTools(linear: LinearClient) {
  return [
    tool(async ({ statusTypes }) => JSON.stringify(await fetchLinearIssues(linear, statusTypes ?? [])), {
      name: "list_issues",
      description:
        "List up to 250 issues, most recently updated first, without descriptions. " + "Optionally filter by status type.",
      schema: z.object({ statusTypes: z.array(z.enum(STATUS_TYPES)).optional() }),
    }),
    tool(async ({ query }) => JSON.stringify(await searchLinearIssues(linear, query)), {
      name: "search_issues",
      description:
        "Search issue titles and descriptions with Linear's full-text search, like its " + "search box. Up to 50 results.",
      schema: z.object({ query: z.string().min(1) }),
    }),
    tool(async ({ id }) => JSON.stringify(await fetchLinearIssue(linear, id)), {
      name: "get_issue",
      description:
        "Get one issue with its description, comments, attachments (links such as its pull requests), " +
        "the issues blocking it (blockedBy) and the issues it blocks, each with its status, by identifier (e.g. ENG-123) or id.",
      schema: z.object({ id: z.string() }),
    }),
    tool(
      async ({ issueId, blockerId, blocked }) =>
        JSON.stringify({ blockedBy: await setLinearBlocker(linear, issueId, blockerId, blocked ?? true) }),
      {
        name: "set_blocker",
        description:
          "Mark blockerId as blocking issueId, or with blocked=false, remove that blocker. " +
          "Returns the issue's blockers afterwards. The user approves the call before it runs.",
        schema: z.object({
          issueId: z.string().describe("The blocked issue: identifier (e.g. ENG-123) or id"),
          blockerId: z.string().describe("The issue that blocks it: identifier or id"),
          blocked: z.boolean().optional().describe("false removes the blocker; default true"),
        }),
      },
    ),
    tool(async () => JSON.stringify(await fetchLinearTeams(linear)), {
      name: "list_teams",
      description:
        'List the workspace\'s teams with their statuses and members, and who "me" is. ' + "Creating an issue needs a team id.",
      schema: z.object({}),
    }),
    tool(async (input) => JSON.stringify(await createLinearIssue(linear, input)), {
      name: "create_issue",
      description: "Create an issue. The user approves the call before it runs.",
      schema: z.object({
        teamId: z.string(),
        title: z.string(),
        description: z.string().optional().describe("Markdown"),
        priority: z.number().int().min(0).max(4).optional(),
        status: STATUS.optional(),
        assignee: ASSIGNEE.optional(),
      }),
    }),
    tool(async ({ id, ...changes }) => JSON.stringify(await updateLinearIssue(linear, id, changes)), {
      name: "update_issue",
      description:
        "Change an issue's title, description, priority, status or assignee. Every field " +
        "but id is optional: omit the ones you aren't changing, rather than passing their " +
        "current value or an empty string. Set assignee to null to unassign. " +
        "The user approves the call before it runs.",
      schema: z.object({
        id: z.string().describe("Identifier (e.g. ENG-123) or id"),
        title: z.string().optional(),
        description: z.string().optional().describe("Markdown"),
        priority: z.number().int().min(0).max(4).optional(),
        status: STATUS.optional(),
        assignee: ASSIGNEE.nullable().optional(),
      }),
    }),
  ];
}

// The issue's id: workspaces and Forges are keyed by it, not by its identifier.
export const toIssueId = async (linear: LinearClient, id: string) =>
  isIssueId(id) ? id : (await fetchLinearIssue(linear, id)).id;

export const ISSUE_ID = z.string().describe("Linear issue id or identifier, e.g. ENG-123");
