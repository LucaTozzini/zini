import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Check } from "../../../harness/types.js";

// With three to-dos, one done, the app says "2 to-dos left", whichever filter is
// selected; with one left, "1 to-do left"; with every one done, "0 to-dos left" (the
// issue hides it only when there are no to-dos at all, and then it's gone).
const check: Check = async ({ startApp, launchBrowser, runCommand }) => {
  const dataFile = join(mkdtempSync(join(tmpdir(), "eval-data-")), "todos.json");
  const todo = (title: string, done: boolean) => ({
    id: title,
    title,
    done,
    createdAt: new Date().toISOString(),
  });
  writeFileSync(dataFile, JSON.stringify([todo("a", false), todo("b", false), todo("c", true)]));

  const app = await startApp({ dataFile, protocol: "https" });
  const browser = await launchBrowser();
  const failures: string[] = [];
  try {
    const tls = await runCommand(`node --input-type=module -e 'import https from "node:https";import assert from "node:assert/strict";assert.equal(process.env.TLS_KEY,"/state/dev-tls/key.pem");assert.equal(process.env.TLS_CERT,"/state/dev-tls/cert.pem");assert.equal(process.env.NODE_EXTRA_CA_CERTS,process.env.TLS_CERT);assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED,"0");const request=https.get("${app.browserUrl}/api/todos",response=>{assert.equal(response.socket.authorized,true);assert.ok(response.socket.getProtocol().startsWith("TLS"));assert.equal(response.statusCode,200);let body="";response.on("data",chunk=>body+=chunk);response.on("end",()=>{assert.equal(JSON.parse(body).length,3);console.log("Verified trusted TLS connection and real API");});});request.on("error",error=>{console.error(error.message);process.exitCode=1;});'`);
    if (tls.exitCode !== 0) throw new Error(`Strict TLS verification failed: ${tls.output}`);
    const plaintext = await runCommand(`node --input-type=module -e 'import assert from "node:assert/strict";const accepted=await fetch("${app.browserUrl.replace("https:", "http:")}/api/todos").then(()=>true,()=>false);assert.equal(accepted,false,"Plain HTTP must not be accepted");'`);
    if (plaintext.exitCode !== 0) throw new Error(`HTTPS-only verification failed: ${plaintext.output}`);
    const page = await browser.newPage({ ignoreHTTPSErrors: true });
    await page.goto(app.browserUrl);
    const shows = async (text: string, when: string) => {
      const found = await page
        .getByText(text)
        .first()
        .waitFor({ timeout: 5_000 })
        .then(() => true, () => false);
      if (!found) failures.push(`Expected "${text}" ${when}`);
    };
    await shows("2 to-dos left", "with two of three to-dos not done");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await shows("2 to-dos left", 'with the "Done" filter selected');
    await page.getByRole("button", { name: "All", exact: true }).click();
    // A click, not check(): the box only changes once the API has answered.
    await page.getByRole("checkbox").first().click();
    await shows("1 to-do left", "after ticking one of the two");
    await page.getByRole("checkbox").nth(1).click();
    await shows("0 to-dos left", "with every to-do done (it's only hidden when there are none)");

    // Every to-do deleted (through the API, so the check doesn't depend on the list's
    // buttons), then the page reloaded: no count at all.
    for (const id of ["a", "b", "c"]) await fetch(`${app.url}/api/todos/${id}`, { method: "DELETE" });
    await page.reload();
    await page.getByRole("heading").first().waitFor({ timeout: 5_000 });
    await page.waitForTimeout(1_000);
    if ((await page.getByText(/\d+ to-dos? left/).count()) > 0) {
      failures.push("Expected no count with no to-dos at all");
    }
  } finally {
    await browser.close();
    await app.stop();
  }
  return failures.length
    ? { passed: false, details: failures.join("\n") }
    : {
        passed: true,
        details: "Workspace-generated trusted TLS, HTTPS browser/API access and preview proxy verified; count follows changes and filters, shows zero when all done, and hides when empty.",
      };
};

export default check;
