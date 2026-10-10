# Workspace sandbox

Start Docker Desktop and run `npm run sandbox:build` from the repository root before
starting a coordinator or preview. This installs git, Node.js/npm, curl, CA certificates,
and Playwright Chromium in one common Linux image. Rebuild after gateway/image changes;
existing containers keep their image until recreated. No per-repository configuration
or additional application service containers are required.

Each issue uses `zini-workspace-<issueId>`, a dedicated bridge network, a persistent
`zini-workspace-<issueId>-files` volume and a separate runtime/state volume. The `repo`
subdirectory of the files volume is mounted at `/workspace`; source, `.git`, ignored
files, dependencies and build outputs all use Linux storage. Package caches, preview
launch plans and test data use the state volume. No additional database tables are
used. The host keeps only a volume-reference marker for new workspaces. Deletion
through Zini removes containers, the network and both volumes, and the host marker folder.

The trusted backend handles models, credentials and checkpoints. Agent file tools
read, search and edit through the container gateway, with virtual repository paths and
symlink checks. Git operations run in temporary trusted containers mounting the same
files volume. Authentication is sent over stdin only for the requested Git operation;
it never becomes Docker environment, an image layer, a mounted token file or Git config.
The agent container is paused during trusted Git operations. The trusted helper exits
and is removed after each operation, while commits and any conflict state remain in
the files volume. The host's bare repository cache is mounted read-only during clone.
Repository commands run as UID 1000 through `/bin/sh`, with no Linux capabilities,
2 CPUs, 4 GiB memory and 512 processes. Only one authenticated gateway port is published
on host loopback. There is no Docker socket, host home or credential mount. Startup
installs outbound firewall rules before dropping privileges: public package downloads
and Docker's loopback DNS work, while host/private networks, other containers and
metadata endpoints are blocked. IPv6 is disabled. Private registries therefore need
additional explicit networking support in a later version.

Setup, checks, QA commands, HTTP tools, browser sessions and preview servers use this
runtime. Docker failure blocks execution; there is no host command fallback. Plan
approval, questions and explicit commit/push remain. Unsupported language runtimes or
missing configuration are reported for user input. QA cleanup stops its own process
groups and browser contexts; preview processes have separate ownership. The host proxy
forwards HTTP and WebSockets through the gateway only to declared preview services.

Workspace volumes must be initialized by the backend's clone operation before use.
There is no Windows bind-mount or worktree migration path. Trusted Git rejects
executable config extensions, symlinked Git metadata and external object stores,
and disables hooks, credential helpers, fsmonitor and untrusted system/global config.
A helper-owned temporary config permits only its read-only /source cache for Git's
local clone transport.

Use the PM `sync_workspace` tool or `POST /api/workspaces/:issueId/sync` with
`{"merge":false}` to fetch, or `{"merge":true}` to merge the configured default branch.
Pause the coordinator first. Merging refuses unfinished edits, preserves commit history,
and leaves conflicts for resolution. Source revision checks invalidate prior validation
and source-backed facts on subsequent pipeline runs. Git mutations and container
lifecycle operations use workspace locks; credentials use the backend's configured
GitHub repository URL rather than sandbox-controlled remotes.

Run backend tests normally for unit coverage. To run real Docker integration checks:

```powershell
$env:ZINI_DOCKER_TESTS='1'
node --import tsx --test --test-concurrency=1 backend/src/repositories/workspaceGit.test.ts backend/src/workspaces/workspaceSandbox.test.ts backend/src/workspaces/workspaceApps.test.ts
```
