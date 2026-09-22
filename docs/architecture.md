# Architecture

## Principles

1. **Own the agent loop.** zini implements its own agent runtime instead of
   wrapping Codex, Claude Code, or similar. Users supply their own model API
   key. This is what makes monitoring, cancellation, per-ticket cost
   tracking, and tool-level control possible.
2. **Least-privilege tools.** Each agent gets exactly the tools its job
   needs — nothing more.
3. **Deterministic where it counts.** The build pipeline is a state machine,
   not an open-ended agent conversation. Runs are reproducible, resumable,
   and debuggable.
4. **No special infrastructure.** Everything a contributor needs runs on
   their machine (or a plain VM). Nothing RenoFiz-specific.

## Components

### PM agent (MVP)

- **Job:** turn a rough ticket into a sharp spec through conversation.
- **Tools:** read and write Linear issues (get issue, list issues, update
  description, add comment; exact surface TBD). No code tools, no shell.
- **Model:** user-provided API key; model selectable at setup. zini never
  ships with a key and never proxies through a vendor account.

### Ticket UI (MVP)

- Left-side issue list, right-side detail — the layout that works.
- PM chat panel scoped to the selected issue.

### Coordinator + execution pipeline (post-MVP)

- Per ticket: isolated workspace (git worktree, database, dev-server
  preview), a coordinator chat, PR creation, post-merge teardown.
- Pipeline stages: **tech-lead** (plan) → **coder** → **reviewer** →
  **de-slop** → **qa-planner** → **qa-tester**. Each stage is a narrow agent
  with a narrow toolset, run in a fixed order by the coordinator.
- The execution backend is swappable; the coordinator owns the loop either
  way.

## Data flow

```
Linear API  <──>  zini backend  <──>  UI (tickets + PM chat)
                        │
                        │  (post-MVP)
                        ▼
              coordinator ──▶ workspaces ──▶ PRs
```

zini is the system of record for agent runs; Linear stays the system of
record for tickets; GitHub stays the system of record for code.
