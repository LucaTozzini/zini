import type { LinearClient } from "@linear/sdk";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { tool } from "langchain";
import { z } from "zod";
import { diffForModel } from "../forge/tools.js";
import {
  forgeThreadId,
  continueForge,
  getForge,
  loadSetup as loadForgeSetup,
  messageForge,
  outsideAgentRun,
  forgeRun,
  readReply,
  replyFits,
  resumeForge,
  startForge,
} from "../forge/forge.js";
import { Workspace } from "../models/Workspace.js";
import { pauseRun, startRun } from "../agents/runs.js";
import { sendEvent } from "../core/events.js";
import { commitAndPush, createWorkspace } from "../workspaces/workspaces.js";
import { forgeSubscriptions } from "../forge/forgeSubscriptions.js";
import { listForges } from "../forge/listForges.js";
import { launchWorkspaceApp } from "../workspaces/workspaceApps.js";
import { workspaceApps } from "../workspaces/workspaceAppSessions.js";
import { WorkspaceChoiceRequired } from "../workspaces/branchSelection.js";
import { syncWorkspace } from "../repositories/git.js";
import { openWorkspacePullRequest } from "../workspaces/workspacePullRequests.js";
import { ISSUE_ID, toIssueId } from "./linearTools.js";

// Syncing an issue's workspace and running its app.
export function workspaceAppTools(linear: LinearClient, model: BaseChatModel) {
  return [
    tool(async ({ issueId, merge }) => JSON.stringify(await syncWorkspace(await toIssueId(linear, issueId), merge)), {
      name: "sync_workspace",
      description:
        "Fetch the configured GitHub repository into an idle workspace. With merge=true, merge the current default branch while preserving history; refuses unfinished edits and surfaces conflicts. Pause the Forge first. Use merge only when the user requests integrating upstream changes.",
      schema: z.object({ issueId: ISSUE_ID, merge: z.boolean().default(false) }),
    }),
    tool(
      async ({ issueId, request }, config) =>
        JSON.stringify(await launchWorkspaceApp(model, await toIssueId(linear, issueId), request, config.signal)),
      {
        name: "launch_workspace_app",
        description:
          "Delegate getting a workspace web app running to a launcher subagent. It inspects current files, runs setup/server commands inside Docker, launches, checks readiness and diagnoses/retries startup failures. Returns ready with previewUrl (Zini's preview page), not_webapp, needs_input with questions, or failed with diagnostics. Requires a paused/idle Forge. Servers stay running until stopped.",
        schema: z.object({
          issueId: ISSUE_ID,
          request: z
            .string()
            .min(1)
            .describe(
              "Which app to run and any user answers or constraints. The launcher handles command discovery and sandbox startup; do not supply a guessed launch plan.",
            ),
        }),
      },
    ),
    tool(async ({ issueId }) => JSON.stringify(await workspaceApps.refresh(await toIssueId(linear, issueId))), {
      name: "workspace_app_status",
      description:
        "Read the user app session's status, previewUrl (Zini's preview page), its address inside the workspace, startup errors and recent server output.",
      schema: z.object({ issueId: ISSUE_ID }),
    }),
    tool(async ({ issueId }) => JSON.stringify(await workspaceApps.stop(await toIssueId(linear, issueId))), {
      name: "stop_workspace_app",
      description: "Stop all processes in a user app session without stopping Forge or QA processes.",
      schema: z.object({ issueId: ISSUE_ID }),
    }),
  ];
}

