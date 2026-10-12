# Evals

Runs the Forge pipeline on repeatable test issues and records model/tool usage,
validation evidence, elapsed time and hidden-check results.

The trusted harness runs on the host in a separate process per run, with a temporary
SQLite database and independent repository clone in a Linux Docker volume. Repository setup, checks, QA,
preview servers and Chromium run inside that run's workspace Docker sandbox, using
the same image, gateway, tools and cleanup as normal forges. Provider credentials
remain in the trusted harness; they are never mounted or passed to workspace commands.
There is no Docker socket mount or Docker-in-Docker.

## Running

Start Docker Desktop and connect the Forge provider/model in Zini. From the
Evals page select a scenario and repeat count. The backend builds `sandbox/Dockerfile`
and starts `evals/run.ts` on the host. It supplies the selected model and provider
credentials only to the trusted runner. ChatGPT access tokens are refreshed by the
backend in a temporary host file; refresh tokens remain with the backend.

You can also run the trusted harness with `node --import tsx evals/run.ts all --repeat 1`
from the repository root after `npm run sandbox:build`. Set `EVAL_MODEL` and either
`OPENROUTER_API_KEY`, or `EVAL_PROVIDER=chatgpt` and `CHATGPT_TOKEN_FILE`.

Scenario answers and plan approvals remain scripted. Sandbox commands run without
approval pauses. Unsupported runtimes or configuration
failures still surface as blocked validation or questions.

Each run has its own container, network, files volume, runtime volume and database.
Containers and both volumes are removed on completion, timeout or cancellation; the backend also performs
batch cleanup if a harness process is interrupted. Temporary run folders are kept
under `evals/.work/` for diagnosis and may be removed after runs stop. CLI runs default
to a temporary system folder and perform the same sandbox cleanup.

## Results

Results stay in `evals/results/<repo>/<scenario>/<batch>/run-N/`:

- `logs/`: live Forge role logs
- `diff.patch`: workspace changes before hidden checks
- `validation.json`: setup evidence, Reviewer-executed checks, review decision and QA report
- `metrics.json`: timing, tokens, tool calls, questions, plan approvals, QA verdict,
  hidden-check result, `codeVersion` and `rateLimited`

Each batch also saves `console.log` in its batch directory, containing the complete
console output across runs, including errors and hidden checks. Webapp batches also
include image-build progress and cleanup errors. `console-result.json` records the
batch outcome. The Evals page keeps only the latest 500 lines in memory, restores the
latest saved output after a backend restart, and links to the full log for past batches.
Restoring output does not resume an interrupted eval process.

`codeVersion` includes Forge sources and sandbox runtime/image files. The Evals
page still compares batches and displays hidden checks and diffs. Model rate limits
save the interrupted run and stop the remaining batch. Success requires a completed
pipeline, passing QA and no failed hidden check.

## Scenarios

`repos/<repo>/` contains each fixture project. Every run creates a fresh Git repository,
then applies the optional scenario patch. Dependencies are installed inside its sandbox
before execution unless `preinstalledDependencies: false` exercises pipeline setup.

`scenarios/<repo>/<name>/scenario.json` supplies the issue title, description, optional
patch and scripted answers. An optional `check.ts` receives container-backed `readFile`
and `runCommand` helpers, `startApp` and `launchBrowser`. Hidden-check code remains trusted on the host; its app
and browser execute inside the sandbox. HTTP checks use a temporary authenticated
loopback proxy (`app.url`); browser checks use the container-local `app.browserUrl`.
Fixture data lives in the persistent runtime volume, outside tracked source.

Linear is stubbed with the scenario issue. Runs do not use GitHub.

## Continuation and integration scenarios

Scenarios can supply `branchPatch` to seed committed inherited work, `upstreamPatch` to advance main before Forge starts, and `upstreamAfterCoderPatch` to advance it at the second upstream checkpoint. The latter runs after coder for normal implementations, or at the final checkpoint when a completed inherited implementation skips coder. The harness refreshes a controlled local upstream while using production merge/commit logic; no live Linear or GitHub credentials are needed.

The continuation scenarios cover partial and complete implementations, initial conflicts, and upstream advancement with and without a coder round. Their hidden checks cover both inherited behavior and upstream preservation. Existing scenarios remain the baseline.

Runs also save `zini.diff.patch` (changes since the initial head) and `git.json` (initial/final heads, commit history, latest integration, validated revision, refresh count and unfinished Git state). A completed run with dirty files or a pending merge fails the harness. Scenario patch contents contribute to `codeVersion`.

## Agent tests

An agent test runs one Forge agent once, from a fixed starting point, instead of the
whole pipeline: `agents/<repo>/<name>/agent.json` names the role (only `reviewer` so far),
the issue, the patches for main (`patch`) and the issue branch (`branchPatches`,
committed one by one), a `state` file of pipeline state (e.g. the approved plan) and a
`history` file of the agent's earlier conversation, standing in for what it remembers.
Its `check.ts` gets the run's log and the submitted document as well as the workspace,
so it can check how the agent worked, not just what it decided.

Run them from the Evals page's Agent tests tab, or with
`node --import tsx evals/run.ts --agents todo-app/review-repair --repeat 1`. Results go to
`results/agents/<repo>/<name>/<batch>/run-N/`, with `document.json` (what the agent
submitted) next to the usual files.

## PostgreSQL and Redis

`todo-app/postgres-redis` adds a SQL-backed todo statistics API and Redis cache to the fixture through a scenario patch. Dependencies start uninstalled. Interactive setup must provision PostgreSQL 16 and Redis 7, install locked dependencies, migrate, seed, verify fixtures and probe backend readiness. The issue fixes an incorrect remaining count. Hidden checks use real SQL and Redis clients to verify counts, caching, invalidation and app-restart persistence; the original file-backed API must remain available.

Services belong to each eval workspace and are removed with its sandbox, including their data volumes. They have no host-published ports or production credentials. Existing scenarios don't request services and continue using their original fixtures.

## TLS and HTTPS

`todo-app/https` requires the todo server to serve HTTPS with `TLS_KEY` and `TLS_CERT`, starting without installed dependencies. Reviewer must generate workspace-local certificates, install dependencies and verify HTTPS readiness. The issue adds remaining-todo counts; Reviewer runs checks and QA exercises the real HTTPS UI/API. Hidden checks require a trusted TLS connection, reject plain HTTP, verify the HTTPS preview proxy and test count behavior. Certificates are supplied by Reviewer, never by the hidden check.
