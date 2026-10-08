import { Typography, Box, Card } from "@mui/material";
import type { Ref } from "react";
import type { ChatMessage } from "shared";

import MarkdownText from "../MarkdownText.tsx";
import LineLimit from "../LineLimit.tsx";
import { useProfile } from "../../api/profile.ts";

type HumanMessageProps = {
  message: Extract<ChatMessage, { role: "user" }>;
  ref?: Ref<HTMLDivElement>;
  lineLimit?: number;
};

export function HumanMessage({
  message,
  ref,
  lineLimit = 12,
}: HumanMessageProps) {
  const { data: profile } = useProfile();

  const username = profile?.username;
  const bgcolor =
    username == message.username ? "primary.main" : "secondary.main";
  const color =
    username == message.username
      ? "primary.contrastText"
      : "secondary.contrastText";

  return (
    <Box sx={{ display: "flex", flexDirection: "column" }}>
      {message.username && (
        <Typography
          variant={"caption"}
          align={"right"}
          sx={{ mb: 0, color: "text.secondary" }}
        >
          @{message.username}
        </Typography>
      )}
      <Card
        ref={ref}
        data-chat-message=""
        variant="elevation"
        elevation={0}
        sx={{
          maxWidth: "85%",
          alignSelf: "flex-end",
          bgcolor,
          color,
          position: "relative",
          overflow: "hidden",
          p: 1,
        }}
      >
        <LineLimit
          key={message.content}
          lineLimit={lineLimit}
          fadeColor={bgcolor}
        >
          <MarkdownText>{message.content}</MarkdownText>
        </LineLimit>
      </Card>
    </Box>
  );
}
