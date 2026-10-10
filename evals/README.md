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

Scenario answers and plan approvals remain scripted. Sandbox commands no longer
produce approval pauses, so the existing `commandsApproved` metric is normally zero;
legacy paused checkpoints remain compatible. Unsupported runtimes or configuration
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
