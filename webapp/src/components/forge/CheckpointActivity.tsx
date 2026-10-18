import { useEffect, useState } from "react";
import CloseIcon from "@mui/icons-material/Close";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Skeleton,
  Stack,
  Typography,
  ButtonBase,
} from "@mui/material";
import { useChatScroll } from "../../hooks/useChatScroll.ts";
import type { ForgeMessage, ForgeState } from "shared";
import { errorMessage } from "../../api/client.ts";
import { useForgeMessages } from "../../api/forge.ts";
import ThinkingIndicator from "../ThinkingIndicator.tsx";
import MessageList from "../chat/MessageList.tsx";

const titles = { coder: "Coder", reviewer: "Reviewer" };

// Which worker run is open: the one for a Lead's delegate_coder or delegate_reviewer call.
type Opened = { worker: "coder" | "reviewer"; delegation?: string; working: boolean };

const workers: Record<string, "coder" | "reviewer"> = { delegate_coder: "coder", delegate_reviewer: "reviewer" };

// A Forge conversation, with the Lead's delegate_coder and delegate_reviewer calls as
// buttons that open the worker's run.
function Conversation({ items, busy, onOpen }: { items: ForgeMessage[]; busy: boolean; onOpen?: (opened: Opened) => void }) {
  return (
    <MessageList
      entries={items}
      busy={busy}
      renderCall={(call) => workers[call.name] && <Delegation call={call} worker={workers[call.name]} onOpen={onOpen} />}
    />
  );
}

// A delegate_coder or delegate_reviewer call: the worker, how it went, and the brief.
function Delegation({
  call,
  worker,
  onOpen,
}: {
  call: Extract<ForgeMessage, { role: "tool" }>;
  worker: "coder" | "reviewer";
  onOpen?: (opened: Opened) => void;
}) {
  const brief = typeof call.args.brief === "string" ? call.args.brief : "";
  const status =
    call.status === "pending"
      ? "working"
      : call.status === "done"
        ? "done"
        : call.status === "error"
          ? "failed"
          : "didn't finish";
  return (
    <Paper variant="outlined">
      <ButtonBase
        onClick={() => onOpen?.({ worker, delegation: call.callId, working: call.status === "pending" })}
        sx={{ display: "block", width: "100%", textAlign: "left", p: 1.5 }}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 0.5 }}>
          {call.status === "pending" && <CircularProgress size={12} />}
          <Typography variant="subtitle2">
            {titles[worker]} · {status}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Open this run
          </Typography>
        </Stack>
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
        >
          {brief}
        </Typography>
      </ButtonBase>
    </Paper>
  );
}

// A worker's run for one of the Lead's briefs.
// Opens at its end and follows new activity while scrolled to the bottom, like the
// Lead's and the Project Lead's chats.
function WorkerConversation({ issueId, opened, busy }: { issueId: string; opened: Opened; busy: boolean }) {
  const history = useForgeMessages(issueId, opened.worker, opened.delegation);
  const items = history.data ?? [];
  const { scrollRef, onScroll, onScrollEnd, messagesBelow, scrollToBottom } = useChatScroll({
    content: history.dataUpdatedAt,
    sending: false,
    busy,
    error: history.isError,
    lastIsReply: false,
  });
  return (
    <DialogContent dividers ref={scrollRef} onScroll={onScroll} onScrollEnd={onScrollEnd} sx={{ position: "relative" }}>
      <Stack spacing={2}>
        {history.isPending && <Skeleton height={100} />}
        {history.isError && <Alert severity="error">{errorMessage(history.error)}</Alert>}
        {history.data?.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            No activity yet.
          </Typography>
        )}
        <Conversation items={items} busy={busy} />
        {busy && <ThinkingIndicator />}
      </Stack>
      {messagesBelow !== null && (
        <Box sx={{ position: "sticky", bottom: 0, display: "flex", justifyContent: "center", pt: 1 }}>
          <Button variant="contained" size="small" startIcon={<KeyboardArrowDownIcon />} onClick={scrollToBottom}>
            Latest activity
          </Button>
        </Box>
      )}
    </DialogContent>
  );
}

// The Lead's conversation; its workers' open from their delegations.
export default function CheckpointActivity({
  issueId,
  forge,
  onContentChange,
}: {
  issueId: string;
  forge: ForgeState;
  onContentChange: (key: string) => void;
}) {
  const history = useForgeMessages(issueId);
  const items = history.data ?? [];
  const [open, setOpen] = useState<Opened | null>(null);
  const busy = Boolean(forge.running);
  useEffect(() => onContentChange(String(history.dataUpdatedAt)), [history.dataUpdatedAt, onContentChange]);
  return (
    <Stack spacing={2} aria-label="Forge activity" sx={{ minWidth: 0 }}>
      {history.isPending && <Skeleton height={100} />}
      {history.isError && <Alert severity="error">{errorMessage(history.error)}</Alert>}
      {history.data?.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          Activity will appear when the Lead starts.
        </Typography>
      )}
      <Conversation items={items} busy={busy} onOpen={setOpen} />
      {busy && forge.running === "lead" && <ThinkingIndicator />}
      <Dialog
        open={open !== null}
        onClose={() => setOpen(null)}
        fullWidth
        maxWidth="md"
        aria-labelledby="worker-conversation-title"
      >
        <DialogTitle id="worker-conversation-title" sx={{ pr: 7 }}>
          {open && titles[open.worker]}
          <IconButton aria-label="Close" onClick={() => setOpen(null)} sx={{ position: "absolute", right: 12, top: 12 }}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        {open && (
          <WorkerConversation
            key={`${open.worker}:${open.delegation ?? ""}`}
            issueId={issueId}
            opened={open}
            busy={forge.running === open.worker && open.working}
          />
        )}
      </Dialog>
    </Stack>
  );
}
