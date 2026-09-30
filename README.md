# zini

Turn Linear tickets into merged PRs: a PM chat front-end with an agent pipeline that plans, builds, reviews, and ships.

## How it works

1. **Discuss** — talk through a ticket with the PM agent; it sharpens scope and writes the spec.

   This works today: the PM chat reads and writes Linear and the repo's code, and you approve every issue create or update before it runs.

2. **Spec** — the spec lands on the Linear issue.

   This works today too: the PM writes the spec onto the issue.

3. **Build** — a coordinator spins up an isolated workspace per ticket and runs the agent pipeline: plan → code → review → QA.

   Plan, code and review work. The QA stage named in the list doesn't exist yet — the planner, coder and reviewer are the only subagents, and the QA stage is tracked separately.

4. **Ship** — a PR is created; the workspace is torn down after merge.

   This is the intended end state, and it isn't built. The pipeline stops after the review and waits for your feedback, and you then commit and push the branch yourself from the pipeline panel, where a committer agent writes the commit message for you to edit before you press Commit & push. No pull request is opened, and nothing is torn down on merge: you delete the workspace yourself, which removes the worktree, the setup log, the pipeline conversation and the run logs.

## Status

What works today: the PM chat; a git worktree per issue that runs the setup command; the plan → code → review pipeline with its questions and plan approval; the diff view and the per-run logs; and committing and pushing the branch.

Ahead of the code: opening a pull request, a QA stage, and tearing a workspace down after a merge.
