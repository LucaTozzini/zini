import { randomUUID } from "node:crypto";
import type { PipelineState } from "shared";

export type ForgeUpdate = {
  eventId: string;
  issueId: string;
  eventType: string;
  content: string;
};
export type ForgeSnapshot = { key: string; eventType: string; content: string };

export function forgeSnapshot(pipeline: PipelineState): ForgeSnapshot | null {
  const state = {
    running: pipeline.running, waiting: pipeline.waiting, finished: pipeline.finished,
    error: pipeline.error, pausing: pipeline.pausing, canResume: pipeline.canResume,
    qa: pipeline.finished ? pipeline.qa : undefined,
  };
  let eventType: string;
  let content: string;
  if (pipeline.error) {
    eventType = "failed"; content = `Forge failed: ${pipeline.error}`;
  } else if (pipeline.finished) {
    eventType = "completed";
    content = `Forge completed. QA verdict: ${pipeline.qa?.verdict ?? "unavailable"}.`;
    if (pipeline.qa?.failures.length) content += `\nFailures:\n${pipeline.qa.failures.join("\n")}`;
    if (pipeline.qa?.couldNotTest.length) content += `\nNot verified:\n${pipeline.qa.couldNotTest.join("\n")}`;
  } else if (pipeline.waiting) {
    eventType = "waiting";
    const waiting = pipeline.waiting;
    content = waiting.kind === "questions" ? `${waiting.from} needs answers:\n${waiting.questions.join("\n")}`
      : waiting.kind === "approve_plan" ? "The plan is ready for your approval."
      : `Commands need your approval:\n${waiting.commands.map((c) => c.command).join("\n")}`;
  } else if (pipeline.pausing || pipeline.canResume) {
    eventType = pipeline.pausing ? "pausing" : "stopped";
    content = pipeline.pausing ? "Forge is pausing." : "Forge stopped with unfinished work. It can be resumed.";
  } else if (pipeline.running) {
    eventType = "stage_changed"; content = `${pipeline.running === "qa" ? "QA" : pipeline.running} started.`;
  } else if (!pipeline.started) {
    eventType = "setup_ready"; content = "Workspace setup is ready. The Forge has not started yet.";
  } else return null; // Internal graph transitions don't need a Project Lead turn.
  return { key: JSON.stringify(state), eventType, content };
}
type Inbox = { issues: Set<string>; queue: ForgeUpdate[]; paused: boolean };

// MVP: subscriptions and undelivered events last only until this backend restarts.
export class ForgeSubscriptions {
  private chats = new Map<string, Inbox>();
  private latest = new Map<string, { key: string; event: ForgeUpdate }>();
  private working = false;

  subscribe(threadId: string, issueId: string) {
    let inbox = this.chats.get(threadId);
    if (!inbox) this.chats.set(threadId, inbox = { issues: new Set(), queue: [], paused: false });
    inbox.paused = false;
    inbox.issues.add(issueId);
  }
  unsubscribe(threadId: string, issueId: string) {
    const inbox = this.chats.get(threadId);
    inbox?.issues.delete(issueId);
    if (inbox) inbox.queue = inbox.queue.filter((event) => event.issueId !== issueId);
    this.prune();
  }
  list(threadId: string) { return [...(this.chats.get(threadId)?.issues ?? [])]; }
  pause(threadId: string) { const inbox = this.chats.get(threadId); if (inbox) inbox.paused = true; }
  resume(threadId: string) { const inbox = this.chats.get(threadId); if (inbox) inbox.paused = false; }
  forget(threadId: string) { this.chats.delete(threadId); this.prune(); }
  private prune() {
    const watched = new Set([...this.chats.values()].flatMap((inbox) => [...inbox.issues]));
    for (const id of this.latest.keys()) if (!watched.has(id)) this.latest.delete(id);
  }

  async tick(read: (issueId: string) => Promise<ForgeSnapshot | null>,
    deliver: (threadId: string, events: ForgeUpdate[]) => Promise<boolean>,
    onError: (error: unknown) => void = (error) => { console.error("Forge subscription failed:", error); }) {
    if (this.working) return;
    this.working = true;
    try {
      const issues = new Set([...this.chats.values()].flatMap((inbox) => [...inbox.issues]));
      for (const issueId of issues) {
        try {
          const snapshot = await read(issueId);
          if (!snapshot || this.latest.get(issueId)?.key === snapshot.key) continue;
          const event = { eventId: randomUUID(), issueId, eventType: snapshot.eventType, content: snapshot.content };
          this.latest.set(issueId, { key: snapshot.key, event });
          for (const inbox of this.chats.values()) if (inbox.issues.has(issueId)) inbox.queue.push(event);
        } catch (error) { onError(error); }
      }
      for (const [threadId, inbox] of this.chats) {
        if (inbox.paused || !inbox.queue.length) continue;
        const batch = [...inbox.queue];
        try {
          if (await deliver(threadId, batch)) {
            const delivered = new Set(batch.map((event) => event.eventId));
            inbox.queue = inbox.queue.filter((event) => !delivered.has(event.eventId));
          }
        } catch (error) { onError(error); }
      }
    } finally { this.working = false; }
  }
}

export const forgeSubscriptions = new ForgeSubscriptions();
