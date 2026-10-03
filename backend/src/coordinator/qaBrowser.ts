import type { Response } from "express";
import { chromium, type Browser, type CDPSession, type Page } from "playwright";

// The QA's browser: one headless Chromium page per issue (Playwright's own build,
// installed with the backend), opened on its first browser tool and closed when its run
// ends (closeBrowser). Anyone can watch it live (addViewer): while someone does, Chrome
// sends a frame whenever the page repaints (CDP screencast), passed on as MJPEG, which
// an <img> shows as it comes.

// At most this often a frame goes to the viewers; busy pages (e.g. animations) would
// otherwise send far more.
const MIN_FRAME_MS = 100;
// The most console lines kept between reads.
const MAX_CONSOLE = 200;

type Session = {
  browser: Browser;
  page: Page;
  cdp: CDPSession;
  // Console errors, failed requests and errors loading pages, since the last read.
  console: string[];
  viewers: Set<Response>;
  frame: Buffer | null;
  sentAt: number;
  pending: ReturnType<typeof setTimeout> | null;
};

const sessions = new Map<string, Promise<Session>>();

async function launch(issueId: string): Promise<Session> {
  let browser: Browser;
  try {
    browser = await chromium.launch();
  } catch (err) {
    throw new Error(
      "The QA's browser couldn't start. If it isn't installed, run `npx playwright install " +
        `chromium --only-shell\` in zini's backend folder (npm install does it). ${String(err)}`,
    );
  }
  // Allowed to use the clipboard, as a visitor's browser would after a click, so copying
  // works rather than failing on a permission headless Chromium doesn't grant.
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const session: Session = {
    browser,
    page,
    cdp: await page.context().newCDPSession(page),
    console: [],
    viewers: new Set(),
    frame: null,
    sentAt: 0,
    pending: null,
  };
  const note = (line: string) => {
    session.console.push(line);
    if (session.console.length > MAX_CONSOLE) session.console.shift();
  };
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      note(`console.${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (err) => note(`Uncaught error: ${err.message}`));
  page.on("requestfailed", (request) =>
    note(`Request failed: ${request.method()} ${request.url()} (${request.failure()?.errorText ?? "unknown"})`),
  );
  page.on("response", (response) => {
    if (response.status() >= 400) {
      note(`HTTP ${response.status()}: ${response.request().method()} ${response.url()}`);
    }
  });
  session.cdp.on("Page.screencastFrame", ({ data, sessionId }) => {
    session.cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    session.frame = Buffer.from(data, "base64");
    sendFrame(session);
  });
  // Closed, or crashed: the next browser tool opens a new one.
  browser.on("disconnected", () => {
    sessions.delete(issueId);
    urls.delete(issueId);
    endViewers(session);
  });
  return session;
}

// The issue's page, opening the browser first if it isn't open.
export async function getPage(issueId: string) {
  let session = sessions.get(issueId);
  if (!session) {
    session = launch(issueId);
    sessions.set(issueId, session);
    // A failed launch isn't kept, so the next tool tries again.
    session.catch(() => sessions.delete(issueId));
  }
  const { page, console } = await session;
  return { page, console };
}

// The page's address, or null if the issue's browser isn't open (or still opening).
const urls = new Map<string, string>();
export const browserUrl = (issueId: string) => urls.get(issueId) ?? null;
export const noteUrl = (issueId: string, page: Page) => urls.set(issueId, page.url());

// Closes the issue's browser, ending its viewers' streams.
export async function closeBrowser(issueId: string) {
  const session = sessions.get(issueId);
  sessions.delete(issueId);
  urls.delete(issueId);
  if (!session) return;
  try {
    const { browser } = await session;
    await browser.close();
  } catch {
    // It never opened, or is already closed.
  }
}

// ---- Watching it -----------------------------------------------------------------

function writeFrame(viewer: Response, frame: Buffer) {
  viewer.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
  viewer.write(frame);
  viewer.write("\r\n");
}

// Sends the latest frame to every viewer, no more often than MIN_FRAME_MS: one that
// comes sooner waits, and a newer one replaces it meanwhile.
function sendFrame(session: Session) {
  if (session.pending) return;
  const wait = session.sentAt + MIN_FRAME_MS - Date.now();
  if (wait > 0) {
    session.pending = setTimeout(() => {
      session.pending = null;
      sendFrame(session);
    }, wait);
    return;
  }
  session.sentAt = Date.now();
  if (session.frame) for (const viewer of session.viewers) writeFrame(viewer, session.frame);
}

function endViewers(session: Session) {
  if (session.pending) clearTimeout(session.pending);
  for (const viewer of session.viewers) viewer.end();
  session.viewers.clear();
}

// Streams the issue's browser to res as MJPEG, until the browser closes or res does.
// false (nothing sent) if the browser isn't open.
export async function addViewer(issueId: string, res: Response) {
  const pending = sessions.get(issueId);
  if (!pending) return false;
  let session: Session;
  try {
    session = await pending;
  } catch {
    return false;
  }
  res.writeHead(200, {
    "Content-Type": "multipart/x-mixed-replace; boundary=frame",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
  });
  if (session.frame) writeFrame(res, session.frame);
  session.viewers.add(res);
  // Frames are only made while someone watches; starting sends the current one.
  if (session.viewers.size === 1) {
    await session.cdp
      .send("Page.startScreencast", { format: "jpeg", quality: 60, maxWidth: 1280, maxHeight: 800 })
      .catch(() => {});
  }
  res.on("close", () => {
    session.viewers.delete(res);
    if (session.viewers.size === 0) session.cdp.send("Page.stopScreencast").catch(() => {});
  });
  return true;
}
