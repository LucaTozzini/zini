import {
  Typography,
  Box,
  Card,
  Grid,
} from "@mui/material";
import type { Ref } from "react";
import type { ChatMessage } from "shared";
import MarkdownText from "../MarkdownText.tsx";
import LineLimit from "../LineLimit.tsx";
import { useUserMe } from "../../api/users.ts";

type HumanMessageProps = {
  message: Extract<ChatMessage, { role: "user" }>;
  ref?: Ref<HTMLDivElement>;
  lineLimit?: number;
};

const MessageImages = ({ images }: { images?: string[] }) => {
  if (!images?.length) return null;

  return (
    <Grid
      container
      spacing={1}
      sx={{
        width: "80%",
        alignSelf: "flex-end",
        justifyContent: "flex-end",
        mb: 1,
      }}
    >
      {images.map((src, i) => (
        <Grid
          key={i}
          size={{ xs: 6, sm: 4, md: 3 }}
          component="img"
          src={src}
          alt={`Attached image ${i + 1}`}
          sx={{
            objectFit: "cover",
            borderRadius: 1,
            aspectRatio: 5 / 4,
          }}
        />
      ))}
    </Grid>
  );
};

export function HumanMessage({
  message,
  ref,
  lineLimit = 12,
}: HumanMessageProps) {
  const { data: user } = useUserMe();

  const username = user?.username;
  const ownMessage = Boolean(username && username === message.username);
  const bgcolor = ownMessage ? "primary.main" : "secondary.main";
  const color = ownMessage ? "primary.contrastText" : "secondary.contrastText";

  return (
    <Box
      ref={ref}
      data-chat-message=""
      sx={{ display: "flex", flexDirection: "column" }}
    >
      {message.username && (
        <Typography
          variant={"caption"}
          align={"right"}
          sx={{ mb: 0, color: "text.secondary" }}
        >
          @{message.username}
        </Typography>
      )}
      <MessageImages images={message.images} />
      {message.content && (
        <Card
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
      )}
    </Box>
  );
}
