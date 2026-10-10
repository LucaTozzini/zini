import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { createAgent, tool } from "langchain";
import { z } from "zod";

test("nested launcher executes inside Docker without approval and recovers startup failures", { skip: process.env.ZINI_DOCKER_TESTS !== "1" }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "zini-launcher-"));
  process.env.DB_PATH = join(dir, "zini.sqlite");
  const { launchWorkspaceApp } = await import("./workspaceApps.js");
  const { Workspace } = await import("../models/Workspace.js");
  const { initDb, sequelize } = await import("../db.js");
  const { createTestWorkspace } = await import("./testFixtures.js");
  const { checkpointer, toolErrors } = await import("../agents/agents.js");
  const { workspaceApps } = await import("./workspaceAppSessions.js");
  const { availableAppPort } = await import("./workspaceAppRuntime.js");
  const issueId = "00000000-0000-4000-8000-000000000001";
  let port = 0;
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
          setup: [{ command: `node setup.cjs`, cwd: "." }],
          services: [{ id: "web", command: `node ${retry && firstAttempt ? "fail.cjs" : "app.cjs"} ${port}`, cwd: ".", port, readiness: "http", path: "/" }],
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
    _llmType() { return "project-lead-test"; }
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
    await initDb();
    await createTestWorkspace(issueId, {
      "README.md": "Library only.\n",
      ".gitignore": "prepared\n",
      "setup.cjs": "require('fs').writeFileSync('prepared','yes');",
      "app.cjs": "require('http').createServer((req,res)=>res.end('app')).listen(Number(process.argv[2]),'127.0.0.1');",
      "fail.cjs": "console.error('Startup failed'); process.exit(1);",
    });
    await Workspace.create({ issueId });
    port = await availableAppPort(issueId);
    assert.equal(report((await build().invoke(input, config("library"))).messages).status, "not_webapp");
    const { workspaceRequest } = await import("./workspaceSandbox.js");
    await workspaceRequest(issueId, "filesystem", { method: "edit", args: ["README.md", "Library only.", "Browser app. Run app.cjs."] });
    const launched = await build().invoke(input, config("auto"));
    const snapshot = await build().graph.getState(config("auto"));
    assert.equal(snapshot.tasks.flatMap(task => task.interrupts).length, 0);
    assert.equal(report(launched.messages).status, "ready");
    assert.equal(report(launched.messages).previewUrl, `/preview/${issueId}/`);
    assert.equal(await workspaceRequest(issueId, "file", { operation: "readText", path: "prepared" }), "yes");
    await workspaceApps.stop(issueId); await workspaceRequest(issueId, "file", { operation: "delete", path: "prepared" });
    retry = true;
    const recovered = await build().invoke(input, config("retry"));
    assert.equal(report(recovered.messages).status, "ready");
  } finally {
    await workspaceApps.stopAll();
    const { removeSandbox } = await import("./workspaceSandbox.js"); await removeSandbox(issueId);
    checkpointer.db.close(); await sequelize.close();
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
