import { useEffect, useMemo } from "react";
import { Alert, Box, Divider, Skeleton, Stack, Typography } from "@mui/material";
import type { PipelineState } from "shared";
import { errorMessage } from "../../api/client.ts";
import { useForgeMessages } from "../../api/forge.ts";
import { HumanMessage } from "../chat/HumanMessage.tsx";
import AiMessage from "../chat/AiMessage.tsx";
import ThinkingIndicator from "../ThinkingIndicator.tsx";
import CompactionMarker from "../CompactionMarker.tsx";
import ToolCallLine from "../ToolCallLine.tsx";
import ToolCallGroup from "../ToolCallGroup.tsx";
import { groupMessages } from "./groupMessages.ts";

const titles = { lead: "Lead", coder: "Coder", reviewer: "Reviewer" };

// The Lead's and its workers' conversations, in time order, with a divider wherever the
// speaking agent changes.
export default function CheckpointActivity({ issueId, pipeline, onContentChange }: {
  issueId: string; pipeline: PipelineState; onContentChange: (key: string) => void;
}) {
  const history = useForgeMessages(issueId);
  const items = useMemo(() => groupMessages(history.data ?? []), [history.data]);
  const busy = Boolean(pipeline.running);
  useEffect(() => onContentChange(String(history.dataUpdatedAt)), [history.dataUpdatedAt, onContentChange]);
  return <Stack spacing={2} aria-label="Forge activity" sx={{ minWidth: 0 }}>
    {history.isPending && <Skeleton height={100} />}
    {history.isError && <Alert severity="error">{errorMessage(history.error)}</Alert>}
    {history.data?.length === 0 && <Typography variant="body2" color="text.secondary">Activity will appear when the Lead starts.</Typography>}
    {items.map((item, i) => <Box key={item.id} data-chat-message="" sx={{ minWidth: 0 }}>
      {item.agent && item.agent !== items[i - 1]?.agent && <Divider textAlign="center" sx={{ mt: 1, mb: 2 }}>
        <Typography variant="caption" color="text.secondary">
          {titles[item.agent]} · {new Date(item.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </Typography>
      </Divider>}
      {item.kind === "message" ? item.message.role === "compaction" ?
        <CompactionMarker summary={item.message.summary} /> : item.message.role === "user" ?
          <HumanMessage message={item.message} /> : <AiMessage content={item.message.content} /> :
        item.tools.length === 1 ?
          <ToolCallLine call={item.tools[0].call} busy={busy} result={item.tools[0].result} /> :
          <ToolCallGroup calls={item.tools.map((tool) => tool.call)} results={item.tools.map((tool) => tool.result)} busy={busy} />}
    </Box>)}
    {busy && <ThinkingIndicator />}
  </Stack>;
}
