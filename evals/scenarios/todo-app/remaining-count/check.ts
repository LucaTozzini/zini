import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import type { Check } from "../../../harness/types.js";

// With three to-dos, one done, the app says "2 to-dos left", whichever filter is
// selected; with one left, "1 to-do left".
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
  } finally {
    await browser.close();
    await app.stop();
  }
  return failures.length
    ? { passed: false, details: failures.join("\n") }
    : { passed: true, details: "The count shows, follows changes, and ignores the filter." };
};

export default check;
