import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LinearClient } from "@linear/sdk";

type Call = { name: string; args: unknown } | { text: string };

// Script model responses, but run the actual Lead and workers, filesystem tools,
// checkpoints and trusted Docker Git path. No model credentials or network calls.
test(
  "the Lead plans, delegates, resolves conflicts, reviews and finishes only on the latest main",
  {
    skip: process.env.ZINI_DOCKER_TESTS !== "1",
    timeout: 420000,
  },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "zini-forge-integration-"));
    process.env.DB_PATH = join(dir, "db.sqlite");
    const { createTestWorkspace } = await import("../workspaces/testFixtures.js");
    const { git, workspacePath, removeWorkspaceMarker } = await import("../repositories/git.js");
    const { Workspace } = await import("../models/Workspace.js");
    const { initDb, sequelize } = await import("../db.js");
    const { startForge, resumeForge, approvePlan, planApprovalError, getForge, getForgeMessages, forgeRun } =
      await import("./forge.js");
    const { removeSandbox } = await import("../workspaces/workspaceSandbox.js");
    const { checkpointer } = await import("../agents/agents.js");
    const { saveSettings } = await import("../core/settings.js");
    await initDb();
    await saveSettings({ githubRepo: "fixture/repo" });
    const id = "integration-flow";
    const runGit = (args: string[]) => git(["-C", workspacePath(id), ...args]);
    const source = join(dir, "fixture-source");
    const hostGit = async (...args: string[]) =>
      promisify(execFile)("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@localhost", "-C", source, ...args]);
    const originalFetch = globalThis.fetch;
    const both = "grep -q 'issue behavior' file.txt && grep -q 'upstream behavior' file.txt && echo both-behaviors";
    const passed = { checks: [{ id: "Q1", status: "passed", note: "" }], findings: [], questions: [] };
    type Agent = "lead" | "coder" | "reviewer";
    const scripts: Record<Agent, Call[]> = {
      lead: [
        { name: "ask_user", args: { questions: ["Keep both behaviors?"] } },
        { name: "commit", args: {} },
        {
          name: "write_plan",
          args: {
            design: "Keep the inherited issue behavior and main's upstream behavior side by side in file.txt.",
            steps: ["Resolve file.txt preserving issue and upstream behavior"],
            qaChecklist: ["file.txt keeps both behaviors"],
          },
        },
        // Saving the plan ends the Lead's turn, until the user approves it.
        { text: "The plan is ready for your review." },
        { name: "delegate_coder", args: { brief: "Resolve the conflict in file.txt, keeping both behaviors." } },
        { name: "commit", args: { message: "Preserve issue and upstream behavior" } },
        { name: "delegate_reviewer", args: { brief: "Review the conflict resolution." } },
        { name: "finish", args: { summary: "Preserved both behaviors." } },
        { name: "commit", args: {} },
        { name: "delegate_reviewer", args: { brief: "Main moved; review again." } },
        { name: "finish", args: { summary: "Preserved both behaviors." } },
        { text: "Done: both behaviors are preserved." },
      ],
      coder: [
        { name: "write_file", args: { file_path: "/file.txt", content: "issue behavior\nupstream behavior\n" } },
        { name: "resolve_conflict", args: { path: "file.txt" } },
        {
          name: "submit_work",
          args: { report: "Resolved file.txt with both behaviors.", steps: [{ id: "S1", status: "complete" }], questions: [] },
        },
      ],
      reviewer: [
        { name: "run_command", args: { command: both } },
        // Missing its check: sent back as invalid.
        { name: "submit_review", args: { checks: [], findings: [], questions: [] } },
        { name: "submit_review", args: passed },
        { name: "submit_review", args: passed },
      ],
    };
    const requests: Record<Agent, string[]> = { lead: [], coder: [], reviewer: [] };
    const waits: string[] = [];
    let upstreamAdvanced = false;
    try {
      await createTestWorkspace(id, { "file.txt": "baseline\n" });
      const initialHead = (await runGit(["rev-parse", "HEAD"])).trim();
      await Workspace.create({
        issueId: id,
        context: { branch: `test/${id}`, initialHead, targetBranch: "main", sourcePr: null },
      });
      // Seed the issue's implementation, then conflicting upstream work.
      const { workspaceRequest } = await import("../workspaces/workspaceSandbox.js");
      await workspaceRequest(id, "filesystem", { method: "write", args: ["/file.txt", "issue behavior\n"] });
      await runGit(["add", "file.txt"]);
      await runGit(["commit", "-qm", "Inherited issue implementation"]);
      await writeFile(join(source, "file.txt"), "upstream behavior\n");
      await hostGit("add", ".");
      await hostGit("commit", "-qm", "Upstream implementation");
      globalThis.fetch = async (url, init) => {
        if (!String(url).startsWith("https://openrouter.ai/")) return originalFetch(url, init);
        const body = JSON.parse(String(init?.body));
        const tools = new Set(body.tools.map((t: { function: { name: string } }) => t.function.name));
        const agent: Agent | null = tools.has("write_plan")
          ? "lead"
          : tools.has("submit_work")
            ? "coder"
            : tools.has("submit_review")
              ? "reviewer"
              : null;
        assert.ok(agent, "Every model call is the Lead's or a worker's");
        requests[agent].push(JSON.stringify(body.messages));
        const next = scripts[agent].shift();
        if (!next) throw new Error(`The ${agent}'s script ran out: ${JSON.stringify(body.messages.slice(-2))}`);
        const responseId = `fixture-${Object.values(requests).flat().length}`;
        const message =
          "text" in next
            ? { role: "assistant", content: next.text }
            : {
                role: "assistant",
                content: "",
                tool_calls: [
                  {
                    index: 0,
                    id: `call-${responseId}`,
                    type: "function",
                    function: { name: next.name, arguments: JSON.stringify(next.args) },
                  },
                ],
              };
        const finish = "text" in next ? "stop" : "tool_calls";
        if (!body.stream)
          return Response.json({
            id: responseId,
            object: "chat.completion",
            model: "fixture",
            created: 0,
            choices: [{ index: 0, message, finish_reason: finish }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          });
        const chunks = [
          {
            id: responseId,
            object: "chat.completion.chunk",
            model: "fixture",
            choices: [{ index: 0, delta: message, finish_reason: null }],
          },
          {
            id: responseId,
            object: "chat.completion.chunk",
            model: "fixture",
            choices: [{ index: 0, delta: {}, finish_reason: finish }],
          },
        ];
        return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", {
          headers: { "Content-Type": "text/event-stream" },
        });
      };
      const linear = {
        client: {
          rawRequest: async () => ({
            data: {
              issue: {
                id,
                identifier: "TEST-1",
                title: "Preserve both behaviors",
                description: "Preserve both behaviors",
                comments: { nodes: [] },
                attachments: { nodes: [] },
                relations: { nodes: [] },
                inverseRelations: { nodes: [] },
              },
            },
          }),
        },
      } as unknown as LinearClient;
      const run = forgeRun(
        { linear, connection: { provider: "openrouter", key: "test-only" }, model: "fixture" },
        id,
        "Test",
        async () => {
          // Main advances once the first review is in, so the first finish is refused.
          if (requests.reviewer.length >= 3 && !upstreamAdvanced) {
            upstreamAdvanced = true;
            await writeFile(join(source, "later.txt"), "later upstream behavior\n");
            await hostGit("add", ".");
            await hostGit("commit", "-qm", "Later upstream behavior");
          }
          await promisify(execFile)("git", ["-C", join(dir, "repo.git"), "fetch", "-q", "origin"]);
        },
      );
      for await (const _ of await startForge(run, "")) {
        /* drain */
      }
      for (let n = 0; n < 5; n++) {
        const forge = await getForge(id);
        if (forge.waiting) {
          waits.push(forge.waiting.kind);
          for await (const _ of await resumeForge(run, { answers: ["Yes, keep both"] })) {
            /* drain */
          }
        } else if (forge.plan && !forge.planApproved) {
          waits.push(`plan revision ${forge.plan.revision}`);
          assert.equal(await planApprovalError(id, 2), "The plan has changed since: review revision 1");
          assert.equal(await planApprovalError(id, 1), null);
          for await (const _ of await approvePlan(run, 1)) {
            /* drain */
          }
        } else break;
      }
      const forge = await getForge(id);
      assert.deepEqual(waits, ["questions", "plan revision 1"]);
      assert.equal(forge.finished, true);
      assert.deepEqual(
        forge.plan?.steps.map((step) => step.status),
        ["complete"],
      );
      assert.deepEqual(
        forge.plan?.qaChecklist.map((check) => check.status),
        ["passed"],
      );
      assert.ok(
        Object.values(scripts).every((script) => script.length === 0),
        "Every scripted call was made",
      );
      assert.match(requests.lead[2]!, /Yes, keep both/, "The Lead gets the user's answers");
      assert.match(requests.lead[2]!, /stopped on conflicts in: file\.txt/, "Committing merges main and reports conflicts");
      assert.match(requests.lead[3]!, /Saved plan revision 1, not approved yet/, "Saving the plan doesn't wait");
      assert.match(requests.lead[4]!, /I approved plan revision 1/, "Approving tells the Lead");
      assert.match(requests.lead[8]!, /Can't finish yet[\s\S]*latest default branch/, "Finishing needs the latest main");
      assert.match(requests.lead[9]!, /Merged the latest main[\s\S]*back to todo/, "A merge sets the QA checks back to todo");
      assert.match(requests.coder[0]!, /Preserve both behaviors/, "The Coder sees the issue");
      assert.match(requests.coder[0]!, /Resolve the conflict in file\.txt/, "The Coder gets the Lead's brief");
      assert.match(requests.coder[0]!, /S1 \[todo\] Resolve file\.txt/, "The Coder sees the plan's steps");
      assert.match(requests.coder[0]!, /side by side in file\.txt/, "The Coder sees the plan's design");
      assert.match(requests.lead[5]!, /S1: complete/, "The Coder marks the steps it completes");
      assert.match(requests.reviewer[0]!, /Q1: file\.txt keeps both behaviors/, "The Reviewer gets the QA checklist");
      assert.match(requests.reviewer[2]!, /Your report was invalid: Give a result for every QA check/);
      assert.doesNotMatch(requests.reviewer[3]!, /both-behaviors/, "Each review starts a fresh Reviewer");
      assert.equal((await runGit(["status", "--porcelain"])).trim(), "");
      assert.match(await runGit(["show", "HEAD:file.txt"]), /issue behavior\nupstream behavior/);
      assert.equal((await runGit(["show", "HEAD:later.txt"])).trim(), "later upstream behavior");
      const lead = await getForgeMessages(id, "lead");
      const callId = (name: string) => {
        const item = lead.find((entry) => entry.role === "tool" && entry.name === name);
        return item?.role === "tool" ? item.callId : undefined;
      };
      assert.ok(callId("delegate_coder") && callId("delegate_reviewer"), "The Lead's delegations carry their call ids");
      for (const [agent, feed] of [
        ["lead", lead],
        ["coder", await getForgeMessages(id, "coder", callId("delegate_coder"))],
        ["reviewer", await getForgeMessages(id, "reviewer", callId("delegate_reviewer"))],
      ] as const) {
        assert.ok(feed.length > 0 && feed.every((item) => item.agent === agent), `${agent}'s chat loads on its own`);
      }
      assert.equal((await getForgeMessages(id, "coder")).length, 0, "The Coder has no shared thread: each brief is its own");
      assert.equal((await getForgeMessages(id, "reviewer")).length, 0, "Nor does the Reviewer: each review is its own");
    } finally {
      globalThis.fetch = originalFetch;
      await removeSandbox(id);
      await removeWorkspaceMarker(id).catch(() => {});
      checkpointer.db.close();
      await sequelize.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
