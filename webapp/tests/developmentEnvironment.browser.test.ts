import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright";

test("Settings saves masked variables, imports .env and removes entries", { skip: process.env.ZINI_BROWSER_TESTS !== "1", timeout: 60000 }, async () => {
  const server = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), server: { host: "127.0.0.1", port: 5189, strictPort: true } });
  await server.listen();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("pageerror", error => process.stderr.write(`Browser error: ${error.message}\n`));
  let variables: Array<{ name: string; configured: boolean }> = [];
  let saved: unknown;
  try {
    await page.route("http://127.0.0.1:5189/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      let data: unknown = [];
      if (path === "/api/users/me") data = { id: "fixture", username: "Fixture", authority: 1 };
      else if (path === "/api/settings") data = { githubRepo: "fixture/repo", projectLeadProvider: "openrouter", forgeProvider: "openrouter", projectLeadModel: "fixture", forgeModel: "fixture" };
      else if (path === "/api/integrations") data = { github: { connected: true }, linear: { connected: true }, openrouter: { connected: true } };
      else if (path === "/api/chatgpt") data = { connected: false };
      else if (path === "/api/integrations/linear/issues") data = { issues: [] };
      else if (path.startsWith("/api/settings/development-environment")) {
        if (route.request().method() !== "GET") {
          const body = route.request().postDataJSON(); saved = body;
          if (body.content) variables.push({ name: "IMPORT_TOKEN", configured: true });
          else for (const change of body.variables) {
            variables = variables.filter(variable => variable.name !== change.name);
            if (!change.remove) variables.push({ name: change.name, configured: true });
          }
        }
        data = { repository: "fixture/repo", variables };
      }
      await route.fulfill({ json: data });
    });
    await page.goto("http://127.0.0.1:5189/settings");
    await page.getByText("Development environment variables", { exact: true }).waitFor().catch(async error => { process.stderr.write(`Page: ${await page.locator("body").innerText()}\n`); throw error; });
    await page.getByLabel(/^Variable name/).fill("DEV_TOKEN");
    assert.equal(await page.getByLabel(/^Value/).getAttribute("type"), "password");
    await page.getByLabel(/^Value/).fill("synthetic-browser-secret");
    await page.getByRole("button", { name: "Save variable" }).click();
    await page.getByText("DEV_TOKEN · Configured").waitFor();
    assert.deepEqual(saved, { repository: "fixture/repo", variables: [{ name: "DEV_TOKEN", value: "synthetic-browser-secret" }] });
    assert.equal(await page.getByLabel(/^Value/).inputValue(), "");
    assert.ok(!(await page.locator("body").innerText()).includes("synthetic-browser-secret"));
    await page.locator('input[type="file"]').setInputFiles({ name: ".env", mimeType: "text/plain", buffer: Buffer.from("IMPORT_TOKEN=synthetic-import-secret") });
    await page.getByText("IMPORT_TOKEN · Configured").waitFor();
    await page.getByRole("button", { name: "Remove", exact: true }).first().click();
    await page.getByText("DEV_TOKEN · Configured").waitFor({ state: "detached" });
  } finally { await browser.close(); await server.close(); }
});
