import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LinearClient } from "@linear/sdk";

// Script model responses, but run the actual Forge graph, filesystem tools,
// checkpoints and trusted Docker Git path. No model credentials or network calls.
test("Forge resumes conflicts through planner/coder, commits, and revalidates after upstream movement", {
  skip: process.env.ZINI_DOCKER_TESTS !== "1", timeout: 420000,
}, async () => {
  const dir = await mkdtemp(join(tmpdir(), "zini-forge-integration-"));
  process.env.DB_PATH = join(dir, "db.sqlite");
  const { createTestWorkspace } = await import("../workspaces/testFixtures.js");
  const { git, workspacePath, removeWorkspaceMarker } = await import("../repositories/git.js");
  const { workspaceRevision } = await import("../workspaces/workspaceFiles.js");
  const { Workspace } = await import("../models/Workspace.js");
  const { initDb, sequelize } = await import("../db.js");
  const { startPipeline, resumePipeline, getPipeline, pipelineRun } = await import("./forge.js");
  const { removeSandbox } = await import("../workspaces/workspaceSandbox.js");
  const { checkpointer } = await import("../agents/agents.js");
  const { saveSettings } = await import("../core/settings.js");
  const { saveDevelopmentEnvironment } = await import("../core/developmentEnvironment.js");
  await initDb();
  await saveSettings({ githubRepo: "fixture/repo" });
  const id = "integration-flow";
  const runGit = (args: string[]) => git(["-C", workspacePath(id), ...args]);
  const source = join(dir, "fixture-source");
  const hostGit = async (...args: string[]) => promisify(execFile)("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@localhost", "-C", source, ...args]);
  const originalFetch = globalThis.fetch;
  const stages: string[] = [];
  const prompts: string[] = [];
  let coderCalls = 0;
  let reviewCalls = 0;
  let qaCalls = 0;
  let refreshes = 0;
  let credentialPauses = 0;
  let upstreamAdvanced = false;
  const credential = "synthetic-forge-dev-token-123";
  const setupEntry = { id: "dev-credential", kind: "setup", cwd: ".", command: "node -e 'if(!process.env.DEV_TOKEN)process.exit(1);console.log(\"credential available\")'", purpose: "Verify development credential injection", sources: ["file.txt"] };
  try {
    await createTestWorkspace(id, { "file.txt": "baseline\n" });
    const initialHead = (await runGit(["rev-parse", "HEAD"])).trim();
    await Workspace.create({ issueId: id, context: { branch: `test/${id}`, initialHead, targetBranch: "main", sourcePr: {
      number: 1, url: "https://github.com/fixture/repo/pull/1", title: "Inherited work", body: "Preserve both behaviors", state: "open",
    } } });
    // Seed an existing PR implementation, then conflicting upstream work.
    const { workspaceRequest } = await import("../workspaces/workspaceSandbox.js");
    await workspaceRequest(id, "filesystem", { method: "write", args: ["/file.txt", "issue behavior\n"] });
    await runGit(["add", "file.txt"]); await runGit(["commit", "-qm", "Inherited issue implementation"]);
    await writeFile(join(source, "file.txt"), "upstream behavior\n"); await hostGit("add", "."); await hostGit("commit", "-qm", "Upstream implementation");
    globalThis.fetch = async (url, init) => {
      if (!String(url).startsWith("https://openrouter.ai/")) return originalFetch(url, init);
      const body = JSON.parse(String(init?.body));
      const submit = body.tools.find((t: { function: { name: string } }) => t.function.name.startsWith("submit_"))?.function.name;
      assert.ok(submit, "Every agent must expose its submission tool");
      stages.push(submit); prompts.push(JSON.stringify(body.messages));
      if (stages.length > 60) {
        process.stderr.write(`Scripted model loop: ${stages.slice(-5).join(", ")} ${JSON.stringify(body.messages.slice(-2))}\n`);
        throw new Error("Scripted model did not finish");
      }
      // Reviewer and QA documents also take runbookUpdates.
      const common = { blockingQuestions: [] };
      const validation = { ...common, runbookUpdates: [] };
      const reviewed = { ...validation, preexistingFailures: [] };
      let name = submit;
      let args: unknown;
      if (submit === "submit_plan") args = { ...common, summary: "Preserve issue and upstream behavior", existingImplementation: "Inherited issue behavior in file.txt; validate it too",
        steps: coderCalls ? [] : ["Resolve file.txt preserving issue and upstream behavior"],
        acceptanceCriteria: [{ id: "both", requirement: "Preserve both behaviors", source: "Preserve both behaviors" }] };
      else if (submit === "submit_implementation") {
        coderCalls++;
        if (coderCalls === 4) {
          assert.match(JSON.stringify(body.messages.filter((m: { role: string }) => m.role === "system")),
            /Current Reviewer requested changes[\s\S]*Observed startup code defect/, "Repair requests are in Coder system context");
          assert.match(JSON.stringify(body.messages.filter((m: { role: string }) => m.role === "user").at(-1)),
            /Observed startup code defect/, "Repair requests are in the Coder's input too");
        }
        if (coderCalls === 1) { name = "write_file"; args = { file_path: "/file.txt", content: "issue behavior\nupstream behavior\n" }; }
        else if (coderCalls === 2) { name = "resolve_conflict"; args = { path: "file.txt" }; }
        // A repair has to change something (an empty one is sent back).
        else if (coderCalls === 4) { name = "write_file"; args = { file_path: "/startup_fix.txt", content: "Startup defect repaired\n" }; }
        else if (coderCalls === 6) {
          assert.match(JSON.stringify(body.messages.filter((m: { role: string }) => m.role === "system")), /QA reproduced source bug/,
            "Coder receives Reviewer repairs in system context after QA failure");
          name = "write_file"; args = { file_path: "/qa_fix.txt", content: "QA reproduced behavior repaired\n" };
        }
        else args = { ...common, commitMessage: "Preserve issue and upstream behavior", replanReason: "" };
      } else if (submit === "submit_review") {
        reviewCalls++;
        assert.ok(body.tools.some((t: { function: { name: string } }) => t.function.name === "run_setup"), "Reviewer owns preparation");
        assert.ok(!body.tools.some((t: { function: { name: string } }) => t.function.name === "submit_environment_setup"));
        if (reviewCalls === 9) assert.ok(body.messages.some((message: { role: string; content: unknown }) =>
          message.role === "tool" && JSON.stringify(message.content).includes("test -f file.txt")),
          "Reviewer retains diagnostics across QA repair rounds");
        if (reviewCalls === 1) args = { ...reviewed, requiredChanges: ["Observed startup code defect requires a coder repair"] };
        else if (reviewCalls === 2) args = { ...reviewed, requiredChanges: [], blockingQuestions: ["Add DEV_TOKEN in Settings /settings"] };
        else if (reviewCalls === 12) {
          assert.match(JSON.stringify(body.messages.filter((m: { role: string }) => m.role === "user").at(-1)),
            /QA failed on the code you approved/, "After QA fails approved code, Reviewer is told it can't just approve again");
          args = { ...reviewed, requiredChanges: ["QA reproduced source bug: create qa_fix.txt with the repaired product behavior"] };
        }
        else if ([3, 6, 9, 13, 16].includes(reviewCalls)) {
          name = "run_setup";
          const command = setupEntry.command + (reviewCalls === 6 ? " && touch /state/reviewer-ready" : reviewCalls === 9 ? " && touch /state/reviewer-ready /state/qa-ready" : "");
          args = { entry: { ...setupEntry, command } };
        } else if ([4, 5, 7, 10, 14, 17].includes(reviewCalls)) {
          name = "run_check";
          args = { entry: { id: "fixture-check", kind: "check", command: reviewCalls === 5 ? "test -f file.txt" : reviewCalls >= 14 ? "test -f qa_fix.txt && test -f file.txt" : "test -f /state/reviewer-ready", cwd: ".", purpose: "Verify runtime prerequisite", sources: ["file.txt"] } };
        } else args = { ...reviewed, requiredChanges: [] };
      }
      else if (submit === "submit_qa_report") {
        qaCalls++;
        const system = JSON.stringify(body.messages.filter((m: { role: string }) => m.role === "system"));
        if (qaCalls === 3) {
          assert.match(system, /Previous QA report[\s\S]*Product QA observed missing runtime fixture/);
          assert.ok(body.messages.some((m: { role: string }) => m.role === "tool"), "QA retains previous tool observations");
        }
        if (qaCalls === 5) {
          assert.match(system, /Previous QA report[\s\S]*QA reproduced source bug/, "QA findings survive coder commit");
          assert.ok(body.messages.some((m: { role: string; content: unknown }) => m.role === "tool" && JSON.stringify(m.content).includes("code 1")),
            "QA remembers failed reproduction output after source repair");
        }
        if (qaCalls === 7) assert.match(system, /Previous QA report[\s\S]*Both behaviors preserved/, "QA report survives upstream integration");
        if (qaCalls % 2 === 1) { name = "run_command"; args = { command: qaCalls === 1 ? "test -f /state/qa-ready" : "cat qa_fix.txt" }; }
        else args = { ...validation, coverage: [{ criterionId: "both", status: qaCalls === 2 ? "blocked" : qaCalls === 4 ? "fail" : "pass",
          evidence: qaCalls === 2 ? "Missing runtime fixture" : qaCalls === 4 ? "QA reproduced source bug: qa_fix.txt missing" : "Both behaviors preserved and repair retested" }],
          failures: qaCalls === 4 ? ["QA reproduced source bug: qa_fix.txt missing"] : [],
          environmentFailures: qaCalls === 2 ? [{ command: "test -f /state/qa-ready", reason: "Product QA observed missing runtime fixture" }] : [] };
      }
      else throw new Error(`Unexpected role ${submit}`);
      const call = { index: 0, id: `call-${stages.length}`, type: "function", function: { name, arguments: JSON.stringify(args) } };
      const responseId = `fixture-${stages.length}`;
      if (!body.stream) return Response.json({ id: responseId, object: "chat.completion", model: "fixture", created: 0,
        choices: [{ index: 0, message: { role: "assistant", content: "", tool_calls: [{ id: call.id, type: call.type, function: call.function }] }, finish_reason: "tool_calls" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
      const chunks = [{ id: responseId, object: "chat.completion.chunk", model: "fixture", choices: [{ index: 0, delta: { role: "assistant", tool_calls: [call] }, finish_reason: null }] },
        { id: responseId, object: "chat.completion.chunk", model: "fixture", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }];
      return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
    };
    const linear = { client: { rawRequest: async () => ({ data: { issue: {
      id, identifier: "TEST-1", title: "Preserve both behaviors", description: "Preserve both behaviors", comments: { nodes: [] },
    } } }) } } as unknown as LinearClient;
    const run = pipelineRun({ linear, connection: { provider: "openrouter", key: "test-only" }, model: "fixture" }, id, "Test", async () => {
      refreshes++;
      // Main advances at the final readiness checkpoint, after validation.
      if (qaCalls >= 6 && !upstreamAdvanced) {
        upstreamAdvanced = true;
        await writeFile(join(source, "later.txt"), "later upstream behavior\n"); await hostGit("add", "."); await hostGit("commit", "-qm", "Later upstream behavior");
      }
      await promisify(execFile)("git", ["-C", join(dir, "repo.git"), "fetch", "-q", "origin"]);
    });
    for await (const _ of await startPipeline(run, "")) { /* drain */ }
    for (let n = 0; n < 10; n++) {
      const pipeline = await getPipeline(id);
      if (pipeline.finished) break;
      if (pipeline.waiting?.kind === "questions") {
        assert.match(pipeline.waiting.questions.join(" "), /DEV_TOKEN.*Settings/);
        credentialPauses++;
        await saveDevelopmentEnvironment("fixture/repo", [{ name: "DEV_TOKEN", value: credential }]);
        for await (const _ of await resumePipeline(run, { answers: ["DEV_TOKEN is configured in Settings; retry setup"] })) { /* drain */ }
      } else {
        assert.equal(pipeline.waiting?.kind, "approve_plan");
        for await (const _ of await resumePipeline(run, { approve: true })) { /* drain */ }
      }
    }
    const pipeline = await getPipeline(id);
    assert.equal(pipeline.finished, true);
    assert.equal(pipeline.qa?.verdict, "pass");
    assert.equal(credentialPauses, 1, "Missing development credentials pause setup until configured");
    assert.ok(prompts.every(prompt => !prompt.includes(credential)), "Credential values never enter model prompts");
    assert.ok(!JSON.stringify(pipeline).includes(credential), "Pipeline documents contain no credential value");
    assert.equal(pipeline.checks?.revision, await workspaceRevision(id));
    assert.equal(coderCalls, 7, "Coder resolves conflicts and concrete Reviewer/QA source defects");
    assert.ok(prompts.some(prompt => prompt.includes("test -f file.txt") && prompt.includes("passed")), "Reviewer receives the missing check's actual result");
    assert.equal(stages.filter(s => s === "submit_qa_report").length, 8, "QA collects fresh reproduction evidence after environment repair, source repair and upstream movement");
    assert.ok(stages.indexOf("submit_plan") < stages.indexOf("submit_implementation"));
    assert.ok(prompts.some(p => p.includes("Inherited work")));
    assert.ok(prompts.filter(p => p.includes("submit_review") || p.includes("submit_qa_report")).every(p => p.includes("Existing implementation") && p.includes("Preserve both behaviors")));
    assert.equal((await runGit(["status", "--porcelain"])).trim(), "");
    assert.match(await runGit(["show", "HEAD:file.txt"]), /issue behavior\nupstream behavior/);
    assert.equal((await runGit(["show", "HEAD:later.txt"])).trim(), "later upstream behavior");
  } finally {
    globalThis.fetch = originalFetch;
    await removeSandbox(id); await removeWorkspaceMarker(id).catch(() => {});
    checkpointer.db.close(); await sequelize.close(); await rm(dir, { recursive: true, force: true });
  }
});
