import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { inspectElements } from "./browserInspection.js";

test("browser inspection reads actual styles, field state and absence without clicking", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<style>.highlight { color: rgb(180, 20, 30); font-weight: 700; }</style>
      <button class="highlight" onclick="this.textContent='clicked'">Notice</button>
      <input type="checkbox" checked disabled><div hidden>Hidden</div>`);
    const highlighted = await inspectElements(page.locator("button")) as { count: number; elements: { text: string; visible: boolean; style: { color: string; fontWeight: string } }[] };
    assert.equal(highlighted.count, 1);
    assert.equal(highlighted.elements[0]?.text, "Notice");
    assert.equal(highlighted.elements[0]?.visible, true);
    assert.equal(highlighted.elements[0]?.style.color, "rgb(180, 20, 30)");
    assert.equal(highlighted.elements[0]?.style.fontWeight, "700");
    const field = await inspectElements(page.locator("input")) as { elements: { checked: boolean; disabled: boolean }[] };
    assert.equal(field.elements[0]?.checked, true);
    assert.equal(field.elements[0]?.disabled, true);
    assert.deepEqual(await inspectElements(page.locator(".missing")), { count: 0, elements: [] });
    const hidden = await inspectElements(page.locator("div")) as { elements: { visible: boolean }[] };
    assert.equal(hidden.elements[0]?.visible, false);
    assert.equal(await page.locator("button").textContent(), "Notice");
  } finally { await browser.close(); }
});
