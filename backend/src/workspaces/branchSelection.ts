import type { WorkspaceChoice, WorkspaceSelection } from "shared";
import type { getPullRequest } from "../integrations/github.js";

type Pull = Awaited<ReturnType<typeof getPullRequest>>;
export class WorkspaceChoiceRequired extends Error {
  constructor(choices: { number: number; title: string; url: string; state: string }[], message = "Choose an existing pull request to resume, or start a fresh branch.") {
    super(message);
    this.choices = choices.map(p => ({ pr: p.number, title: p.title, url: p.url, state: p.state as "open" | "closed" }));
  }
  public choices: WorkspaceChoice[];
}

export function selectWorkspaceBranch(
  suggested: string, target: string, branches: string[], linked: Pull[], exact: Pull | null,
  selection: WorkspaceSelection = {},
) {
  if (selection.fresh && selection.pullRequest !== undefined) throw new Error("Choose a pull request or fresh branch, not both");
  const fresh = () => {
    let branch = suggested;
    for (let n = 2; branches.includes(branch); n++) branch = `${suggested}-${n}`;
    return { branch, target, pull: null, reuse: false };
  };
  const resume = (pull: Pull) => ({ branch: pull.branch, target: pull.base, pull, reuse: true });
  const active = linked.filter(p => p.state === "open");
  const closed = linked.filter(p => p.state === "closed");
  if (selection.fresh) return fresh();
  if (selection.pullRequest !== undefined) {
    const pull = [...linked, ...(exact ? [exact] : [])].find(p => p.number === selection.pullRequest && p.state !== "merged");
    if (!pull) throw new Error("The selected PR is no longer available to resume");
    return resume(pull);
  }
  if (active.length === 1) return resume(active[0]!);
  if (active.length > 1 || closed.length) throw new WorkspaceChoiceRequired(active.length ? active : closed);
  if (linked.some(p => p.state === "merged")) return fresh();
  if (exact?.state === "open") return resume(exact);
  if (exact?.state === "closed") throw new WorkspaceChoiceRequired([exact]);
  if (exact?.state === "merged") return fresh();
  return { branch: suggested, target, pull: null, reuse: branches.includes(suggested) };
}
