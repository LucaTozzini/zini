# MVP

The first milestone: prove the front half of the loop — Linear in, spec out —
with an experience good enough to use daily.

## In scope

1. **Linear connection**
   - Authenticate with a Linear API key.
   - List issues (filterable by team/project/state) in a left-side list;
     selecting one shows details on the right.

2. **PM chat**
   - A chat session scoped to a Linear issue.
   - Discuss scope, requirements, edge cases, acceptance criteria.
   - The agent writes the resulting spec back to the issue (description,
     and/or sub-issues / comments — TBD).
   - Conversation history is tied to the issue and resumable.

3. **Easy setup**
   - A new user goes from clone to chatting about their first ticket in
     minutes, with no repo-specific infrastructure.
   - `zini init` (or equivalent) walks through: Linear API key, model API
     key, model selection.

## Out of scope (for MVP)

- Workspaces, git worktrees, databases, dev-server previews.
- The coordinator and the code/review/QA agent pipeline.
- PR creation and post-merge teardown.
- Cost/token tracking per ticket (planned, not MVP).
- Multi-user / team features, auth, hosting.

## Acceptance

A user can: connect Linear, browse tickets, open a PM chat on an issue,
iterate on the spec conversationally, and end with a well-written spec saved
to the Linear issue — without reading any docs beyond the quickstart.
