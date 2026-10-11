# zini

Turn Linear tickets into merged PRs: a Project Lead chat front-end with an agent pipeline that plans, builds, reviews, and ships.

## How it works

1. **Discuss** — talk through a ticket with the Project Lead agent; it sharpens scope and writes the spec.

   This works today: the Project Lead chat reads and writes Linear and the repo's code, and you approve every issue create or update before it runs.

   Each Project Lead chat also has its own browser for HTTP/HTTPS websites, including external
   sites. The browser button in the chat header opens a live, read-only viewer with
   the current URL. Sessions persist between turns until the Project Lead closes its browser,
   the chat is deleted, or the backend restarts. Closing the viewer leaves the
   browser running. QA uses the same browser controls and viewer transport but
   continues to open only localhost addresses and closes its browser after each run.
   Browser tools include screenshots the model can see, keyboard input, hover, scrolling,
   drag, native select/checkbox controls, conditional waits, and viewport/media emulation.
   Emulation persists until reset or the browser closes.

2. **Spec** — the spec lands on the Linear issue.

   This works today too: the Project Lead writes the spec onto the issue.

3. **Build** — a Forge spins up an isolated workspace per ticket and runs the agent pipeline: plan → code → environment setup → checks → review → QA.

   Environment setup selects repository-defined dependency installation, fixtures and
   readiness commands before each check round. Commands run automatically inside the workspace Docker sandbox. If setup
   fails or needs configuration, the pipeline pauses there for your answer; checks
   and review wait until preparation succeeds. Reusable setup instructions live in
   the source-validated runbook.

   All four stages work. The QA works out how to run the software from the repo itself (its CI config, scripts and README), then tests the changes: it runs the project's checks, starts the app, calls its APIs and uses its UI in a headless browser you can watch live. Commands run inside Docker without per-command approval; plan approval and explicit commit/push remain. What it finds broken goes back to the coder.

   The QA browser runs inside the workspace container. Project Lead chats keep their browser on the host.

4. **Ship** — a PR is created; the workspace is torn down after merge.

   This is the intended end state, and it isn't built. The pipeline stops after QA, with no pending reply; revisions use redirect, and you then commit and push the branch yourself from the pipeline panel, where a committer agent writes the commit message for you to edit before you press Commit & push. No pull request is opened, and nothing is torn down on merge: you delete the workspace yourself, which removes the container, Linux workspace and runtime volumes, the host marker folder, the setup log, the pipeline conversation and the run logs.

## Backend source layout

`backend/src/index.ts` starts the HTTP server, and `db.ts` configures SQLite.
The remaining files are grouped by responsibility:

| Folder | Contents |
| --- | --- |
| `routes/` | Express endpoints |
| `models/` | Sequelize models |
| `auth/` | Access-token session lookup and authenticated request identity |
| `forge/` | Pipeline execution, history, steering, QA, and subscriptions |
| `projectLead/` | Project Lead conversations, notes, and Forge updates |
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

What works today: the Project Lead chat; an independent Git clone and Docker sandbox per issue;
the plan → code → environment setup → checks → review → QA pipeline with questions and
plan approval; the diff view, logs, live QA browser, persistent previews, and explicit
commit/push. Setup, check and QA commands run automatically inside Docker. See
[sandbox setup and lifecycle](sandbox/README.md).

The Project Lead automatically follows Forges it starts. Its
`forge_subscription` tool can subscribe to other issues or unsubscribe.
`list_forges` discovers existing workspaces and Forge status, with a
`subscribed` flag per issue and an optional `subscribedOnly` filter for this chat.
The Project Lead can pause running work with `pause_forge` and continue paused or
interrupted work with `continue_forge` when requested. Continuation is available
after cancellation drains and uses the saved checkpoint; questions and approvals still
go through `reply_to_pipeline`.
Meaningful progress, questions, approvals, failures and
completion appear as Forge activity messages and wake the Project Lead when the chat is
idle. The pipeline emits lifecycle events directly; token and file updates only refresh
the webapp. Subscriptions and a source-agnostic Project Lead message queue live in SQLite.
Updates wait while the Project Lead is busy or awaiting approval. Stop cancels the current
chat turn; future Forge events can wake it again.
The queue claims messages per chat and marks them delivered once their input is saved
in the conversation, retaining event IDs to prevent duplicate enqueueing. On restart,
unfinished claims are retried; conversation message IDs prevent duplicate input if a
crash occurred between saving and acknowledgement. Recovery assumes one backend process.
`GET /api/project-lead/subscriptions` lists subscribed chats as `{ threadId, forgeIds }[]`.

The Project Lead can launch an existing workspace's web app for manual use. A read-only launcher
subagent (`launch_workspace_app`, taking `issueId` and `request`) discovers whether the workspace contains a web app,
its prerequisites, startup commands, ports and readiness endpoints, or asks about
missing configuration. The launcher executes its setup and server plan inside the workspace sandbox, diagnoses startup failures and returns the preview URL to the Project Lead when ready. Changed workspace files
invalidate a plan before execution. `workspace_app_status` reports readiness, errors
and recent output; `stop_workspace_app` stops the session. Servers survive the Project Lead turn
and are owned separately from QA. The gateway owns sessions and keeps the launch plan in a persistent volume. Backend restarts reconnect to existing processes; container restarts recover the plan. The returned
`previewUrl` is a relative `/preview/<issueId>/...` link through Zini, usable from any
device that can reach Zini. The local `url` is retained for diagnostics. The proxy
streams HTTP bodies and WebSockets, including HMR, to declared loopback services.
The launcher configures supported asset/router bases (e.g. Vite `--base`) and optional
backend routes `{ prefix, serviceId, stripPrefix }`; frontend requests must use URLs
under the preview base, rather than browser-local `localhost` or Zini's root `/api`.
`app.preservePreviewPath` tells the proxy whether the frontend server expects that
base in incoming requests. If this needs source changes, the launcher reports them
instead of editing the repo. Stopping the session removes preview access. Preview
access is unauthenticated in this MVP; no tunnel or DNS setup is created.
All `/api` endpoints except `POST /api/users/login` require a signed-in user.
Chat messages use the username
from the access-token session, including optimistic messages and author highlighting.
Conversations remain shared, and previously saved authors are preserved.
Any reverse proxy in front of Zini must forward `/preview/` and WebSocket
upgrades. Development Vite also forwards `/preview/` to the backend.

Ahead of the code: opening a pull request, and tearing a workspace down after a merge.

Forge steering is available through **Redirect…** on the issue page and the Project Lead's
`redirect_forge` tool (`issueId`, `target`, `feedback`). Targets are planner,
coder, reviewer, or QA. It pauses and drains the current run, replaces pending work
or approvals, records feedback, clears downstream results, and reruns the normal
pipeline. Existing workspace edits and history remain. Forward jumps and missing
prerequisites are rejected; new plans still require approval.

All revisions use `/api/forge/:issueId/redirect` / `redirect_forge`.
The plan revision and completed-work "Send to coder" cards are shortcuts to that
same operation. `/resume` / `reply_to_pipeline` accepts only answers, plan approval,
and command decisions. Completed pipelines have `waiting: null`.
