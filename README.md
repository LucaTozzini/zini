# zini

An open-source **software factory**: turn Linear tickets into merged PRs with
a PM chat front-end and an agent pipeline that plans, builds, reviews, and ships.

## The problem

Ticket-to-PR tooling today is either a black box (paste a ticket into an agent,
hope for the best) or a pile of scripts duct-taped together per team. There's
no clean, self-hostable loop that takes you from *"we should build X"* to a
merged pull request — with a human in the loop where it matters and agents
doing the rest.

## How it works

The full loop zini is building toward:

1. **Discuss** — You talk through a ticket with a PM agent in a chat session.
   It asks questions, sharpens scope, and writes the spec.
2. **Spec** — The PM agent writes the plan into the Linear issue. The ticket
   list updates; pick a ticket to see its details and workspace.
3. **Build** — A coordinator spins up an isolated workspace per ticket
   (git worktree, database, dev-server preview) and runs an agent pipeline:
   plan → code → review → QA.
4. **Ship** — A PR is created from the workspace. After merge, the workspace
   is torn down.

Humans drive intent and judgment. Agents do the mechanical work. Every step
is observable and interruptible.

## MVP scope

The first milestone is deliberately small:

- Connect to Linear and display tickets (list + detail view).
- A **PM chat** for discussing and managing Linear issues — talk through
  scope, then have the agent write the spec back to the issue.

See [docs/mvp.md](docs/mvp.md) for what's in and out.

## Architecture

- **Custom-built agents, not wrappers.** zini does not shell out to Codex or
  Claude Code. Users bring their own model API key, and zini owns the agent
  loop — which is what makes cost/token tracking, cancellation, and
  fine-grained control possible.
- **Least-privilege tools.** The PM agent gets tools for reading and writing
  Linear issues. Nothing else. Execution agents get similarly narrow toolsets.
- **Deterministic pipeline.** The coordinator runs a state machine
  (plan → code → review → QA), not free-form agent chat, so runs are
  reproducible and debuggable.

See [docs/architecture.md](docs/architecture.md) for the full picture.

## Quickstart

> 🚧 zini is pre-MVP. Quickstart lands with the first milestone.

Planned setup: clone, `zini init`, paste your Linear API key and model API
key, open the app, pick a ticket, start chatting.

## Non-goals

- Not a CI replacement, not a project-management tool — it sits between
  Linear and your repo and does one loop well.
- No vendor lock-in on models: any API-compatible model works.
- No RenoFiz-specific infrastructure. If it only runs on one team's stack,
  it doesn't ship.

## Contributing

Issues and PRs welcome. Open an issue first for anything bigger than a typo
so design can be discussed before code.

## License

MIT — see [LICENSE](LICENSE).
