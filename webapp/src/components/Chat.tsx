import { Alert, Box, Chip, Container, Stack, Typography } from "@mui/material";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import { errorMessage } from "../api.ts";
import type { ChatState } from "../hooks/useChat.ts";
import { useChatScroll } from "../hooks/useChatScroll.ts";
import ApprovalCard from "./ApprovalCard.tsx";
import ChatAvatar from "./ChatAvatar.tsx";
import ChatInput from "./ChatInput.tsx";
import { MessageBubble } from "./MessageBubble.tsx";

type ChatProps = {
  // From useChat; the role's page decides which thread and API it talks to.
  chat: ChatState;
  avatar: { src: string; label: string };
  // Shown in an empty chat.
  emptyText: string;
  placeholder: string;
};

// A chat with any agent role: messages, approvals and the input box.
function Chat({ chat, avatar, emptyText, placeholder }: ChatProps) {
  const {
    thread,
    messages,
    pending,
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
  } = chat;

  const { scrollRef, lastMessageRef, onScroll, onScrollEnd, messagesBelow, scrollToBottom } = useChatScroll({
    content: thread.data,
    sending: Boolean(sending),
    busy,
    error: Boolean(error),
    lastIsReply: messages.at(-1)?.role === "assistant",
  });

  return (
    <Box
      sx={{
        flex: 1,
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

          "&::-webkit-scrollbar": {
            display: "none", // Safari and Chrome
          },
          msOverflowStyle: "none", // IE and Edge
        }}
      >
        <ChatAvatar src={avatar.src} label={avatar.label} />
        <Container maxWidth={false} sx={{ maxWidth: 750 }}>
          <Stack spacing={2} sx={{ pt: 3 }}>
            {messages.length === 0 && !sending && !thread.isLoading && (
              <Typography
                color="text.secondary"
                align="center"
                sx={{ pt: "20vh" }}
              >
                {emptyText}
              </Typography>
            )}
            {thread.isLoading && (
              <Typography color="text.secondary">Loading…</Typography>
            )}
            {messages.map((message, i) => (
              <MessageBubble
                key={i}
                message={message}
                ref={i === messages.length - 1 ? lastMessageRef : undefined}
              />
            ))}
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
              placeholder={
                pending.length ? "Approve or reject above first" : placeholder
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
