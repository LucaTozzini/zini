import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RoleMetrics, RunMetrics } from "shared";

// Metrics for one eval run, from its run logs (one JSON Lines file per subagent run; see
// backend/src/coordinator/runLog.ts) and what the harness saw.

type LogEvent = {
  t: string;
  event: string;
  name?: string;
  outcome?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
};

const emptyRole = (): RoleMetrics => ({
  runs: 0,
  seconds: 0,
  modelCalls: 0,
  toolCalls: 0,
  toolCallsByName: {},
  inputTokens: 0,
  outputTokens: 0,
  errors: 0,
});

// Each role's metrics, from the logs in logDir (named <time>-<role>.jsonl).
export function roleMetrics(logDir: string) {
  const roles: Record<string, RoleMetrics> = {};
  const files = readdirSync(logDir).filter((file) => file.endsWith(".jsonl")).sort();
  for (const file of files) {
    const role = file.replace(/\.jsonl$/, "").split("-").at(-1)!;
    const events = readFileSync(join(logDir, file), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as LogEvent);
    if (events.length === 0) continue;
    const metrics = (roles[role] ??= emptyRole());
    // Runs paused for approval, then resumed, are one log: their time includes the wait.
    metrics.runs++;
    metrics.seconds += (Date.parse(events.at(-1)!.t) - Date.parse(events[0]!.t)) / 1000;
    for (const event of events) {
      if (event.event === "model_reply") {
        metrics.modelCalls++;
        metrics.inputTokens += event.usage?.input_tokens ?? 0;
        metrics.outputTokens += event.usage?.output_tokens ?? 0;
      } else if (event.event === "tool_call" && event.name) {
        metrics.toolCalls++;
        metrics.toolCallsByName[event.name] = (metrics.toolCallsByName[event.name] ?? 0) + 1;
      } else if (event.event === "model_error" || (event.event === "end" && event.outcome === "error")) {
        metrics.errors++;
      }
    }
  }
  return roles;
}

export function totals(roles: Record<string, RoleMetrics>): RunMetrics["totals"] {
  const sum = (key: "seconds" | "modelCalls" | "toolCalls" | "inputTokens" | "outputTokens" | "errors") =>
    Object.values(roles).reduce((total, role) => total + role[key], 0);
  return {
    seconds: sum("seconds"),
    modelCalls: sum("modelCalls"),
    toolCalls: sum("toolCalls"),
    inputTokens: sum("inputTokens"),
    outputTokens: sum("outputTokens"),
    errors: sum("errors"),
  };
}
