import type { IncomingMessage, Server } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser, BrowserContext, CDPSession, Dialog, FileChooser, Page } from "playwright";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import type { PreviewClientMessage, PreviewMode, PreviewServerMessage } from "shared";
import { connectWorkspaceBrowser } from "./agentBrowser.js";
import { userForCookies } from "../auth/session.js";
import { Workspace } from "../models/Workspace.js";

// The user's preview: the workspace's app in a Chromium page inside its Docker
// container (its own context, apart from QA's), so the app runs at its own localhost
// addresses. The user controls it over a WebSocket: their mouse, keyboard and pasted
// text go to the page, and its screen comes back as JPEG frames (CDP screencast) while
// someone watches. It stays open, with its cookies, until the app stops.

const MOBILE = { width: 390, height: 844, scale: 3 };
// A frame isn't sent to a viewer that's still this far behind.
const MAX_BUFFERED = 4 * 1024 * 1024;

type Preview = {
  browser: Browser;
  context: BrowserContext;
  // Pages open, the shown one last: a popup is shown until it closes.
  pages: { page: Page; cdp: CDPSession }[];
  viewers: Set<WebSocket>;
  mode: PreviewMode;
  size: { width: number; height: number };
  scale: number;
  userAgent: string;
  // Mouse buttons held, for drags (CDP's bit field).
  buttons: number;
  chooser: FileChooser | null;
  dialog: Dialog | null;
  downloads: Map<string, { name: string; path: string }>;
  dir: string;
};

const previews = new Map<string, Promise<Preview>>();

const shown = (preview: Preview) => preview.pages.at(-1)!;
// The page's size in CSS pixels, and its pixel density: on desktop the viewer's, so
// text is as sharp as their screen allows.
const viewport = (preview: Preview) => preview.mode === "mobile" ? MOBILE : { ...preview.size, scale: preview.scale };

function send(preview: Preview, message: PreviewServerMessage) {
  const text = JSON.stringify(message);
  for (const viewer of preview.viewers) viewer.send(text);
}

async function sendState(preview: Preview) {
  const { page, cdp } = shown(preview);
  const history = await cdp.send("Page.getNavigationHistory").catch(() => null);
  const { width, height } = viewport(preview);
  // The blank page each page starts on isn't somewhere to go back to.
  const first = history?.entries[0]?.url === "about:blank" ? 1 : 0;
  send(preview, { type: "state", url: page.url(), title: await page.title().catch(() => ""),
    canGoBack: Boolean(history && history.currentIndex > first),
    canGoForward: Boolean(history && history.currentIndex < history.entries.length - 1),
    mode: preview.mode, width, height });
}

// Sizes the page for the mode: the viewer's size, or a phone's (with touch and a mobile
// user agent).
async function emulate(preview: Preview, cdp: CDPSession) {
  const mobile = preview.mode === "mobile";
  const { width, height, scale } = viewport(preview);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile });
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
  await cdp.send("Emulation.setUserAgentOverride", { userAgent: mobile
    ? preview.userAgent.replace(/\(([^)]*)\)/, "(Linux; Android 14; Pixel 8)").replace(/(Chrome\/[\d.]+)/, "$1 Mobile")
    : preview.userAgent });
}

// Frames are only made while someone watches; starting sends the current one.
async function screencast(preview: Preview) {
  const { cdp } = shown(preview);
  await cdp.send("Page.stopScreencast").catch(() => {});
  if (!preview.viewers.size) return;
  const { width, height } = viewport(preview);
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 70,
    maxWidth: Math.round(width * preview.scale), maxHeight: Math.round(height * preview.scale) }).catch(() => {});
}

async function show(preview: Preview, page: Page) {
  const cdp = await page.context().newCDPSession(page);
  cdp.on("Page.screencastFrame", ({ data, sessionId }) => {
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    if (shown(preview).cdp !== cdp) return;
    const frame = Buffer.from(data, "base64");
    for (const viewer of preview.viewers) if (viewer.bufferedAmount < MAX_BUFFERED) viewer.send(frame);
  });
  page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) void sendState(preview); });
  page.on("load", () => void sendState(preview));
  page.on("filechooser", (chooser) => {
    preview.chooser = chooser;
    send(preview, { type: "fileChooser", multiple: chooser.isMultiple() });
  });
  page.on("dialog", (dialog) => {
    if (dialog.type() === "beforeunload") { void dialog.accept().catch(() => {}); return; }
    preview.dialog = dialog;
    send(preview, { type: "dialog", kind: dialog.type(), message: dialog.message(), defaultValue: dialog.defaultValue() });
  });
  page.on("download", (download) => void (async () => {
    const id = randomUUID();
    const path = join(preview.dir, id);
    await download.saveAs(path);
    preview.downloads.set(id, { name: download.suggestedFilename(), path });
    send(preview, { type: "download", id, name: download.suggestedFilename() });
  })().catch((error) => send(preview, { type: "error", message: `The download failed: ${String(error)}` })));
  // A closed popup shows the page that opened it again; the last one is replaced.
  page.on("close", () => void (async () => {
    const wasShown = shown(preview).page === page;
    preview.pages = preview.pages.filter((entry) => entry.page !== page);
    if (!preview.pages.length) { await show(preview, await preview.context.newPage()); return; }
    if (wasShown) await refresh(preview);
  })().catch(() => {}));
  preview.pages.push({ page, cdp });
  await emulate(preview, cdp);
  await refresh(preview);
}

