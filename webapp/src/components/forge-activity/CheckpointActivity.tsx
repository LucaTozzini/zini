import { useEffect, useMemo, useState } from "react";
import CloseIcon from "@mui/icons-material/Close";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import { Alert, Box, Button, CircularProgress, Dialog, DialogContent, DialogTitle, IconButton, Paper, Skeleton, Stack, Typography,
  ButtonBase } from "@mui/material";
import { useChatScroll } from "../../hooks/useChatScroll.ts";
import type { PipelineState } from "shared";
import { errorMessage } from "../../api/client.ts";
import { useForgeMessages } from "../../api/forge.ts";
import { HumanMessage } from "../chat/HumanMessage.tsx";
import AiMessage from "../chat/AiMessage.tsx";
import ThinkingIndicator from "../ThinkingIndicator.tsx";
import CompactionMarker from "../CompactionMarker.tsx";
import ToolCallLine from "../ToolCallLine.tsx";
import ToolCallGroup from "../ToolCallGroup.tsx";
import { groupMessages, type GroupedMessage } from "./groupMessages.ts";

const titles = { coder: "Coder", reviewer: "Reviewer" };

// One agent's conversation: its messages and tool calls, with delegations to workers as
// buttons that open the worker's conversation.
function Conversation({ items, busy, onOpen }: {
  items: GroupedMessage[]; busy: boolean; onOpen?: (worker: "coder" | "reviewer") => void;
}) {
  return <>
    {items.map((item) => <Box key={item.id} data-chat-message="" sx={{ minWidth: 0 }}>
      {item.kind === "message" ? item.message.role === "compaction" ?
        <CompactionMarker summary={item.message.summary} /> : item.message.role === "user" ?
          <HumanMessage message={item.message} /> : <AiMessage content={item.message.content} /> :
        item.kind === "delegation" ? <Delegation item={item} onOpen={onOpen} /> :
        item.tools.length === 1 ?
          <ToolCallLine call={item.tools[0].call} busy={busy} result={item.tools[0].result} /> :
          <ToolCallGroup calls={item.tools.map((tool) => tool.call)} results={item.tools.map((tool) => tool.result)} busy={busy} />}
    </Box>)}
  </>;
}

// A delegate_coder or delegate_reviewer call: the worker, how it went, and the brief.
function Delegation({ item, onOpen }: { item: Extract<GroupedMessage, { kind: "delegation" }>; onOpen?: (worker: "coder" | "reviewer") => void }) {
  const { call } = item.tool;
  const brief = typeof call.args.brief === "string" ? call.args.brief : "";
  const status = call.status === "pending" ? "working" : call.status === "done" ? "done"
    : call.status === "error" ? "failed" : "didn't finish";
  return <Paper variant="outlined">
    <ButtonBase onClick={() => onOpen?.(item.worker)} sx={{ display: "block", width: "100%", textAlign: "left", p: 1.5 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 0.5 }}>
        {call.status === "pending" && <CircularProgress size={12} />}
        <Typography variant="subtitle2">{titles[item.worker]} · {status}</Typography>
        <Typography variant="caption" color="text.secondary">Open its conversation</Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
        {brief}
      </Typography>
    </ButtonBase>
  </Paper>;
}

// A worker's whole conversation: every brief from the Lead and what it did for each.
// Opens at its end and follows new activity while scrolled to the bottom, like the
// Lead's and the Project Lead's chats.
function WorkerConversation({ issueId, worker, busy }: { issueId: string; worker: "coder" | "reviewer"; busy: boolean }) {
  const history = useForgeMessages(issueId, worker);
  const items = useMemo(() => groupMessages(history.data ?? []), [history.data]);
  const { scrollRef, onScroll, onScrollEnd, messagesBelow, scrollToBottom } = useChatScroll({
    content: history.dataUpdatedAt, sending: false, busy, error: history.isError, lastIsReply: false,
  });
  return <DialogContent dividers ref={scrollRef} onScroll={onScroll} onScrollEnd={onScrollEnd} sx={{ position: "relative" }}>
    <Stack spacing={2}>
      {history.isPending && <Skeleton height={100} />}
      {history.isError && <Alert severity="error">{errorMessage(history.error)}</Alert>}
      {history.data?.length === 0 && <Typography variant="body2" color="text.secondary">No activity yet.</Typography>}
      <Conversation items={items} busy={busy} />
      {busy && <ThinkingIndicator />}
    </Stack>
    {messagesBelow !== null && <Box sx={{ position: "sticky", bottom: 0, display: "flex", justifyContent: "center", pt: 1 }}>
      <Button variant="contained" size="small" startIcon={<KeyboardArrowDownIcon />} onClick={scrollToBottom}>Latest activity</Button>
    </Box>}
  </DialogContent>;
}

// The Lead's conversation; its workers' open from their delegations.
export default function CheckpointActivity({ issueId, pipeline, onContentChange }: {
  issueId: string; pipeline: PipelineState; onContentChange: (key: string) => void;
}) {
  const history = useForgeMessages(issueId);
  const items = useMemo(() => groupMessages(history.data ?? []), [history.data]);
  const [open, setOpen] = useState<"coder" | "reviewer" | null>(null);
  const busy = Boolean(pipeline.running);
  useEffect(() => onContentChange(String(history.dataUpdatedAt)), [history.dataUpdatedAt, onContentChange]);
  return <Stack spacing={2} aria-label="Forge activity" sx={{ minWidth: 0 }}>
    {history.isPending && <Skeleton height={100} />}
    {history.isError && <Alert severity="error">{errorMessage(history.error)}</Alert>}
    {history.data?.length === 0 && <Typography variant="body2" color="text.secondary">Activity will appear when the Lead starts.</Typography>}
    <Conversation items={items} busy={busy} onOpen={setOpen} />
    {busy && pipeline.running === "lead" && <ThinkingIndicator />}
    <Dialog open={open !== null} onClose={() => setOpen(null)} fullWidth maxWidth="md" aria-labelledby="worker-conversation-title">
      <DialogTitle id="worker-conversation-title" sx={{ pr: 7 }}>
        {open && titles[open]}
        <IconButton aria-label="Close" onClick={() => setOpen(null)} sx={{ position: "absolute", right: 12, top: 12 }}><CloseIcon /></IconButton>
      </DialogTitle>
      {open && <WorkerConversation issueId={issueId} worker={open} busy={pipeline.running === open} />}
    </Dialog>
  </Stack>;
}
