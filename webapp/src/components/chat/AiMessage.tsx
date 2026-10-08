import { Card } from "@mui/material";
import type { Ref } from "react";
import MarkdownText from "../MarkdownText";
import LineLimit from "../LineLimit.tsx";

type AiMessageProps = {
  content: string;
  ref?: Ref<HTMLDivElement>;
  lineLimit?: number;
};
const AiMessage = ({ content, ref, lineLimit }: AiMessageProps) => {
  return (
    <Card
      data-chat-message=""
      ref={ref}
      sx={{ p: 1.5, width: "fit-content", maxWidth: "100%", }}
      variant="outlined"
    >
      <LineLimit
        key={content}
        lineLimit={lineLimit}
        fadeColor="background.paper"
      >
        <MarkdownText>{content}</MarkdownText>
      </LineLimit>
    </Card>
  );
};

export default AiMessage;
