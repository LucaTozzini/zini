import { Alert, Box, Chip, Container, Stack, Typography } from "@mui/material";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import type { FormEvent, KeyboardEvent } from "react";
import type { ChatMessage, Decision, PendingAction, Todo } from "shared";
import { errorMessage } from "../api/client.ts";
import { useChatScroll } from "../hooks/useChatScroll.ts";
import ApprovalCard from "./ApprovalCard.tsx";
import ChatInput from "./ChatInput.tsx";
import CompactionMarker from "./CompactionMarker.tsx";
import { MessageBubble } from "./MessageBubble.tsx";
import ToolCallGroup from "./ToolCallGroup.tsx";
import ToolCallLine from "./ToolCallLine.tsx";
import ChatHeader from "./ChatHeader.tsx";

// Everything the chat shows and does, whatever agent and API are behind it (e.g.
// useChat for the product manager).
export type ChatState = {
  messages: ChatMessage[];
  // Actions waiting on approval.
  pending: PendingAction[];
  // The agent's to-do list, and its project notes (markdown).
  todos: Todo[];
  notes: string;
  // The conversation is loading for the first time.
  loading: boolean;
  // Changes whenever the conversation does, for auto-scroll.
  content: unknown;
  draft: string;
  setDraft: (draft: string) => void;
  // A message on its way that isn't in messages yet.
  sending: string | null | undefined;
  // The agent is working.
  busy: boolean;
  canSend: boolean;
  error: Error | null;
  sendLoading: boolean;
  decideLoading: boolean;
  sendDraft: (e?: FormEvent) => void;
  handleKeyDown: (e: KeyboardEvent) => void;
  decide: (decision: Decision) => void;
  // A run is going on that can be stopped, so the input's button stops it while there's
  // nothing typed to send.
  stoppable: boolean;
  stopAgent: () => void;
};

type ToolCall = Extract<ChatMessage, { role: "tool" }>;
type ChatItem =
  | { i: number; message: Exclude<ChatMessage, ToolCall>; calls?: undefined }
  | { i: number; message?: undefined; calls: ToolCall[] };

// Messages as shown: consecutive tool calls together, each item keeping the index of
// its first message (its key).
function groupToolCalls(messages: ChatMessage[]) {
  const items: ChatItem[] = [];
  messages.forEach((message, i) => {
    if (message.role !== "tool") return items.push({ i, message });
    const last = items.at(-1);
    if (last?.calls) last.calls.push(message);
    else items.push({ i, calls: [message] });
  });
  return items;
}

type ChatProps = {
  chat: ChatState;
  avatar: { src: string; label: string };
  // Shown in an empty chat.
  emptyText: string;
  placeholder: string;
};

// A chat with any agent role: messages, approvals and the input box.
function Chat({ chat, avatar, emptyText, placeholder }: ChatProps) {
  const {
    loading,
    content,
    messages,
    pending,
    todos,
    notes,
    draft,
    setDraft,
    sending,
    busy,
    canSend,
    error,
    sendLoading,
    decideLoading,
    sendDraft,
    handleKeyDown,
    decide,
    stoppable,
    stopAgent,
  } = chat;

  const { scrollRef, lastMessageRef, onScroll, onScrollEnd, messagesBelow, scrollToBottom } = useChatScroll({
    content,
    // A new chat's first message, or a message just sent to this one.
    sending: Boolean(sending) || sendLoading,
    busy,
    error: Boolean(error),
    lastIsReply: messages.at(-1)?.role === "assistant",
  });

  return (
    <Box
      sx={{
        flex: 1,
        // A flex item can't shrink below its content's widest unbreakable part, e.g. a
        // code block's longest line, which would widen the whole chat past the screen.
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
    >
      <Box
        ref={scrollRef}
        onScroll={onScroll}
        onScrollEnd={onScrollEnd}
        sx={{
          flex: 1,
          overflow: "auto",
          pb: 20,

          // No scrollbar, in every browser. Overrides the theme's global "thin".
          scrollbarWidth: "none",
        }}
      >
        <ChatHeader src={avatar.src} label={avatar.label} todos={todos} notes={notes} />
        <Container maxWidth={false} sx={{ maxWidth: 750 }}>
          <Stack spacing={2} sx={{ pt: 3 }}>
            {messages.length === 0 && !sending && !loading && (
              <Typography
                color="text.secondary"
                align="center"
                sx={{ pt: "20vh" }}
              >
                {emptyText}
              </Typography>
            )}
            {loading && (
              <Typography color="text.secondary">Loading…</Typography>
            )}
            {groupToolCalls(messages).map(({ i, message, calls }) =>
              calls ? (
                calls.length === 1 ? (
                  <ToolCallLine key={i} call={calls[0]} busy={busy} />
                ) : (
                  <ToolCallGroup key={i} calls={calls} busy={busy} />
                )
              ) : message.role === "compaction" ? (
                <CompactionMarker key={i} summary={message.summary} />
              ) : (
                <MessageBubble
                  key={i}
                  message={message}
                  ref={i === messages.length - 1 ? lastMessageRef : undefined}
                />
              ),
            )}
            {sending && (
              <MessageBubble message={{ role: "user", content: sending }} />
            )}
            {pending.length > 0 && (
              <ApprovalCard
                actions={pending}
                loading={decideLoading}
                onDecide={decide}
              />
            )}
            {busy && (
              <MessageBubble
                message={{ role: "assistant", content: "" }}
                loading
              />
            )}
            {error && <Alert severity="error">{errorMessage(error)}</Alert>}
          </Stack>
        </Container>
      </Box>

      <Box
        sx={{
          height: 0,
          overflow: "visible",
          position: "relative",
        }}
      >
        <Box
          sx={{
            py: 3,
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            background: (theme) =>
              `linear-gradient(transparent, ${(theme.vars || theme).palette.background.default} 40%)`,
          }}
        >
          {/* Shown while scrolled up: jumps back to the latest message. */}
          {messagesBelow !== null && (
            <Box
              sx={{
                position: "absolute",
                top:-20,
                left: 0,
                right: 0,
                display: "flex",
                justifyContent: "center",
              }}
            >
              <Chip
                clickable
                onClick={scrollToBottom}
                icon={<KeyboardArrowDownIcon color="inherit" />}
                label={
                  messagesBelow > 0
                    ? `${messagesBelow} message${messagesBelow === 1 ? "" : "s"}`
                    : undefined
                }
                sx={{
                  bgcolor: "primary.main",
                  color: "primary.contrastText",
                  ":hover": {
                    bgcolor: "primary.light",
                  color: "primary.contrastText",
                  }
                }}
              />
            </Box>
          )}
          <Container maxWidth={false} sx={{ maxWidth: 780 }}>
            <ChatInput
              value={draft}
              loading={sendLoading}
              onChange={setDraft}
              handleKeyDown={handleKeyDown}
              disabled={pending.length > 0}
              canSend={canSend}
              stoppable={stoppable}
              onStop={stopAgent}
              placeholder={
                pending.length
                  ? "Approve or reject above first"
                  : stoppable
                    ? "Send to steer the agent, or stop it"
                    : placeholder
              }
              onSubmit={sendDraft}
            />
          </Container>
        </Box>
      </Box>
    </Box>
  );
}

export default Chat;
