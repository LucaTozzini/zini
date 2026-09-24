import { AuthenticationLinearError, LinearClient } from "@linear/sdk";
import { getKey } from "./models/Integration.js";
import type { LinearIssue, StatusType } from "shared";

// Built per call so a replaced or removed key takes effect immediately.
export async function getLinearClient() {
  const apiKey = await getKey("linear");
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

const SEARCH_QUERY = `
  query SearchIssues($term: String!) {
    searchIssues(term: $term, first: 50) {
      nodes {
        id identifier title priority url updatedAt
        state { name type }
        assignee { name }
      }
    }
  }
`;

// Linear's own full-text search over issue titles and descriptions (not comments),
// like the search box in the Linear app. Up to 50 results.
export async function searchLinearIssues(client: LinearClient, query: string) {
  const { data } = await client.client.rawRequest<
    { searchIssues: { nodes: LinearIssue[] } },
    { term: string }
  >(SEARCH_QUERY, { term: query });
  return data!.searchIssues.nodes;
}

const ISSUE_QUERY = `
  query Issue($id: String!) {
    issue(id: $id) {
      id identifier title description priority url updatedAt
      state { name type }
      assignee { name email }
      team { key name }
    }
  }
`;

// Accepts the internal id or the identifier, e.g. "ENG-123".
export async function fetchLinearIssue(client: LinearClient, id: string) {
  const { data } = await client.client.rawRequest<{ issue: unknown }, { id: string }>(
    ISSUE_QUERY,
    { id },
  );
  return data!.issue;
}

type Team = {
  id: string;
  key: string;
  name: string;
  states: { nodes: { id: string; name: string; type: string }[] };
  members: { nodes: { id: string; name: string; email: string; active: boolean }[] };
};

const TEAMS_QUERY = `
  query Teams {
    viewer { name email }
    teams {
      nodes {
        id key name
        states { nodes { id name type } }
        members { nodes { id name email active } }
      }
    }
  }
`;

// Each team with the statuses and people its issues can use, plus who the API key
// belongs to ("me").
export async function fetchLinearTeams(client: LinearClient) {
  const { data } = await client.client.rawRequest<
    { viewer: { name: string; email: string }; teams: { nodes: Team[] } },
    Record<string, never>
  >(TEAMS_QUERY, {});
  return {
    me: data!.viewer,
    teams: data!.teams.nodes.map((team) => ({
      id: team.id,
      key: team.key,
      name: team.name,
      statuses: team.states.nodes.map(({ name, type }) => ({ name, type })),
      members: team.members.nodes
        .filter((member) => member.active)
        .map(({ name, email }) => ({ name, email })),
    })),
  };
}

const TEAM_QUERY = `
  query Team($id: String!) {
    team(id: $id) {
      states { nodes { id name type } }
      members { nodes { id name email active } }
    }
  }
`;

// Status and assignee are given by name and email, so the approval card shows
// something readable; Linear needs their ids, which depend on the team.
type ReadableFields = { status?: string; assignee?: string };

async function resolveFields(client: LinearClient, teamId: string, fields: ReadableFields) {
  const ids: { stateId?: string; assigneeId?: string } = {};
  if (!fields.status && !fields.assignee) return ids;

  const { data } = await client.client.rawRequest<
    { team: Pick<Team, "states" | "members"> },
    { id: string }
  >(TEAM_QUERY, { id: teamId });
  const { states, members } = data!.team;

  if (fields.status) {
    const status = fields.status.toLowerCase();
    const state = states.nodes.find((s) => s.name.toLowerCase() === status);
    if (!state) {
      throw new Error(
        `No status "${fields.status}" in this team. Options: ${states.nodes.map((s) => s.name).join(", ")}`,
      );
    }
    ids.stateId = state.id;
  }

  if (fields.assignee) {
    const email = fields.assignee.toLowerCase();
    const member = members.nodes.find((m) => m.active && m.email.toLowerCase() === email);
    if (!member) {
      throw new Error(`No team member with email "${fields.assignee}". Use list_teams to see members.`);
    }
    ids.assigneeId = member.id;
  }

  return ids;
}

const CREATE_ISSUE_MUTATION = `
  mutation CreateIssue($input: IssueCreateInput!) {
    issueCreate(input: $input) {
      issue { identifier url }
    }
  }
`;

type NewLinearIssue = ReadableFields & {
  teamId: string;
  title: string;
  description?: string;
  priority?: number;
};

export async function createLinearIssue(
  client: LinearClient,
  { status, assignee, ...input }: NewLinearIssue,
) {
  const ids = await resolveFields(client, input.teamId, { status, assignee });
  const { data } = await client.client.rawRequest<
    { issueCreate: { issue: { identifier: string; url: string } } },
    { input: object }
  >(CREATE_ISSUE_MUTATION, { input: { ...input, ...ids } });
  return data!.issueCreate.issue;
}

const UPDATE_ISSUE_MUTATION = `
  mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
    issueUpdate(id: $id, input: $input) {
      issue { identifier url }
    }
  }
`;

// assignee: null unassigns the issue.
type LinearIssueChanges = Partial<Pick<NewLinearIssue, "title" | "description" | "priority">> & {
  status?: string;
  assignee?: string | null;
};

export async function updateLinearIssue(
  client: LinearClient,
  id: string,
  { status, assignee, ...input }: LinearIssueChanges,
) {
  // Statuses and members belong to the issue's team.
  let ids: { stateId?: string; assigneeId?: string | null } =
    assignee === null ? { assigneeId: null } : {};
  if (status || assignee) {
    const { data } = await client.client.rawRequest<
      { issue: { team: { id: string } } },
      { id: string }
    >(`query IssueTeam($id: String!) { issue(id: $id) { team { id } } }`, { id });
    ids = { ...ids, ...(await resolveFields(client, data!.issue.team.id, { status, assignee: assignee ?? undefined })) };
  }

  const { data } = await client.client.rawRequest<
    { issueUpdate: { issue: { identifier: string; url: string } } },
    { id: string; input: object }
  >(UPDATE_ISSUE_MUTATION, { id, input: { ...input, ...ids } });
  return data!.issueUpdate.issue;
}
