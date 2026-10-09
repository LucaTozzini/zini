import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { createAgent, tool } from "langchain";
import { Command } from "@langchain/langgraph";
import { z } from "zod";

test("nested launcher pauses, resumes without reinspection and blocks rejected/stale commands", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zini-launcher-"));
  process.env.DB_PATH = join(dir, "zini.sqlite");
  const { launchWorkspaceApp } = await import("./workspaceApps.js");
  const { Workspace } = await import("./models/Workspace.js");
  const { initDb, sequelize } = await import("./db.js");
  const { git, workspacePath } = await import("./git.js");
  const { checkpointer, toolErrors } = await import("./agents.js");
  const { workspaceApps } = await import("./workspaceAppSessions.js");
  const { availableAppPort } = await import("./workspaceAppRuntime.js");
  const issueId = "00000000-0000-4000-8000-000000000001", root = workspacePath(issueId);
  const port = await availableAppPort();
  let reads = 0;
  let retry = false;
  class Launcher extends BaseChatModel {
    _llmType() { return "launcher-test"; }
    bindTools() { return this; }
    async _generate(messages: BaseMessage[]) {
      const previous = messages.at(-1);
      let name = "read_file", args: Record<string, unknown> = { file_path: "/README.md" };
      const start = () => {
        name = "start_app_services";
        const firstAttempt = !messages.some(m => AIMessage.isInstance(m) && m.tool_calls?.some(call => call.name === name));
        args = { issueId, revision: /Workspace revision: (\w+)/.exec(messages.find(m => m.type === "system")!.text)![1], plan: {
          setup: [{ command: `"${process.execPath}" setup.cjs`, cwd: "." }],
          services: [{ id: "web", command: `"${process.execPath}" ${retry && firstAttempt ? "fail.cjs" : "app.cjs"} ${port}`, cwd: ".", port, readiness: "http", path: "/" }],
          app: { serviceId: "web", path: "/" },
        } };
      };
      if (ToolMessage.isInstance(previous) && previous.name === "read_file") {
        reads++;
        if (previous.text.includes("Browser app")) {
          start();
        } else { name = "submit_app_launch_report"; args = { status: "not_webapp", explanation: "Library only.", questions: [], sources: ["README.md"] }; }
      } else if (ToolMessage.isInstance(previous) && previous.name === "start_app_services") {
        const ready = previous.text.includes('"status":"ready"');
        if (retry && previous.text.includes('"status":"failed"')) start();
        else {
          name = "submit_app_launch_report";
          args = { status: ready ? "ready" : "needs_input", explanation: previous.text, questions: ready ? [] : ["How should we revise the plan?"], sources: ["README.md"] };
        }
      }
      return { generations: [{ text: "", message: new AIMessage({ content: "", tool_calls: [{ id: `${name}-${messages.length}`, name, args }] }) }] };
    }
  }
  class Pm extends BaseChatModel {
    _llmType() { return "pm-test"; }
    bindTools() { return this; }
    async _generate(messages: BaseMessage[]) {
      const message = ToolMessage.isInstance(messages.at(-1)) ? new AIMessage("Done") : new AIMessage({ content: "", tool_calls: [{ id: "launch", name: "launch_workspace_app", args: { request: "Run the app." } }] });
      return { generations: [{ text: message.text, message }] };
    }
  }
  const build = () => createAgent({ model: new Pm({}), checkpointer, middleware: [toolErrors], tools: [
    tool(async ({ request }: { request: string }, config) => JSON.stringify(await launchWorkspaceApp(new Launcher({}), issueId, request, config.signal)), {
      name: "launch_workspace_app", description: "Launch the app.", schema: z.object({ request: z.string() }),
    }),
  ] });
  const config = (id: string) => ({ configurable: { thread_id: id }, durability: "sync" as const, recursionLimit: 100 });
  const report = (messages: BaseMessage[]) => JSON.parse(messages.filter(ToolMessage.isInstance).at(-1)!.text);
  const input = { messages: [{ role: "user" as const, content: "Run it" }] };
  try {
    await initDb(); await mkdir(root, { recursive: true }); await git(["init", "--quiet", root]);
    await writeFile(join(root, "README.md"), "Library only.\n");
    await writeFile(join(root, ".gitignore"), "prepared\n");
    await writeFile(join(root, "setup.cjs"), "require('fs').writeFileSync('prepared','yes');");
    await writeFile(join(root, "app.cjs"), "require('http').createServer((req,res)=>res.end('app')).listen(Number(process.argv[2]),'127.0.0.1');");
    await writeFile(join(root, "fail.cjs"), "console.error('Startup failed'); process.exit(1);");
    await git(["-C", root, "add", "."]);
    await git(["-C", root, "-c", "user.name=Launcher test", "-c", "user.email=launcher@example.invalid", "commit", "--quiet", "-m", "fixture"]);
    await Workspace.create({ issueId });
    assert.equal(report((await build().invoke(input, config("library"))).messages).status, "not_webapp");
    await writeFile(join(root, "README.md"), "Browser app. Run app.cjs.\n");
    await build().invoke(input, config("approve"));
    const paused = await build().graph.getState(config("approve"));
    const pending = paused.tasks.flatMap(task => task.interrupts)[0]!.value as { actionRequests: { name: string }[] };
    assert.equal(pending.actionRequests[0]!.name, "start_app_services");
    assert.equal(existsSync(join(root, "prepared")), false);
    const beforeResume = reads;
    const launched = await build().invoke(new Command({ resume: { decisions: [{ type: "approve" }] } }), config("approve"));
    assert.equal(reads, beforeResume, "Approval resume must not repeat inspection");
    assert.equal(report(launched.messages).status, "ready");
    assert.equal(report(launched.messages).previewUrl, `/preview/${issueId}/`);
    assert.equal(existsSync(join(root, "prepared")), true);
    await workspaceApps.stop(issueId); await rm(join(root, "prepared"));
    await build().invoke(input, config("reject"));
    const rejected = await build().invoke(new Command({ resume: { decisions: [{ type: "reject", message: "Don't run these commands." }] } }), config("reject"));
    assert.equal(report(rejected.messages).status, "needs_input");
    assert.match(report(rejected.messages).explanation, /Don't run these commands/);
    assert.equal(existsSync(join(root, "prepared")), false);
    retry = true;
    await build().invoke(input, config("retry"));
    await build().invoke(new Command({ resume: { decisions: [{ type: "approve" }] } }), config("retry"));
    const retried = await build().graph.getState(config("retry"));
    const retryPending = retried.tasks.flatMap(task => task.interrupts)[0]!.value as { actionRequests: { args: { plan: { services: { command: string }[] } } }[] };
    assert.match(retryPending.actionRequests[0]!.args.plan.services[0]!.command, /app.cjs/);
    assert.equal(workspaceApps.status(issueId).status, "failed", "A revised launch still needs fresh approval");
    const recovered = await build().invoke(new Command({ resume: { decisions: [{ type: "approve" }] } }), config("retry"));
    assert.equal(report(recovered.messages).status, "ready");
    await workspaceApps.stop(issueId); await rm(join(root, "prepared")); retry = false;
    await build().invoke(input, config("stale"));
    await writeFile(join(root, "README.md"), "Browser app. Changed configuration.\n");
    const stale = await build().invoke(new Command({ resume: { decisions: [{ type: "approve" }] } }), config("stale"));
    assert.equal(report(stale.messages).status, "needs_input");
    assert.match(report(stale.messages).explanation, /Workspace changed/);
    assert.equal(existsSync(join(root, "prepared")), false);
  } finally {
    await workspaceApps.stopAll(); checkpointer.db.close(); await sequelize.close();
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