async function refresh(preview: Preview) {
  await screencast(preview);
  await sendState(preview);
}

async function open(issueId: string, url: string | null): Promise<Preview> {
  const browser = await connectWorkspaceBrowser(issueId);
  const context = await browser.newContext({ viewport: null, ignoreHTTPSErrors: true, acceptDownloads: true });
  const page = await context.newPage();
  const userAgent = (await page.evaluate(() => navigator.userAgent)).replace("HeadlessChrome", "Chrome");
  const dir = join(tmpdir(), "zini-preview-downloads", issueId);
  await mkdir(dir, { recursive: true });
  const preview: Preview = { browser, context, pages: [], viewers: new Set(), mode: "desktop",
    size: { width: 1280, height: 800 }, scale: 1, userAgent, buttons: 0, chooser: null, dialog: null,
    downloads: new Map(), dir };
  context.on("page", (popup) => { if (popup !== page) void show(preview, popup).catch(() => {}); });
  browser.on("disconnected", () => void forget(issueId, preview));
  await show(preview, page);
  if (url) await page.goto(url, { waitUntil: "commit" }).catch(() => {});
  return preview;
}

async function forget(issueId: string, preview: Preview) {
  const pending = previews.get(issueId);
  if (pending && await pending.catch(() => null) === preview) previews.delete(issueId);
  for (const viewer of preview.viewers) viewer.close(1000, "The preview closed");
  preview.viewers.clear();
  await rm(preview.dir, { recursive: true, force: true }).catch(() => {});
}

// The issue's preview, opening it at url (the app's address) if it isn't open.
function getPreview(issueId: string, url: string | null) {
  let pending = previews.get(issueId);
  if (!pending) {
    pending = open(issueId, url);
    previews.set(issueId, pending);
    const opening = pending;
    pending.catch(() => { if (previews.get(issueId) === opening) previews.delete(issueId); });
  }
  return pending;
}

// Closes the issue's preview (e.g. its app stopped), with its downloads.
export async function closePreview(issueId: string) {
  const pending = previews.get(issueId);
  previews.delete(issueId);
  const preview = await pending?.catch(() => null);
  if (!preview) return;
  await preview.browser.close().catch(() => {});
  await forget(issueId, preview);
}

export async function previewDownload(issueId: string, id: string) {
  const preview = await previews.get(issueId)?.catch(() => null);
  return preview?.downloads.get(id) ?? null;
}

// ---- The user's input --------------------------------------------------------------

const MOUSE = { down: "mousePressed", up: "mouseReleased", move: "mouseMoved" } as const;
const BUTTON_BITS = { left: 1, right: 2, middle: 4, none: 0 };

function withScheme(url: string) {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `http://${url}`;
}

