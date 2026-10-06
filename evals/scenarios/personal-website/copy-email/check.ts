import { chromium } from "playwright";
import type { Check } from "../../../harness/types.js";

// Clicking the Email card copies me@lucatozzini.com, shows that it was copied, and opens
// nothing (no mailto: tab); the other cards still link out.
const check: Check = async ({ startApp }) => {
  const app = await startApp();
  const browser = await chromium.launch();
  const failures: string[] = [];
  try {
    const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
    const page = await context.newPage();
    let opened = false;
    context.on("page", () => (opened = true));
    await page.goto(app.url);
    const socials = page.locator("#socials");
    await socials.getByText("Email", { exact: true }).click();

    const copied = await page.evaluate<string>("navigator.clipboard.readText()").catch(() => "");
    if (copied.trim() !== "me@lucatozzini.com") {
      failures.push(`The clipboard has ${JSON.stringify(copied)} after clicking Email, expected "me@lucatozzini.com"`);
    }
    const confirmed = await page
      .getByText(/copied/i)
      .first()
      .waitFor({ timeout: 5_000 })
      .then(() => true, () => false);
    if (!confirmed) failures.push('No confirmation mentioning "copied" after clicking Email');
    if (opened) failures.push("Clicking Email opened a new tab");

    const github = await socials.getByRole("link", { name: /GitHub/ }).getAttribute("href").catch(() => null);
    if (github !== "https://github.com/lucatozzini") failures.push(`The GitHub card links to ${github}`);
  } finally {
    await browser.close();
    await app.stop();
  }
  return failures.length
    ? { passed: false, details: failures.join("\n") }
    : { passed: true, details: "Email copies the address and confirms it; the other cards still link out." };
};

export default check;
