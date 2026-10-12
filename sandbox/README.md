# Workspace sandbox

Start Docker Desktop and run `npm run sandbox:build` from the repository root before
starting a Forge or preview. This installs git, Node.js/npm, curl, CA certificates,
and Playwright Chromium in one common Linux image. Rebuild after gateway/image changes;
existing containers keep their image until recreated. PostgreSQL and Redis are optional
per-workspace service containers provisioned on request by Forge setup.

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
and Docker's loopback DNS work, while host/private networks, unrelated containers and
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

Use the Project Lead `sync_workspace` tool or `POST /api/workspaces/:issueId/sync` with
`{"merge":false}` to fetch, or `{"merge":true}` to merge the configured default branch.
Pause the Forge first. Merging refuses unfinished edits, preserves commit history,
and leaves conflicts for resolution. Source revision checks invalidate prior validation
and source-backed facts on subsequent pipeline runs. Git mutations and container
lifecycle operations use workspace locks; credentials use the backend's configured
GitHub repository URL rather than sandbox-controlled remotes.

Run backend tests normally for unit coverage. To run real Docker integration checks:

```powershell
$env:ZINI_DOCKER_TESTS='1'
node --import tsx --test --test-concurrency=1 backend/src/repositories/workspaceGit.test.ts backend/src/workspaces/workspaceSandbox.test.ts backend/src/workspaces/workspaceApps.test.ts
```

### Workspace test services

Forge setup can request PostgreSQL 16/17 and Redis 7 through `provision_services`.
The host provisions dedicated, ownership-labelled containers and data volumes on
the workspace network, waits for an authenticated SQL query/Redis PING, and permits
only those service IPs and ports through the workspace's private-network firewall.
Database ports are not published to the host. Services persist across Forge pauses,
retries and gateway restarts; workspace deletion and eval cleanup remove them.

Generated test connection variables (`DATABASE_URL`, `PG*`, `REDIS_URL`, `REDIS_*`)
and optional repo-specific bindings are injected into commands, QA and previews.
`configure_environment` supplies other local test settings; runtime/gateway overrides
are rejected. Configuration lives outside tracked source in the installation's
workspace-services metadata and gateway runtime volume. After changing gateway code,
rebuild the image and recreate development gateway containers using their existing
workspace and runtime volumes.

Setup uses `run_setup` for installations, migrations, seeds and fixture verification,
and `check_app` for HTTP readiness. Submission is checked against actual successful
tool results and current service health. Preparation is capped at 32 operations per
turn. Successful commands on the same revision are reused;
explicit reruns support changed test data/configuration. Required external secrets
remain blockers; source defects return to coder.

Development provider credentials belong in Settings â†’ Development environment
variables for the selected repository. Setup and preview agents see names/status
only. Each command/launch refreshes the injected environment; running servers need
a restart after changes. Generated service settings override repository variables,
which override setup's local options. The host stores repository/name/value rows in
SQLite. Settings never returns stored values to the browser, and agents receive
configured names only.

Credential regression coverage uses synthetic values only:

```powershell
$env:ZINI_DOCKER_TESTS='1'
node --import tsx --test backend/src/core/developmentEnvironment.test.ts backend/src/workspaces/developmentEnvironment.test.ts backend/src/forge/integrationFlow.test.ts
$env:ZINI_BROWSER_TESTS='1'
node --import tsx --test webapp/tests/developmentEnvironment.browser.test.ts
```

The Forge integration test runs the actual graph and Docker tools with scripted
model responses. It pauses setup for a missing development variable, configures
the variable outside the conversation, resumes through QA and verifies that model
prompts and pipeline documents contain no secret value.

### Local development TLS

Setup's `generate_tls_certificates` creates/reuses one self-signed localhost PEM
certificate and private key in `/state/dev-tls`, outside Git. It returns paths only.
Defaults are `TLS_KEY`, `TLS_CERT` and `NODE_EXTRA_CA_CERTS`; optional bindings map
repo-specific environment names to key/cert paths. These generated paths override
repository Settings. Files persist in the runtime volume and disappear with the
workspace. No host certificate installation or certificate uploads are required.

Readiness checks, QA HTTP tools and previews support local HTTPS. Preview services
use `readiness: "https"`; HTTPS upstream WebSockets also work. Self-signed
certificates are accepted by Zini's loopback HTTP client and isolated QA browser;
external Project Lead browsing keeps normal certificate verification.

```powershell
$env:ZINI_DOCKER_TESTS='1'
node --import tsx --test backend/src/workspaces/workspaceTls.test.ts
```
