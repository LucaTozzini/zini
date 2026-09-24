import { Paper, Typography, useTheme } from "@mui/material";
import type { Ref } from "react";
import type { ChatMessage } from "shared";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { BeatLoader } from "react-spinners";

// Links open in a new tab instead of replacing the chat. noreferrer also stops the
// new page from reaching back into this one through window.opener.
const markdownComponents: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
};

type MessageBubbleProps = {
  message: ChatMessage;
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

  return (
    <Paper
      ref={ref}
      // Lets the chat count messages below the view; the loading bubble isn't one.
      data-chat-message={loading ? undefined : ""}
      variant="elevation"
      elevation={0}
      sx={{
        px: 2,
        py: 1,
        maxWidth: "85%",
        // User messages are plain text, so keep their line breaks. Replies are
        // markdown, which handles its own; trim its outer paragraph margins.
        whiteSpace: isUser ? "pre-wrap" : undefined,
        "& > .markdown > :first-child": { mt: 0 },
        "& > .markdown > :last-child": { mb: 0 },

        alignSelf: isUser ? "flex-end" : "flex-start",
        borderRadius: 6,
        borderBottomLeftRadius: isUser ? undefined : 4,
        borderBottomRightRadius: isUser ? 4 : undefined,
        bgcolor: isUser ? "primary.main" : "background.secondary",
        color: isUser ? "primary.contrastText" : undefined,
      }}
    >
      {loading ? (
        <BeatLoader size={8} margin={1} color={(theme.vars || theme).palette.text.secondary}  />
      ) : (
        <Typography component="div" className="markdown">
          <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {message.content}
          </Markdown>
        </Typography>
      )}
    </Paper>
  );
}
