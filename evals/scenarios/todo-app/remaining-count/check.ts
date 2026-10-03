import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import type { Check } from "../../../harness/types.js";

// With three to-dos, one done, the app says "2 to-dos left", whichever filter is
// selected; with one left, "1 to-do left"; with every one done, "0 to-dos left" (the
// issue hides it only when there are no to-dos at all, and then it's gone).
const check: Check = async ({ startApp }) => {
  const dataFile = join(mkdtempSync(join(tmpdir(), "eval-data-")), "todos.json");
  const todo = (title: string, done: boolean) => ({
    id: title,
    title,
    done,
    createdAt: new Date().toISOString(),
  });
  writeFileSync(dataFile, JSON.stringify([todo("a", false), todo("b", false), todo("c", true)]));

  const app = await startApp({ dataFile });
  const browser = await chromium.launch();
  const failures: string[] = [];
  try {
    const page = await browser.newPage();
    await page.goto(app.url);
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
        details: "The count shows, follows changes, ignores the filter, shows 0 when all are done, and hides with no to-dos.",
      };
};

export default check;
