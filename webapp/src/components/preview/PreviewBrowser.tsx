import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type PointerEvent } from "react";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import CloseIcon from "@mui/icons-material/Close";
import DesktopWindowsOutlinedIcon from "@mui/icons-material/DesktopWindowsOutlined";
import KeyboardOutlinedIcon from "@mui/icons-material/KeyboardOutlined";
import PhoneIphoneOutlinedIcon from "@mui/icons-material/PhoneIphoneOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";
import {
  Alert,
  Box,
  Button,
  IconButton,
  Link,
  MenuItem,
  Select,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
} from "@mui/material";
import type { PreviewClientMessage, PreviewMode, PreviewServerMessage } from "shared";

type State = Extract<PreviewServerMessage, { type: "state" }>;

// Alt 1, Ctrl 2, Meta 4, Shift 8. The page runs on Linux, so a Mac's Cmd is its Ctrl.
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const modifiers = (event: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) =>
  (event.altKey ? 1 : 0) |
  (event.ctrlKey || (IS_MAC && event.metaKey) ? 2 : 0) |
  (event.metaKey && !IS_MAC ? 4 : 0) |
  (event.shiftKey ? 8 : 0);
const keyName = (key: string) => (IS_MAC && key === "Meta" ? "Control" : key);
const BUTTONS = ["left", "middle", "right"] as const;
// Keys left to the composition and input events: IMEs and phone keyboards.
const COMPOSING = new Set(["Process", "Unidentified", "Dead"]);

const readBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

