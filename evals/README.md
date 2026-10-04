# Evals

Runs the coordinator's pipeline (planner, coder, deterministic checks, reviewer, product QA) on test issues, the same
way each time, so you can measure how it behaves and compare a change against a baseline.

Each run takes a scenario's issue, works on a fresh copy of a test repo, answers every
pause by itself (questions with the scenario's answers, then "You decide."; it approves
the plan and every check/product QA command), and stops when the pipeline finishes. Because
every command is approved, runs only happen in a Docker container, where they can't
reach your machine.

## Running

Needs Docker Desktop running, OpenRouter connected in zini, and the coordinator's model
set (or `EVAL_MODEL`).

Evals are started from the webapp's **Evals** page: pick a repo, a scenario and how many
runs, and start. One eval runs at a time. zini's backend builds the image
(`evals/Dockerfile`), then runs the scenario in a container (`evals/run.ts`). Its output
shows on the page as it goes: each subagent, its tool calls and what the harness
answers, then a summary of the batch.

## Results

The page lists past batches with their summary, each run's hidden check and what it
changed; select two batches to compare them (e.g. against a baseline from before a
change). They're kept in `evals/results/<repo>/<scenario>/<batch>/run-N/`:

- `logs/`: the subagents' run logs, as zini writes them, written live
- `diff.patch`: what the run changed in the repo
- `metrics.json`: time, model and tool calls, tokens, per subagent and in total, the
  pauses answered, the QA's verdict, and the hidden check's result. New runs include
  `codeVersion`, a SHA-256 hash of the sources actually copied into the container
  (including uncommitted changes), and `rateLimited`.

The pipeline runs selected deterministic checks between coding and review, then
product QA checks acceptance criteria. Check results are recorded directly by the
executor and tied to the workspace content version. The repo supplies commands and
working directories; the coordinator does not assume a language or package manager.

A model rate limit saves the interrupted run and stops the batch before subsequent
runs start. Batch failures and rate limits produce nonzero exits and a failed status
in the webapp. A hidden check passing is not enough for a successful run: the pipeline
must complete and return a passing QA report. Partial validation is reported separately.

## Test repos and scenarios

- `repos/<repo>/`: a small project, copied fresh into each run as a git repo with one
  commit. Its dependencies are installed when the image is built.
- `scenarios/<repo>/<name>/`: a scenario for that repo.
  - `scenario.json`: the issue's `title` and `description`. Optionally a `patch` in the
    folder, applied before the first commit (e.g. a planted bug), and `answers` to the
    subagents' questions.
  - `check.ts`: optional, a hidden check the subagents never see, run on the result (see
    `harness/types.ts`).

The pipeline gets the scenario's issue from a stand-in for Linear, and nothing in a run
uses GitHub.
