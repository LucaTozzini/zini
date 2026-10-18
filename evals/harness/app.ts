import { createServer, request } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { workspaceApps } from "../../backend/src/workspaces/workspaceAppSessions.js";
import { availableAppPort } from "../../backend/src/workspaces/workspaceAppRuntime.js";
import { ensureSandbox, workspaceRequest } from "../../backend/src/workspaces/workspaceSandbox.js";
import type { RunningApp } from "./types.js";

// Hidden check code stays trusted on the host. Only the repository app executes
// inside Docker; a temporary loopback proxy, through the workspace gateway's /app
// pass-through, makes it reachable by the check.
export async function startApp(
  issueId: string,
  { dataFile, protocol = "http" }: { dataFile?: string; protocol?: "http" | "https" } = {},
): Promise<RunningApp> {
  const port = await availableAppPort(issueId);
  const file = `${createHash("sha256")
    .update(dataFile ?? String(Date.now()))
    .digest("hex")}.json`;
  const dataPath = await workspaceRequest<string>(issueId, "checkData", {
    file,
    content: dataFile && existsSync(dataFile) ? await readFile(dataFile, "utf8") : undefined,
  });
  const state = await workspaceApps.launch(issueId, {
    setup: [],
    services: [
      { id: "web", cwd: ".", command: `PORT=${port} DATA_FILE=${dataPath} npm run dev`, port, readiness: protocol, path: "/" },
    ],
    app: { serviceId: "web", path: "/" },
  });
  if (state.status !== "ready") throw new Error(`Hidden check app failed: ${state.error}\n${state.output}`);
  const sandbox = await ensureSandbox(issueId);
  const server = createServer((req, res) => {
    const upstream = request(
      {
        hostname: "127.0.0.1",
        port: sandbox.port,
        path: `/app${req.url}`,
        method: req.method,
        headers: { ...req.headers, "x-workspace-token": sandbox.token },
      },
      (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      },
    );
    upstream.on("error", () => res.destroy());
    req.pipe(upstream);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    browserUrl: `${protocol}://127.0.0.1:${port}`,
    stop: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      await workspaceApps.stop(issueId);
    },
  };
}
