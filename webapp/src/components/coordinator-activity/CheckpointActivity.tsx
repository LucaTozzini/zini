import { useEffect, useMemo } from "react";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import { Alert, Box, Button, Divider, Skeleton, Stack, Typography } from "@mui/material";
import type { AgentRole, PipelineState } from "shared";
import { errorMessage } from "../../api/client.ts";
import { useCoordinatorMessages } from "../../api/coordinator.ts";
import { MessageBubble } from "../MessageBubble.tsx";
import CompactionMarker from "../CompactionMarker.tsx";
import ToolCallLine from "../ToolCallLine.tsx";
import ToolCallGroup from "../ToolCallGroup.tsx";
import { groupMessages } from "./groupMessages.ts";

const titles = { planner: "Planner", coder: "Coder", checks: "Checks", reviewer: "Reviewer", qa: "Product QA" };

export default function CheckpointActivity({ issueId, pipeline, onSelect, onContentChange }: {
  issueId: string; pipeline: PipelineState; onSelect: (role: AgentRole) => void; onContentChange: (key: string) => void;
}) {
  const history = useCoordinatorMessages(issueId);
  const items = useMemo(() => groupMessages(history.data ?? []), [history.data]);
  const busy = Boolean(pipeline.running);
  useEffect(() => onContentChange(String(history.dataUpdatedAt)), [history.dataUpdatedAt, onContentChange]);
  return <Stack spacing={2} aria-label="Coordinator activity" sx={{ minWidth: 0 }}>
    {history.isPending && <Skeleton height={100} />}
    {history.isError && <Alert severity="error">{errorMessage(history.error)}</Alert>}
    {history.data?.length === 0 && <Typography variant="body2" color="text.secondary">Activity will appear when the first stage starts.</Typography>}
    {items.map((item) => <Box key={item.id} data-chat-message="" sx={{ minWidth: 0 }}>
      {item.kind === "stage" ? <Divider textAlign="center" sx={{ mt: 1, mb: 1 }}><Typography variant="caption" color="text.secondary">
        {item.agent && titles[item.agent]} · {new Date(item.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </Typography></Divider> : item.kind === "message" ? item.message.role === "compaction" ?
        <CompactionMarker summary={item.message.summary} /> : <MessageBubble message={item.message} /> :
        item.kind === "tools" ? item.tools.length === 1 ?
          <ToolCallLine call={item.tools[0].call} busy={busy} result={item.tools[0].result} /> :
          <ToolCallGroup calls={item.tools.map((tool) => tool.call)} results={item.tools.map((tool) => tool.result)} busy={busy} /> :
          item.agent && <Button size="small" startIcon={<DescriptionOutlinedIcon />} onClick={() => onSelect(item.agent!)}>
            {titles[item.agent]} document created · Open latest
          </Button>}
    </Box>)}
    {busy && <MessageBubble message={{ role: "assistant", content: "" }} loading />}
  </Stack>;
}
