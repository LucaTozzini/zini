# zini

Turn Linear tickets into merged PRs: a Project Lead chat front-end with a Forge that plans, builds, reviews, and ships.

## How it works

1. **Discuss** — talk through a ticket with the Project Lead agent; it sharpens scope and writes the spec.

   This works today: the Project Lead chat reads and writes Linear and the repo's code, and you approve every issue create or update before it runs.

   Each Project Lead chat also has its own browser for HTTP/HTTPS websites, including external
   sites. The browser button in the chat header opens a live, read-only viewer with
   the current URL. Sessions persist between turns until the Project Lead closes its browser,
   the chat is deleted, or the backend restarts. Closing the viewer leaves the
   browser running. The Forge's Reviewer uses the same browser controls and viewer transport but
   continues to open only localhost addresses and closes its browser after each run.
   Browser tools include screenshots the model can see, keyboard input, hover, scrolling,
   drag, native select/checkbox controls, conditional waits, and viewport/media emulation.
   Emulation persists until reset or the browser closes.

2. **Spec** — the spec lands on the Linear issue.

   This works today too: the Project Lead writes the spec onto the issue.

3. **Build** — a Forge spins up an isolated workspace per ticket, where a Lead agent works the ticket end to end with two workers.

   The Lead reads the code (read-only) and the repo's OpenWiki, and writes the plan:
   implementation steps and a QA checklist (behaviour plus code checks such as
   typecheck, lint, tests and the diff's scope). You approve the plan, and every later
   change to its contents; the Lead asks you anything else only when it can't decide. It
   then delegates briefs to the Coder (edits files, runs commands, resolves merge
   conflicts) and marks steps done. Its `commit` tool commits with its message and then
   merges the latest default branch; every commit sets the QA checks back to todo. The
   Reviewer tests the committed code against the checklist (commands, services, TLS and
   a headless browser you can watch live) and is the only one that marks the checks,
   reporting findings outside the checklist to the Lead. The Lead's `finish` is refused
   until every step is complete, every check passed or was skipped, and everything is
   committed on top of the latest default branch. All three keep their conversations
   (compacted when long); commands run inside Docker without per-command approval.

   The Reviewer's browser runs inside the workspace container. Project Lead chats keep their browser on the host.

4. **Ship** — a PR is created; the workspace is torn down after merge.

   This is the intended end state, and it isn't built. The Forge stops once the Lead finishes; you can message it for changes, and you push its commits explicitly from the Forge panel. No pull request is opened, and nothing is torn down on merge: you delete the workspace yourself, which removes the container, Linux workspace and runtime volumes, the host marker folder, the setup log, the Forge's conversations and the run logs.

## Backend source layout

`backend/src/index.ts` starts the HTTP server, and `db.ts` configures SQLite.
The remaining files are grouped by responsibility:

| Folder | Contents |
| --- | --- |
| `routes/` | Express endpoints |
| `models/` | Sequelize models |
| `auth/` | Access-token session lookup and authenticated request identity |
| `forge/` | The Forge's Lead and workers, their tools, history, and subscriptions |
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
the Forge's Lead with its Coder and Reviewer, questions and plan approval; the diff view, logs,
live Reviewer browser, persistent previews, and explicit commit/push. Worker commands run
automatically inside Docker. See
[sandbox setup and lifecycle](sandbox/README.md).

The Project Lead automatically follows Forges it starts. Its
`forge_subscription` tool can subscribe to other issues or unsubscribe.
`list_forges` discovers existing workspaces and Forge status, with a
`subscribed` flag per issue and an optional `subscribedOnly` filter for this chat.
The Project Lead can pause running work with `pause_forge` and continue paused or
interrupted work with `continue_forge` when requested. Continuation is available
after cancellation drains and uses the saved checkpoint; questions and approvals still
go through `reply_to_forge`.
Meaningful progress, questions, approvals, failures and
completion appear as Forge activity messages and wake the Project Lead when the chat is
idle. The Forge emits lifecycle events directly; token and file updates only refresh
the webapp. Subscriptions and a source-agnostic Project Lead message queue live in SQLite.
Updates wait while the Project Lead is busy or awaiting approval. Stop cancels the current
chat turn; future Forge events can wake it again.
The queue claims messages per chat and marks them delivered once their input is saved
in the conversation, retaining event IDs to prevent duplicate enqueueing. On restart,
unfinished claims are retried; conversation message IDs prevent duplicate input if a
crash occurred between saving and acknowledgement. Recovery assumes one backend process.
`GET /api/project-lead/subscriptions` lists subscribed chats as `{ threadId, forgeIds }[]`.

Changing the repository in Settings requires confirmation: all tracked workspaces,
their Docker containers and volumes, and Forge history/logs are deleted. Local changes
and unpushed commits are lost. Running Forges must be paused and app launches stopped
first. The new repository is cloned and validated before cleanup starts; workspace
creation and Forge starts cannot race the switch. A cleanup failure leaves the old
repository setting in place, but workspaces already deleted cannot be restored.

The Project Lead can launch an existing workspace's web app for manual use. A read-only launcher
subagent (`launch_workspace_app`, taking `issueId` and `request`) discovers whether the workspace contains a web app,
its prerequisites, startup commands, ports and readiness endpoints, or asks about
missing configuration. The launcher executes its setup and server plan inside the workspace sandbox, diagnoses startup failures and returns the preview URL to the Project Lead when ready. Changed workspace files
invalidate a plan before execution. `workspace_app_status` reports readiness, errors
and recent output; `stop_workspace_app` stops the session. Servers survive the Project Lead turn
and are owned separately from the Forge's processes. The gateway owns sessions and keeps the launch plan in a persistent volume. Preview requests and explicit app-status queries reconnect to existing processes on demand, including after backend restarts; there is no background workspace polling. Container restarts recover the plan. The returned
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

To steer a Forge, message its Lead: the issue page's message box (`/api/forge/:issueId/message`)
or the Project Lead's `message_forge` tool, whenever it isn't running or waiting on a
reply (pause it first to change course). `/resume` / `reply_to_forge` accepts answers,
plan approval, or feedback on a proposed plan. Finished Forges have `waiting: null`.

### Development environment variables

Settings provides development variables for the selected GitHub repository. Add a
name and value or import a `.env` file; imports add names and replace matching names.
Values are stored as ordinary rows in SQLite and never returned by the Settings
API. Each row contains repository, name and value. Agents receive names and
configured status only; Settings masks entered values.

Variables are applied before the next workspace command, setup operation or preview
launch. Restart running apps after changing values. Generated PostgreSQL/Redis
connection settings take precedence. Missing provider credentials pause setup and
direct you to Settings. Variable values are not deliberately included in prompts or logs.

### Continuing existing work

Workspace creation uses Linear-linked GitHub PRs in the configured repository. A single open PR resumes its actual head branch and retains its target branch. Multiple open PRs or closed unmerged work require a choice. Completed PRs start a fresh branch; an exact suggested branch without a PR can be resumed. Fork PRs require starting fresh. Existing workspaces are preserved.

Every commit by the Lead merges the latest target branch; it starts by committing nothing, to begin from the latest code. The Lead sees inherited work and merge conflicts and plans only the remaining changes. The Coder resolves conflicts through file tools and controlled resolution tools; the Lead's next commit completes the merge. Merges set the QA checks back to todo, and finishing requires the latest target branch. No force push or automatic publication is performed.

Workspaces record starting context when created. Uncommitted edits in interrupted workspaces are preserved until the Lead commits them.
