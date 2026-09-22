# zini

Turn Linear tickets into merged PRs: a PM chat front-end with an agent pipeline that plans, builds, reviews, and ships.

## How it works

1. **Discuss** — talk through a ticket with the PM agent; it sharpens scope and writes the spec.
2. **Spec** — the spec lands on the Linear issue.
3. **Build** — a coordinator spins up an isolated workspace per ticket and runs the agent pipeline: plan → code → review → QA.
4. **Ship** — a PR is created; the workspace is torn down after merge.

## Status

Pre-MVP. Current milestone: connect Linear, browse tickets, and iterate on specs in the PM chat. The build pipeline comes after.
