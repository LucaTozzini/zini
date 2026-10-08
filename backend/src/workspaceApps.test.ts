import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";

test("launcher reads current workspace files and returns non-webapp or a launch plan without executing commands", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zini-launcher-discovery-"));
  process.env.DB_PATH = join(dir, "zini.sqlite");
  const { inspectWorkspaceApp } = await import("./workspaceApps.js");
  const { Workspace } = await import("./models/Workspace.js");
  const { initDb, sequelize } = await import("./db.js");
  const { git, workspacePath } = await import("./git.js");
  const { checkpointer } = await import("./agents.js");
  const issueId = "00000000-0000-4000-8000-000000000001";
  const root = workspacePath(issueId);
  class Model extends BaseChatModel {
    _llmType() { return "local-launcher-test"; }
    bindTools() { return this; }
    async _generate(messages: BaseMessage[]) {
      const previous = messages.at(-1);
      const read = ToolMessage.isInstance(previous) && previous.name === "read_file";
      const webapp = read && previous.text.includes("Browser app");
      const message = new AIMessage({ content: "", tool_calls: [{
        id: read ? "submit" : "read",
        name: read ? "submit_app_launch_plan" : "read_file",
        args: read ? {
          status: webapp ? "webapp" : "not_webapp", explanation: "From the workspace README.", questions: [], sources: ["README.md"],
          plan: webapp ? { setup: [], services: [{ id: "web", command: "npm run dev -- --port 45678", cwd: ".",
            port: 45678, readiness: "http", path: "/" }], app: { serviceId: "web", path: "/" } } : null,
        } : { file_path: "/README.md" },
      }] });
      return { generations: [{ text: "", message }] };
    }
  }
  try {
    await initDb(); await mkdir(root, { recursive: true });
    await git(["init", "--quiet", root]);
    await writeFile(join(root, "README.md"), "Library only. No browser interface.\n");
    await git(["-C", root, "add", "."]);
    await git(["-C", root, "-c", "user.name=Launcher test", "-c", "user.email=launcher@example.invalid", "commit", "--quiet", "-m", "fixture"]);
    await Workspace.create({ issueId });
    const model = new Model({});
    const library = await inspectWorkspaceApp(model, issueId, "Inspect the workspace.");
    assert.equal(library.status, "not_webapp"); assert.equal(library.plan, null);
    // An uncommitted branch change must be read, rather than default-branch content.
    await writeFile(join(root, "README.md"), "Browser app. Start with npm run dev -- --port 45678.\n");
    const app = await inspectWorkspaceApp(model, issueId, "Inspect again.");
    assert.equal(app.status, "webapp"); assert.equal(app.plan?.services[0]?.port, 45678);
    assert.notEqual(app.revision, library.revision);
    assert.equal(app.session.status, "stopped");
  } finally {
    checkpointer.db.close(); await sequelize.close();
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
