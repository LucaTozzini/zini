import type { LinearClient } from "@linear/sdk";
import { AsyncLocalStorageProviderSingleton } from "@langchain/core/singletons";
import type { AgentRole } from "shared";
import { getLinearClient } from "../integrations/linear.js";
import { chatModel, loadConnection, type ModelConnection } from "../providers/modelProvider.js";
import { getSetting } from "../core/settings.js";
import { sendEvent } from "../core/events.js";
import { PipelineExecution } from "./execution.js";

// What every Forge agent needs to run, shared by the Lead (forge.ts) and its workers
// (workers.ts).

export type Setup = {
  linear: LinearClient;
  connection: ModelConnection;
  model: string;
};

// What the Forge needs to run, or what's missing.
export async function loadSetup(): Promise<Setup | string> {
  const [linear, provider, model] = await Promise.all([
    getLinearClient(),
    getSetting("forgeProvider"),
    getSetting("forgeModel"),
  ]);
  if (!linear) return "Linear isn't connected";
  const connection = await loadConnection(provider);
  if (typeof connection === "string") return connection;
  if (!model) return "No Forge model set";
  return { linear, connection, model };
}

// The Forge model is shared by the Lead and its workers.
// Our middleware owns retries, and must stop immediately on model rate limits.
export const forgeModel = (setup: Setup) => chatModel(setup.connection, setup.model, { maxRetries: 0 });

// One Forge per issue, so the issue id is enough to find it: the Lead's conversation is
// on this thread, and each worker's on its own.
export const forgeThreadId = (issueId: string) => `forge:${issueId}`;
export const workerThreadId = (issueId: string, role: "coder" | "reviewer") => `forge:${issueId}:${role}`;

// What running the Forge needs. Absent when it's only read (getPipeline).
export type Run = {
  setup: Setup;
  issueId: string;
  notify: () => void;
  signal?: AbortSignal;
  execution: PipelineExecution;
  username?: string;
  // Fetches the target branch before merging it (evals stand in for GitHub).
  refreshUpstream?: () => Promise<void>;
};

// A run of the issue's Forge, which tells every connected webapp whenever it changes.
export const pipelineRun = (setup: Setup, issueId: string, username?: string, refreshUpstream?: () => Promise<void>): Run => ({
  setup,
  issueId,
  username,
  refreshUpstream,
  execution: new PipelineExecution(),
  notify: () => sendEvent({ type: "forge.updated", issueId }),
});

// The worker the Lead delegated to, by issue, while it works.
export const working = new Map<string, AgentRole>();

// Runs start outside whatever LangGraph run calls them, e.g. a project lead tool's, or the
// Lead's for its workers. Inside one, the run would join it as a subgraph, saving its
// checkpoints under that run's namespace (where getPipeline doesn't look) and sharing
// its callbacks.
export const outsideAgentRun = <T>(start: () => T) =>
  AsyncLocalStorageProviderSingleton.getInstance().run(undefined, start);
