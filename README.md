# zini

Turn Linear tickets into merged PRs: a PM chat front-end with an agent pipeline that plans, builds, reviews, and ships.

## How it works

1. **Discuss** — talk through a ticket with the PM agent; it sharpens scope and writes the spec.

   This works today: the PM chat reads and writes Linear and the repo's code, and you approve every issue create or update before it runs.

   Each PM chat also has its own browser for HTTP/HTTPS websites, including external
   sites. The browser button in the chat header opens a live, read-only viewer with
   the current URL. Sessions persist between turns until the PM closes its browser,
   the chat is deleted, or the backend restarts. Closing the viewer leaves the
   browser running. QA uses the same browser controls and viewer transport but
   continues to open only localhost addresses and closes its browser after each run.
   Browser tools include screenshots the model can see, keyboard input, hover, scrolling,
   drag, native select/checkbox controls, conditional waits, and viewport/media emulation.
   Emulation persists until reset or the browser closes.

2. **Spec** — the spec lands on the Linear issue.

   This works today too: the PM writes the spec onto the issue.

3. **Build** — a coordinator spins up an isolated workspace per ticket and runs the agent pipeline: plan → code → environment setup → checks → review → QA.

   Environment setup selects repository-defined dependency installation, fixtures and
   readiness commands before each check round. You approve its commands. If setup
   fails or needs configuration, the pipeline pauses there for your answer; checks
   and review wait until preparation succeeds. Reusable setup instructions live in
   the source-validated runbook.

   All four stages work. The QA works out how to run the software from the repo itself (its CI config, scripts and README), then tests the changes: it runs the project's checks, starts the app, calls its APIs and uses its UI in a headless browser you can watch live. You approve every command it runs. What it finds broken goes back to the coder.

   The QA's browser is Playwright's headless Chromium, downloaded (about 115 MB) by the backend's `npm install`. If that step was skipped, run `npx playwright install chromium --only-shell` in `backend/`.

4. **Ship** — a PR is created; the workspace is torn down after merge.

   This is the intended end state, and it isn't built. The pipeline stops after QA, with no pending reply; revisions use redirect, and you then commit and push the branch yourself from the pipeline panel, where a committer agent writes the commit message for you to edit before you press Commit & push. No pull request is opened, and nothing is torn down on merge: you delete the workspace yourself, which removes the worktree, the setup log, the pipeline conversation and the run logs.

## Backend source layout

`backend/src/index.ts` starts the HTTP server, and `db.ts` configures SQLite.
The remaining files are grouped by responsibility:

| Folder | Contents |
| --- | --- |
| `routes/` | Express endpoints |
| `models/` | Sequelize models |
| `coordinator/` | Pipeline execution, history, steering, QA, and subscriptions |
| `productManager/` | PM conversations, notes, and coordinator updates |
| `agents/` | Shared agent setup, compaction, run state, and code exploration tools |
| `providers/` | Model connections, ChatGPT authentication/streaming, and OpenRouter |
| `integrations/` | Integration management and GitHub/Linear clients |
| `workspaces/` | Workspace lifecycle, files, app sessions, and preview proxy |
| `repositories/` | Git operations, repository filesystem, and npm package source |
| `browser/` | Browser sessions and interaction tools |
| `evals/` | Evaluation execution and temporary credentials |
| `core/` | Settings, events, process management, and text editing |

Tests live beside the modules they cover as `*.test.ts` files.

## Status

What works today: the PM chat; a git worktree per issue; the plan → code → environment setup → checks → review → QA pipeline with its questions, plan approval and command approvals; the diff view, the per-run logs and the QA's live browser; and committing and pushing the branch.

The PM automatically follows coordinators it starts. Its
`coordinator_subscription` tool can subscribe to other issues or unsubscribe.
`list_coordinators` discovers existing workspaces and coordinator status, with a
`subscribed` flag per issue and an optional `subscribedOnly` filter for this chat.
The PM can pause running work with `pause_coordinator` and continue paused or
interrupted work with `continue_coordinator` when requested. Continuation is available
after cancellation drains and uses the saved checkpoint; questions and approvals still
go through `reply_to_pipeline`.
Meaningful progress, questions, approvals, failures and
completion appear as coordinator activity messages and wake the PM when the chat is
idle. Updates queue while the PM is busy or waiting for approval; Stop pauses automatic
delivery until the next human turn. Subscriptions and undelivered updates are in memory
for this MVP and reset on backend restart; delivered messages remain in chat history.

The PM can launch an existing workspace's web app for manual use. A read-only launcher
subagent (`launch_workspace_app`, taking `issueId` and `request`) discovers whether the workspace contains a web app,
its prerequisites, startup commands, ports and readiness endpoints, or asks about
missing configuration. Inside the subagent, `start_app_services` presents the entire plan for approval,
then runs setup and starts the services in dependency order. The checkpointed launcher
resumes after approval, diagnoses failed launches and proposes revised plans for fresh
approval, returning the preview URL to the PM when ready. Changed workspace files
invalidate a plan before execution. `workspace_app_status` reports readiness, errors
and recent output; `stop_workspace_app` stops the session. Servers survive the PM turn
and are owned separately from QA. Sessions are in memory for this MVP. The returned
`previewUrl` is a relative `/preview/<issueId>/...` link through Zini, usable from any
device that can reach Zini. The local `url` is retained for diagnostics. The proxy
streams HTTP bodies and WebSockets, including HMR, to declared loopback services.
The launcher configures supported asset/router bases (e.g. Vite `--base`) and optional
backend routes `{ prefix, serviceId, stripPrefix }`; frontend requests must use URLs
under the preview base, rather than browser-local `localhost` or Zini's root `/api`.
`app.preservePreviewPath` tells the proxy whether the frontend server expects that
base in incoming requests. If this needs source changes, the launcher reports them
instead of editing the repo. Stopping the session removes preview access. Preview
access is unauthenticated in this MVP, as is Zini itself; no tunnel or DNS setup is
created. Any reverse proxy in front of Zini must forward `/preview/` and WebSocket
upgrades. Development Vite also forwards `/preview/` to the backend.

Ahead of the code: opening a pull request, and tearing a workspace down after a merge.

Coordinator steering is available through **Redirect…** on the issue page and the PM's
`redirect_coordinator` tool (`issueId`, `target`, `feedback`). Targets are planner,
coder, reviewer, or QA. It pauses and drains the current run, replaces pending work
or approvals, records feedback, clears downstream results, and reruns the normal
pipeline. Existing workspace edits and history remain. Forward jumps and missing
prerequisites are rejected; new plans and commands still require approval.

All revisions use `/api/coordinator/:issueId/redirect` / `redirect_coordinator`.
The plan revision and completed-work "Send to coder" cards are shortcuts to that
same operation. `/resume` / `reply_to_pipeline` accepts only answers, plan approval,
and command decisions. Completed pipelines have `waiting: null`.
