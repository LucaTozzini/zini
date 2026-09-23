import { AuthenticationLinearError, LinearClient } from "@linear/sdk";
import { Integration } from "./models/Integration.js";
import type { LinearIssue, StatusType } from "shared";

export async function getLinearKey() {
  const row = await Integration.findByPk("linear");
  return row?.apiKey ?? null;
}

// Built per call so a replaced or removed key takes effect immediately.
export async function getLinearClient() {
  const apiKey = await getLinearKey();
  return apiKey ? new LinearClient({ apiKey }) : null;
}

// true if Linear accepts the key, false if it rejects it. Other errors
// (e.g. Linear unreachable) are thrown, since they say nothing about the key.
export async function testLinearKey(apiKey: string) {
  try {
    await new LinearClient({ apiKey }).viewer;
    return true;
  } catch (err) {
    if (err instanceof AuthenticationLinearError) return false;
    throw err;
  }
}

// One request with nested fields, instead of the SDK's lazy per-issue lookups.
const ISSUES_QUERY = `
  query Issues($filter: IssueFilter) {
    issues(first: 250, filter: $filter, orderBy: updatedAt) {
      nodes {
        id identifier title priority url updatedAt
        state { name type }
        assignee { name }
      }
    }
  }
`;

export async function fetchLinearIssues(client: LinearClient, statusTypes: StatusType[]) {
  const filter = statusTypes.length ? { state: { type: { in: statusTypes } } } : undefined;
  const { data } = await client.client.rawRequest<
    { issues: { nodes: LinearIssue[] } },
    { filter?: object }
  >(ISSUES_QUERY, { filter });
  return data!.issues.nodes;
}
