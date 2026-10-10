import { useId, useMemo, useState } from "react";
import CloseIcon from "@mui/icons-material/Close";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Container, Dialog, DialogContent, DialogTitle, IconButton, Skeleton, Stack, Typography } from "@mui/material";
import type { AgentRole, PipelineResume, PipelineState } from "shared";
import { errorMessage } from "../api/client.ts";
import { useForge, usePipelineControl, useRedirectPipeline, useResumePipeline, useStartPipeline } from "../api/forge.ts";
import { useChatScroll } from "../hooks/useChatScroll.ts";
import CheckpointActivity from "./forge-activity/CheckpointActivity.tsx";
import BrowserView from "./pipeline/BrowserView.tsx";
import { FeedbackCard } from "./pipeline/Cards.tsx";
import CommitCard from "./pipeline/CommitCard.tsx";
import SteeringControls from "./pipeline/SteeringControls.tsx";
import PipelineDocument from "./pipeline/PipelineDocument.tsx";
import PipelineRequest from "./pipeline/PipelineRequest.tsx";
import PullRequestCard from "./pipeline/PullRequestCard.tsx";
import { PIPELINE_STEPS } from "./pipeline/progress.ts";

function ForgeContent({ issueId, pipeline }: { issueId: string; pipeline: PipelineState }) {
  const [selected, setSelected] = useState<AgentRole | null>(null);
  const titleId = useId();
  const start = useStartPipeline(issueId);
  const resume = useResumePipeline(issueId);
  const control = usePipelineControl(issueId);
  const redirect = useRedirectPipeline(issueId);
  const reply = (response: PipelineResume) => resume.mutate(response);
  const failure = start.error ?? resume.error ?? control.error ?? redirect.error;
  const [activityContent, setActivityContent] = useState("");
  const content = useMemo(() => ({ pipeline, activityContent }), [pipeline, activityContent]);
  const { scrollRef, onScroll, onScrollEnd, messagesBelow, scrollToBottom } = useChatScroll({
    content, sending: start.isPending || resume.isPending || redirect.isPending, busy: Boolean(pipeline.running),
    error: Boolean(failure || pipeline.error), lastIsReply: false,
  });
  const hasControl = Boolean(pipeline.running || pipeline.pausing || pipeline.canResume);

  return (
    <Box sx={{ flex: 1, minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column", position: "relative" }}>
      <Box ref={scrollRef} onScroll={onScroll} onScrollEnd={onScrollEnd} aria-label="Forge conversation"
        sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
      <Container maxWidth={false} sx={{ maxWidth: 750, pt: 3, pb: 18 }}>
      <Stack spacing={3}>
      {pipeline.started && <CheckpointActivity issueId={issueId} pipeline={pipeline} onSelect={setSelected}
        onContentChange={setActivityContent} />}
      {pipeline.error && <Alert severity="error">{pipeline.error}</Alert>}
      {failure && <Alert severity="error">{errorMessage(failure)}</Alert>}
      <Box data-chat-message="">
        <PipelineRequest issueId={issueId} pipeline={pipeline} onStart={(note) => start.mutate(note)} onReply={reply} onRedirect={(request) => redirect.mutate(request)}
          sending={start.isPending || resume.isPending || redirect.isPending || Boolean(pipeline.redirecting)} />
      </Box>
      {pipeline.finished && <>
        <CommitCard issueId={issueId} />
        <PullRequestCard issueId={issueId} />
        <FeedbackCard
          title="Request changes"
          placeholder="Describe what to change. The coder will revise it, followed by setup, checks, review, and QA."
          feedbackLabel="Send to coder" onFeedback={(feedback) => redirect.mutate({ target: "coder", feedback })} loading={resume.isPending || redirect.isPending || Boolean(pipeline.redirecting)} />
      </>}
      {pipeline.browserUrl && <Accordion slotProps={{ transition: { unmountOnExit: true } }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}><Typography>Live product preview</Typography></AccordionSummary>
        <AccordionDetails><BrowserView issueId={issueId} url={pipeline.browserUrl} /></AccordionDetails>
      </Accordion>}
      </Stack>
      </Container>
      </Box>
      {(hasControl || pipeline.started || messagesBelow !== null) && <Box sx={{ position: "absolute", bottom: 0, left: 0, right: 0,
        pt: 4, pb: 3, pointerEvents: "none",
        background: (theme) => `linear-gradient(transparent, ${(theme.vars || theme).palette.background.default} 50%)` }}>
        <Stack spacing={1} sx={{ alignItems: "center" }}>
          {messagesBelow !== null && <Button variant="contained" size="small" startIcon={<KeyboardArrowDownIcon />}
            onClick={scrollToBottom} sx={{ pointerEvents: "auto" }}>Latest activity</Button>}
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            {hasControl && <Button variant="outlined" loading={control.isPending || pipeline.pausing}
              disabled={start.isPending || resume.isPending || redirect.isPending || pipeline.pausing || pipeline.redirecting}
              onClick={() => control.mutate(pipeline.running ? "pause" : "continue")}
              sx={{ pointerEvents: "auto", bgcolor: "background.default" }}>
              {pipeline.pausing ? "Pausing…" : pipeline.running ? "Pause" : "Resume"}
            </Button>}
            {pipeline.started && <SteeringControls issueId={issueId} pipeline={pipeline} disabled={start.isPending || resume.isPending || redirect.isPending || control.isPending} />}
          </Stack>
        </Stack>
      </Box>}
      <Dialog open={selected !== null} onClose={() => setSelected(null)} fullWidth
        maxWidth={selected === "coder" ? "lg" : "md"} aria-labelledby={titleId}>
        <DialogTitle id={`${titleId}-heading`} sx={{ pr: 7 }}>
          <span id={titleId}>{PIPELINE_STEPS.find((step) => step.role === selected)?.label}</span>
          <IconButton aria-label="Close document" onClick={() => setSelected(null)} sx={{ position: "absolute", right: 12, top: 12 }}><CloseIcon /></IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {selected && <PipelineDocument issueId={issueId} pipeline={pipeline} role={selected} />}
        </DialogContent>
      </Dialog>
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
