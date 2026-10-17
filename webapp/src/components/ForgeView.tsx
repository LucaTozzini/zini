import { useMemo, useState } from "react";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Container, Skeleton, Stack, Typography } from "@mui/material";
import type { PipelineResume, PipelineState } from "shared";
import { errorMessage } from "../api/client.ts";
import { useForge, useMessagePipeline, usePipelineControl, useResumePipeline, useStartPipeline } from "../api/forge.ts";
import { useWorkspaceDiff } from "../api/workspaces.ts";
import { useChatScroll } from "../hooks/useChatScroll.ts";
import CheckpointActivity from "./forge-activity/CheckpointActivity.tsx";
import BrowserView from "./pipeline/BrowserView.tsx";
import CommitCard from "./pipeline/CommitCard.tsx";
import DiffView from "./pipeline/DiffView.tsx";
import { PlanView } from "./pipeline/Documents.tsx";
import PipelineRequest from "./pipeline/PipelineRequest.tsx";
import PullRequestCard from "./pipeline/PullRequestCard.tsx";

// The workspace's changes, fetched only while open.
function Changes({ issueId }: { issueId: string }) {
  const diff = useWorkspaceDiff(issueId, true);
  if (diff.isPending) return <Skeleton height={120} />;
  if (diff.isError) return <Alert severity="error">{errorMessage(diff.error)}</Alert>;
  return diff.data?.diff ? <DiffView diff={diff.data.diff} truncated={diff.data.truncated} />
    : <Typography color="text.secondary">No workspace changes yet.</Typography>;
}

function ForgeContent({ issueId, pipeline }: { issueId: string; pipeline: PipelineState }) {
  const start = useStartPipeline(issueId);
  const resume = useResumePipeline(issueId);
  const message = useMessagePipeline(issueId);
  const control = usePipelineControl(issueId);
  const reply = (response: PipelineResume) => resume.mutate(response);
  const sending = start.isPending || resume.isPending || message.isPending;
  const failure = start.error ?? resume.error ?? message.error ?? control.error;
  const [activityContent, setActivityContent] = useState("");
  const content = useMemo(() => ({ pipeline, activityContent }), [pipeline, activityContent]);
  const { scrollRef, onScroll, onScrollEnd, messagesBelow, scrollToBottom } = useChatScroll({
    content, sending, busy: Boolean(pipeline.running),
    error: Boolean(failure || pipeline.error), lastIsReply: false,
  });
  const hasControl = Boolean(pipeline.running || pipeline.pausing || pipeline.canResume);

  return (
    <Box sx={{ flex: 1, minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column", position: "relative" }}>
      <Box ref={scrollRef} onScroll={onScroll} onScrollEnd={onScrollEnd} aria-label="Forge conversation"
        sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
      <Container maxWidth={false} sx={{ maxWidth: 750, pt: 3, pb: 18 }}>
      <Stack spacing={3}>
      {pipeline.plan && <Accordion defaultExpanded>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}><Typography>
          Plan{pipeline.planApproved ? "" : " (not approved yet)"}{pipeline.finished ? " · finished" : ""}
        </Typography></AccordionSummary>
        <AccordionDetails><PlanView plan={pipeline.plan} /></AccordionDetails>
      </Accordion>}
      {pipeline.started && <Accordion slotProps={{ transition: { unmountOnExit: true } }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}><Typography>Code changes</Typography></AccordionSummary>
        <AccordionDetails><Changes issueId={issueId} /></AccordionDetails>
      </Accordion>}
      {pipeline.started && <CheckpointActivity issueId={issueId} pipeline={pipeline} onContentChange={setActivityContent} />}
      {pipeline.error && <Alert severity="error">{pipeline.error}</Alert>}
      {pipeline.integration?.status === "conflicts" && <Alert severity="warning">
        Resolving conflicts with {pipeline.integration.targetBranch}
        {pipeline.integration.conflicts.length > 0 && ` — ${pipeline.integration.conflicts.join(", ")}`}
      </Alert>}
      {failure && <Alert severity="error">{errorMessage(failure)}</Alert>}
      {pipeline.finished && <>
        <CommitCard issueId={issueId} />
        <PullRequestCard issueId={issueId} />
      </>}
      <Box data-chat-message="">
        <PipelineRequest issueId={issueId} pipeline={pipeline} onStart={(note) => start.mutate(note)} onReply={reply}
          onMessage={(text) => message.mutate(text)} sending={sending} />
      </Box>
      {pipeline.browserUrl && <Accordion slotProps={{ transition: { unmountOnExit: true } }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}><Typography>Live product preview</Typography></AccordionSummary>
        <AccordionDetails><BrowserView issueId={issueId} url={pipeline.browserUrl} /></AccordionDetails>
      </Accordion>}
      </Stack>
      </Container>
      </Box>
      {(hasControl || messagesBelow !== null) && <Box sx={{ position: "absolute", bottom: 0, left: 0, right: 0,
        pt: 4, pb: 3, pointerEvents: "none",
        background: (theme) => `linear-gradient(transparent, ${(theme.vars || theme).palette.background.default} 50%)` }}>
        <Stack spacing={1} sx={{ alignItems: "center" }}>
          {messagesBelow !== null && <Button variant="contained" size="small" startIcon={<KeyboardArrowDownIcon />}
            onClick={scrollToBottom} sx={{ pointerEvents: "auto" }}>Latest activity</Button>}
          {hasControl && <Button variant="outlined" loading={control.isPending || pipeline.pausing}
            disabled={sending || pipeline.pausing}
            onClick={() => control.mutate(pipeline.running ? "pause" : "continue")}
            sx={{ pointerEvents: "auto", bgcolor: "background.default" }}>
            {pipeline.pausing ? "Pausing…" : pipeline.running ? "Pause" : "Resume"}
          </Button>}
        </Stack>
      </Box>}
    </Box>
  );
}

function ForgeView({ issueId }: { issueId: string }) {
  const pipeline = useForge(issueId);
  if (pipeline.isPending) return <Skeleton height={120} />;
  if (pipeline.isError) return <Alert severity="error">{errorMessage(pipeline.error)}</Alert>;
  return <ForgeContent key={issueId} issueId={issueId} pipeline={pipeline.data} />;
}

export default ForgeView;
