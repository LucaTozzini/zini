import { Alert, Box, Chip, Container, Stack, Typography } from "@mui/material";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import type { FormEvent, KeyboardEvent, ReactNode } from "react";
import {
  fileInfo,
  type ChatEntry,
  type ChatFile,
  type ProjectLeadMessage,
  type Decision,
  type PendingAction,
  type Todo,
} from "shared";
import { errorMessage } from "../api/client.ts";
import { useChatScroll } from "../hooks/useChatScroll.ts";
import ApprovalCard from "./ApprovalCard.tsx";
import ChatInput from "./chat/ChatInput.tsx";
import { HumanMessage } from "./chat/HumanMessage.tsx";
import ThinkingIndicator from "./ThinkingIndicator.tsx";
import ChatHeader from "./ChatHeader.tsx";
import MessageList from "./chat/MessageList.tsx";

// Everything the chat shows and does, whatever agent and API are behind it (e.g.
// useChat for the project lead).
export type ChatState = {
  messages: ChatEntry[];
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
  sending: ProjectLeadMessage | null | undefined;
  images: string[];
  setImages: (images: string[]) => void;
  files: ChatFile[];
  setFiles: (files: ChatFile[]) => void;
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

type ChatProps = {
  chat: ChatState;
  // The chat's title, and the agent it's with.
  title: string;
  agent: { name: string; icon: ReactNode };
  // Shown in an empty chat: a heading, a line under it, and messages to start from,
  // each put in the input when clicked.
  emptyTitle: string;
  emptyText: string;
  suggestions?: { label: string; message: string }[];
  placeholder: string;
  headerActions?: ReactNode;
};

// A chat with any agent role: messages, approvals and the input box.
function Chat({ chat, title, agent, emptyTitle, emptyText, suggestions = [], placeholder, headerActions }: ChatProps) {
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
        <ChatHeader title={title} agent={agent.name} icon={agent.icon} todos={todos} notes={notes} actions={headerActions} />
        <Container maxWidth={"md"}>
          <Stack spacing={3} sx={{ pt: 3 }}>
            {messages.length === 0 && !sending && !loading && (
              <Stack spacing={2} sx={{ pt: "16vh", alignItems: "center", textAlign: "center" }}>
                <Box
                  sx={{
                    display: "grid",
                    placeItems: "center",
                    width: 56,
                    height: 56,
                    borderRadius: 3,
                    bgcolor: "action.selected",
                    color: "primary.main",
                    "& .MuiSvgIcon-root": { fontSize: 30 },
                  }}
                >
                  {agent.icon}
                </Box>
                <Box>
                  <Typography variant="h5" component="h1" gutterBottom>
                    {emptyTitle}
                  </Typography>
                  <Typography color="text.secondary">{emptyText}</Typography>
                </Box>
                {suggestions.length > 0 && (
                  <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", justifyContent: "center", pt: 1 }}>
                    {suggestions.map(({ label, message }) => (
                      <Chip key={label} label={label} variant="outlined" clickable onClick={() => setDraft(message)} />
                    ))}
                  </Stack>
                )}
              </Stack>
            )}
            {loading && <Typography color="text.secondary">Loading…</Typography>}
            <MessageList entries={messages} busy={busy} lastMessageRef={lastMessageRef} />
            {sending && (
              <HumanMessage
                message={{ role: "user", content: sending.message, images: sending.images, files: fileInfo(sending.files) }}
              />
            )}
            {pending.length > 0 && <ApprovalCard actions={pending} loading={decideLoading} onDecide={decide} />}
            {busy && <ThinkingIndicator />}
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
            py: 2,
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            background: (theme) => `linear-gradient(transparent, ${(theme.vars || theme).palette.background.default} 40%)`,
          }}
        >
          {/* Shown while scrolled up: jumps back to the latest message. */}
          {messagesBelow !== null && (
            <Box
              sx={{
                position: "absolute",
                top: -20,
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
                label={messagesBelow > 0 ? `${messagesBelow} message${messagesBelow === 1 ? "" : "s"}` : undefined}
                sx={{
                  bgcolor: "primary.main",
                  color: "primary.contrastText",
                  ":hover": {
                    bgcolor: "primary.light",
                    color: "primary.contrastText",
                  },
                }}
              />
            </Box>
          )}
          <Container maxWidth={"md"}>
            <ChatInput
              images={chat.images}
              onImagesChange={chat.setImages}
              files={chat.files}
              onFilesChange={chat.setFiles}
              value={draft}
              loading={sendLoading}
              onChange={setDraft}
              handleKeyDown={handleKeyDown}
              disabled={pending.length > 0}
              canSend={canSend}
              stoppable={stoppable}
              onStop={stopAgent}
              placeholder={
                pending.length ? "Approve or reject above first" : stoppable ? "Send to steer the agent, or stop it" : placeholder
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