async function handle(preview: Preview, message: PreviewClientMessage) {
  const { page, cdp } = shown(preview);
  switch (message.type) {
    case "mouse": {
      if (preview.mode === "mobile") {
        // A phone gets touches: a press, a drag and a release are a tap or a swipe.
        if (message.action === "move" && !preview.buttons) return;
        preview.buttons = message.action === "down" ? 1 : message.action === "up" ? 0 : preview.buttons;
        const type = message.action === "down" ? "touchStart" : message.action === "up" ? "touchEnd" : "touchMove";
        await cdp.send("Input.dispatchTouchEvent", { type, modifiers: message.modifiers,
          touchPoints: message.action === "up" ? [] : [{ x: message.x, y: message.y }] });
        return;
      }
      if (message.action === "down") preview.buttons |= BUTTON_BITS[message.button];
      if (message.action === "up") preview.buttons &= ~BUTTON_BITS[message.button];
      await cdp.send("Input.dispatchMouseEvent", { type: MOUSE[message.action], x: message.x, y: message.y,
        button: message.action === "move" ? (preview.buttons & 1 ? "left" : preview.buttons & 2 ? "right" : preview.buttons & 4 ? "middle" : "none") : message.button,
        buttons: preview.buttons, clickCount: message.clickCount, modifiers: message.modifiers });
      return;
    }
    case "wheel":
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: message.x, y: message.y,
        deltaX: message.deltaX, deltaY: message.deltaY, modifiers: message.modifiers });
      return;
    case "key":
      try { await (message.action === "down" ? page.keyboard.down(message.key) : page.keyboard.up(message.key)); }
      // A character the keyboard layout doesn't have is typed as text instead.
      catch { if (message.action === "down" && [...message.key].length === 1) await page.keyboard.insertText(message.key); }
      return;
    case "text": await page.keyboard.insertText(message.text); return;
    case "navigate": await page.goto(withScheme(message.url.trim()), { waitUntil: "commit" }); return;
    case "back": await page.goBack({ waitUntil: "commit" }); return;
    case "forward": await page.goForward({ waitUntil: "commit" }); return;
    case "reload": await page.reload({ waitUntil: "commit" }); return;
    case "resize": {
      preview.size = { width: Math.round(Math.min(3840, Math.max(200, message.width))),
        height: Math.round(Math.min(2160, Math.max(200, message.height))) };
      preview.scale = Math.min(2, Math.max(1, message.scale));
      if (preview.mode === "desktop") await emulate(preview, cdp);
      await refresh(preview);
      return;
    }
    case "mode": {
      preview.mode = message.mode;
      preview.buttons = 0;
      for (const entry of preview.pages) await emulate(preview, entry.cdp);
      // Pages and servers read the user agent and touch support when they load.
      await page.reload({ waitUntil: "commit" }).catch(() => {});
      await refresh(preview);
      return;
    }
    case "files": {
      const chooser = preview.chooser;
      preview.chooser = null;
      await chooser?.setFiles(message.files.map((file) =>
        ({ name: file.name, mimeType: file.mimeType || "application/octet-stream", buffer: Buffer.from(file.data, "base64") })));
      return;
    }
    case "dialog": {
      const dialog = preview.dialog;
      preview.dialog = null;
      await (message.accept ? dialog?.accept(message.text) : dialog?.dismiss());
      return;
    }
  }
}

// ---- The WebSocket ---------------------------------------------------------------

const sockets = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });
const PATH = /^\/api\/workspaces\/([^/?]+)\/preview\/?(?:\?.*)?$/;

// Serves previews at /api/workspaces/:issueId/preview to signed-in users. appUrl is the
// app's address in the workspace, or null if it isn't running.
export function previewSockets(server: Server, appUrl: (issueId: string) => Promise<string | null>) {
  server.on("upgrade", (req: IncomingMessage, socket, head) => void (async () => {
    const match = PATH.exec(req.url ?? "");
    if (!match) { socket.destroy(); return; }
    const issueId = decodeURIComponent(match[1]!);
    if (!await userForCookies(req.headers.cookie)) { socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n"); return; }
    const url = await Workspace.findByPk(issueId) ? await appUrl(issueId) : null;
    if (!url) { socket.end("HTTP/1.1 404 Not Found\r\n\r\n"); return; }
    sockets.handleUpgrade(req, socket, head, (viewer) => void watch(issueId, url, viewer));
  })().catch(() => socket.destroy()));
}

async function watch(issueId: string, url: string, viewer: WebSocket) {
  // Messages wait for the preview to open (the viewer sends its size straight away),
  // then go in order: a click must not overtake the move before it.
  const opening = (async () => {
    const preview = await getPreview(issueId, url);
    // Opened before the app was ready: show the app now.
    if (shown(preview).page.url() === "about:blank") await shown(preview).page.goto(url, { waitUntil: "commit" }).catch(() => {});
    if (viewer.readyState !== viewer.OPEN) return preview;
    preview.viewers.add(viewer);
    await refresh(preview);
    return preview;
  })();
  let queue: Promise<unknown> = opening.catch((error) =>
    viewer.close(1011, `The preview browser couldn't open: ${String(error)}`.slice(0, 120)));
  viewer.on("message", (data: RawData, binary) => {
    if (binary) return;
    let message: PreviewClientMessage;
    try { message = JSON.parse(data.toString()); } catch { return; }
    queue = queue.then(async () => handle(await opening, message)).catch((error) =>
      viewer.send(JSON.stringify({ type: "error", message: String(error instanceof Error ? error.message : error) } satisfies PreviewServerMessage)));
  });
  viewer.on("close", () => void opening.then((preview) => {
    preview.viewers.delete(viewer);
    if (!preview.viewers.size) void shown(preview).cdp.send("Page.stopScreencast").catch(() => {});
  }).catch(() => {}));
}