// Drive the Forge (see forge.ts) from chat. None of them waits on
// the workspace's setup or the Forge's work: they start it, or say where it's at.
export function forgeTools(linear: LinearClient) {
  const caller = (config: { configurable?: Record<string, unknown> }) => {
    const id = config.configurable?.thread_id;
    if (typeof id !== "string") throw new Error("This tool needs a Project Lead chat");
    return id;
  };
  return [
    tool(
      async ({ issueId, message }, config) => {
        const id = await toIssueId(linear, issueId);
        if (!(await Workspace.findByPk(id))) return JSON.stringify({ status: "error", error: "This issue has no workspace" });
        if (workspaceApps.starting(id)) throw new Error("The user app is still being prepared.");
        const pipeline = await getForge(id);
        if (!pipeline.started) return JSON.stringify({ status: "error", error: "The Forge hasn't started; use start_forge" });
        if (pipeline.waiting)
          return JSON.stringify({
            status: "error",
            error: "The Forge is waiting on a reply; use reply_to_forge",
            waiting: pipeline.waiting,
          });
        const setup = await loadForgeSetup();
        if (typeof setup === "string") return JSON.stringify({ status: "error", error: setup });
        await forgeSubscriptions.subscribe(caller(config), id);
        const run = forgeRun(setup, id, "Project Lead");
        const started = await outsideAgentRun(() =>
          startRun(forgeThreadId(id), (signal) => messageForge(run, message.trim(), signal), run.notify),
        );
        return JSON.stringify(
          started
            ? { status: "sent" }
            : { status: "error", error: "The Forge is running or pausing; pause it and wait for canResume first" },
        );
      },
      {
        name: "message_forge",
        description:
          "Send the Forge's Lead a message with the user's requested changes or corrections, e.g. after it finished. " +
          "Not while it's running (pause_forge first) or waiting on a reply (use reply_to_forge). Automatically subscribes this chat.",
        schema: z.object({
          issueId: ISSUE_ID,
          message: z
            .string()
            .trim()
            .min(1)
            .describe("The user's actionable requested changes, with their context. Not praise or acceptance."),
        }),
      },
    ),
    tool(
      async ({ issueId }) => {
        const id = await toIssueId(linear, issueId);
        if (!pauseRun(forgeThreadId(id))) {
          return JSON.stringify({ status: "error", error: "The Forge isn't running or is already pausing" });
        }
        sendEvent({ type: "forge.updated", issueId: id });
        return JSON.stringify({ status: "pausing" });
      },
      {
        name: "pause_forge",
        description:
          "Pause a running Forge at the user's request. Returns pausing immediately; " +
          "the workspace stays locked until cancellation drains. Use forge_status to check canResume.",
        schema: z.object({ issueId: ISSUE_ID }),
      },
    ),
    tool(
      async ({ issueId }, config) => {
        const id = await toIssueId(linear, issueId);
        const workspace = await Workspace.findByPk(id);
        if (!workspace) {
          return JSON.stringify({ status: "error", error: "This issue has no workspace" });
        }
        if (workspaceApps.starting(id)) throw new Error("The user app is still being prepared.");
        const pipeline = await getForge(id);
        if (!pipeline.canResume) {
          return JSON.stringify({
            status: "error",
            error: pipeline.waiting
              ? "The Forge needs a reply through reply_to_forge, not continuation"
              : "The Forge has no interrupted work to resume",
            waiting: pipeline.waiting,
          });
        }
        const setup = await loadForgeSetup();
        if (typeof setup === "string") return JSON.stringify({ status: "error", error: setup });
        await forgeSubscriptions.subscribe(caller(config), id);
        const run = forgeRun(setup, id, "Project Lead");
        const started = await outsideAgentRun(() =>
          startRun(forgeThreadId(id), (signal) => continueForge(run, signal), run.notify),
        );
        return JSON.stringify(
          started ? { status: "continued" } : { status: "error", error: "The Forge is still running or pausing" },
        );
      },
      {
        name: "continue_forge",
        description:
          "Continue paused or interrupted Forge work from its saved checkpoint at the user's request. " +
          "Requires a workspace and canResume. Does not answer questions or approve plans/commands; " +
          "use reply_to_forge for those. Automatically subscribes this chat to progress updates.",
        schema: z.object({ issueId: ISSUE_ID }),
      },
    ),
    tool(
      async ({ subscribedOnly }, config) => {
        const workspaces = await Workspace.findAll({ order: [["createdAt", "DESC"]] });
        return JSON.stringify(
          await listForges(workspaces, await forgeSubscriptions.list(caller(config)), getForge, subscribedOnly),
        );
      },
      {
        name: "list_forges",
        description:
          "Discover all issues with workspaces, plus issues this Project Lead chat follows. Returns issueId, " +
          "subscribed, hasWorkspace, whether the Forge started, its current running role, " +
          "waiting questions/approvals, completion, errors, resume availability and QA verdict. " +
          "Set subscribedOnly to true to list just this chat's subscriptions. Use forge_status for full reports.",
        schema: z.object({ subscribedOnly: z.boolean().optional() }),
      },
    ),
    tool(
      async ({ action, issueId }, config) => {
        const threadId = caller(config);
        const id = await toIssueId(linear, issueId);
        if (action === "subscribe") {
          await forgeSubscriptions.subscribe(threadId, id);
          const [workspace, pipeline] = await Promise.all([Workspace.findByPk(id), getForge(id)]);
          return JSON.stringify({
            issueIds: await forgeSubscriptions.list(threadId),
            hasWorkspace: Boolean(workspace),
            pipeline,
          });
        }
        await forgeSubscriptions.unsubscribe(threadId, id);
        return JSON.stringify({ issueIds: await forgeSubscriptions.list(threadId) });
      },
      {
        name: "forge_subscription",
        description:
          "Subscribe this Project Lead chat to automatic updates for an issue's workspace and Forge, " +
          "or unsubscribe (also removes queued updates). Subscriptions persist across backend restarts. " +
          "Use list_forges to see subscriptions and discover existing workspaces/forges.",
        schema: z.object({ action: z.enum(["subscribe", "unsubscribe"]), issueId: ISSUE_ID }),
      },
    ),
    tool(
      async ({ issueId, pullRequest, fresh }, config) => {
        const id = await toIssueId(linear, issueId);
        await forgeSubscriptions.subscribe(caller(config), id);
        let result;
        try {
          result = await createWorkspace(linear, id, { pullRequest, fresh });
        } catch (error) {
          if (error instanceof WorkspaceChoiceRequired)
            return JSON.stringify({
              status: "needs_choice",
              choices: error.choices,
              instruction: "Ask the user which PR to resume or whether to start fresh, then retry with pullRequest or fresh.",
            });
          throw error;
        }
        const { workspace } = result;
        if (workspaceApps.starting(id)) throw new Error("The user app is still being prepared.");
        const pipeline = await getForge(workspace.issueId);
        if (pipeline.finished) return JSON.stringify({ status: "finished", pipeline });
        if (pipeline.started) return JSON.stringify({ status: "already_running", pipeline });
        const setup = await loadForgeSetup();
        if (typeof setup === "string") return JSON.stringify({ status: "error", error: setup });
        const run = forgeRun(setup, workspace.issueId, "Project Lead");
        const started = await outsideAgentRun(() =>
          startRun(forgeThreadId(workspace.issueId), (signal) => startForge(run, "", signal), run.notify),
        );
        return JSON.stringify({ status: started ? "started" : "already_running" });
      },
      {
        name: "start_forge",
        description:
          "Build an issue: create its workspace if it has none, and start the Forge " +
          "pipeline. Environment preparation happens in the Forge. Returns a status: started, already_running, " +
          "finished (send changes with message_forge instead) or error.",
        schema: z.object({
          issueId: ISSUE_ID,
          pullRequest: z.number().int().positive().optional(),
          fresh: z.boolean().optional(),
        }),
      },
    ),
    tool(
      async ({ issueId }) => {
        const id = await toIssueId(linear, issueId);
        const [workspace, pipeline] = await Promise.all([Workspace.findByPk(id), getForge(id)]);
        return JSON.stringify({
          hasWorkspace: Boolean(workspace),
          ...pipeline,
        });
      },
      {
        name: "forge_status",
        description:
          "Where an issue's Forge is at: running is the agent working now (lead, coder or " +
          "reviewer), waiting what it needs from the user (questions to answer, or a plan to " +
          "approve), and the plan: its steps and QA checklist with their statuses. Finished " +
          "has waiting: null; changes go through message_forge. Not the code changes.",
        schema: z.object({ issueId: ISSUE_ID }),
      },
    ),
    tool(
      async ({ issueId, path }) => {
        const id = await toIssueId(linear, issueId);
        if (!(await Workspace.findByPk(id))) return "This issue has no workspace.";
        return diffForModel(id, path);
      },
      {
        name: "git_diff",
        description:
          "The changes in an issue's workspace since it branched, uncommitted ones and new " +
          "files included: the list of changed files, then a unified diff. Not the default " +
          "branch that read_file reads. A long diff is cut between files, with a note naming " +
          "the rest; pass a path for one file's (or folder's) diff.",
        schema: z.object({ issueId: ISSUE_ID, path: z.string().optional() }),
      },
    ),
    tool(
      async ({ issueId, message }) => {
        const result = await commitAndPush(await toIssueId(linear, issueId), message ?? "");
        if ("error" in result) return JSON.stringify({ status: "error", error: result.error });
        return JSON.stringify({ status: "pushed", branch: result.workspace.branch });
      },
      {
        name: "commit_and_push",
        description:
          "Commit all of an issue's workspace's uncommitted changes with message, then push " +
          "its branch to GitHub. With nothing uncommitted it only pushes, and message can " +
          "be left out. Not while the Forge is working in the workspace. The user " +
          "approves the call before it runs.",
        schema: z.object({
          issueId: ISSUE_ID,
          message: z.string().optional().describe("Commit message: a short summary line, then a blank line and the details"),
        }),
      },
    ),
    tool(
      async ({ issueId, title, body }) => {
        const result = await openWorkspacePullRequest(await toIssueId(linear, issueId), title, body);
        if ("error" in result) return JSON.stringify({ status: "error", error: result.error });
        return JSON.stringify({ status: "opened", pullRequest: result.pullRequest });
      },
      {
        name: "pull_request_create",
        description:
          "Open a pull request for an issue's workspace into the configured default branch. " +
          "All changes must be committed and pushed first; errors tell you to use commit_and_push before retrying. " +
          "The user approves this call. Returns the PR number, URL and state. The Linear identifier is added to the title automatically.",
        schema: z.object({
          issueId: ISSUE_ID,
          title: z.string().trim().min(1).describe("A short, accurate pull request title"),
          body: z.string().optional().describe("Markdown description covering the change and relevant validation"),
        }),
      },
    ),
    tool(
      async ({ issueId, ...input }) => {
        // Exactly one, so nothing the user approved on the card is left out.
        if (Object.values(input).filter((value) => value !== undefined).length !== 1) {
          return JSON.stringify({
            status: "error",
            error: "Pass exactly one of answers, approve or feedback",
          });
        }
        const id = await toIssueId(linear, issueId);
        const { waiting } = await getForge(id);
        if (!waiting) return JSON.stringify({ status: "not_waiting" });
        const reply = readReply(input);
        if (!reply || !replyFits(waiting, reply)) {
          return JSON.stringify({
            status: "error",
            error: "That reply doesn't fit what the Forge is waiting on",
            waiting,
          });
        }
        const workspace = await Workspace.findByPk(id);
        if (!workspace) {
          return JSON.stringify({ status: "error", error: "This issue has no workspace" });
        }
        if (workspaceApps.starting(id)) throw new Error("The user app is still being prepared.");
        const setup = await loadForgeSetup();
        if (typeof setup === "string") return JSON.stringify({ status: "error", error: setup });
        const run = forgeRun(setup, id, "Project Lead");
        const started = await outsideAgentRun(() =>
          startRun(forgeThreadId(id), (signal) => resumeForge(run, reply, signal), run.notify),
        );
        return JSON.stringify(started ? { status: "resumed" } : { status: "error", error: "The Forge is still running" });
      },
      {
        name: "reply_to_forge",
        description:
          "Reply to what an issue's Forge is waiting on, with exactly one of: " +
          "answers (one per question, in order), approve: true (approve the plan) or " +
          "feedback (what to change in the plan). Other changes use message_forge. Finished " +
          "work needs no reply. The user approves the call before it runs.",
        schema: z.object({
          issueId: ISSUE_ID,
          answers: z.array(z.string()).optional().describe("User answers to waiting.kind=questions, one per question in order."),
          approve: z
            .boolean()
            .optional()
            .describe(
              "Pass true only for user approval of a pending plan (waiting.kind=approve_plan). Not acceptance of finished work.",
            ),
          feedback: z
            .string()
            .optional()
            .describe("The user's requested changes to a pending plan (waiting.kind=approve_plan), instead of approving it."),
        }),
      },
    ),
  ];
}
