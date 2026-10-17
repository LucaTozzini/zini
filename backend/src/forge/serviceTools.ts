import { tool } from "langchain";
import { z } from "zod";
import { SERVICE_REQUEST, provisionWorkspaceServices, configureWorkspaceEnvironment, provisionWorkspaceTls } from "../workspaces/workspaceServices.js";

// The workspace's services, for the workers that run commands: databases, local TLS and
// test configuration, shared by every command and app in the workspace.
export function serviceTools(id: string) {
  return [
    tool(async ({ bindings }) => provisionWorkspaceTls(id, bindings), {
      name: "generate_tls_certificates",
      description: "Generate or reuse a workspace-local development PEM certificate/private key for localhost. Persist outside Git; return paths only. Inject TLS_KEY/TLS_CERT and NODE_EXTRA_CA_CERTS into commands and previews. Optional bindings map repo-specific env names to key/cert paths. Use for local HTTPS; never ask users for their personal development certificates.",
      schema: z.object({ bindings: z.record(z.string(), z.enum(["key", "cert"])).optional() }),
    }),
    tool(async ({ services }, config) => provisionWorkspaceServices(id, services, config.signal), {
      name: "provision_services",
      description: "Provision or reuse dedicated workspace PostgreSQL/Redis, wait for authenticated health checks, and inject local test connection variables into all commands/app processes. Defaults: PostgreSQL 16, Redis 7. Services persist through retries; never resets data. Use bindings for repo-specific env names. No production credentials are used.",
      schema: z.object({ services: z.array(SERVICE_REQUEST).min(1).max(2) }),
    }),
    tool(async ({ values }) => configureWorkspaceEnvironment(id, values), {
      name: "configure_environment",
      description: "Persist repo-specific local test configuration (e.g. NODE_ENV=test) for all workspace commands/apps. Services supply generated connection credentials. Never put production/provider secrets here or invent missing external credentials.",
      schema: z.object({ values: z.record(z.string(), z.string()).refine((values) => Object.keys(values).length <= 32) }),
    }),
  ];
}