// The workspace's preview browser: its screen, streamed as JPEG frames over a WebSocket,
// which takes the user's mouse, keyboard and pasted text back to the page.
function PreviewBrowser({ issueId }: { issueId: string }) {
  const socket = useRef<WebSocket | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const screen = useRef<HTMLImageElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [connection, setConnection] = useState<"connecting" | "open" | "closed">("connecting");
  const [closeReason, setCloseReason] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State | null>(null);
  const [address, setAddress] = useState("");
  const [editing, setEditing] = useState(false);
  const [areaSize, setAreaSize] = useState({ width: 0, height: 0 });
  const [error, setError] = useState<string | null>(null);
  const [fileRequest, setFileRequest] = useState<{ multiple: boolean } | null>(null);
  const [downloads, setDownloads] = useState<{ id: string; name: string }[]>([]);

  const send = useCallback((message: PreviewClientMessage) => {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(message));
  }, []);

  useEffect(() => {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${location.host}/api/workspaces/${encodeURIComponent(issueId)}/preview`);
    ws.binaryType = "blob";
    socket.current = ws;
    setConnection("connecting");
    let frameUrl: string | null = null;
    ws.onopen = () => {
      setConnection("open");
      const { width, height } = area.current?.getBoundingClientRect() ?? { width: 1280, height: 800 };
      ws.send(JSON.stringify({ type: "resize", width, height, scale: window.devicePixelRatio } satisfies PreviewClientMessage));
    };
    ws.onclose = (event) => {
      setConnection("closed");
      setCloseReason(event.reason);
    };
    ws.onmessage = (event) => {
      if (event.data instanceof Blob) {
        const url = URL.createObjectURL(event.data);
        if (screen.current) screen.current.src = url;
        if (frameUrl) URL.revokeObjectURL(frameUrl);
        frameUrl = url;
        return;
      }
      const message = JSON.parse(event.data) as PreviewServerMessage;
      if (message.type === "state") setState(message);
      else if (message.type === "error") setError(message.message);
      else if (message.type === "fileChooser") setFileRequest({ multiple: message.multiple });
      else if (message.type === "download") setDownloads((list) => [...list.slice(-4), { id: message.id, name: message.name }]);
      // The browser's own dialogs, after this handler, as the page's would block.
      else if (message.type === "dialog")
        setTimeout(() => {
          if (message.kind === "alert") {
            window.alert(message.message);
            ws.send(JSON.stringify({ type: "dialog", accept: true }));
            return;
          }
          if (message.kind === "prompt") {
            const text = window.prompt(message.message, message.defaultValue);
            ws.send(
              JSON.stringify({ type: "dialog", accept: text !== null, text: text ?? undefined } satisfies PreviewClientMessage),
            );
            return;
          }
          ws.send(JSON.stringify({ type: "dialog", accept: window.confirm(message.message) } satisfies PreviewClientMessage));
        });
    };
    return () => {
      ws.close();
      if (frameUrl) URL.revokeObjectURL(frameUrl);
    };
  }, [issueId, attempt]);

  // On desktop the page is the size of this area.
  useEffect(() => {
    const element = area.current;
    if (!element) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      setAreaSize({ width, height });
      clearTimeout(timer);
      timer = setTimeout(() => send({ type: "resize", width, height, scale: window.devicePixelRatio }), 150);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [send]);

  useEffect(() => {
    if (!editing && state) setAddress(state.url);
  }, [state, editing]);

  // The page's coordinates for a point on the screen.
  const point = (event: { clientX: number; clientY: number }) => {
    const rect = screen.current!.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) * (state?.width ?? rect.width)) / rect.width,
      y: ((event.clientY - rect.top) * (state?.height ?? rect.height)) / rect.height,
    };
  };

  // Wheel events must be non-passive to keep this page from scrolling.
  useEffect(() => {
    const element = screen.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
      send({
        type: "wheel",
        ...point(event),
        deltaX: event.deltaX * unit,
        deltaY: event.deltaY * unit,
        modifiers: modifiers(event),
      });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  });

  const clicks = useRef({ count: 0, at: 0, x: 0, y: 0 });
  const pending = useRef<PreviewClientMessage | null>(null);
  const onPointerDown = (event: PointerEvent<HTMLImageElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (event.pointerType === "mouse") input.current?.focus({ preventScroll: true });
    const now = Date.now();
    const last = clicks.current;
    const count =
      now - last.at < 500 && Math.abs(event.clientX - last.x) < 5 && Math.abs(event.clientY - last.y) < 5 ? last.count + 1 : 1;
    clicks.current = { count, at: now, x: event.clientX, y: event.clientY };
    send({
      type: "mouse",
      action: "down",
      ...point(event),
      button: BUTTONS[event.button] ?? "left",
      clickCount: count,
      modifiers: modifiers(event),
    });
  };
  const onPointerMove = (event: PointerEvent<HTMLImageElement>) => {
    // Only the latest move goes, once a frame.
    const queued = pending.current;
    pending.current = {
      type: "mouse",
      action: "move",
      ...point(event),
      button: "none",
      clickCount: 0,
      modifiers: modifiers(event),
    };
    if (!queued)
      requestAnimationFrame(() => {
        if (pending.current) send(pending.current);
        pending.current = null;
      });
  };
  const onPointerUp = (event: PointerEvent<HTMLImageElement>) => {
    if (pending.current) {
      send(pending.current);
      pending.current = null;
    }
    send({
      type: "mouse",
      action: "up",
      ...point(event),
      button: BUTTONS[event.button] ?? "left",
      clickCount: clicks.current.count,
      modifiers: modifiers(event),
    });
  };

  const held = useRef(new Set<string>());
  const onKey = (action: "down" | "up") => (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || COMPOSING.has(event.key)) return;
    // Pasting goes through the paste event, which carries the user's clipboard.
    if (action === "down" && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") return;
    event.preventDefault();
    const key = keyName(event.key);
    if (action === "down") held.current.add(key);
    else held.current.delete(key);
    send({ type: "key", action, key });
  };
  // Keys still held when focus leaves would otherwise stay down in the page.
  const onBlur = () => {
    for (const key of held.current) send({ type: "key", action: "up", key });
    held.current.clear();
  };
  const typeText = () => {
    const element = input.current;
    if (element?.value) {
      send({ type: "text", text: element.value });
      element.value = "";
    }
  };
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    event.preventDefault();
    const text = event.clipboardData.getData("text");
    if (text) send({ type: "text", text });
  };

  const chooseFiles = async (files: FileList | null) => {
    setFileRequest(null);
    if (!files?.length) return;
    send({
      type: "files",
      files: await Promise.all(
        [...files].map(async (file) => ({ name: file.name, mimeType: file.type, data: await readBase64(file) })),
      ),
    });
  };

  const mode: PreviewMode = state?.mode ?? "desktop";
  // A phone's screen, fitted into the area; on desktop the page fills it.
  const fit = state && mode === "mobile" ? Math.min(1, areaSize.width / state.width, areaSize.height / state.height) : 1;
  const shownSize =
    state && mode === "mobile" ? { width: state.width * fit, height: state.height * fit } : { width: "100%", height: "100%" };

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", px: 1, py: 0.5, borderBottom: 1, borderColor: "divider" }}>
        <IconButton size="small" aria-label="Back" disabled={!state?.canGoBack} onClick={() => send({ type: "back" })}>
          <ArrowBackIcon fontSize="small" />
        </IconButton>
        <IconButton size="small" aria-label="Forward" disabled={!state?.canGoForward} onClick={() => send({ type: "forward" })}>
          <ArrowForwardIcon fontSize="small" />
        </IconButton>
        <IconButton size="small" aria-label="Reload" onClick={() => send({ type: "reload" })}>
          <RefreshIcon fontSize="small" />
        </IconButton>
        <TextField
          size="small"
          fullWidth
          value={address}
          slotProps={{ htmlInput: { "aria-label": "Address" } }}
          onChange={(event) => setAddress(event.target.value)}
          onFocus={() => setEditing(true)}
          onBlur={() => setEditing(false)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            send({ type: "navigate", url: address });
            (event.target as HTMLInputElement).blur();
          }}
        />
        {state && state.tabs.length > 1 && (
          <Select
            size="small"
            value={state.tab}
            inputProps={{ "aria-label": "Tab" }}
            onChange={(event) => send({ type: "tab", id: Number(event.target.value) })}
            renderValue={(id) => {
              const tab = state.tabs.find((entry) => entry.id === id);
              return tab?.title || tab?.url;
            }}
            sx={{ width: 200, flexShrink: 0 }}
          >
            {state.tabs.map((tab) => (
              <MenuItem key={tab.id} value={tab.id} sx={{ maxWidth: 360 }}>
                <Box sx={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{tab.title || tab.url}</Box>
                {tab.closable && (
                  <IconButton
                    size="small"
                    aria-label={`Close ${tab.title || tab.url}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      send({ type: "closeTab", id: tab.id });
                    }}
                  >
                    <CloseIcon fontSize="small" />
                  </IconButton>
                )}
              </MenuItem>
            ))}
          </Select>
        )}
        <ToggleButtonGroup
          size="small"
          exclusive
          value={mode}
          aria-label="Screen"
          onChange={(_event, value: PreviewMode | null) => {
            if (value) send({ type: "mode", mode: value });
          }}
        >
          <ToggleButton value="desktop" aria-label="Desktop">
            <DesktopWindowsOutlinedIcon fontSize="small" />
          </ToggleButton>
          <ToggleButton value="mobile" aria-label="Mobile">
            <PhoneIphoneOutlinedIcon fontSize="small" />
          </ToggleButton>
        </ToggleButtonGroup>
        <Tooltip title="Type into the page">
          <IconButton size="small" aria-label="Keyboard" onClick={() => input.current?.focus()}>
            <KeyboardOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
      {connection === "closed" && (
        <Alert
          severity="warning"
          action={
            <Button size="small" onClick={() => setAttempt((n) => n + 1)}>
              Reconnect
            </Button>
          }
        >
          The preview disconnected{closeReason ? `: ${closeReason}` : "."}
        </Alert>
      )}
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {fileRequest && (
        <Alert
          severity="info"
          action={
            <Button size="small" onClick={() => setFileRequest(null)}>
              Cancel
            </Button>
          }
        >
          The page asks for {fileRequest.multiple ? "files" : "a file"}:{" "}
          <input type="file" multiple={fileRequest.multiple} onChange={(event) => void chooseFiles(event.target.files)} />
        </Alert>
      )}
      {downloads.length > 0 && (
        <Stack direction="row" spacing={2} sx={{ px: 2, py: 0.5, flexWrap: "wrap" }}>
          {downloads.map((download) => (
            <Link
              key={download.id}
              download={download.name}
              href={`/api/workspaces/${encodeURIComponent(issueId)}/preview/downloads/${download.id}`}
            >
              {download.name}
            </Link>
          ))}
        </Stack>
      )}
      <Box
        ref={area}
        sx={{
          flex: 1,
          minHeight: 0,
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          bgcolor: mode === "mobile" ? "action.hover" : "background.default",
        }}
      >
        <img
          ref={screen}
          alt={state?.title ? `Preview: ${state.title}` : "Preview"}
          draggable={false}
          // The next frame comes once this one is on screen.
          onLoad={() => send({ type: "frame" })}
          onError={() => send({ type: "frame" })}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onContextMenu={(event) => event.preventDefault()}
          style={{
            ...shownSize,
            objectFit: "fill",
            touchAction: "none",
            userSelect: "none",
            display: "block",
            cursor: "default",
          }}
        />
        {/* Takes the user's typing: keys, composed text and pastes go to the page. */}
        <textarea
          ref={input}
          aria-label="Type into the preview"
          autoCapitalize="off"
          autoComplete="off"
          spellCheck={false}
          onKeyDown={onKey("down")}
          onKeyUp={onKey("up")}
          onBlur={onBlur}
          onPaste={onPaste}
          onInput={(event) => {
            if (!(event.nativeEvent as InputEvent).isComposing) typeText();
          }}
          onCompositionEnd={typeText}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: 1,
            height: 1,
            opacity: 0,
            border: 0,
            padding: 0,
            resize: "none",
          }}
        />
      </Box>
    </Box>
  );
}

export default PreviewBrowser;
