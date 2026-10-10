import type { BackendProtocolV2 } from "deepagents";
import { workspaceRequest } from "./workspaceSandbox.js";

export function containerFilesystem(issueId: string, writable = false, notify: () => void = () => {}): BackendProtocolV2 {
  const request = (method: string, args: unknown[]) => workspaceRequest(issueId, "filesystem", { method, args });
  const change = async (method: string, args: unknown[]) => {
    if (!writable) return { error: "Repository is read-only" };
    const result = await request(method, args);
    if (!result.error) notify();
    return result;
  };
  return {
    read: (...args) => request("read", args), readRaw: (...args) => request("readRaw", args),
    ls: (...args) => request("ls", args), glob: (...args) => request("glob", args), grep: (...args) => request("grep", args),
    write: (...args) => change("write", args), edit: (...args) => change("edit", args),
  };
}
