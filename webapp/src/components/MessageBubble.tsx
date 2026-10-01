import { Paper, Typography, useTheme, Box } from "@mui/material";
import type { Ref } from "react";
import type { ChatMessage } from "shared";

import { BeatLoader } from "react-spinners";
import MarkdownText from "./MarkdownText.tsx";
import { useProfile } from "../api/profile.ts";

type MessageBubbleProps = {
  // Tool calls show as a ToolCallLine instead, compactions as a CompactionMarker.
  message: Extract<ChatMessage, { role: "user" | "assistant" }>;
  ref?: Ref<HTMLDivElement>;
  loading?: boolean;
};

export function MessageBubble({
  message,
  ref,
  loading = false,
}: MessageBubbleProps) {
  const isUser = message.role === "user";
  const theme = useTheme();
  const {
    data: profile,
  } = useProfile();

  const username = profile?.username;

  return (
    <Box sx={{ display: "flex", flexDirection: "column" }}>
      {isUser && message.username && (
        <Typography
          variant={"caption"}
          align={"right"}
          sx={{ mb: 0, color: "text.secondary" }}
        >
          @{message.username}
        </Typography>
      )}
      <Paper
        ref={ref}
        // Lets the chat count messages below the view; the loading bubble isn't one.
        data-chat-message={loading ? undefined : ""}
        variant="elevation"
        elevation={0}
        sx={{
          px: 2,
          py: 1,
          maxWidth: isUser ? "85%" : undefined,
          // User messages are plain text, so keep their line breaks. Replies are
          // markdown, which handles its own.
          whiteSpace: isUser ? "pre-wrap" : undefined,

          alignSelf: isUser ? "flex-end" : "flex-start",
          borderRadius: 6,
          borderBottomLeftRadius: isUser ? undefined : 4,
          borderBottomRightRadius: isUser ? 4 : undefined,
          bgcolor: isUser
            ? username == message.username
              ? "primary.main"
              : "secondary.main"
            : "background.secondary",
          color: isUser ? "primary.contrastText" : undefined,
        }}
      >
        {loading ? (
          <BeatLoader
            size={8}
            margin={1}
            color={(theme.vars || theme).palette.text.secondary}
          />
        ) : (
          <MarkdownText>{message.content}</MarkdownText>
        )}
      </Paper>
    </Box>
  );
}
