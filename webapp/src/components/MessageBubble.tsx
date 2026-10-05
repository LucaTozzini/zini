import { Paper, Typography, useTheme, Box, Button } from "@mui/material";
import { useId, useLayoutEffect, useRef, useState, type Ref } from "react";
import type { ChatMessage } from "shared";

import { BeatLoader } from "react-spinners";
import MarkdownText from "./MarkdownText.tsx";
import { useProfile } from "../api/profile.ts";

type MessageBubbleProps = {
  // Tool calls show as a ToolCallLine instead, compactions as a CompactionMarker.
  message: Extract<ChatMessage, { role: "user" | "assistant" }>;
  ref?: Ref<HTMLDivElement>;
  loading?: boolean;
  lineLimit?: number;
};

export function MessageBubble({
  message,
  ref,
  loading = false,
  lineLimit = 12,
}: MessageBubbleProps) {
  const contentId = useId();
  const previewRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [expandedContent, setExpandedContent] = useState<string | null>(null);
  const expanded = expandedContent === message.content;
  const lines = Math.max(1, Math.floor(lineLimit));
  useLayoutEffect(() => {
    const preview = previewRef.current;
    const content = contentRef.current;
    if (!preview || !content) {
      setOverflows(false);
      return;
    }
    const measure = () => {
      const limit = parseFloat(getComputedStyle(preview).lineHeight) * lines;
      setOverflows(content.scrollHeight > limit + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [message.content, lines, loading]);
  const isUser = message.role === "user";
  const theme = useTheme();
  const { data: profile } = useProfile();

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
          maxWidth: isUser ? "85%" : "97%",
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

          position: "relative",
          overflow: "hidden",
        }}
      >
        {loading ? (
          <BeatLoader
            size={8}
            margin={1}
            color={(theme.vars || theme).palette.text.secondary}
          />
        ) : (
          <>
            <Box
              id={contentId}
              ref={previewRef}
              sx={{
                typography: "body1",
                overflow: "hidden",
                maxHeight: expanded ? "none" : `${lines}lh`,
              }}
            >
              <Box ref={contentRef}>
                <MarkdownText>{message.content}</MarkdownText>
              </Box>
            </Box>
            {overflows && (
              <Box
                sx={{
                  background: (theme) =>
                    `linear-gradient(transparent, ${(theme.vars || theme).palette.background.secondary})`,
                  position: expanded ? "relative" : "absolute",
                  bottom: 0,
                  left: 0,
                  right: 0,
                  pt: expanded ? 2 : 15
                }}
              >
                <Button
                  fullWidth
                  size="small"
                  color="inherit"
                  aria-expanded={expanded}
                  aria-controls={contentId}
                  onClick={() =>
                    setExpandedContent(expanded ? null : message.content)
                  }
                  sx={{
                    color: expanded ? "text.secondary" : "text.primary"
                  }}
                >
                  {expanded ? "Show less" : "Show more"}
                </Button>
              </Box>
            )}
          </>
        )}
      </Paper>
    </Box>
  );
}
