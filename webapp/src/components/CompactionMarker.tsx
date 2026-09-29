import { useState } from "react";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { ButtonBase, Collapse, Divider } from "@mui/material";
import MarkdownText from "./MarkdownText.tsx";

// Where the conversation was compacted: the agent now sees a summary of the messages
// above instead of the messages themselves. Expanded to show that summary.
function CompactionMarker({ summary }: { summary: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <Divider>
        <ButtonBase
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          sx={{ gap: 0.5, typography: "caption", color: "text.secondary" }}
        >
          Conversation compacted
          <ExpandMoreIcon
            fontSize="small"
            sx={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 150ms" }}
          />
        </ButtonBase>
      </Divider>
      <Collapse in={open} unmountOnExit>
        <MarkdownText color="text.secondary" sx={{ mt: 1 }}>
          {summary}
        </MarkdownText>
      </Collapse>
    </div>
  );
}

export default CompactionMarker;
