import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { Response } from "express";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { browserAddress, browserTools } from "./browserTools.js";
import { addViewer, browserState, closeBrowser, getPage } from "./agentBrowser.js";

test("PM browser opens external pages, persists per chat, streams frames and closes independently of QA", async () => {
  assert.equal(browserAddress("https://example.com", true).hostname, "example.com");
  assert.throws(() => browserAddress("https://example.com"), /Only addresses on this machine/);
  assert.throws(() => browserAddress("file:///etc/passwd", true), /Only HTTP and HTTPS/);
  const key = "pm:browser-test";
  const qaKey = "browser-test";
  let notifications = 0;
  const tools = browserTools(key, () => notifications++, { external: true });
  const call = (name: string, args: Record<string, unknown>) =>
    (tools.find((tool) => tool.name === name)! as StructuredToolInterface).invoke(args);
  const server = createServer(async (_req, res) => {
    if (!await addViewer(key, res as Response)) { res.statusCode = 404; res.end(); }
  });
  try {
    const { page } = await getPage(key);
    await page.route("https://zini-browser.example/**", (route) => route.fulfill({
      contentType: "text/html", body: '<title>External site</title><button onclick="this.textContent=\'Clicked\'">Try me</button>',
    }));
    assert.match(String(await call("browser_open", { url: "https://zini-browser.example/" })), /External site/);
    assert.match(String(await call("browser_click", { role: "button", name: "Try me" })), /Clicked/);
    const session = browserState(key);
    assert.equal(session.url, "https://zini-browser.example/");
    assert.equal((await getPage(key)).page, page);
    assert.equal((await getPage(qaKey)).page.url(), "about:blank");
    assert.notEqual(browserState(qaKey).sessionId, session.sessionId);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const stream = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(10_000) });
    assert.match(stream.headers.get("content-type")!, /multipart\/x-mixed-replace/);
    const reader = stream.body!.getReader();
    const frame = await reader.read();
    assert.match(Buffer.from(frame.value!).toString("latin1"), /Content-Type: image\/jpeg/);
    await reader.cancel();
    await call("browser_close", {});
    assert.deepEqual(browserState(key), { url: null, sessionId: null });
    assert.equal((await getPage(qaKey)).page.url(), "about:blank");
    await getPage(key);
    assert.notEqual(browserState(key).sessionId, session.sessionId);
    assert.equal(notifications, 3);
  } finally {
    await Promise.all([closeBrowser(key), closeBrowser(qaKey)]);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("browser tools interact, wait, emulate and return real screenshot image content", async () => {
  const key = "pm:browser-controls-test";
  const tools = browserTools(key, () => {}, { external: true });
  const call = (name: string, args: Record<string, unknown>) =>
    (tools.find((tool) => tool.name === name)! as StructuredToolInterface).invoke(args);
  try {
    const { page } = await getPage(key);
    await page.route("https://zini-browser.example/**", (route) => route.fulfill({ contentType: "text/html", body: `
      <style>body{height:2500px}#scroll{height:80px;width:150px;overflow:auto}#hover:hover + #hint{display:block}#hint{display:none}</style>
      <input aria-label="Text"><input type="checkbox" aria-label="Enable">
      <select aria-label="Choice"><option value="a">A</option><option value="b">B</option></select>
      <button id="hover">Hover me</button><span id="hint">Tooltip</span>
      <div id="scroll"><div style="height:500px">Scrollable</div></div>
      <div id="source" style="display:inline-block;width:100px;height:80px" draggable="true" ondragstart="event.dataTransfer.setData('text/plain','item')">Drag me</div>
      <div id="target" style="display:inline-block;width:100px;height:80px" ondragenter="event.preventDefault()" ondragover="event.preventDefault()" ondrop="event.preventDefault();this.textContent='Dropped'">Drop here</div>
      <button onclick="setTimeout(()=>document.querySelector('#ready').textContent='Ready now',100)">Start</button><span id="ready"></span>
    ` }));
    await call("browser_open", { url: "https://zini-browser.example/" });
    await page.getByRole("textbox", { name: "Text" }).focus();
    await call("browser_keypress", { key: "A" });
    assert.equal(await page.getByRole("textbox").inputValue(), "A");
    await call("browser_set_checked", { role: "checkbox", name: "Enable", checked: true });
    await call("browser_set_checked", { role: "checkbox", name: "Enable", checked: true });
    assert.equal(await page.getByRole("checkbox").isChecked(), true);
    await call("browser_select", { role: "combobox", name: "Choice", values: ["b"] });
    assert.equal(await page.getByRole("combobox").inputValue(), "b");
    assert.match(String(await call("browser_hover", { role: "button", name: "Hover me" })), /Tooltip/);
    await call("browser_scroll", { direction: "down", pixels: 120, selector: "#scroll" });
    const scrollTop = new Function("element", "return element.scrollTop") as (element: unknown) => number;
    assert.equal(await page.locator("#scroll").evaluate(scrollTop), 120);
    await call("browser_drag", { source: { selector: "#source" }, target: { selector: "#target" } });
    assert.equal(await page.locator("#target").textContent(), "Dropped");
    // Trigger a delayed update directly so browser_wait has to synchronize with it.
    await page.getByRole("button", { name: "Start", exact: true }).click();
    assert.match(String(await call("browser_wait", { condition: { type: "text", text: "Ready now", present: true } })), /Ready now/);
    await call("browser_wait", { condition: { type: "text", text: "Absent text", present: false } });
    await call("browser_wait", { condition: { type: "element", selector: "#ready", state: "visible" } });
    await call("browser_wait", { condition: { type: "url", pattern: "**/" } });
    await assert.rejects(call("browser_wait", { condition: { type: "element", selector: "#missing", state: "visible" }, timeoutMs: 100 }), /Waiting for .*#missing.*failed:[\s\S]*Current URL/);
    await call("browser_set_viewport", { width: 390, height: 844 });
    assert.deepEqual(page.viewportSize(), { width: 390, height: 844 });
    await call("browser_emulate_media", { colorScheme: "dark", reducedMotion: "reduce" });
    await call("browser_emulate_media", { media: "print" });
    assert.equal(await page.evaluate("matchMedia('(prefers-color-scheme: dark)').matches && matchMedia('(prefers-reduced-motion: reduce)').matches && matchMedia('print').matches"), true);
    const image = await call("browser_screenshot", { selector: "#ready" }) as { type: string; image_url?: string }[];
    assert.equal(image[1]?.type, "input_image");
    const bytes = Buffer.from(image[1]!.image_url!.split(",")[1]!, "base64");
    assert.equal(bytes.subarray(0, 3).toString("hex"), "ffd8ff");
    await call("browser_reset_emulation", {});
    assert.deepEqual(page.viewportSize(), { width: 1280, height: 800 });
    assert.equal(await page.evaluate("matchMedia('(prefers-color-scheme: dark)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches || matchMedia('print').matches"), false);
    const beforeScroll = await page.evaluate<number>("window.scrollY");
    await call("browser_scroll", { direction: "down", pixels: 300 });
    assert.equal(await page.evaluate("window.scrollY"), beforeScroll + 300);
  } finally { await closeBrowser(key); }
});
